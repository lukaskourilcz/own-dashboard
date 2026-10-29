import { todayKey } from "@/lib/date-keys";
import { staleCronCount } from "@/lib/cron-heartbeat";
import { taskBelongsToProject } from "@/lib/project-match";
import type { Cron, Project, ProjectCost, Todo } from "@/lib/types";

export type ProjectHealth = "healthy" | "attention" | "at_risk";

export type ProjectHealthResult = {
  health: ProjectHealth;
  reasons: string[];
};

/** A small, explainable heuristic. It never mutates project state. */
export function assessProjectHealth(
  project: Project,
  todos: Todo[],
  costs: ProjectCost[],
  crons: Cron[],
  now = new Date(),
): ProjectHealthResult {
  const reasons: string[] = [];
  const today = todayKey(now);
  const overdue = todos.filter(
    (todo) =>
      taskBelongsToProject(todo, project) &&
      !todo.done &&
      todo.due_date != null &&
      todo.due_date < today,
  ).length;
  const projectCrons = crons.filter((cron) => cron.project_id === project.id);
  const disabledCrons = projectCrons.filter((cron) => !cron.enabled).length;
  // An enabled cron that has not reported a success in several of its own
  // intervals is a job the owner believes is running and is not.
  const silentCrons = staleCronCount(projectCrons, now);
  const monthlyCost = costs
    .filter((cost) => cost.project_id === project.id)
    .reduce((sum, cost) => sum + Number(cost.amount), 0);

  if (project.status === "on_hold") reasons.push("Project is on hold");
  if (overdue > 0) reasons.push(`${overdue} overdue task${overdue === 1 ? "" : "s"}`);
  if (disabledCrons > 0) reasons.push(`${disabledCrons} disabled automation${disabledCrons === 1 ? "" : "s"}`);
  if (silentCrons > 0) {
    reasons.push(
      silentCrons === 1
        ? "1 automation missed its heartbeat"
        : `${silentCrons} automations missed their heartbeat`,
    );
  }
  if (monthlyCost > 0 && Number(project.revenue ?? 0) === 0) {
    reasons.push("Running costs without recorded revenue");
  }

  return {
    health:
      project.status === "on_hold" || overdue >= 2
        ? "at_risk"
        : reasons.length > 0
          ? "attention"
          : "healthy",
    reasons,
  };
}

export type ProjectHealthCopy = {
  projectOnHold: string; costsWithoutRevenue: string; overdueTasks: string;
  disabledAutomations: string; missedHeartbeat: string;
};

/** Both project surfaces use the same bilingual explanations. */
export function localizeProjectHealthReason(reason: string, copy: ProjectHealthCopy): string {
  if (reason === "Project is on hold") return copy.projectOnHold;
  if (reason === "Running costs without recorded revenue") return copy.costsWithoutRevenue;
  const counted = /^(\d+) (overdue tasks?|disabled automations?|automations? missed (?:its|their) heartbeat)$/.exec(reason);
  if (!counted) return reason;
  const label = counted[2].startsWith("overdue") ? copy.overdueTasks
    : counted[2].startsWith("disabled") ? copy.disabledAutomations : copy.missedHeartbeat;
  return `${label}: ${counted[1]}`;
}
