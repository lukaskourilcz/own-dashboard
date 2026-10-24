import "server-only";
import { awaitWithSignal } from "@/lib/abortable";
import { createOAuthFetcher } from "@/lib/provider-auth-fetch";
import { createAdminClient } from "@/lib/supabase/admin";

const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/**
 * Persist the refresh token captured at /auth/callback. This is the ONLY
 * moment Supabase exposes session.provider_refresh_token — if we miss it,
 * we cannot reconstruct without a full re-consent.
 */
export async function storeGoogleTokens(args: {
  userId: string;
  refreshToken: string;
  accessToken: string | null;
  expiresInSeconds: number | null;
  scopes: string[];
  googleSub: string | null;
}, parent?: AbortSignal): Promise<void> {
  const signal = parent ?? AbortSignal.timeout(12_000);
  const admin = createAdminClient(signal);
  const expires_at =
    args.expiresInSeconds != null
      ? new Date(
          Date.now() + args.expiresInSeconds * 1000,
        ).toISOString()
      : null;

  const result = await awaitWithSignal(admin.from("google_oauth").upsert(
    {
      user_id: args.userId,
      refresh_token: args.refreshToken,
      access_token: args.accessToken,
      expires_at,
      scopes: args.scopes,
      google_sub: args.googleSub,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  ).select("user_id,access_token,refresh_token,expires_at,scopes,google_sub").abortSignal(signal).single(), signal);
  const saved = result.data;
  if (result.error || saved?.user_id !== args.userId || saved.access_token !== args.accessToken
    || saved.refresh_token !== args.refreshToken || JSON.stringify(saved.scopes) !== JSON.stringify(args.scopes)
    || (expires_at === null ? saved.expires_at !== null : Date.parse(saved.expires_at) !== Date.parse(expires_at))
    || saved.google_sub !== args.googleSub) throw new Error("OAuth grant storage unconfirmed");
}

/**
 * Revoke the Google grant + delete our row. Used by /auth/signout and by an
 * explicit "Disconnect Google" button. Best-effort: a non-200 from /revoke
 * (e.g. token already revoked) is not treated as an error.
 */
export async function revokeGoogleAccess(userId: string): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("google_oauth")
    .select("refresh_token")
    .eq("user_id", userId)
    .maybeSingle<{ refresh_token: string | null }>();

  if (data?.refresh_token) {
    try {
      await fetch(GOOGLE_REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: data.refresh_token }),
        cache: "no-store",
      });
    } catch {
      // Network blip or already-revoked token; we still delete the row below.
    }
  }

  await admin.from("google_oauth").delete().eq("user_id", userId);
}

/** The route supplies its already verified owner. Keep this fetcher local to
 * that request; never place it in a module-level cache. */
export function createGoogleFetcher(userId: string, signal?: AbortSignal) {
  return createOAuthFetcher("google", userId, signal);
}
