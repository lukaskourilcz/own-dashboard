import { projectSubscriptionShares, developmentPaymentAmount, isDevelopmentTransaction } from "@/lib/dev-finance";
import { projectMonthlyIn } from "@/lib/projects";
import type { Cron, Project, ProjectCost, Subscription, SubscriptionAllocation, Transaction } from "@/lib/types";

export const COST_PROJECTS = [
  { name: "DNESKAi", slugs: ["dneskai"] },
  { name: "devShark", slugs: ["devshark"] },
  { name: "heyDarlink", slugs: ["phone-app", "heydarlink"] },
  { name: "NaviGym", slugs: ["gym-plzen", "navigym"] },
] as const;

export type ProjectCostInput = {
  subscriptions: Subscription[]; allocations: SubscriptionAllocation[]; transactions: Transaction[];
  projectCosts: ProjectCost[]; crons: Cron[]; currency: string; now?: Date; preview?: boolean;
};
export function projectCostEvidence(project: Project, input: ProjectCostInput) {
  const subscriptions = projectSubscriptionShares(input.subscriptions, input.allocations, input.currency, input.now).get(project.id) ?? [];
  const costs = input.projectCosts.filter(row => row.project_id === project.id);
  const payments = input.transactions.filter(row => row.project_id === project.id && isDevelopmentTransaction(row))
    .sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || a.id.localeCompare(b.id));
  const recurringCosts = costs.filter(row => !row.cost_type || row.cost_type === "monthly_estimate");
  const crons = input.crons.filter(row => row.project_id === project.id);
  return {
    project, subscriptions, payments,
    recurring: subscriptions.reduce((sum, row) => sum + row.monthly, 0) + projectMonthlyIn(recurringCosts, crons, input.currency),
    hasRecurring: subscriptions.length > 0 || recurringCosts.length > 0 || crons.some(row => row.enabled && row.is_ai_call),
    paid: payments.reduce((sum, row) => sum + developmentPaymentAmount(row, input.currency), 0),
    // Different periods and cost bases must stay visible, never added to a made-up grand total.
    usage: costs.filter(row => row.cost_type === "usage").sort((a, b) => (b.period_end ?? "").localeCompare(a.period_end ?? "")),
    credits: costs.filter(row => row.cost_type === "credit"),
  };
}

export function costEvidenceHref(value: string | null | undefined): string | null {
  try { const u = new URL(value ?? ""); return u.protocol === "https:" && !u.username && !u.password ? u.href : null; } catch { return null; }
}
