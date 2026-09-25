import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dashboardDataKeysForTab, onDemandDataKeys, tabNeedsDashboardData } from "@/lib/dashboard-data";
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

  it("loads notifications only for the Inbox", () => {
    for (const tab of NAV_TABS) {
      expect(tabNeedsDashboardData(tab, "notifications"), tab).toBe(tab === "inbox");
    }
    expect(dashboardDataKeysForTab("home").has("inboxItems")).toBe(false);
  });

  it("loads Career and Opportunities records only after the check is pressed", () => {
    expect([...dashboardDataKeysForTab("career")]).toEqual(["jobLastRun"]);
    expect([...dashboardDataKeysForTab("opportunities")]).toEqual([]);
    for (const key of ["jobListings", "jobUserStates", "savedJobPositions", "jobApplications", "jobApplicationEvents", "coverLetterTemplates"] as const) {
      expect(tabNeedsDashboardData("career", key), key).toBe(false);
      expect(tabNeedsDashboardData("career", key, true), key).toBe(true);
    }
    for (const key of ["projects", "organizations", "opportunities"] as const) {
      expect(tabNeedsDashboardData("opportunities", key), key).toBe(false);
      expect(tabNeedsDashboardData("opportunities", key, true), key).toBe(true);
    }
    // Activation never widens another destination.
    expect(onDemandDataKeys("home")).toEqual([]);
    expect(tabNeedsDashboardData("home", "jobListings", true)).toBe(false);
  });

  it("schedules no daily job scrape", () => {
    const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as { crons: { path: string }[] };
    expect(vercel.crons.map((cron) => cron.path)).not.toContain("/api/cron/jobs-scrape");
    expect(vercel.crons.map((cron) => cron.path)).toContain("/api/cron/renewal-warnings");
  });
});
