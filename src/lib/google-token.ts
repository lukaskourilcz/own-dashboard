import "server-only";
import { revokeOAuthGrant } from "@/lib/oauth-revocation";
import { awaitWithSignal } from "@/lib/abortable";
import { createOAuthFetcher } from "@/lib/provider-auth-fetch";
import { createAdminClient } from "@/lib/supabase/admin";

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

/** Confirm local removal separately from the provider's revoke response. */
export function revokeGoogleAccess(userId: string, signal?: AbortSignal) {
  return revokeOAuthGrant("google", userId, signal);
}

/** The route supplies its already verified owner. Keep this fetcher local to
 * that request; never place it in a module-level cache. */
export function createGoogleFetcher(userId: string, signal?: AbortSignal) {
  return createOAuthFetcher("google", userId, signal);
}
