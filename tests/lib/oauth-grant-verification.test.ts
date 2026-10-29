import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { User, UserIdentity } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import { verifyOAuthGrant } from "@/lib/oauth-grant-verification";
const identity = (provider: string, id: string): UserIdentity => ({ provider, id, user_id: "owner", identity_id: "11111111-1111-4111-8111-111111111111", identity_data: { provider_id: "untrusted-alternative" } });
const user = (): User => ({ id: "owner", aud: "authenticated", app_metadata: {}, user_metadata: { provider_id: "untrusted-alternative" }, created_at: "2026-10-24", identities: [identity("google", "google-sub"), identity("github", "123")] });
const googleSession = { provider_token: "synthetic-google-access", provider_refresh_token: "synthetic-google-refresh", expires_in: 90000, provider_scopes: "untrusted-scopes" };
const info = { sub: "google-sub", aud: "synthetic-client", azp: "synthetic-client", expires_in: "3542", scope: "openid calendar calendar" };
beforeEach(() => { vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "synthetic-client"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it("matches Google's introspected subject/audience and uses its actual remaining TTL/scopes", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(info)); vi.stubGlobal("fetch", fetcher);
  expect(await verifyOAuthGrant(googleSession, user())).toEqual({ provider: "google", accessToken: "synthetic-google-access", refreshToken: "synthetic-google-refresh", scopes: ["openid", "calendar"], expiresInSeconds: 3542, googleSub: "google-sub" });
  const [url, init] = fetcher.mock.calls[0]; expect(new URL(String(url)).origin).toBe("https://oauth2.googleapis.com"); expect(init).toMatchObject({ redirect: "error", cache: "no-store" });
});
it.each([{ ...info, sub: "other-sub" }, { ...info, aud: "other-client" }, { ...info, azp: "other-client" }, { ...info, expires_in: "unknown" }, { ...info, expires_in: 0 }, { ...info, expires_in: 1e30 }])("refuses mismatched or malformed Google grants without exposing inputs", async payload => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload))); await expect(verifyOAuthGrant(googleSession, user())).rejects.toThrow(/^OAuth grant verification unavailable$/);
});
it.each(["gho_syntheticOAuthFixture", "ghu_syntheticUserFixture"])("verifies the documented GitHub token type with its own identity (%s)", async access => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: 123, login: "fixture-login" }, { headers: { "x-oauth-scopes": "repo, read:user" } })); vi.stubGlobal("fetch", fetcher);
  const grant = await verifyOAuthGrant({ provider_token: access, provider_refresh_token: "synthetic-refresh" }, user());
  expect(grant).toMatchObject({ provider: "github", githubId: 123, githubLogin: "fixture-login", scopes: ["repo", "read:user"], expiresInSeconds: null });
  expect(fetcher.mock.calls[0][0]).toBe("https://api.github.com/user"); expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ Authorization: `Bearer ${access}` });
});
it("does not pick the first linked identity when several accounts of one provider exist", async () => {
  const owner = user(); owner.identities!.unshift(identity("google", "other-google-sub"), identity("github", "456"));
  vi.stubGlobal("fetch", vi.fn(async url => String(url).includes("github") ? Response.json({ id: 123, login: "fixture-login" }) : Response.json(info)));
  expect((await verifyOAuthGrant(googleSession, owner))?.provider).toBe("google"); expect((await verifyOAuthGrant({ provider_token: "gho_syntheticFixture" }, owner))?.provider).toBe("github");
});
it("refuses a different GitHub identity without consulting user metadata", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: 999, login: "other-login" })));
  await expect(verifyOAuthGrant({ provider_token: "gho_syntheticFixture" }, user())).rejects.toThrow(/^OAuth grant verification unavailable$/);
});
it("does not send known unsupported GitHub token classes, foreign identities or an unknown provider token to Google", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  for (const token of ["ghp_syntheticPersonalFixture", "ghr_syntheticRefreshFixture"]) await expect(verifyOAuthGrant({ ...googleSession, provider_token: token }, user())).rejects.toThrow("verification unavailable");
  const owner = user(); owner.identities!.push(identity("azure", "azure-sub")); await expect(verifyOAuthGrant(googleSession, owner)).rejects.toThrow("verification unavailable");
  const foreign = user(); foreign.identities = foreign.identities!.map(value => ({ ...value, user_id: "foreign" })); await expect(verifyOAuthGrant(googleSession, foreign)).rejects.toThrow("verification unavailable");
  expect(fetcher).not.toHaveBeenCalled();
});
it("avoids provider reads when there is no new grant, and refuses missing Google client configuration", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  expect(await verifyOAuthGrant({}, user())).toBeNull(); expect(await verifyOAuthGrant({ provider_token: "synthetic-google-access" }, user())).toBeNull();
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", ""); await expect(verifyOAuthGrant(googleSession, user())).rejects.toThrow("verification unavailable"); expect(fetcher).not.toHaveBeenCalled();
});
it("refuses unbounded or failed verification without using a partial profile", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("x".repeat(65537))).mockResolvedValueOnce(Response.json({ error: "synthetic-private" }, { status: 503 })); vi.stubGlobal("fetch", fetcher);
  await expect(verifyOAuthGrant(googleSession, user())).rejects.toThrow(/^OAuth grant verification unavailable$/); await expect(verifyOAuthGrant(googleSession, user())).rejects.toThrow(/^OAuth grant verification unavailable$/);
});
it("honors cancellation even when the provider never settles", async () => {
  const controller = new AbortController(); vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
  const pending = verifyOAuthGrant(googleSession, user(), controller.signal); controller.abort(Error("synthetic-private")); await expect(pending).rejects.toThrow(/^OAuth grant verification unavailable$/);
});
