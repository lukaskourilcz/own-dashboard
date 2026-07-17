import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rejectCrossOrigin } from "@/lib/csrf";
import { deleteRequisition, isGoCardlessConfigured } from "@/lib/gocardless";

/**
 * Disconnect a linked bank: revoke the requisition at GoCardless, then drop our
 * row. Already-imported transactions are left in place (they're the user's
 * data); only the live link is removed.
 */
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request);
  if (csrf) return csrf;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }
  const id = body.id?.trim();
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: conn } = await admin
    .from("bank_connections")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!conn) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // Best-effort revoke upstream; proceed with local delete regardless.
  if (isGoCardlessConfigured()) {
    try {
      await deleteRequisition(conn.requisition_id);
    } catch (err) {
      console.error("[api/bank/disconnect] revoke failed:", err);
    }
  }

  const { error } = await admin
    .from("bank_connections")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json(
      { error: "Could not disconnect." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
