import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ user: true, limited: false, presenceFails: false, rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user ? { id: "owner" } : null } }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: state.rpc }) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: !state.limited, retryAfter: 60 }) }));
vi.mock("@/lib/bank/credentials", () => ({ hasProviderSecret: async () => { if (state.presenceFails) throw new Error("Synthetic private cause"); return true; } }));
import { GET, POST, DELETE } from "@/app/api/bank/credentials/route";
const id = "11111111-1111-4111-8111-111111111111";
const request = (body: unknown, origin = "https://app.example") => new Request("https://app.example/api/bank/credentials", { method: "POST", headers: { origin }, body: JSON.stringify(body) });
const valid = { provider: "fio", token: "synthetic-inert-bank-fixture" };
beforeEach(() => { state.user = true; state.limited = false; state.presenceFails = false; state.rpc.mockReset().mockResolvedValue({ data: id, error: null }); });
it.each([null, [], {}, { ...valid, token: 123 }, { ...valid, provider: "unknown" }, { ...valid, extra: true }])("refuses invalid credential bodies before storage (%#)", async body => {
  expect((await POST(request(body))).status).toBe(400); expect(state.rpc).not.toHaveBeenCalled();
});
it("retains auth/CSRF/rate and request-size boundaries", async () => {
  expect((await POST(request(valid, "https://other.test"))).status).toBe(403);
  state.user = false; expect((await POST(request(valid))).status).toBe(401); state.user = true;
  state.limited = true; expect((await POST(request(valid))).status).toBe(429); state.limited = false;
  expect((await POST(request({ ...valid, token: "x".repeat(4097) }))).status).toBe(413); expect(state.rpc).not.toHaveBeenCalled();
});
it("reports unavailable presence instead of inventing an absent token", async () => {
  expect(await (await GET()).json()).toEqual({ stored: { fio: true } }); state.presenceFails = true;
  const result = await GET(); expect(result.status).toBe(503); expect(await result.text()).not.toContain("Synthetic private cause");
});
it("requires confirmed storage/removal receipts and never returns private causes", async () => {
  expect(await (await POST(request(valid))).json()).toEqual({ ok: true, connectionId: id });
  expect(state.rpc.mock.calls[0][0]).toBe("store_bank_token"); expect(state.rpc.mock.calls[0][1].p_user_id).toBe("owner");
  state.rpc.mockResolvedValue({ data: null, error: { message: "Synthetic private cause" } });
  const result = await POST(request(valid)); expect(result.status).toBe(500); expect(await result.text()).not.toContain("Synthetic private cause");
  const removal = () => DELETE(new Request("https://app.example/api/bank/credentials?provider=fio", { method: "DELETE", headers: { origin: "https://app.example" } }));
  expect((await removal()).status).toBe(500); state.rpc.mockResolvedValue({ data: true, error: null });
  expect(await (await removal()).json()).toEqual({ ok: true });
  expect(state.rpc.mock.calls.at(-1)).toEqual(["forget_bank_token", { p_user_id: "owner", p_provider: "fio" }]);
});
