import type { Cron, ProjectCost } from "@/lib/types";
import { convert } from "@/lib/fx";

/** A single cost line's monthly amount in the display currency. */
export function costMonthlyIn(cost: ProjectCost, display: string): number {
  return convert(cost.amount, cost.currency, display);
}

/**
 * A cron's estimated monthly spend in the display currency. Only AI-API-call
 * crons that are enabled cost money — everything else is 0. The estimate is
 * cost_per_run × runs_per_month.
 */
export function cronMonthlyIn(cron: Cron, display: string): number {
  if (!cron.enabled || !cron.is_ai_call) return 0;
  return convert(cron.cost_per_run * cron.runs_per_month, cron.currency, display);
}

export function costsMonthlyIn(costs: ProjectCost[], display: string): number {
  return costs.reduce((acc, c) => acc + costMonthlyIn(c, display), 0);
}

export function cronsMonthlyIn(crons: Cron[], display: string): number {
  return crons.reduce((acc, c) => acc + cronMonthlyIn(c, display), 0);
}

/** Total monthly cost of a project = manual cost lines + AI cron estimates. */
export function projectMonthlyIn(
  costs: ProjectCost[],
  crons: Cron[],
  display: string,
): number {
  return costsMonthlyIn(costs, display) + cronsMonthlyIn(crons, display);
}
