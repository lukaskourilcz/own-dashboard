import "server-only";
import { createOAuthFetcher } from "@/lib/provider-auth-fetch";
import { createAdminClient } from "@/lib/supabase/admin";

const GITHUB_API = "https://api.github.com";

/**
 * OAuth App client credentials. Optional: only needed to (a) refresh an
 * expiring GitHub-App token and (b) revoke the grant on disconnect. Standard
 * OAuth App tokens don't expire, so a missing pair degrades gracefully — we
 * just use the stored token and delete the row locally on disconnect.
 */
function getGitHubCreds(): { id: string; secret: string } | null {
  const id = process.env.GITHUB_OAUTH_CLIENT_ID;
  const secret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!id || !secret) return null;
  return { id, secret };
}

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
}): Promise<void> {
  const admin = createAdminClient();
  const expires_at =
    args.expiresInSeconds != null
      ? new Date(
          Date.now() + args.expiresInSeconds * 1000,
        ).toISOString()
      : null;

  const result = await admin.from("github_tokens").upsert(
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
  ).select("user_id").single();
  if (result.error || result.data?.user_id !== args.userId) throw new Error("OAuth grant storage unconfirmed");
}

/**
 * Revoke the OAuth grant (best-effort) and delete our row. Used by the
 * "Disconnect GitHub" button. A missing client secret or a non-2xx from
 * GitHub is not fatal — we always delete the local row.
 */
export async function revokeGitHubAccess(userId: string): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("github_tokens")
    .select("access_token")
    .eq("user_id", userId)
    .maybeSingle<{ access_token: string | null }>();

  const creds = getGitHubCreds();
  if (creds && data?.access_token) {
    try {
      const basic = Buffer.from(`${creds.id}:${creds.secret}`).toString(
        "base64",
      );
      await fetch(`${GITHUB_API}/applications/${creds.id}/grant`, {
        method: "DELETE",
        headers: {
          Authorization: `Basic ${basic}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ access_token: data.access_token }),
        cache: "no-store",
      });
    } catch {
      // Network blip or already-revoked grant; we still delete the row below.
    }
  }

  await admin.from("github_tokens").delete().eq("user_id", userId);
}

/** The route supplies its already verified owner. Keep this fetcher local to
 * that request; never place it in a module-level cache. */
export function createGitHubFetcher(userId: string, signal?: AbortSignal) {
  return createOAuthFetcher("github", userId, signal);
}
