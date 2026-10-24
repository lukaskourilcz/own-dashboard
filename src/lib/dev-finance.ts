import { todayKey } from "@/lib/date-keys";
import { convert } from "@/lib/fx";
import { isActive, toMonthlyIn } from "@/lib/subscriptions";
import { projectEngagement, projectMonthlyIn } from "@/lib/projects";
import { isPortfolioProject } from "@/lib/portfolio";
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
 * is `development` or when a project allocation/legacy project link exists. A
 * transaction belongs to development when it settles a development subscription, is linked
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
  if (sub.category_group === "development" || sub.project_id) return true;
  return allocations.some((allocation) => allocation.subscription_id === sub.id);
}

export function isDevelopmentTransaction(tx: Transaction, developmentSubscriptions?: ReadonlySet<string>): boolean {
  if (tx.kind !== "expense") return false;
  if (tx.project_id || (tx.subscription_id && developmentSubscriptions?.has(tx.subscription_id))) return true;
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

/** Index allocations once per calculation, instead of rescanning all rows for
 * every subscription and every historical payment. No stored share changes. */
export function indexSubscriptionShares(subscriptions: Subscription[], allocations: SubscriptionAllocation[]): Map<string, ShareSlice[]> {
  const bySubscription = new Map<string, SubscriptionAllocation[]>();
  for (const allocation of allocations) {
    const rows = bySubscription.get(allocation.subscription_id);
    if (rows) rows.push(allocation); else bySubscription.set(allocation.subscription_id, [allocation]);
  }
  return new Map(subscriptions.map(sub => [sub.id, subscriptionShares(sub, bySubscription.get(sub.id) ?? [])]));
}

/**
 * Which stored allocation rows an edit removed: the rows the form opened with
 * whose project is no longer in it. The form's starting rows are the only
 * evidence of what the owner saw, so a row that loaded after the form opened
 * is never deleted by a save that could not have shown it.
 */
export function staleAllocationIds(
  startedWith: readonly Pick<SubscriptionAllocation, "id" | "project_id">[],
  kept: readonly { project_id: string }[],
): string[] {
  const keep = new Set(kept.map((row) => row.project_id));
  return startedWith.filter((row) => !keep.has(row.project_id)).map((row) => row.id);
}

/**
 * Whether a subscription is being billed today: switched on, its entered start
 * date reached and its entered end date not yet passed. No dates are inferred.
 */
export function isRunningSubscription(sub: Subscription, now: Date = new Date()): boolean {
  if (!isActive(sub)) return false;
  const today = todayKey(now), started = sub.started_on ?? "";
  if (DATE_ONLY.test(started) && started > today) return false;
  const ended = sub.ended_on ?? "";
  return !DATE_ONLY.test(ended) || ended >= today;
}

/** One running development subscription's part of one project. */
export type ProjectSubscriptionShare = {
  subscription: Subscription;
  share: number;
  /** The share's monthly amount in the requested currency. */
  monthly: number;
};

/**
 * The running development subscriptions each project carries, keyed by project
 * id, with what its share costs per month in `currency`. The Money overview, a
 * project workspace and the Projects list all take their subscription figure
 * from this rule, so a project shows one monthly cost wherever it appears and a
 * cancelled subscription stops counting in all three at once.
 */
export function projectSubscriptionShares(
  subscriptions: Subscription[],
  allocations: SubscriptionAllocation[],
  currency: string,
  now: Date = new Date(),
): Map<string, ProjectSubscriptionShare[]> {
  const byProject = new Map<string, ProjectSubscriptionShare[]>();
  const allocated = new Set(allocations.map(row => row.subscription_id));
  const shares = indexSubscriptionShares(subscriptions, allocations);
  for (const subscription of subscriptions) {
    if (subscription.category_group !== "development" && !subscription.project_id && !allocated.has(subscription.id)) continue;
    if (!isRunningSubscription(subscription, now)) continue;
    const monthly = toMonthlyIn(subscription, currency);
    for (const slice of shares.get(subscription.id) ?? []) {
      if (!slice.projectId) continue;
      const entry = { subscription, share: slice.share, monthly: monthly * slice.share };
      const list = byProject.get(slice.projectId);
      if (list) list.push(entry);
      else byProject.set(slice.projectId, [entry]);
    }
  }
  return byProject;
}

/** The monthly total of a project's subscription shares; none is zero. */
export function sharesMonthly(shares: readonly ProjectSubscriptionShare[] | undefined): number {
  return (shares ?? []).reduce((sum, item) => sum + item.monthly, 0);
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
  /** Recurring spend on the owner's own projects (`engagement = 'own'`). */
  ownMonthly: number;
  /** Recurring spend on freelance client projects (`engagement = 'client'`). */
  clientMonthly: number;
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
  const allocated = new Set(allocations.map(row => row.subscription_id));
  const devSubs = subscriptions.filter(sub => sub.category_group === "development" || sub.project_id || allocated.has(sub.id));
  const shares = indexSubscriptionShares(subscriptions, allocations);
  const monthlyById = new Map(devSubs.map(sub => [sub.id, toMonthlyIn(sub, currency)]));
  const activeDevSubs = devSubs.filter((sub) => isRunningSubscription(sub, now));
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const recurringByProject = new Map<string, number>();
  let unallocated = 0;

  for (const sub of activeDevSubs) {
    const monthly = monthlyById.get(sub.id)!;
    for (const slice of shares.get(sub.id) ?? []) {
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
  const today = todayKey(now);
  const developmentIds = new Set(devSubs.map(sub => sub.id));
  const devTx = transactions.filter(tx => isDevelopmentTransaction(tx, developmentIds) && tx.occurred_on <= today);
  const windowTx = devTx.filter((tx) => monthKeyOf(tx.occurred_on) >= firstKey);
  const subById = new Map(subscriptions.map((sub) => [sub.id, sub]));
  const paidByProject = new Map<string, number>();
  const oneOffByProject = new Map<string, number>();
  let paidTotal = 0;
  const paidByMonth = new Map<string, number>();

  for (const tx of windowTx) {
    const amount = convert(tx.amount, tx.currency, currency);
    paidTotal += amount;
    const month = monthKeyOf(tx.occurred_on);
    paidByMonth.set(month, (paidByMonth.get(month) ?? 0) + amount);
    const sub = tx.subscription_id ? subById.get(tx.subscription_id) : undefined;
    // A transaction's explicit project is more specific than the current
    // subscription split; subscription payments remain outside one-off totals.
    if (tx.project_id) {
      paidByProject.set(tx.project_id, (paidByProject.get(tx.project_id) ?? 0) + amount);
      if (!sub) oneOffByProject.set(tx.project_id, (oneOffByProject.get(tx.project_id) ?? 0) + amount);
    } else if (sub) {
      for (const slice of shares.get(sub.id) ?? []) {
        if (!slice.projectId) continue;
        paidByProject.set(slice.projectId, (paidByProject.get(slice.projectId) ?? 0) + amount * slice.share);
      }
    }
  }

  const costsByProject = new Map<string, ProjectCost[]>(), cronsByProject = new Map<string, Cron[]>();
  for (const cost of projectCosts) {
    const rows = costsByProject.get(cost.project_id); if (rows) rows.push(cost); else costsByProject.set(cost.project_id, [cost]);
  }
  for (const cron of crons) {
    const rows = cronsByProject.get(cron.project_id); if (rows) rows.push(cron); else cronsByProject.set(cron.project_id, [cron]);
  }
  const byProject: ProjectSpend[] = projects
    .map((project) => {
      const costLinesMonthly = projectMonthlyIn(
        costsByProject.get(project.id) ?? [],
        cronsByProject.get(project.id) ?? [],
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
    // Portfolio and client projects stay listed at zero; any other project
    // appears only once it carries spend.
    .filter((row) => row.recurringMonthly > 0 || row.oneOffTotal > 0 || row.paidTotal > 0 || isPortfolioProject(row.project) || projectEngagement(row.project) === "client")
    .sort((a, b) => b.recurringMonthly - a.recurringMonthly || b.paidTotal - a.paidTotal || a.project.name.localeCompare(b.project.name));

  const engagementMonthly = (engagement: "own" | "client") =>
    byProject.filter((row) => projectEngagement(row.project) === engagement).reduce((sum, row) => sum + row.recurringMonthly, 0);

  const recurringMonthly = activeDevSubs.reduce((sum, sub) => sum + monthlyById.get(sub.id)!, 0)
    + byProject.reduce((sum, row) => sum + row.costLinesMonthly, 0);

  const timeline: TimelinePoint[] = keys.map((month) => ({
    month,
    committed: devSubs
      .filter((sub) => subscriptionActiveInMonth(sub, month))
      .reduce((sum, sub) => sum + monthlyById.get(sub.id)!, 0),
    paid: paidByMonth.get(month) ?? 0,
  }));

  const byVendor = activeDevSubs
    .map((sub) => ({ name: sub.name, value: monthlyById.get(sub.id)!, subscription: sub }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);

  // Only running subscriptions are reported: an ended vendor's figure no longer
  // moves the recurring total, so asking the owner to go and check it is noise.
  const unconfirmed = activeDevSubs.filter((sub) => !isAmountConfirmed(sub));

  return {
    recurringMonthly,
    recurringYearly: recurringMonthly * 12,
    unallocatedMonthly: unallocated,
    unconfirmedMonthly: unconfirmed.reduce((sum, sub) => sum + monthlyById.get(sub.id)!, 0),
    unconfirmedCount: unconfirmed.length,
    ownMonthly: engagementMonthly("own"),
    clientMonthly: engagementMonthly("client"),
    paidLastMonths: paidTotal,
    byProject,
    byVendor,
    timeline,
    developmentSubscriptions: devSubs,
    developmentTransactions: devTx.sort((a, b) => b.occurred_on.localeCompare(a.occurred_on)),
  };
}
