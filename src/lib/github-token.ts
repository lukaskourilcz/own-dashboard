import "server-only";
import { revokeOAuthGrant } from "@/lib/oauth-revocation";
import { awaitWithSignal } from "@/lib/abortable";
import { createOAuthFetcher } from "@/lib/provider-auth-fetch";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Persist the token captured at /auth/callback after a GitHub identity link.
 * Unlike Google, the access_token is the durable credential (no refresh_token
 * for a classic OAuth App), so we store it directly and upsert is idempotent.
 */
export async function storeGitHubTokens(args: {
  userId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number | null;
  scopes: string[];
  githubLogin: string | null;
  githubId: number | null;
}, parent?: AbortSignal): Promise<void> {
  const signal = parent ?? AbortSignal.timeout(12_000);
  const admin = createAdminClient(signal);
  const expires_at =
    args.expiresInSeconds != null
      ? new Date(
          Date.now() + args.expiresInSeconds * 1000,
        ).toISOString()
      : null;

  const result = await awaitWithSignal(admin.from("github_tokens").upsert(
    {
      user_id: args.userId,
      access_token: args.accessToken,
      refresh_token: args.refreshToken,
      expires_at,
      scopes: args.scopes,
      github_login: args.githubLogin,
      github_id: args.githubId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  ).select("user_id,access_token,refresh_token,expires_at,scopes,github_login,github_id").abortSignal(signal).single(), signal);
  const saved = result.data;
  if (result.error || saved?.user_id !== args.userId || saved.access_token !== args.accessToken
    || saved.refresh_token !== args.refreshToken || JSON.stringify(saved.scopes) !== JSON.stringify(args.scopes)
    || (expires_at === null ? saved.expires_at !== null : Date.parse(saved.expires_at) !== Date.parse(expires_at))
    || saved.github_id !== args.githubId || saved.github_login !== args.githubLogin) throw new Error("OAuth grant storage unconfirmed");
}

/** Confirm local removal separately from the provider's revoke response. */
export function revokeGitHubAccess(userId: string, signal?: AbortSignal) {
  return revokeOAuthGrant("github", userId, signal);
}

/** The route supplies its already verified owner. Keep this fetcher local to
 * that request; never place it in a module-level cache. */
export function createGitHubFetcher(userId: string, signal?: AbortSignal) {
  return createOAuthFetcher("github", userId, signal);
}
