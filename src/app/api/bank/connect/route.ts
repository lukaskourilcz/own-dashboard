import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rejectCrossOrigin } from "@/lib/csrf";
import { createRequisition, isGoCardlessConfigured } from "@/lib/gocardless";

/**
 * Begin linking a bank: create a GoCardless requisition and hand back the
 * consent link the browser should redirect to. We stash the pending connection
 * (keyed by a random reference) so the callback can finalise it.
 */
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request);
  if (csrf) return csrf;

  if (!isGoCardlessConfigured()) {
    return NextResponse.json({ error: "not-configured" }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let body: { institutionId?: string; institutionName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }
  const institutionId = body.institutionId?.trim();
  if (!institutionId) {
    return NextResponse.json(
      { error: "institutionId is required." },
      { status: 400 },
    );
  }

  const reference = crypto.randomUUID();
  const redirect = new URL("/api/bank/callback", request.url).toString();

  try {
    const req = await createRequisition({
      institutionId,
      redirect,
      reference,
    });

    const admin = createAdminClient();
    const { error } = await admin.from("bank_connections").insert({
      user_id: user.id,
      requisition_id: req.id,
      institution_id: institutionId,
      institution_name: body.institutionName?.slice(0, 120) ?? null,
      reference,
      status: "created",
    });
    if (error) throw error;

    return NextResponse.json({ link: req.link });
  } catch (err) {
    console.error("[api/bank/connect] failed:", err);
    return NextResponse.json(
      { error: "Could not start bank connection." },
      { status: 502 },
    );
  }
}
