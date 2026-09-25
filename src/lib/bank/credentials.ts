import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BankProviderId } from "@/lib/bank/provider";

/**
 * Per-user bank provider secrets.
 *
 * GoCardless is an app-level env pair, but a Fio token belongs to one person's
 * account, so it is user data and lives in `bank_provider_credentials` — RLS on,
 * every grant revoked from `anon` and `authenticated`, service_role only. That
 * is the same boundary `github_tokens` uses. A value read here is held in a
 * request-scoped variable and never returned to the browser, never written onto
 * a `bank_connections` row, and never logged.
 */

const TABLE = "bank_provider_credentials";

export async function readProviderSecret(
  admin: SupabaseClient,
  userId: string,
  provider: BankProviderId,
): Promise<string | null> {
  const { data, error } = await admin
    .from(TABLE)
    .select("secret")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  if (error || !data) return null;
  const secret = (data as { secret: string | null }).secret;
  return secret && secret.length > 0 ? secret : null;
}

export async function hasProviderSecret(
  admin: SupabaseClient,
  userId: string,
  provider: BankProviderId,
): Promise<boolean> {
  const { data, error } = await admin
    .from(TABLE)
    .select("user_id")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  return !error && Boolean(data);
}

export async function writeProviderSecret(
  admin: SupabaseClient,
  userId: string,
  provider: BankProviderId,
  secret: string,
): Promise<void> {
  const { error } = await admin.from(TABLE).upsert(
    {
      user_id: userId,
      provider,
      secret,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider" },
  );
  if (error) throw error;
}

export async function deleteProviderSecret(
  admin: SupabaseClient,
  userId: string,
  provider: BankProviderId,
): Promise<void> {
  const { error } = await admin
    .from(TABLE)
    .delete()
    .eq("user_id", userId)
    .eq("provider", provider);
  if (error) throw error;
}
