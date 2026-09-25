import type { Cron, Project, ProjectCost, ProjectEngagement } from "@/lib/types";
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

/** A project's engagement; rows written before the column existed are own. */
export function projectEngagement(
  project: Pick<Project, "engagement">,
): ProjectEngagement {
  return project.engagement === "client" ? "client" : "own";
}

/**
 * Split projects into the owner's own products and freelance client work,
 * keeping the incoming order inside each group. Lists render own first, then a
 * divider, then client projects.
 */
export function groupProjectsByEngagement<T extends Pick<Project, "engagement">>(
  projects: readonly T[],
): { own: T[]; client: T[] } {
  const own: T[] = [];
  const client: T[] = [];
  for (const project of projects) {
    (projectEngagement(project) === "client" ? client : own).push(project);
  }
  return { own, client };
}

/** Own projects first, then client projects, each in the incoming order. */
export function orderProjectsByEngagement<T extends Pick<Project, "engagement">>(
  projects: readonly T[],
): T[] {
  const { own, client } = groupProjectsByEngagement(projects);
  return [...own, ...client];
}

/**
 * Resolve a URL segment to a project: the id or the current slug first, then
 * an earlier slug, so a renamed project's old URL keeps working.
 */
export function resolveProjectRef<
  T extends Pick<Project, "id" | "slug"> & Partial<Pick<Project, "previous_slugs">>,
>(projects: readonly T[], ref: string): T | undefined {
  return (
    projects.find((project) => project.id === ref || project.slug === ref) ??
    projects.find((project) => project.previous_slugs?.includes(ref))
  );
}
