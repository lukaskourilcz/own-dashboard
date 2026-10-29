import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  auth: vi.fn(),
  paused: new Map<string, Promise<unknown>>(),
  failures: new Set<string>(),
  rejected: new Set<string>(),
  reads: [] as string[],
  projects: [] as { id: string; slug: string; is_active: boolean }[],
}));
vi.mock("@/components/dashboard-shell", () => ({ DashboardShell: () => null }));
vi.mock("@/components/dashboard-data-unavailable", () => ({ DashboardDataUnavailable: () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("404"); }, redirect: () => { throw new Error("redirect"); } }));
vi.mock("@/lib/calendar-server", () => ({ fetchTodayWindowEvents: async () => ({ ok: true, events: [] }), fetchUpcomingWeekEvents: async () => ({ ok: true, events: [] }) }));
vi.mock("@/lib/user-prefs", () => ({ loadUserPreferences: async () => ({ language: "cs" }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: () => state.auth() },
  rpc: (_name: string, args: { p_entity: string }) => {
    const table = args.p_entity;
    state.reads.push(table);
    const query = {
      retry: () => query, abortSignal: () => query,
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        (state.paused.get(table) ?? (state.rejected.has(table) ? Promise.reject(new Error("network")) : Promise.resolve({
          data: table === "projects" ? state.projects.map(project => ({ user_id: "11111111-1111-4111-8111-111111111111", ...project })) : [], error: state.failures.has(table) ? { message: "database unavailable" } : null,
        }))).then(resolve, reject),
    };
    return query;
  },
  from: (table: string) => {
    state.reads.push(table);
    const query = {
      select: () => query, retry: () => query, abortSignal: () => query, eq: () => query, order: () => query, limit: () => query, range: () => query, maybeSingle: () => query,
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        (state.paused.get(table) ?? (state.rejected.has(table) ? Promise.reject(new Error("network")) : Promise.resolve({
          data: table === "projects" ? state.projects : [],
          count: table === "projects" ? state.projects.length : 0,
          error: state.failures.has(table) ? { message: "database unavailable" } : null,
        }))).then(resolve, reject),
    };
    return query;
  },
}) }));

import DashboardPage from "@/app/[[...slug]]/page";
import { DashboardShell } from "@/components/dashboard-shell";
import { DashboardDataUnavailable } from "@/components/dashboard-data-unavailable";

const page = (slug?: string[]) => DashboardPage({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({}) });
beforeEach(() => { state.auth.mockReset().mockResolvedValue({ data: { user: { id: "11111111-1111-4111-8111-111111111111", user_metadata: {} } }, error: null }); state.paused.clear(); state.failures.clear(); state.rejected.clear(); state.reads = []; state.projects = []; });

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });
function fakeClock() { vi.useFakeTimers(); vi.spyOn(AbortSignal, "timeout").mockImplementation(delay => { const controller = new AbortController(); setTimeout(() => controller.abort(), delay); return controller.signal; }); }

describe("authenticated dashboard read failures", () => {
  it("does not seed an editable page with failed empty records", async () => {
    state.failures.add("subscriptions");
    const result = await page(["subscriptions"]);
    expect(result.type).toBe(DashboardDataUnavailable);
    expect(result.props.lang).toBe("cs");
  });
  it("handles a rejected network read without fabricating a successful result", async () => {
    state.rejected.add("invoice_items");
    expect((await page(["invoices"])).type).toBe(DashboardDataUnavailable);
  });
  it("does not turn a project read outage into a false 404", async () => {
    state.failures.add("projects");
    expect((await page(["projects", "mine"])).type).toBe(DashboardDataUnavailable);
  });
  it("retains 404 for a missing or foreign project after a successful read", async () => {
    await expect(page(["projects", "foreign"])).rejects.toThrow("404");
  });
  it("accepts genuinely empty data and reuses the project read for navigation", async () => {
    const result = await page(["notes"]);
    expect(result.type).toBe(DashboardShell);
    expect(result.props.initialDataKeys).toEqual(["notes", "projects"]);
    expect(result.props.initialNotes).toEqual([]);
    expect(state.reads.filter(table => table === "projects")).toHaveLength(1);
  });
  it("keeps a small navigation projection when the destination needs no projects", async () => {
    const result = await page(["marketing"]);
    expect(result.type).toBe(DashboardShell);
    expect(state.reads).toEqual(["projects"]);
    state.failures.add("projects");
    expect((await page(["marketing"])).type).toBe(DashboardDataUnavailable);
    state.failures.clear();
    state.rejected.add("projects");
    expect((await page(["marketing"])).type).toBe(DashboardDataUnavailable);
  });
});

it('does not render private data from an auth error with a cached user', async () => {
 state.auth.mockResolvedValue({ data: { user: { id: '11111111-1111-4111-8111-111111111111', user_metadata: {} } }, error: Error('PRIVATE TEST') });
 await expect(page(['notes'])).rejects.toThrow('redirect'); expect(state.reads).toEqual([]);
});
it('bounds uncooperative authentication before any private query and ignores its late result', async () => {
 fakeClock(); let finish!: (value: unknown) => void, settled = false;
 state.auth.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
 const pending = page(['notes']).then(value => { settled = true; return value; }); await vi.advanceTimersByTimeAsync(8001); const metDeadline = settled;
 finish({ data: { user: { id: '11111111-1111-4111-8111-111111111111', user_metadata: {} } }, error: null }); const result = await pending;
 expect(metDeadline).toBe(true); expect(result.type).toBe(DashboardDataUnavailable); expect(state.reads).toEqual([]);
});
it('refuses an uncooperative required read instead of waiting forever or seeding an empty page', async () => {
 fakeClock(); let finish!: (value: unknown) => void, settled = false;
 state.paused.set('notes', new Promise(resolve => { finish = resolve; })); const pending = page(['notes']).then(value => { settled = true; return value; });
 await vi.advanceTimersByTimeAsync(20001); const metDeadline = settled; finish({ data: [], error: null }); const result = await pending;
 expect(metDeadline).toBe(true); expect(result.type).toBe(DashboardDataUnavailable);
});
it.each([null, { id: '' }, { id: 'invalid', user_metadata: {} }])('redirects an absent or malformed verified identity before querying: %j', async user => {
 state.auth.mockResolvedValue({ data: { user }, error: null }); await expect(page(['notes'])).rejects.toThrow('redirect'); expect(state.reads).toEqual([]);
});
it('shows unavailable after a rejected verification without reading private data', async () => {
 state.auth.mockRejectedValue(Error('PRIVATE TEST diagnostic')); const result = await page(['notes']); expect(result.type).toBe(DashboardDataUnavailable); expect(state.reads).toEqual([]);
});
it('bounds an uncooperative lightweight navigation projection too', async () => {
 fakeClock(); let finish!: (value: unknown) => void; state.paused.set('projects', new Promise(resolve => { finish = resolve; }));
 const pending = page(['marketing']); await vi.advanceTimersByTimeAsync(20001); const result = await pending; expect(result.type).toBe(DashboardDataUnavailable); finish({ data: [], error: null }); await Promise.resolve(); expect(state.reads).toEqual(['projects']);
});
it('enforces the total budget while awaiting framework search parameters', async () => {
 fakeClock(); let finish!: (value: object) => void;
 const pending = DashboardPage({ params: Promise.resolve({ slug: ['notes'] }), searchParams: new Promise(resolve => { finish = resolve; }) }); await vi.advanceTimersByTimeAsync(30001);
 expect((await pending).type).toBe(DashboardDataUnavailable); finish({}); await Promise.resolve();
});
