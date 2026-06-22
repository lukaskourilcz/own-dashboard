import "server-only";
import { createClient as createUserClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API = "https://api.github.com";

/**
 * Skew applied when deciding whether a cached, expiring access_token is still
 * usable. Only relevant in GitHub-App "expiring tokens" mode; standard OAuth
 * App tokens never expire.
 */
const EXPIRY_SKEW_SECONDS = 60;

type GitHubTokenRow = {
  user_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  scopes: string[];
};

type RefreshResponse = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
  token_type?: string;
};

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
          Date.now() + (args.expiresInSeconds - EXPIRY_SKEW_SECONDS) * 1000,
        ).toISOString()
      : null;

  await admin.from("github_tokens").upsert(
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
  );
}

/**
 * Returns a usable GitHub access token for the current user, or null if GitHub
 * isn't connected (caller should surface a "Connect GitHub" CTA).
 *
 * Standard OAuth App tokens never expire, so the common path just returns the
 * stored token. When GitHub is in expiring-token mode (expires_at set + a
 * refresh_token on file) we refresh under a per-user advisory lock, exactly
 * like the Google flow, to avoid racing a refresh_token rotation.
 */
export async function getGitHubAccessToken(
  opts: { force?: boolean } = {},
): Promise<string | null> {
  const supabase = await createUserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  return await refreshUnderLock(user.id, opts.force ?? false);
}

async function refreshUnderLock(
  userId: string,
  force: boolean,
): Promise<string | null> {
  const admin = createAdminClient();

  const { data: lockRows, error: lockErr } = await admin.rpc(
    "github_tokens_acquire_refresh_lock",
    { p_user_id: userId },
  );
  if (lockErr) throw new Error(`github refresh lock failed: ${lockErr.message}`);

  const data = (lockRows as GitHubTokenRow[] | null)?.[0] ?? null;
  if (!data?.access_token) return null;

  // Non-expiring token (classic OAuth App): nothing to refresh.
  if (!data.expires_at || !data.refresh_token) return data.access_token;

  if (!force) {
    const msLeft = new Date(data.expires_at).getTime() - Date.now();
    if (msLeft > EXPIRY_SKEW_SECONDS * 1000) return data.access_token;
  }

  const creds = getGitHubCreds();
  if (!creds) {
    // Can't refresh without the app secret — hand back what we have and let
    // the upstream 401 surface a reconnect CTA if it's truly stale.
    return data.access_token;
  }

  const res = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: creds.id,
      client_secret: creds.secret,
      grant_type: "refresh_token",
      refresh_token: data.refresh_token,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`GitHub token refresh failed: ${res.status}`);
  }

  const json = (await res.json()) as RefreshResponse & { error?: string };
  if (json.error || !json.access_token) {
    // invalid_grant — the grant was revoked. Force a reconnect.
    await admin.from("github_tokens").delete().eq("user_id", userId);
    return null;
  }

  const expires_at =
    json.expires_in != null
      ? new Date(
          Date.now() + (json.expires_in - EXPIRY_SKEW_SECONDS) * 1000,
        ).toISOString()
      : null;

  await admin
    .from("github_tokens")
    .update({
      access_token: json.access_token,
      expires_at,
      scopes: json.scope ? json.scope.split(" ") : data.scopes,
      ...(json.refresh_token ? { refresh_token: json.refresh_token } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  return json.access_token;
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

/**
 * Fetch the GitHub API with auth + the standard versioned headers, retrying
 * once on 401 after forcing a token refresh. Returns the raw Response so
 * callers keep control over parsing and error mapping.
 */
export async function fetchWithGitHubAuth(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  let token = await getGitHubAccessToken();
  if (!token) {
    // Synthetic 401 so callers share the "token revoked" branch.
    return new Response(null, { status: 401, statusText: "no-token" });
  }

  const url = path.startsWith("http") ? path : `${GITHUB_API}${path}`;
  const buildInit = (t: string): RequestInit => ({
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
      Authorization: `Bearer ${t}`,
    },
    cache: "no-store",
  });

  const first = await fetch(url, buildInit(token));
  if (first.status !== 401) return first;

  token = await getGitHubAccessToken({ force: true });
  if (!token) return first;
  return await fetch(url, buildInit(token));
}
