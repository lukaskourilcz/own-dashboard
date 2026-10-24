import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ rpc: vi.fn(), calls: [] as { name: string; args: Record<string, unknown> }[] }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: (name: string, args: Record<string, unknown>) => {
  state.calls.push({ name, args }); return { abortSignal: () => state.rpc(name, args) };
} }) }));
import { revokeOAuthGrant } from "@/lib/oauth-revocation";
const lease = "11111111-1111-4111-8111-111111111111", row = { user_id: "owner", access_token: "synthetic-access", refresh_token: "synthetic-refresh" };
beforeEach(() => {
  state.calls = []; state.rpc.mockReset().mockImplementation(name => Promise.resolve({ data: name === "claim_oauth_revocation" ? { state: "claimed", lease_id: lease, row } : true, error: null }));
  vi.stubEnv("GITHUB_OAUTH_CLIENT_ID", "synthetic-client"); vi.stubEnv("GITHUB_OAUTH_CLIENT_SECRET", "synthetic-secret");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it.each(["google", "github"] as const)("requires both the explicit %s revoke response and local removal receipt", async provider => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 })); vi.stubGlobal("fetch", fetcher);
  expect(await revokeOAuthGrant(provider, "owner")).toEqual({ upstreamRevoked: true });
  expect(state.calls).toEqual([{ name: "claim_oauth_revocation", args: { p_user_id: "owner", p_provider: provider } }, { name: "complete_oauth_revocation", args: { p_user_id: "owner", p_provider: provider, p_lease_id: lease } }]);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "error", cache: "no-store" });
  expect(String(fetcher.mock.calls[0][0])).not.toContain("synthetic-access"); expect(String(fetcher.mock.calls[0][0])).not.toContain("synthetic-refresh");
});
it.each(["google", "github"] as const)("reports local-only removal after failed %s revocation", async provider => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
  expect(await revokeOAuthGrant(provider, "owner")).toEqual({ upstreamRevoked: false }); expect(state.calls.at(-1)?.name).toBe("complete_oauth_revocation");
});
it("keeps missing app credentials explicit instead of pretending GitHub revoked a grant", async () => {
  vi.stubEnv("GITHUB_OAUTH_CLIENT_SECRET", ""); vi.stubGlobal("fetch", vi.fn());
  expect(await revokeOAuthGrant("github", "owner")).toEqual({ upstreamRevoked: false }); expect(fetch).not.toHaveBeenCalled();
});
it.each([{ data: { state: "busy" } }, { data: null, error: { message: "synthetic-private" } }, { data: { state: "claimed", lease_id: lease, row: { ...row, user_id: "foreign" } } }])("does not revoke or delete after a failed, busy or foreign claim", async result => {
  state.rpc.mockResolvedValueOnce(result); vi.stubGlobal("fetch", vi.fn());
  await expect(revokeOAuthGrant("google", "owner")).rejects.toThrow(/^OAuth removal unconfirmed$/); expect(state.calls).toHaveLength(1); expect(fetch).not.toHaveBeenCalled();
});
it("confirms existing local absence without claiming upstream revocation", async () => {
  state.rpc.mockResolvedValueOnce({ data: { state: "disconnected" } }); vi.stubGlobal("fetch", vi.fn());
  expect(await revokeOAuthGrant("google", "owner")).toEqual({ upstreamRevoked: false }); expect(state.calls).toHaveLength(1); expect(fetch).not.toHaveBeenCalled();
});
it("does not claim local removal when completion reports a stale reservation", async () => {
  state.rpc.mockImplementation(name => Promise.resolve({ data: name === "claim_oauth_revocation" ? { state: "claimed", lease_id: lease, row } : false }));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
  await expect(revokeOAuthGrant("google", "owner")).rejects.toThrow(/^OAuth removal unconfirmed$/);
});
it("bounds a hanging upstream while still confirming independent local removal", async () => {
  const controller = new AbortController(), original = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => ms === 8000 ? controller.signal : original(ms));
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
  const pending = revokeOAuthGrant("google", "owner"); await vi.waitFor(() => expect(fetch).toHaveBeenCalled()); controller.abort();
  expect(await pending).toEqual({ upstreamRevoked: false }); expect(state.calls.at(-1)?.name).toBe("complete_oauth_revocation");
});
it("makes no late local removal after the enclosing request is cancelled", async () => {
  const controller = new AbortController(); vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
  const pending = revokeOAuthGrant("google", "owner", controller.signal); await vi.waitFor(() => expect(fetch).toHaveBeenCalled()); controller.abort(Error("synthetic-private"));
  await expect(pending).rejects.toThrow(/^OAuth removal unconfirmed$/); expect(state.calls).toHaveLength(1);
});
