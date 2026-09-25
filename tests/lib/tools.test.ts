import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dashboardDataKeysForTab } from "@/lib/dashboard-data";
import { NAV_TABS } from "@/lib/nav-tabs";
import {
  TOOL_STATUSES,
  filterToolsByProject,
  groupToolsByStatus,
  toolMonthlyCost,
  toolName,
  toolUsage,
} from "@/lib/tools";
import type { ProjectLink, Subscription, Tool } from "@/lib/types";

const TS = "2026-09-25T10:00:00Z";
const tool = (id: string, ai_link_id: string, status: Tool["status"], extra: Partial<Tool> = {}): Tool => ({
  id, user_id: "owner", ai_link_id, name: null, what_it_does: "Does things", status, subscription_id: null,
  created_at: TS, updated_at: TS, ...extra,
});
const relation = (id: string, project_id: string, ai_link_id: string, role: ProjectLink["role"], note = ""): ProjectLink => ({
  id, user_id: "owner", project_id, ai_link_id, role, note, sort_order: 0, created_at: TS, updated_at: TS,
});
const links = [
  { id: "vercel", title: "Vercel" },
  { id: "supabase", title: "Supabase" },
  { id: "figma", title: "Figma" },
];
const projects = [
  { id: "dneskai", name: "DNESKAi" },
  { id: "devshark", name: "devShark" },
];
const tools = [
  tool("t-figma", "figma", "trial", { subscription_id: "s-figma" }),
  tool("t-vercel", "vercel", "in_use"),
  tool("t-supabase", "supabase", "in_use", { name: "Supabase Postgres" }),
];
const relations = [
  relation("r1", "devshark", "vercel", "tool", "Hosts the client"),
  relation("r2", "dneskai", "vercel", "tool", "Hosts DNESKAi"),
  relation("r3", "dneskai", "supabase", "uses"),
];

describe("tools", () => {
  it("groups by status in order and sorts by display name", () => {
    expect(TOOL_STATUSES).toEqual(["in_use", "trial", "retired"]);
    const groups = groupToolsByStatus(tools, links);
    expect(groups.map((group) => [group.status, group.tools.map((item) => item.id)])).toEqual([
      ["in_use", ["t-supabase", "t-vercel"]],
      ["trial", ["t-figma"]],
    ]);
    expect(toolName(tools[2]!, links[1])).toBe("Supabase Postgres");
    expect(toolName(tools[1]!, links[0])).toBe("Vercel");
  });

  it("lists the projects a tool is used in from role-tool relations only", () => {
    expect(toolUsage(tools[1]!, relations, projects).map(({ project, relation }) => [project.name, relation.note])).toEqual([
      ["devShark", "Hosts the client"],
      ["DNESKAi", "Hosts DNESKAi"],
    ]);
    expect(toolUsage(tools[2]!, relations, projects)).toEqual([]);
  });

  it("filters tools by the project they help", () => {
    expect(filterToolsByProject(tools, relations, "dneskai").map((item) => item.id)).toEqual(["t-vercel"]);
    expect(filterToolsByProject(tools, relations, "all")).toHaveLength(3);
  });

  it("takes the monthly cost from an active linked subscription with static FX", () => {
    const subscriptions: Subscription[] = [
      { id: "s-figma", user_id: "owner", name: "Figma", amount: 1440, currency: "CZK", billing_cycle: "yearly", category: null, next_billing_date: "2026-12-01", is_active: true, created_at: TS, updated_at: TS },
    ];
    expect(toolMonthlyCost(tools[0]!, subscriptions, "CZK")).toBe(120);
    expect(toolMonthlyCost(tools[1]!, subscriptions, "CZK")).toBeNull();
    expect(toolMonthlyCost(tools[0]!, [{ ...subscriptions[0]!, is_active: false }], "CZK")).toBeNull();
  });

  it("is a library navigation tab that loads its own data", () => {
    expect(NAV_TABS.indexOf("tools")).toBe(NAV_TABS.indexOf("prompts") + 1);
    expect(NAV_TABS.indexOf("links")).toBe(NAV_TABS.indexOf("tools") + 1);
    const keys = dashboardDataKeysForTab("tools");
    for (const key of ["tools", "aiLinks", "aiCategories", "projects", "projectLinks", "subscriptions"] as const) {
      expect(keys.has(key), key).toBe(true);
    }
    expect(keys.has("notifications")).toBe(false);
  });
});

describe("tools migration", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20260925090500_tools.sql", import.meta.url), "utf8");

  it("is own-only with owned link and subscription checks", () => {
    expect(sql).toMatch(/unique \(user_id, ai_link_id\)/);
    expect(sql).toMatch(/status in \('in_use', 'trial', 'retired'\)/);
    expect(sql).toMatch(/subscription_id uuid references public\.subscriptions\(id\) on delete set null/);
    expect(sql).toMatch(/tools enable row level security/);
    expect(sql.match(/from public\.ai_links l where l\.id = ai_link_id and l\.user_id = \(select auth\.uid\(\)\)/g)).toHaveLength(2);
    expect(sql.match(/subscription_id is null or exists \(select 1 from public\.subscriptions s where s\.id = subscription_id and s\.user_id = \(select auth\.uid\(\)\)\)/g)).toHaveLength(2);
  });
});
