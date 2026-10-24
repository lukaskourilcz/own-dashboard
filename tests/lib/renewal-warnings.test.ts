import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET } from "@/app/api/cron/renewal-warnings/route";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ mode: "", send: vi.fn(), log: vi.fn(), ping: vi.fn(), owner: "11111111-1111-4111-8111-111111111111", date: "2026-10-25", language: "cs", enabled: true, subs: 1, calls: [] as { table: string; method: string; args: unknown[] }[], saved: [] as Record<string, unknown>[], prior: [] as Record<string, unknown>[] }));
vi.mock("@/lib/renewal-email", async load => ({ ...await load<object>(), sendRenewalEmail: (...args: unknown[]) => state.send(...args) }));
vi.mock("@/lib/cron-log", () => ({ logCronRun: (...args: unknown[]) => state.log(...args) }));
vi.mock("@/lib/heartbeat", () => ({ heartbeatUrlForJob: () => null, pingHeartbeat: (...args: unknown[]) => state.ping(...args) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  let payload: Record<string, unknown> | null = null;
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "limit", "abortSignal", "maybeSingle", "upsert"]) builder[method] = (...args: unknown[]) => {
    state.calls.push({ table, method, args }); if (method === "upsert") { payload = args[0] as Record<string, unknown>; state.saved.push(payload); } return builder;
  };
  builder.then = (resolve: (value: unknown) => unknown) => {
    const error = state.mode === `${table}-error` || (payload && state.mode === "save-error") ? { message: "Synthetic private database failure" } : null;
    const data = table === "user_preferences" ? { user_id: state.mode === "foreign-preferences" ? "foreign" : state.owner, notifications_renewals: state.enabled, language: state.language, timezone: "Europe/Prague" }
      : table === "profiles" ? { id: state.owner, email: "owner@example.test" }
      : table === "subscriptions" ? Array.from({ length: state.subs }, (_, i) => ({ id: `22222222-2222-4222-8222-${String(i).padStart(12, "0")}`, user_id: state.mode === "foreign-subscription" ? "foreign" : state.owner, name: `Synthetic subscription ${i}`, amount: "25.50", currency: "EUR", next_billing_date: state.date, is_active: true, amount_confirmed_on: null }))
      : payload ? state.mode === "suppressed-save" ? null : { ...payload, ...(state.mode === "altered-save" ? { ref_id: "foreign" } : {}) } : state.prior;
    return Promise.resolve({ data, error, count: table === "subscriptions" ? state.mode === "partial-subscriptions" ? state.subs + 1 : state.subs : table === "notification_log" ? state.mode === "partial-history" ? state.prior.length + 1 : state.prior.length : null }).then(resolve);
  }; return builder;
} }) }));
const request = (signal?: AbortSignal) => new Request("https://app.example.test/api/cron/renewal-warnings", { headers: { authorization: "Bearer invented-cron-fixture" }, signal });
beforeEach(() => {
  state.mode = ""; state.language = "cs"; state.enabled = true; state.subs = 1; state.date = "2026-10-25"; state.calls = []; state.saved = []; state.prior = [];
  state.send.mockReset(); state.send.mockResolvedValue("33333333-3333-4333-8333-333333333333"); state.log.mockReset(); state.ping.mockReset();
  vi.stubEnv("CRON_SECRET", "invented-cron-fixture"); vi.stubEnv("RESEND_API_KEY", "invented-email-fixture"); vi.stubEnv("DASHBOARD_OWNER_ID", state.owner);
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-24T22:30:00Z"));
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
it("uses Prague's calendar day, owner filters and confirmed provider/local receipts", async () => {
  const reply = await GET(request()); expect(reply.status).toBe(200); expect(await reply.json()).toMatchObject({ ok: true, sent: 1, failed: 0 });
  expect(state.calls).toContainEqual({ table: "subscriptions", method: "in", args: ["next_billing_date", ["2026-10-25", "2026-10-28"]] });
  for (const table of ["subscriptions", "user_preferences", "notification_log"]) expect(state.calls).toContainEqual({ table, method: "eq", args: ["user_id", state.owner] });
  expect(state.saved[0]).toMatchObject({ user_id: state.owner, sent_on: "2026-10-25", kind: "subscription_renewal_0d" });
  expect(state.send.mock.calls[0][0].text).toContain("neověřeno podle faktury"); expect(state.ping).toHaveBeenCalledOnce();
});
it("keeps the three-day reminder on a date key across the DST change", async () => { state.date = "2026-10-28"; state.language = "en"; expect((await GET(request())).status).toBe(200); expect(state.send.mock.calls[0][0].text).toContain("in 3 days (2026-10-28)"); expect(state.saved[0].kind).toBe("subscription_renewal_3d"); });
it("sends nothing after an explicit opt-out or missing configuration", async () => {
  state.enabled = false; expect((await GET(request())).status).toBe(200); expect(state.send).not.toHaveBeenCalled(); expect(state.calls.some(call => call.table === "subscriptions")).toBe(false);
  vi.stubEnv("RESEND_API_KEY", ""); expect((await GET(request())).status).toBe(200); expect(state.send).not.toHaveBeenCalled();
});
it.each(["user_preferences-error", "foreign-preferences", "subscriptions-error", "foreign-subscription", "partial-subscriptions", "profiles-error", "notification_log-error", "partial-history"])("sends nothing for an unknown %s context", async mode => {
  state.mode = mode; const reply = await GET(request()); expect(reply.status).toBe(503); expect(await reply.text()).not.toContain("private database"); expect(state.send).not.toHaveBeenCalled(); expect(state.ping).not.toHaveBeenCalled();
});
it.each(["save-error", "altered-save", "suppressed-save"])("does not report confirmed sent/healthy after %s", async mode => {
  state.mode = mode; const reply = await GET(request()); expect(reply.status).toBe(502); expect(await reply.json()).toMatchObject({ sent: 0, failed: 1, ok: false }); expect(state.ping).not.toHaveBeenCalled(); expect(state.log).toHaveBeenCalledWith(expect.objectContaining({ status: "failure" }), expect.any(AbortSignal));
});
it("retains the same provider identity after a delivery or sent-log failure", async () => {
  state.mode = "save-error"; await GET(request()); const key = state.send.mock.calls[0][1]; state.mode = ""; await GET(request()); expect(state.send.mock.calls[1][1]).toBe(key);
});
it("respects existing sent logs without another provider request", async () => {
  state.prior = [{ user_id: state.owner, kind: "subscription_renewal_0d", ref_id: "22222222-2222-4222-8222-000000000000" }];
  expect(await (await GET(request())).json()).toMatchObject({ sent: 0, skipped: 1, failed: 0 }); expect(state.send).not.toHaveBeenCalled();
});
it("counts provider failure rather than recording an email or pinging", async () => {
  state.send.mockRejectedValue(Error("Synthetic provider failure")); expect(await (await GET(request())).json()).toMatchObject({ sent: 0, failed: 1 }); expect(state.saved).toEqual([]); expect(state.ping).not.toHaveBeenCalled();
});
it("rejects a source beyond the bounded complete read before sending", async () => {
  state.subs = 101; expect((await GET(request())).status).toBe(503); expect(state.send).not.toHaveBeenCalled();
});
it("does not write a late sent log or start another email after cancellation", async () => {
  state.subs = 3; const controller = new AbortController(); let release!: (id: string) => void;
  state.send.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = GET(request(controller.signal)); await vi.waitFor(() => expect(state.send).toHaveBeenCalledOnce()); controller.abort();
  expect(await (await pending).json()).toMatchObject({ ok: false, sent: 0, failed: 3 }); expect(state.saved).toEqual([]); expect(state.ping).not.toHaveBeenCalled();
  release("33333333-3333-4333-8333-333333333333"); await Promise.resolve(); expect(state.send).toHaveBeenCalledOnce(); expect(state.saved).toEqual([]);
});
