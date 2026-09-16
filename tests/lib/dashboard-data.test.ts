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
    expect(keys.has("jobUserStates")).toBe(false);
    expect(keys.has("weekCalendar")).toBe(false);
  });

  it("loads job applications on Home for the follow-up column only", () => {
    // The hero merges opportunity and career follow-ups; neither the scraped
    // board nor the application history belongs on Home.
    expect(dashboardDataKeysForTab("home").has("jobApplications")).toBe(true);
    expect(dashboardDataKeysForTab("home").has("jobApplicationEvents")).toBe(false);
    expect(dashboardDataKeysForTab("home").has("savedJobPositions")).toBe(false);
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

  it("loads invoices only where payments are matched against them", () => {
    for (const tab of ["accounts", "transactions", "categories"] as const) {
      expect(dashboardDataKeysForTab(tab).has("invoices"), tab).toBe(true);
      expect(dashboardDataKeysForTab(tab).has("invoiceItems"), tab).toBe(true);
    }
    // The Money overview renders development finance only, so it needs neither.
    expect(dashboardDataKeysForTab("money").has("invoices")).toBe(false);
    expect(dashboardDataKeysForTab("money").has("invoiceItems")).toBe(false);
    // The invoice list names the payment that settled a paid invoice.
    expect(dashboardDataKeysForTab("invoices").has("transactions")).toBe(true);
    expect(dashboardDataKeysForTab("home").has("invoices")).toBe(false);
  });

  it("loads last week's calendar only where weekly planning measures it", () => {
    expect(dashboardDataKeysForTab("work").has("lastWeekCalendar")).toBe(true);
    expect(dashboardDataKeysForTab("work").has("weeklyReviews")).toBe(true);
    expect(dashboardDataKeysForTab("home").has("lastWeekCalendar")).toBe(false);
    expect(dashboardDataKeysForTab("calendar").has("lastWeekCalendar")).toBe(false);
  });

  it("keeps the notification bell available on every destination", () => {
    for (const tab of NAV_TABS) {
      expect(tabNeedsDashboardData(tab, "notifications"), tab).toBe(true);
    }
  });
});
