import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ user: true, from: vi.fn(), rpc: vi.fn(), limit: true }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: state.user ? { id: "owner" } : null } }) },
  from: state.from, rpc: state.rpc,
}) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: state.limit, retryAfter: 60 }) }));
import { POST } from "@/app/api/money/rules/apply/route";

const request = (body: unknown, origin = "https://app.example") => new Request("https://app.example/api/money/rules/apply", {
  method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
});
beforeEach(() => { state.user = true; state.from.mockReset(); state.rpc.mockReset(); state.limit = true; });

it.each([
  null, [], { mode: "unknown" }, { ruleId: "bad" }, { draft: null }, { draft: [] },
  { ruleId: "11111111-1111-4111-8111-111111111111", draft: {} },
  { draft: { conditions: [{ field: "note", op: "contains", value: "merchant" }, { field: "amount", op: "gt", value: "" }], actions: { category: "Work" } } },
  { draft: { stage: "unknown", conditions: [], actions: {} } },
  { mode: "apply", draft: { conditions: [], actions: {} } },
])("refuses malformed financial rules before reading or writing the ledger (%j)", async body => {
  expect((await POST(request(body))).status).toBe(400);
  expect(state.from).not.toHaveBeenCalled();
});

it("preserves same-origin and authenticated boundaries", async () => {
  expect((await POST(request({}, "https://other.test"))).status).toBe(403);
  state.user = false;
  expect((await POST(request({}))).status).toBe(401);
  expect(state.from).not.toHaveBeenCalled();
});

const version = "0123456789abcdef0123456789abcdef", id = "33333333-3333-4333-8333-333333333333";
const rule = { id, user_id: "owner", stage: "default", conditions: [{ field: "note", op: "contains", value: "merchant" }], actions: { category: "Work" } };
const ledger = { context: { owner_id: "owner", rules_version: version, rules: [rule], project_ids: [], subscription_ids: [] },
  transactions: [{ id, user_id: "owner", version, note: "Synthetic merchant", account_id: null, amount: 1, occurred_on: "2026-10-24", kind: "expense", category: null, project_id: null, subscription_id: null }] };
function respond(snapshot: unknown = ledger, receipt: unknown = { updated: 1, ids: [id] }, code?: string) {
  state.rpc.mockImplementation((name: string) => ({ abortSignal: async () => name === "transaction_rule_snapshot"
    ? { data: snapshot, error: null } : { data: receipt, error: code ? { code, message: "Synthetic private detail" } : null } }));
}
it("counts a complete snapshot and applies only a confirmed versioned plan", async () => {
  respond();
  expect(await (await POST(request({}))).json()).toMatchObject({ scanned: 1, matched: 1, changed: 1, updated: 0, truncated: false });
  expect(state.rpc).toHaveBeenCalledTimes(1); state.rpc.mockClear();
  expect(await (await POST(request({ mode: "apply", expectedRulesVersion: version }))).json()).toMatchObject({ updated: 1, truncated: false });
  expect(state.rpc).toHaveBeenLastCalledWith("apply_transaction_rule_plan", { p_rules_version: version, p_plan: [{ id, version, changes: { category: "Work" } }] });
  expect(state.from).not.toHaveBeenCalled();
});
it("refuses stale rules before applying and reports stale rows without leaking causes", async () => {
  respond(); expect((await POST(request({ mode: "apply", expectedRulesVersion: "a".repeat(32) }))).status).toBe(409); expect(state.rpc).toHaveBeenCalledTimes(1);
  state.rpc.mockClear(); respond(ledger, null, "40001");
  const response = await POST(request({ mode: "apply", expectedRulesVersion: version })); expect(response.status).toBe(409); expect(await response.text()).not.toContain("private detail");
});
it.each([null, { updated: 1, ids: [] }, { updated: 2, ids: [id, id] }, { updated: 1, ids: ["44444444-4444-4444-8444-444444444444"] }])("refuses an unconfirmed receipt %j", async receipt => {
  respond(ledger, receipt); expect((await POST(request({ mode: "apply", expectedRulesVersion: version }))).status).toBe(503);
});
it("refuses partial or malformed snapshots, oversized bodies and excess requests", async () => {
  respond({ ...ledger, transactions: null }); expect((await POST(request({}))).status).toBe(503);
  respond({ ...ledger, context: { ...ledger.context, rules: [{ ...rule, conditions: [null] }] } }); expect((await POST(request({}))).status).toBe(503);
  state.rpc.mockClear(); expect((await POST(request({ extra: "x".repeat(65536) }))).status).toBe(413); expect(state.rpc).not.toHaveBeenCalled();
  state.limit = false; expect((await POST(request({}))).status).toBe(429); expect(state.rpc).not.toHaveBeenCalled();
});
it("requires a captured apply version and refuses draft extras", async () => {
  for (const body of [{ mode: "apply" }, { mode: "apply", expectedRulesVersion: "bad" }, { draft: { conditions: [], actions: {}, extra: true } }]) expect((await POST(request(body))).status).toBe(400);
  expect(state.rpc).not.toHaveBeenCalled();
});
