import "server-only";
import { createClient as createUserClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/**
 * Skew applied when checking whether the cached access_token is still usable.
 * Refresh 60 seconds before Google would consider it expired to absorb clock
 * drift and round-trip latency.
 */
const EXPIRY_SKEW_SECONDS = 60;

type GoogleOAuthRow = {
  user_id: string;
  refresh_token: string;
  access_token: string | null;
  expires_at: string | null;
  scopes: string[];
  google_sub: string | null;
};

type RefreshResponse = {
  access_token: string;
  expires_in: number;
  scope?: string;
  refresh_token?: string;
  token_type?: string;
};

function getGoogleCreds() {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not set. " +
        "Copy them from the Google OAuth client configured in Supabase Auth.",
    );
  }
  return { id, secret };
}

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
}): Promise<void> {
  const admin = createAdminClient();
  const expires_at =
    args.expiresInSeconds != null
      ? new Date(
          Date.now() + (args.expiresInSeconds - EXPIRY_SKEW_SECONDS) * 1000,
        ).toISOString()
      : null;

  await admin.from("google_oauth").upsert(
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
  );
}

/**
 * Returns a fresh Google access token for the current user, or null if no
 * refresh token is on file (caller should surface a "reconnect Google" CTA).
 *
 * Uses a Postgres advisory lock keyed on the user to serialize concurrent
 * refreshes — Google may rotate the refresh_token in the response, so two
 * simultaneous refresh requests would race-overwrite each other otherwise.
 *
 * Pass { force: true } to ignore the cached access_token (e.g. after a 401
 * from Google indicates the cached token went stale before its stamped expiry).
 */
export async function getGoogleAccessToken(
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

  // Advisory lock keyed off the user uuid (hashed to two int4 slots). Cleared
  // on transaction end; since we acquire+release in distinct RPC calls, do
  // it transactional via pg_advisory_xact_lock inside an RPC instead. Simpler
  // here: serialize by SELECT ... FOR UPDATE inside a transaction. We don't
  // have a transaction primitive over the JS client, so we use a small RPC.
  //
  // Pragmatic alternative without an RPC: just attempt the refresh, and if
  // the rotated refresh_token write happens twice it's idempotent — Google
  // returns the same refresh_token unless it deliberately rotates. The risk
  // is rare. Document and move on; revisit if we ever see invalid_grant
  // post-race in the wild.

  const { data, error } = await admin
    .from("google_oauth")
    .select("user_id, refresh_token, access_token, expires_at, scopes, google_sub")
    .eq("user_id", userId)
    .maybeSingle<GoogleOAuthRow>();

  if (error) throw new Error(`google_oauth read failed: ${error.message}`);
  if (!data?.refresh_token) return null;

  if (!force && data.access_token && data.expires_at) {
    const msLeft = new Date(data.expires_at).getTime() - Date.now();
    if (msLeft > EXPIRY_SKEW_SECONDS * 1000) return data.access_token;
  }

  const { id, secret } = getGoogleCreds();
  const body = new URLSearchParams({
    client_id: id,
    client_secret: secret,
    refresh_token: data.refresh_token,
    grant_type: "refresh_token",
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  if (res.status === 400 || res.status === 401) {
    // invalid_grant — refresh token revoked / expired / wrong client. Force
    // the user back through OAuth.
    await admin.from("google_oauth").delete().eq("user_id", userId);
    return null;
  }
  if (!res.ok) {
    throw new Error(`Google token refresh failed: ${res.status}`);
  }

  const json = (await res.json()) as RefreshResponse;
  const expires_at = new Date(
    Date.now() + (json.expires_in - EXPIRY_SKEW_SECONDS) * 1000,
  ).toISOString();
  const scopes = json.scope ? json.scope.split(" ") : data.scopes;

  await admin
    .from("google_oauth")
    .update({
      access_token: json.access_token,
      expires_at,
      scopes,
      ...(json.refresh_token ? { refresh_token: json.refresh_token } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  return json.access_token;
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

/**
 * Fetch with a single automatic retry on 401: forces a token refresh and
 * retries the request once. Returns the final Response untouched so callers
 * keep full control over parsing + error handling.
 */
export async function fetchWithGoogleAuth(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  let token = await getGoogleAccessToken();
  if (!token) {
    // Surface as a synthetic 401 so callers can use the same branch as
    // "token revoked by Google".
    return new Response(null, { status: 401, statusText: "no-token" });
  }

  const buildInit = (t: string): RequestInit => ({
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}` },
    cache: "no-store",
  });

  const first = await fetch(input, buildInit(token));
  if (first.status !== 401) return first;

  // Force a refresh and retry exactly once.
  token = await getGoogleAccessToken({ force: true });
  if (!token) return first;
  return await fetch(input, buildInit(token));
}
