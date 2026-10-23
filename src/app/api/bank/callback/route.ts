import { NextResponse } from "next/server";
import { z } from "zod";
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
  const checkedReference = z.uuid().safeParse(reference);
  const finances = new URL("/finances", request.url);

  if (!checkedReference.success) {
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

  try {
    const admin = createAdminClient();
    const { data, error: readError } = await admin.from("bank_connections").select("*")
      .eq("reference", checkedReference.data).eq("user_id", user.id).maybeSingle();
    if (readError || !data || data.user_id !== user.id || data.reference !== reference) throw new Error("Connection unavailable");
    const conn = data as BankConnection;
    const consent = await getProvider(conn.provider).getConsent(conn);
    if (!z.object({ status: z.enum(["created", "linked", "expired", "error"]), expiresAt: z.iso.datetime({ offset: true }).nullable() }).safeParse(consent).success) throw new Error("Invalid provider consent");
    const { data: saved, error } = await admin
      .from("bank_connections")
      .update({
        status: consent.status,
        consent_expires_at: consent.expiresAt,
        last_error: consent.status === "error" ? "bank-sync-failed" : consent.status === "expired" ? "consent-expired" : null,
      })
      .eq("id", conn.id).eq("user_id", user.id).eq("updated_at", conn.updated_at).select("id").single();
    if (error || saved?.id !== conn.id) throw new Error("Consent write unconfirmed");
    finances.searchParams.set(
      "bank",
      consent.status === "linked" ? "linked" : "error",
    );
  } catch {
    finances.searchParams.set("bank", "error");
  }

  return NextResponse.redirect(finances);
}
