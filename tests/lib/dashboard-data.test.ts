import { describe, expect, it } from "vitest";
import { dashboardDataKeysForTab, tabNeedsDashboardData } from "@/lib/dashboard-data";
import { NAV_TABS } from "@/lib/nav-tabs";

describe("dashboard route data boundaries", () => {
  it("keeps unrelated financial and career records out of Home", () => {
    const keys = dashboardDataKeysForTab("home");
    expect(keys.has("todos")).toBe(true);
    expect(keys.has("todayCalendar")).toBe(true);
    expect(keys.has("transactions")).toBe(false);
    expect(keys.has("jobListings")).toBe(false);
    expect(keys.has("weekCalendar")).toBe(false);
  });

  it("loads the relationships required by a project workspace", () => {
    const keys = dashboardDataKeysForTab("projects");
    for (const key of [
      "projects",
      "projectCommunications",
      "todos",
      "subscriptions",
      "transactions",
      "invoices",
      "notes",
      "prompts",
      "repoNotes",
      "crons",
    ] as const) {
      expect(keys.has(key), key).toBe(true);
    }
  });

  it("loads competitors and allocations where the new sections render them", () => {
    expect(dashboardDataKeysForTab("competition").has("competitors")).toBe(true);
    expect(dashboardDataKeysForTab("competition").has("transactions")).toBe(false);
    expect(dashboardDataKeysForTab("works").has("competitors")).toBe(true);
    expect(dashboardDataKeysForTab("projects").has("aiLinks")).toBe(true);
    expect(dashboardDataKeysForTab("money").has("subscriptionAllocations")).toBe(true);
    expect(dashboardDataKeysForTab("home").has("competitors")).toBe(false);
  });

  it("keeps the notification bell available on every destination", () => {
    for (const tab of NAV_TABS) {
      expect(tabNeedsDashboardData(tab, "notifications"), tab).toBe(true);
    }
  });
});
