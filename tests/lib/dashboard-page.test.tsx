import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
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
  auth: { getUser: async () => ({ data: { user: { id: "owner", user_metadata: {} } } }) },
  rpc: (_name: string, args: { p_entity: string }) => {
    const table = args.p_entity;
    state.reads.push(table);
    return state.rejected.has(table) ? Promise.reject(new Error("network")) : Promise.resolve({
      data: [], error: state.failures.has(table) ? { message: "database unavailable" } : null,
    });
  },
  from: (table: string) => {
    state.reads.push(table);
    const query = {
      select: () => query, eq: () => query, order: () => query, limit: () => query, range: () => query, maybeSingle: () => query,
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        (state.rejected.has(table) ? Promise.reject(new Error("network")) : Promise.resolve({
          data: table === "projects" ? state.projects : [],
          count: table === "projects" ? state.projects.length : 0,
          error: state.failures.has(table) ? { message: "database unavailable" } : null,
        })).then(resolve, reject),
    };
    return query;
  },
}) }));

import DashboardPage from "@/app/[[...slug]]/page";
import { DashboardShell } from "@/components/dashboard-shell";
import { DashboardDataUnavailable } from "@/components/dashboard-data-unavailable";

const page = (slug?: string[]) => DashboardPage({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({}) });
beforeEach(() => { state.failures.clear(); state.rejected.clear(); state.reads = []; state.projects = []; });

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
