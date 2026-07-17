import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRequisition, isGoCardlessConfigured } from "@/lib/gocardless";

/**
 * GoCardless redirects the user here after the bank consent screen, appending
 * our `ref`. We resolve the pending connection, record whether the bank linked,
 * and bounce the user back to Finances with the outcome. The heavy pull runs
 * from the client via /api/bank/sync so this stays fast.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const reference = url.searchParams.get("ref");
  const finances = new URL("/finances", request.url);

  if (!isGoCardlessConfigured() || !reference) {
    finances.searchParams.set("bank", "error");
    return NextResponse.redirect(finances);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const admin = createAdminClient();
  const { data: conn } = await admin
    .from("bank_connections")
    .select("*")
    .eq("reference", reference)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!conn) {
    finances.searchParams.set("bank", "error");
    return NextResponse.redirect(finances);
  }

  try {
    const req = await getRequisition(conn.requisition_id);
    const linked = req.status === "LN";
    await admin
      .from("bank_connections")
      .update({ status: linked ? "linked" : "error" })
      .eq("id", conn.id);
    finances.searchParams.set("bank", linked ? "linked" : "error");
  } catch (err) {
    console.error("[api/bank/callback] failed:", err);
    finances.searchParams.set("bank", "error");
  }

  return NextResponse.redirect(finances);
}
