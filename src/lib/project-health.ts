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
  const overdue = todos.filter(
    (todo) =>
      todo.project_id === project.id &&
      !todo.done &&
      todo.due_date != null &&
      new Date(`${todo.due_date}T23:59:59`).getTime() < now.getTime(),
  ).length;
  const disabledCrons = crons.filter(
    (cron) => cron.project_id === project.id && !cron.enabled,
  ).length;
  const monthlyCost = costs
    .filter((cost) => cost.project_id === project.id)
    .reduce((sum, cost) => sum + Number(cost.amount), 0);

  if (project.status === "on_hold") reasons.push("Project is on hold");
  if (overdue > 0) reasons.push(`${overdue} overdue task${overdue === 1 ? "" : "s"}`);
  if (disabledCrons > 0) reasons.push(`${disabledCrons} disabled automation${disabledCrons === 1 ? "" : "s"}`);
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
