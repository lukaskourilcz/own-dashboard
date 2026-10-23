import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ user: true, from: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: state.user ? { id: "owner" } : null } }) },
  from: state.from,
}) }));
import { POST } from "@/app/api/money/rules/apply/route";

const request = (body: unknown, origin = "https://app.example") => new Request("https://app.example/api/money/rules/apply", {
  method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
});
beforeEach(() => { state.user = true; state.from.mockReset(); });

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
