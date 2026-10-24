import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ rpc: vi.fn(), calls: [] as { name: string; args: Record<string, unknown>; signal?: AbortSignal }[] }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: (name: string, args: Record<string, unknown>) => {
  const call = { name, args, signal: undefined as AbortSignal | undefined }; state.calls.push(call);
  return { abortSignal: (signal: AbortSignal) => { call.signal = signal; return state.rpc(name, args); } };
} }) }));
import { getOAuthAccessToken } from "@/lib/oauth-access-token";
const lease = "33333333-3333-4333-8333-333333333333";
const row = { user_id: "owner", access_token: "synthetic-old-access", refresh_token: "synthetic-old-refresh", scopes: ["prior"] };
beforeEach(() => {
  state.calls = []; state.rpc.mockReset().mockImplementation(name => Promise.resolve({ data: name === "claim_oauth_refresh" ? { state: "claimed", lease_id: lease, row } : true, error: null }));
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "synthetic-client"); vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "synthetic-secret");
  vi.stubEnv("GITHUB_OAUTH_CLIENT_ID", "synthetic-client"); vi.stubEnv("GITHUB_OAUTH_CLIENT_SECRET", "synthetic-secret");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const run = (provider: "google" | "github" = "google", signal = AbortSignal.timeout(5000)) => getOAuthAccessToken(provider, "owner", signal);
it("reuses a confirmed owner token and returns true absence without a provider request", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  state.rpc.mockResolvedValueOnce({ data: { state: "cached", row } }); expect(await run()).toBe(row.access_token);
  state.rpc.mockResolvedValueOnce({ data: { state: "disconnected" } }); expect(await run()).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
});
it.each([{ data: { state: "busy" } }, { data: null, error: { message: "synthetic-private" } }, { data: { state: "cached", row: { ...row, user_id: "foreign" } } }, { data: { state: "claimed", lease_id: lease, row: { ...row, refresh_token: null } } }])("refuses unavailable, malformed or foreign claims without leaking input", async result => {
  vi.stubGlobal("fetch", vi.fn()); state.rpc.mockResolvedValueOnce(result);
  await expect(run()).rejects.toThrow(/^OAuth access unavailable$/); expect(fetch).not.toHaveBeenCalled();
});
it("confirms the rotated receipt before returning a provider token, using provider TTL only", async () => {
  const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ access_token: "synthetic-new-access", refresh_token: "synthetic-new-refresh", expires_in: 3600, scope: "repo,gist calendar", token_type: "bearer" })));
  expect(await run()).toBe("synthetic-new-access");
  expect(state.calls[1].args).toMatchObject({ p_user_id: "owner", p_provider: "google", p_lease_id: lease, p_access_token: "synthetic-new-access", p_refresh_token: "synthetic-new-refresh", p_expires_at: new Date(now + 3600000).toISOString(), p_scopes: ["repo", "gist", "calendar"], p_invalid_grant: false });
  expect(state.calls.every(call => call.signal instanceof AbortSignal)).toBe(true);
  expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ redirect: "error", cache: "no-store" });
});
it.each(["google", "github"] as const)("requires an exact completion receipt for %s", async provider => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ access_token: "synthetic-new-access", refresh_token: "synthetic-new-refresh", expires_in: 3600 })));
  state.rpc.mockImplementation(name => Promise.resolve({ data: name === "claim_oauth_refresh" ? { state: "claimed", lease_id: lease, row } : false }));
  await expect(run(provider)).rejects.toThrow(/^OAuth access unavailable$/);
});
it.each(["invalid_client", "temporarily_unavailable", "unverified_user_email"])("preserves credentials for non-revocation error %s", async error => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error }, { status: 400 })));
  await expect(run()).rejects.toThrow(/^OAuth access unavailable$/); expect(state.calls).toHaveLength(1);
});
it.each([["google", "invalid_grant", 400], ["github", "bad_refresh_token", 200]] as const)("removes only a confirmed rejected %s reservation", async (provider, error, status) => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error }, { status })));
  expect(await run(provider)).toBeNull(); expect(state.calls[1].args.p_invalid_grant).toBe(true);
});
it.each([{ access_token: "synthetic-new-access", expires_in: 0 }, { access_token: "synthetic-new-access" }, { access_token: "synthetic-new-access", expires_in: 3600, token_type: "not-bearer" }, { access_token: "synthetic-private\ninvalid", expires_in: 3600 }])("does not store malformed refresh payloads", async payload => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload))); await expect(run()).rejects.toThrow(/^OAuth access unavailable$/); expect(state.calls).toHaveLength(1);
});
it("requires GitHub's rotated refresh token but permits Google's unchanged refresh token", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ access_token: "synthetic-new-access", expires_in: 3600 })));
  await expect(run("github")).rejects.toThrow(/^OAuth access unavailable$/); expect(await run()).toBe("synthetic-new-access");
  expect(state.calls.at(-1)?.args.p_refresh_token).toBeNull(); expect(state.calls.at(-1)?.args.p_scopes).toEqual(["prior"]);
});
it("bounds a hanging claim, observes late rejection, and starts no provider work", async () => {
  const controller = new AbortController(); let reject!: (error: Error) => void;
  state.rpc.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; })); vi.stubGlobal("fetch", vi.fn());
  const pending = run("google", controller.signal); controller.abort(); await expect(pending).rejects.toThrow(/^OAuth access unavailable$/);
  reject(Error("synthetic-private")); await Promise.resolve(); expect(fetch).not.toHaveBeenCalled();
});
it("bounds oversized provider JSON without storing a partial credential", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("x".repeat(65537)))); await expect(run()).rejects.toThrow(/^OAuth access unavailable$/); expect(state.calls).toHaveLength(1);
});
