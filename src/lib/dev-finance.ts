import { convert } from "@/lib/fx";
import { isActive, toMonthlyIn } from "@/lib/subscriptions";
import { projectMonthlyIn } from "@/lib/projects";
import { projectScope } from "@/lib/portfolio";
import type {
  Cron,
  Project,
  ProjectCost,
  Subscription,
  SubscriptionAllocation,
  Transaction,
} from "@/lib/types";

/**
 * Development finance: what building and running the projects costs.
 *
 * Scope rule — a subscription belongs to development when its category group
 * is `development` or when at least one project allocation exists. A
 * transaction belongs to development when it settles a subscription, is linked
 * to a project, or carries a development category. Personal spend (rent,
 * streaming, insurance) never enters these figures.
 *
 * Allocation rule — a subscription's normalized monthly amount is split by the
 * recorded shares. The remainder (1 − Σ shares) is reported as unallocated
 * overhead rather than distributed by guesswork.
 *
 * Confirmation rule — a figure is exact only once somebody has compared it with
 * the vendor's own invoice. `amount_confirmed_on` records that date, and the
 * summary reports how much of the recurring total has never been compared,
 * rather than presenting an inferred amount as a measured one.
 */

export const DEVELOPMENT_CATEGORIES = new Set(["development", "dev", "vývoj", "vyvoj", "software", "hosting", "ai tools", "ai"]);

export function isDevelopmentSubscription(sub: Subscription, allocations: SubscriptionAllocation[]): boolean {
  if (sub.category_group === "development") return true;
  return allocations.some((allocation) => allocation.subscription_id === sub.id);
}

export function isDevelopmentTransaction(tx: Transaction): boolean {
  if (tx.kind !== "expense") return false;
  if (tx.subscription_id || tx.project_id) return true;
  return DEVELOPMENT_CATEGORIES.has((tx.category ?? "").trim().toLowerCase());
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** The three fields a confirmation vouches for. */
export type AmountFigure = Pick<Subscription, "amount" | "currency" | "billing_cycle">;

/**
 * Whether this subscription's figure has been checked against a vendor invoice.
 *
 * `amount_confirmed_on` is a Postgres `date`, so it is validated by shape and
 * never parsed into a `Date`: reading it as a timestamp would make the answer
 * depend on the reader's timezone, and the only question here is whether a date
 * was recorded at all. A missing, empty or malformed value is unconfirmed,
 * which is the honest reading of "we do not know when this was checked".
 */
export function isAmountConfirmed(sub: Pick<Subscription, "amount_confirmed_on">): boolean {
  return DATE_ONLY.test(sub.amount_confirmed_on ?? "");
}

/**
 * The confirmation date an edited subscription should keep.
 *
 * A confirmation says "on this date I compared this amount with the invoice".
 * Change the amount, the currency or the billing cycle and that sentence is
 * about a figure that no longer exists, so the confirmation is dropped rather
 * than carried onto a number nobody checked. Everything else — renaming the
 * vendor, moving the renewal date, editing the notes — leaves it standing.
 *
 * A new subscription is never born confirmed: typing an amount is not checking
 * it.
 */
export function amountConfirmationAfterEdit(
  previous: (AmountFigure & Pick<Subscription, "amount_confirmed_on">) | null | undefined,
  next: AmountFigure,
): string | null {
  if (!previous || !isAmountConfirmed(previous)) return null;
  const sameFigure =
    Number(previous.amount) === Number(next.amount)
    && previous.currency === next.currency
    && previous.billing_cycle === next.billing_cycle;
  return sameFigure ? previous.amount_confirmed_on ?? null : null;
}

export type ShareSlice = { projectId: string | null; share: number };

/** Project shares of one subscription; the null project is the unallocated remainder. */
export function subscriptionShares(sub: Subscription, allocations: SubscriptionAllocation[]): ShareSlice[] {
  const own = allocations.filter((allocation) => allocation.subscription_id === sub.id && allocation.share > 0);
  const slices: ShareSlice[] = own.map((allocation) => ({ projectId: allocation.project_id, share: allocation.share }));
  const total = slices.reduce((sum, slice) => sum + slice.share, 0);
  if (total > 1) {
    // Over-allocated rows are normalized so a data-entry slip cannot create money.
    for (const slice of slices) slice.share = slice.share / total;
    return slices;
  }
  if (own.length === 0 && sub.project_id) return [{ projectId: sub.project_id, share: 1 }];
  if (total < 1) slices.push({ projectId: null, share: 1 - total });
  return slices;
}

/** Month key (`yyyy-MM`) helpers without a timezone surprise: keys are compared lexically. */
export function monthKeyOf(date: string): string {
  return date.slice(0, 7);
}

export function monthKeys(count: number, now: Date): string[] {
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

/**
 * Whether a subscription was being billed during a month. `started_on` falls
 * back to the row's creation date; an inactive row without `ended_on` counts
 * as ended at its last update, which is the closest recorded fact.
 */
export function subscriptionActiveInMonth(sub: Subscription, monthKey: string): boolean {
  const started = monthKeyOf(sub.started_on ?? sub.created_at ?? "");
  if (started && started > monthKey) return false;
  const ended = sub.ended_on
    ? monthKeyOf(sub.ended_on)
    : isActive(sub)
      ? null
      : monthKeyOf(sub.updated_at ?? sub.created_at ?? "");
  if (ended && ended < monthKey) return false;
  return true;
}

export type ProjectSpend = {
  project: Project;
  recurringMonthly: number;
  costLinesMonthly: number;
  oneOffTotal: number;
  paidTotal: number;
};

export type TimelinePoint = { month: string; committed: number; paid: number };

export type DevFinanceSummary = {
  recurringMonthly: number;
  recurringYearly: number;
  unallocatedMonthly: number;
  /** Recurring monthly spend whose figure has never been checked against an invoice. */
  unconfirmedMonthly: number;
  /** How many running development subscriptions carry such a figure. */
  unconfirmedCount: number;
  projectsMonthly: number;
  worksMonthly: number;
  paidLastMonths: number;
  byProject: ProjectSpend[];
  byVendor: { name: string; value: number; subscription: Subscription }[];
  timeline: TimelinePoint[];
  developmentSubscriptions: Subscription[];
  developmentTransactions: Transaction[];
};

export function summarizeDevFinance({
  subscriptions,
  allocations,
  transactions,
  projects,
  projectCosts,
  crons,
  currency,
  now = new Date(),
  months = 12,
}: {
  subscriptions: Subscription[];
  allocations: SubscriptionAllocation[];
  transactions: Transaction[];
  projects: Project[];
  projectCosts: ProjectCost[];
  crons: Cron[];
  currency: string;
  now?: Date;
  months?: number;
}): DevFinanceSummary {
  const devSubs = subscriptions.filter((sub) => isDevelopmentSubscription(sub, allocations));
  const activeDevSubs = devSubs.filter(isActive);
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const recurringByProject = new Map<string, number>();
  let unallocated = 0;

  for (const sub of activeDevSubs) {
    const monthly = toMonthlyIn(sub, currency);
    for (const slice of subscriptionShares(sub, allocations)) {
      const amount = monthly * slice.share;
      if (slice.projectId && projectById.has(slice.projectId)) {
        recurringByProject.set(slice.projectId, (recurringByProject.get(slice.projectId) ?? 0) + amount);
      } else {
        unallocated += amount;
      }
    }
  }

  const keys = monthKeys(months, now);
  const firstKey = keys[0] ?? "";
  const devTx = transactions.filter(isDevelopmentTransaction);
  const windowTx = devTx.filter((tx) => monthKeyOf(tx.occurred_on) >= firstKey);
  const subById = new Map(subscriptions.map((sub) => [sub.id, sub]));
  const paidByProject = new Map<string, number>();
  const oneOffByProject = new Map<string, number>();
  let paidTotal = 0;

  for (const tx of windowTx) {
    const amount = convert(tx.amount, tx.currency, currency);
    paidTotal += amount;
    const sub = tx.subscription_id ? subById.get(tx.subscription_id) : undefined;
    if (sub) {
      for (const slice of subscriptionShares(sub, allocations)) {
        if (!slice.projectId) continue;
        paidByProject.set(slice.projectId, (paidByProject.get(slice.projectId) ?? 0) + amount * slice.share);
      }
    } else if (tx.project_id) {
      paidByProject.set(tx.project_id, (paidByProject.get(tx.project_id) ?? 0) + amount);
      oneOffByProject.set(tx.project_id, (oneOffByProject.get(tx.project_id) ?? 0) + amount);
    }
  }

  const byProject: ProjectSpend[] = projects
    .map((project) => {
      const costLinesMonthly = projectMonthlyIn(
        projectCosts.filter((cost) => cost.project_id === project.id),
        crons.filter((cron) => cron.project_id === project.id),
        currency,
      );
      return {
        project,
        recurringMonthly: (recurringByProject.get(project.id) ?? 0) + costLinesMonthly,
        costLinesMonthly,
        oneOffTotal: oneOffByProject.get(project.id) ?? 0,
        paidTotal: paidByProject.get(project.id) ?? 0,
      };
    })
    .filter((row) => row.recurringMonthly > 0 || row.oneOffTotal > 0 || row.paidTotal > 0 || projectScope(row.project) !== "other")
    .sort((a, b) => b.recurringMonthly - a.recurringMonthly || b.paidTotal - a.paidTotal || a.project.name.localeCompare(b.project.name));

  const scopeMonthly = (scope: "project" | "work") =>
    byProject.filter((row) => projectScope(row.project) === scope).reduce((sum, row) => sum + row.recurringMonthly, 0);

  const recurringMonthly = activeDevSubs.reduce((sum, sub) => sum + toMonthlyIn(sub, currency), 0)
    + byProject.reduce((sum, row) => sum + row.costLinesMonthly, 0);

  const timeline: TimelinePoint[] = keys.map((month) => ({
    month,
    committed: devSubs
      .filter((sub) => subscriptionActiveInMonth(sub, month))
      .reduce((sum, sub) => sum + toMonthlyIn(sub, currency), 0),
    paid: windowTx
      .filter((tx) => monthKeyOf(tx.occurred_on) === month)
      .reduce((sum, tx) => sum + convert(tx.amount, tx.currency, currency), 0),
  }));

  const byVendor = activeDevSubs
    .map((sub) => ({ name: sub.name, value: toMonthlyIn(sub, currency), subscription: sub }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);

  // Only running subscriptions are reported: an ended vendor's figure no longer
  // moves the recurring total, so asking the owner to go and check it is noise.
  const unconfirmed = activeDevSubs.filter((sub) => !isAmountConfirmed(sub));

  return {
    recurringMonthly,
    recurringYearly: recurringMonthly * 12,
    unallocatedMonthly: unallocated,
    unconfirmedMonthly: unconfirmed.reduce((sum, sub) => sum + toMonthlyIn(sub, currency), 0),
    unconfirmedCount: unconfirmed.length,
    projectsMonthly: scopeMonthly("project"),
    worksMonthly: scopeMonthly("work"),
    paidLastMonths: paidTotal,
    byProject,
    byVendor,
    timeline,
    developmentSubscriptions: devSubs,
    developmentTransactions: devTx.sort((a, b) => b.occurred_on.localeCompare(a.occurred_on)),
  };
}
