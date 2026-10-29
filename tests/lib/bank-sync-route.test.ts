import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ user: true, limited: false, configured: true, rows: [] as Record<string, unknown>[], count: 0,
  readError: false, controller: null as AbortController | null, sync: vi.fn(), single: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user ? { id: "owner" } : null } }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: state.from }) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: !state.limited, retryAfter: 60 }) }));
vi.mock("@/lib/bank/registry", () => ({ configuredProviders: async () => state.configured ? ["gocardless"] : [] }));
vi.mock("@/lib/bank-sync-server", () => ({ syncConnection: state.sync, syncConnectionById: state.single }));
vi.mock("@/lib/bank/sync-budget", () => ({ bankSyncSignal: () => state.controller!.signal }));
import { POST } from "@/app/api/bank/sync/route";

const id = "11111111-1111-4111-8111-111111111111";
const request = (text = "", origin = "https://app.example") => new Request("https://app.example/api/bank/sync", { method: "POST", headers: { origin, "Content-Type": "application/json" }, ...(text ? { body: text } : {}) });
beforeEach(() => {
  state.controller = new AbortController();
  state.user = true; state.limited = false; state.configured = true; state.rows = []; state.count = 0; state.readError = false;
  state.sync.mockReset().mockResolvedValue({ status: "linked", inserted: 2, accountsLinked: 1 });
  state.single.mockReset().mockResolvedValue({ status: "linked", inserted: 2, accountsLinked: 1 });
  state.from.mockReset().mockImplementation(() => { const q = { select: () => q, eq: () => q, limit: () => q, abortSignal: async () => ({ data: state.rows, count: state.count, error: state.readError ? {} : null }) }; return q; });
});
it.each(["{", "null", "[]", '{"connectionId":1}', '{"connectionId":""}', '{"connectionId":"invalid"}', '{"extra":true}'])("never turns malformed input into a full bank pull (%s)", async body => {
  expect((await POST(request(body))).status).toBe(400); expect(state.sync).not.toHaveBeenCalled(); expect(state.single).not.toHaveBeenCalled(); expect(state.from).not.toHaveBeenCalled();
});
it("bounds input and preserves authentication, CSRF and rate checks", async () => {
  expect((await POST(request(" ".repeat(4097)))).status).toBe(413);
  expect((await POST(request("", "https://other.test"))).status).toBe(403);
  state.user = false; expect((await POST(request())).status).toBe(401); state.user = true;
  state.limited = true; expect((await POST(request())).status).toBe(429); expect(state.from).not.toHaveBeenCalled();
});
it("requires complete owner-filtered connection reads before syncing", async () => {
  state.rows = [{ id, user_id: "owner" }]; state.count = 2;
  expect((await POST(request())).status).toBe(502); expect(state.sync).not.toHaveBeenCalled();
  state.count = 1; state.readError = true; expect((await POST(request())).status).toBe(502); expect(state.sync).not.toHaveBeenCalled();
  state.readError = false; state.rows[0].user_id = "foreign"; expect((await POST(request())).status).toBe(502); expect(state.sync).not.toHaveBeenCalled();
});
it("reports selected consent failures and missing connections without false success", async () => {
  const body = JSON.stringify({ connectionId: id });
  state.single.mockResolvedValueOnce(null).mockResolvedValueOnce({ status: "expired" }).mockResolvedValueOnce({ status: "error" });
  expect((await POST(request(body))).status).toBe(404); expect((await POST(request(body))).status).toBe(409); expect((await POST(request(body))).status).toBe(502);
  const result = await POST(request(body)); expect(await result.json()).toEqual({ inserted: 2, banks: 1, accounts: 1 });
  expect(state.single.mock.calls[0][1]).toBe("owner"); expect(state.sync).not.toHaveBeenCalled();
});
it("keeps confirmed other-bank counts while marking a partial pass failed and redacting causes", async () => {
  state.rows = [{ id, user_id: "owner" }, { id: "second", user_id: "owner" }]; state.count = 2;
  state.sync.mockRejectedValueOnce(new Error("Synthetic private upstream detail"));
  const response = await POST(request()); expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ inserted: 2, banks: 1, accounts: 1, failed: 1, error: "bank-sync-incomplete" });
});

it("ends a partial pass at the shared deadline and counts every unprocessed connection", async () => {
  state.rows = [id, "second", "third"].map(id => ({ id, user_id: "owner" })); state.count = 3;
  state.sync.mockResolvedValueOnce({ status: "linked", inserted: 2, accountsLinked: 1 }).mockImplementationOnce(() => new Promise(() => undefined));
  const pending = POST(request()); await vi.waitFor(() => expect(state.sync).toHaveBeenCalledTimes(2));
  state.controller!.abort(new Error("Synthetic private abort detail"));
  const response = await pending; expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ inserted: 2, banks: 1, accounts: 1, failed: 2, error: "bank-sync-incomplete" });
  expect(state.sync).toHaveBeenCalledTimes(2);
});
it("ends a selected hanging pull without leaking its abort reason", async () => {
  state.single.mockImplementationOnce(() => new Promise(() => undefined)); const pending = POST(request(JSON.stringify({ connectionId: id })));
  await vi.waitFor(() => expect(state.single).toHaveBeenCalledOnce()); state.controller!.abort(new Error("Synthetic private abort detail"));
  const response = await pending; expect(response.status).toBe(502); expect(await response.text()).not.toContain("private abort");
});
