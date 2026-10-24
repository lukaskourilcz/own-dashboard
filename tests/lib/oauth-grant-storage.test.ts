import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ result: {} as Record<string, unknown>, writes: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => ({ upsert: (value: unknown) => {
  state.writes(table, value); return { select: () => ({ single: async () => state.result }) };
} }) }) }));
import { storeGoogleTokens } from "@/lib/google-token";
import { storeGitHubTokens } from "@/lib/github-token";
beforeEach(() => { state.result = { data: { user_id: "owner" }, error: null }; state.writes.mockReset(); });
afterEach(() => vi.restoreAllMocks());
const grant = { userId: "owner", accessToken: "synthetic-inert-access", refreshToken: "synthetic-inert-refresh", expiresInSeconds: null, scopes: [] };
const stores = [() => storeGoogleTokens({ ...grant, googleSub: "synthetic-sub" }), () => storeGitHubTokens({ ...grant, githubLogin: "fixture", githubId: 123 })];
it.each(stores)("requires a matching storage receipt and propagates fixed failure without provider values", async store => {
  for (const result of [{ data: null, error: null }, { data: { user_id: "foreign" } }, { data: null, error: { message: "synthetic-private-detail" } }]) {
    state.result = result; await expect(store()).rejects.toThrow(/^OAuth grant storage unconfirmed$/);
  }
  state.result = { data: { user_id: "owner" } }; await expect(store()).resolves.toBeUndefined();
  expect(state.writes.mock.calls.at(-1)?.[1]).toMatchObject({ user_id: "owner", expires_at: null });
});
it("keeps provider TTL intact so the refresh reservation applies the single expiry skew", async () => {
  const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now);
  await storeGoogleTokens({ ...grant, expiresInSeconds: 3600, googleSub: null });
  expect(state.writes.mock.calls[0][1].expires_at).toBe(new Date(now + 3600000).toISOString());
});
