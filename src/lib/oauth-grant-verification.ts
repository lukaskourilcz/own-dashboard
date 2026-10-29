import "server-only";
import type { User } from "@supabase/supabase-js";
import { z } from "zod";
import { awaitWithSignal } from "@/lib/abortable";
import { readTextPrefix } from "@/lib/bounded-text";

export type ProviderSession = { provider_token?: string | null; provider_refresh_token?: string | null };
type BaseGrant = { accessToken: string; refreshToken: string | null; scopes: string[]; expiresInSeconds: number | null };
export type VerifiedOAuthGrant =
  | (BaseGrant & { provider: "google"; googleSub: string })
  | (BaseGrant & { provider: "github"; githubId: number; githubLogin: string });
const credential = z.string().min(1).max(8192).regex(/^\S+$/);
const githubToken = /^(?:gho|ghu)_[A-Za-z0-9_]+$/;
const scopes = (raw: string) => {
  const result = [...new Set(raw.split(/[,\s]+/).filter(Boolean))];
  return z.array(z.string().min(1).max(500)).max(100).parse(result);
};

/** The code exchange is already verified by Supabase. Bind its provider grant
 * to that user's server-managed identity; URL parameters/user metadata cannot
 * select a credential table or supply an identity, scope or lifetime. */
export async function verifyOAuthGrant(session: ProviderSession, user: User, parent?: AbortSignal): Promise<VerifiedOAuthGrant | null> {
  if (!session.provider_token) return null;
  try {
    const accessToken = credential.parse(session.provider_token);
    const refreshToken = session.provider_refresh_token ? credential.parse(session.provider_refresh_token) : null;
    const identities = (user.identities ?? []).filter(identity => identity.user_id === user.id);
    const signal = AbortSignal.any([AbortSignal.timeout(8000), ...(parent ? [parent] : [])]);
    const read = async (url: string, headers?: HeadersInit) => {
      const response = await awaitWithSignal(fetch(url, { headers, cache: "no-store", redirect: "error", signal }), signal);
      if (!response.ok) throw Error();
      const body = await awaitWithSignal(readTextPrefix(response, 65_536), signal);
      if (body.truncated) throw Error();
      return { response, json: JSON.parse(body.text) as unknown };
    };
    if (githubToken.test(accessToken)) {
      if (!identities.some(identity => identity.provider === "github")) throw Error();
      const { response, json } = await read("https://api.github.com/user", {
        Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
      });
      const profile = z.object({ id: z.number().int().positive().safe(), login: z.string().min(1).max(100) }).parse(json);
      if (!identities.some(identity => identity.provider === "github" && identity.id === String(profile.id))) throw Error();
      return { provider: "github", accessToken, refreshToken, scopes: scopes(response.headers.get("x-oauth-scopes") ?? ""),
        expiresInSeconds: null, githubId: profile.id, githubLogin: profile.login };
    }
    if (/^gh[a-z]_/.test(accessToken)) throw Error();
    // Only Google and GitHub issue provider tokens in this app. Refuse an
    // unfamiliar identity provider rather than sending its opaque token to Google.
    if (identities.some(identity => !["google", "github", "email"].includes(identity.provider))) throw Error();
    if (!refreshToken) return null; // There is no new Google grant to persist.
    if (!identities.some(identity => identity.provider === "google")) throw Error();
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    if (!clientId) throw Error();
    const url = new URL("https://oauth2.googleapis.com/tokeninfo");
    url.searchParams.set("access_token", accessToken);
    const { json } = await read(url.href);
    const info = z.object({ sub: z.string().min(1), aud: z.string(), azp: z.string().optional(), scope: z.string().max(50_000),
      expires_in: z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]).pipe(z.number().int().min(1).max(31_536_000)) }).parse(json);
    if (info.aud !== clientId || (info.azp && info.azp !== clientId)
      || !identities.some(identity => identity.provider === "google" && identity.id === info.sub)) throw Error();
    return { provider: "google", accessToken, refreshToken, scopes: scopes(info.scope), expiresInSeconds: info.expires_in, googleSub: info.sub };
  } catch { throw new Error("OAuth grant verification unavailable"); }
}
