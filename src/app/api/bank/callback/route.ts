import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProvider } from "@/lib/bank/registry";
import type { BankConnection } from "@/lib/types";

/**
 * The provider redirects the user here after the bank consent screen, appending
 * our `ref`. We resolve the pending connection, ask its own adapter whether the
 * bank linked, record the consent expiry, and bounce the user back to Finances
 * with the outcome. The heavy pull runs from the client via /api/bank/sync so
 * this stays fast.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const reference = url.searchParams.get("ref");
  const finances = new URL("/finances", request.url);

  if (!reference) {
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
  const { data } = await admin
    .from("bank_connections")
    .select("*")
    .eq("reference", reference)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!data) {
    finances.searchParams.set("bank", "error");
    return NextResponse.redirect(finances);
  }
  const conn = data as BankConnection;

  try {
    const consent = await getProvider(conn.provider).getConsent(conn);
    await admin
      .from("bank_connections")
      .update({
        status: consent.status,
        consent_expires_at: consent.expiresAt,
        last_error: consent.error,
      })
      .eq("id", conn.id);
    finances.searchParams.set(
      "bank",
      consent.status === "linked" ? "linked" : "error",
    );
  } catch (err) {
    console.error("[api/bank/callback] failed:", err);
    finances.searchParams.set("bank", "error");
  }

  return NextResponse.redirect(finances);
}
