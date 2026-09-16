import { describe, expect, it } from "vitest";
import { assessProjectHealth } from "@/lib/project-health";
import type { Cron, Project } from "@/lib/types";

const project: Project = {
  id: "p1", user_id: "u1", name: "Portal", slug: "portal", repo_full_name: null,
  url: null, notes: "", color: null, sort_order: 0, is_active: true,
  status: "active", revenue: 0, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
};

describe("assessProjectHealth", () => {
  it("is healthy without explainable warning signals", () => {
    expect(assessProjectHealth(project, [], [], [], new Date("2026-07-21"))).toEqual({ health: "healthy", reasons: [] });
  });

  it("marks two overdue linked tasks at risk", () => {
    const todo = (id: string) => ({
      id, user_id: "u1", title: id, done: false, due_date: "2026-07-01", category: null,
      created_at: "2026-01-01", source: "manual" as const, repo_id: null,
      repo_full_name: null, repo_owner: null, repo_name: null, repo_url: null,
      needed_raw: null, generated_at: null, importance: null, project_id: "p1",
    });
    const result = assessProjectHealth(project, [todo("a"), todo("b")], [], [], new Date("2026-07-21"));
    expect(result.health).toBe("at_risk");
    expect(result.reasons).toContain("2 overdue tasks");
  });

  it("explains a cron that stopped reporting, and ignores a fresh one", () => {
    const cron = (id: string, lastSuccessAt: string | null): Cron => ({
      id, user_id: "u1", project_id: "p1", name: id, schedule: "0 6 * * *",
      description: "", endpoint: "", is_ai_call: false, cost_per_run: 0,
      currency: "USD", runs_per_month: 30, enabled: true, last_run_at: lastSuccessAt,
      heartbeat_url: "https://uptime.example.com/api/push/abc",
      last_success_at: lastSuccessAt, created_at: "", updated_at: "",
    });
    const now = new Date("2026-07-21T12:00:00Z");

    const silent = assessProjectHealth(project, [], [], [cron("a", "2026-07-10T06:00:00Z")], now);
    expect(silent.health).toBe("attention");
    expect(silent.reasons).toContain("1 automation missed its heartbeat");

    const fresh = assessProjectHealth(project, [], [], [cron("b", "2026-07-21T06:00:00Z")], now);
    expect(fresh).toEqual({ health: "healthy", reasons: [] });
  });

  it("explains cost without revenue as attention", () => {
    const result = assessProjectHealth(project, [], [{
      id: "c1", user_id: "u1", project_id: "p1", label: "Hosting", amount: 20,
      currency: "USD", note: "", sort_order: 0, created_at: "", updated_at: "",
    }], [], new Date("2026-07-21"));
    expect(result.health).toBe("attention");
    expect(result.reasons).toContain("Running costs without recorded revenue");
  });
});
