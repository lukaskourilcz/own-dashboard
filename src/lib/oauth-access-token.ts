import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { awaitWithSignal } from "@/lib/abortable";
import { readTextPrefix } from "@/lib/bounded-text";

export type OAuthProvider = "google" | "github";
const credential = z.string().min(1).max(8192).regex(/^\S+$/);
const rowSchema = z.object({ user_id: z.string(), access_token: credential.nullable(), refresh_token: credential.nullable(), scopes: z.array(z.string().min(1).max(500)).max(100) });
const claimSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("cached"), row: rowSchema }),
  z.object({ state: z.literal("claimed"), lease_id: z.uuid(), row: rowSchema }),
  z.object({ state: z.literal("disconnected") }), z.object({ state: z.literal("busy") }),
]);
const refreshedSchema = z.object({ access_token: credential, refresh_token: credential.optional(),
  expires_in: z.number().int().min(1).max(31_536_000), scope: z.string().max(50_000).optional(),
  token_type: z.string().refine(value => value.toLowerCase() === "bearer").optional() });

/** Internal service boundary. The caller supplies its already verified owner.
 * Never cache credentials between requests or include provider causes in errors. */
export async function getOAuthAccessToken(provider: OAuthProvider, userId: string, signal: AbortSignal, failedToken?: string): Promise<string | null> {
  try {
    signal.throwIfAborted();
    const admin = createAdminClient(signal);
    const claimResult = await awaitWithSignal(admin.rpc("claim_oauth_refresh", {
      p_user_id: userId, p_provider: provider, p_failed_token: failedToken ?? null,
    }).abortSignal(signal), signal);
    if (claimResult.error) throw Error();
    const claim = claimSchema.parse(claimResult.data);
    if (claim.state === "disconnected") return null;
    if (claim.state === "busy" || claim.row.user_id !== userId) throw Error();
    if (claim.state === "cached") { if (!claim.row.access_token) throw Error(); return claim.row.access_token; }
    if (!claim.row.refresh_token) throw Error();
    const id = provider === "google" ? process.env.GOOGLE_OAUTH_CLIENT_ID : process.env.GITHUB_OAUTH_CLIENT_ID;
    const secret = provider === "google" ? process.env.GOOGLE_OAUTH_CLIENT_SECRET : process.env.GITHUB_OAUTH_CLIENT_SECRET;
    if (!id || !secret) throw Error();
    const refreshSignal = AbortSignal.any([signal, AbortSignal.timeout(12_000)]);
    const response = await awaitWithSignal(fetch(provider === "google" ? "https://oauth2.googleapis.com/token" : "https://github.com/login/oauth/access_token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: "refresh_token", refresh_token: claim.row.refresh_token }),
      cache: "no-store", redirect: "error", signal: refreshSignal,
    }), refreshSignal);
    const prefix = await awaitWithSignal(readTextPrefix(response, 65_536), refreshSignal);
    if (prefix.truncated) throw Error();
    const json: unknown = JSON.parse(prefix.text);
    const error = z.object({ error: z.string() }).safeParse(json);
    const invalidGrant = error.success && error.data.error === (provider === "google" ? "invalid_grant" : "bad_refresh_token")
      && [200, 400, 401].includes(response.status);
    const complete = async (values: { access: string | null; refresh: string | null; expires: string | null; scopes: string[] }, invalid: boolean) => {
      signal.throwIfAborted();
      const result = await awaitWithSignal(admin.rpc("complete_oauth_refresh", {
        p_user_id: userId, p_provider: provider, p_lease_id: claim.lease_id,
        p_access_token: values.access, p_refresh_token: values.refresh, p_expires_at: values.expires, p_scopes: values.scopes, p_invalid_grant: invalid,
      }).abortSignal(signal), signal);
      if (result.error || result.data !== true) throw Error();
    };
    if (invalidGrant) { await complete({ access: null, refresh: null, expires: null, scopes: [] }, true); return null; }
    if (!response.ok || error.success) throw Error();
    const refreshed = refreshedSchema.parse(json);
    if (provider === "github" && !refreshed.refresh_token) throw Error();
    const scopes = refreshed.scope === undefined ? claim.row.scopes : refreshed.scope.split(/[,\s]+/).filter(Boolean);
    if (scopes.length > 100 || scopes.some(scope => scope.length > 500)) throw Error();
    await complete({ access: refreshed.access_token, refresh: refreshed.refresh_token ?? null,
      expires: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(), scopes }, false);
    return refreshed.access_token;
  } catch { throw new Error("OAuth access unavailable"); }
}
