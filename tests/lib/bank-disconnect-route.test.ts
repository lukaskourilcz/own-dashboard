import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ user: true, limited: false, found: true, readError: false, deleteError: false, missingReceipt: false, revokeFails: false, revoke: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user ? { id: "owner" } : null } }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: state.from }) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: !state.limited, retryAfter: 60 }) }));
vi.mock("@/lib/bank/registry", () => ({ getProvider: () => ({ isConfigured: async () => true, revoke: state.revoke }) }));
import { POST } from "@/app/api/bank/disconnect/route";
const id = "11111111-1111-4111-8111-111111111111", version = "2026-10-23T22:00:00Z";
const request = (body: unknown, origin = "https://app.example") => new Request("https://app.example/api/bank/disconnect", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  state.user = true; state.limited = false; state.found = true; state.readError = false; state.deleteError = false; state.missingReceipt = false;
  state.revoke.mockReset().mockResolvedValue(undefined);
  state.from.mockReset().mockImplementation((table: string) => {
    expect(table).toBe("bank_connections"); let deleting = false; const filters = new Map<string, unknown>();
    const query = { select: () => query, delete: () => { deleting = true; return query; }, eq: (key: string, value: unknown) => { filters.set(key, value); return query; },
      maybeSingle: async () => { expect(filters.get("user_id")).toBe("owner"); return { data: state.found ? { id, user_id: "owner", provider: "gocardless", updated_at: version } : null, error: state.readError ? {} : null }; },
      single: async () => { expect(deleting).toBe(true); expect(filters.get("user_id")).toBe("owner"); expect(filters.get("updated_at")).toBe(version); return { data: state.missingReceipt ? null : { id }, error: state.deleteError ? {} : null }; },
    }; return query;
  });
});
it.each([null, [], {}, { id: 123 }, { id: "bad" }, { id, extra: true }])("refuses invalid disconnect input before provider or database work (%j)", async body => {
  expect((await POST(request(body))).status).toBe(400); expect(state.from).not.toHaveBeenCalled(); expect(state.revoke).not.toHaveBeenCalled();
});
it("preserves authenticated, CSRF and rate boundaries", async () => {
  expect((await POST(request({ id }, "https://other.test"))).status).toBe(403);
  state.user = false; expect((await POST(request({ id }))).status).toBe(401); state.user = true;
  state.limited = true; expect((await POST(request({ id }))).status).toBe(429); expect(state.from).not.toHaveBeenCalled();
});
it("distinguishes missing, failed reads and unconfirmed deletes", async () => {
  state.found = false; expect((await POST(request({ id }))).status).toBe(404);
  state.found = true; state.readError = true; expect((await POST(request({ id }))).status).toBe(502); expect(state.revoke).not.toHaveBeenCalled();
  state.readError = false; state.deleteError = true; expect((await POST(request({ id }))).status).toBe(500);
  state.deleteError = false; state.missingReceipt = true; expect((await POST(request({ id }))).status).toBe(500);
});
it("confirms local deletion separately from upstream revocation, without returning provider details", async () => {
  expect(await (await POST(request({ id }))).json()).toEqual({ ok: true, upstreamRevoked: true });
  state.revoke.mockRejectedValue(new Error("Synthetic private provider detail"));
  expect(await (await POST(request({ id }))).json()).toEqual({ ok: true, upstreamRevoked: false });
});
