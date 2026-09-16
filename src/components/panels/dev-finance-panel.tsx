"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { format, parseISO } from "date-fns";
import { CircleDollarSign, CreditCard, FolderKanban, Handshake, PieChart, Receipt, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { Metric } from "@/components/ui/metric";
import { PageHeader, SectionLabel } from "@/components/ui/page-header";
import { SimpleSelect } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EntityBadge, StatusBadge } from "@/components/ui/status-badge";
import { SubscriptionIcon } from "@/components/subscriptions/subscription-icon";
import { Tooltip } from "@/components/ui/tooltip";
import { CHART_COLORS } from "@/lib/chart-colors";
import { isAmountConfirmed, summarizeDevFinance, subscriptionShares } from "@/lib/dev-finance";
import { SUPPORTED_CURRENCIES } from "@/lib/fx";
import { useDateLocale, useDict } from "@/lib/i18n";
import { projectScope } from "@/lib/portfolio";
import { isActive, toMonthlyIn } from "@/lib/subscriptions";
import { formatCurrency } from "@/lib/utils";
import type { Cron, Project, ProjectCost, Subscription, SubscriptionAllocation, Transaction } from "@/lib/types";

const chartFallback = () => <Skeleton className="h-full w-full" />;
const SpendBarChart = dynamic(() => import("@/components/charts/spend-bar-chart").then((m) => m.SpendBarChart), { ssr: false, loading: chartFallback });
const CategoryDonut = dynamic(() => import("@/components/charts/category-donut").then((m) => m.CategoryDonut), { ssr: false, loading: chartFallback });

const MONTHS = 12;

function Legend({ data, currency }: { data: { name: string; value: number }[]; currency: string }) {
  return (
    <ul className="space-y-1.5">
      {data.map((row, index) => (
        <li key={row.name} className="flex items-center gap-2 text-xs">
          <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />
          <span className="flex-1 truncate text-foreground">{row.name}</span>
          <span className="tabular text-foreground-muted">{formatCurrency(row.value, currency)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Money overview reframed as development finance: recurring tooling and
 * hosting spend, its split between the product portfolio and client works,
 * the per-project and per-vendor breakdown, and what was paid month by month.
 */
export function DevFinancePanel({ subscriptions, allocations, transactions, projects, projectCosts, crons, displayCurrency, setDisplayCurrency, onOpenSubscriptions, onOpenProject }: {
  subscriptions: Subscription[];
  allocations: SubscriptionAllocation[];
  transactions: Transaction[];
  projects: Project[];
  projectCosts: ProjectCost[];
  crons: Cron[];
  displayCurrency: string;
  setDisplayCurrency?: (next: string) => void;
  onOpenSubscriptions: () => void;
  onOpenProject: (project: Project) => void;
}) {
  const t = useDict();
  const f = t.portfolio.finance;
  const locale = useDateLocale();
  const summary = useMemo(
    () => summarizeDevFinance({ subscriptions, allocations, transactions, projects, projectCosts, crons, currency: displayCurrency, months: MONTHS }),
    [subscriptions, allocations, transactions, projects, projectCosts, crons, displayCurrency],
  );
  const timeline = useMemo(
    () => summary.timeline.map((point) => ({ ...point, label: format(parseISO(`${point.month}-01`), t.finances.monthFormat, { locale }) })),
    [summary.timeline, t.finances.monthFormat, locale],
  );
  const projectSlices = useMemo(() => {
    const rows = summary.byProject.filter((row) => row.recurringMonthly > 0).map((row) => ({ name: row.project.name, value: Number(row.recurringMonthly.toFixed(2)) }));
    if (summary.unallocatedMonthly > 0) rows.push({ name: f.unallocatedShort, value: Number(summary.unallocatedMonthly.toFixed(2)) });
    return rows;
  }, [summary, f.unallocatedShort]);
  const vendorSlices = useMemo(() => summary.byVendor.map((row) => ({ name: row.name, value: Number(row.value.toFixed(2)) })), [summary.byVendor]);
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const subscriptionById = useMemo(() => new Map(subscriptions.map((sub) => [sub.id, sub])), [subscriptions]);
  const hasSpend = summary.recurringMonthly > 0 || summary.paidLastMonths > 0;
  const shareOf = (value: number) => summary.recurringMonthly > 0 ? `${Math.round((value / summary.recurringMonthly) * 100)}%` : "—";
  const cycleLabel = (sub: Subscription) => t.subscriptions.cycle[sub.billing_cycle] ?? sub.billing_cycle;

  return (
    <div>
      <PageHeader
        title={f.title}
        description={f.description}
        action={
          <div className="inline-flex flex-wrap items-center gap-2">
            {setDisplayCurrency && (
              <>
                <Label className="hidden text-foreground-subtle sm:inline">{t.projects.displayIn}</Label>
                <SimpleSelect value={displayCurrency} onValueChange={setDisplayCurrency} aria-label={t.projects.displayIn} className="h-8 w-20 text-xs" options={SUPPORTED_CURRENCIES.map((c) => ({ value: c, label: c }))} />
              </>
            )}
            <Button size="sm" variant="outline" onClick={onOpenSubscriptions}><CreditCard className="h-3.5 w-3.5" />{f.manageSubscriptions}</Button>
          </div>
        }
      />

      {!hasSpend ? (
        <Card><CardContent className="py-8"><EmptyState icon={Wallet} title={f.noDevSpend} description={f.noDevSpendHint} action={<Button size="sm" onClick={onOpenSubscriptions}>{f.manageSubscriptions}</Button>} /></CardContent></Card>
      ) : (
        <div className="space-y-4">
          <section className="surface-band p-4 sm:p-5">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="flex items-center gap-1.5 text-foreground-muted"><CircleDollarSign className="h-3.5 w-3.5" /><SectionLabel>{f.recurringMonthly}</SectionLabel></div>
                <p className="mt-1.5 text-4xl font-semibold tracking-tight tabular text-foreground sm:text-5xl">{formatCurrency(summary.recurringMonthly, displayCurrency)}</p>
                <p className="mt-1 text-xs tabular text-foreground-subtle">{f.recurringYearly}: {formatCurrency(summary.recurringYearly, displayCurrency)} · {f.paidLastMonths(MONTHS)}: {formatCurrency(summary.paidLastMonths, displayCurrency)}</p>
                {summary.unconfirmedCount > 0 && (
                  <p className="mt-1 max-w-prose text-xs text-warning">{f.unconfirmedAmounts(formatCurrency(summary.unconfirmedMonthly, displayCurrency), summary.unconfirmedCount)}</p>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <Metric label={f.projectsShare} value={formatCurrency(summary.projectsMonthly, displayCurrency)} detail={shareOf(summary.projectsMonthly)} icon={FolderKanban} />
                <Metric label={f.worksShare} value={formatCurrency(summary.worksMonthly, displayCurrency)} detail={shareOf(summary.worksMonthly)} icon={Handshake} />
                <Tooltip content={f.unallocatedHint}>
                  <div><Metric label={f.unallocated} value={formatCurrency(summary.unallocatedMonthly, displayCurrency)} detail={shareOf(summary.unallocatedMonthly)} icon={PieChart} tone={summary.unallocatedMonthly > 0 ? "attention" : "default"} /></div>
                </Tooltip>
              </div>
            </div>
          </section>

          <Card>
            <CardHeader><CardTitle>{f.timelineTitle}</CardTitle><p className="text-xs text-foreground-muted">{f.timelineHint}</p></CardHeader>
            <CardContent><div className="h-56 sm:h-64"><SpendBarChart data={timeline} currency={displayCurrency} committedLabel={f.committed} paidLabel={f.paid} /></div></CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>{f.byProjectTitle}</CardTitle></CardHeader>
              <CardContent>
                {projectSlices.length === 0 ? <p className="text-sm text-foreground-muted">{f.noDevSpend}</p> : (
                  <div className="grid items-center gap-6 sm:grid-cols-2">
                    <div className="h-48 sm:h-56"><CategoryDonut data={projectSlices} currency={displayCurrency} innerRadius={56} outerRadius={92} /></div>
                    <Legend data={projectSlices} currency={displayCurrency} />
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{f.byVendorTitle}</CardTitle></CardHeader>
              <CardContent>
                {vendorSlices.length === 0 ? <p className="text-sm text-foreground-muted">{f.noDevSpend}</p> : (
                  <div className="grid items-center gap-6 sm:grid-cols-2">
                    <div className="h-48 sm:h-56"><CategoryDonut data={vendorSlices} currency={displayCurrency} innerRadius={56} outerRadius={92} /></div>
                    <Legend data={vendorSlices} currency={displayCurrency} />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="overflow-hidden p-0">
            <CardHeader className="border-b border-border"><CardTitle>{f.byProjectTitle}</CardTitle><p className="text-xs text-foreground-muted">{f.allocationsHint}</p></CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left">
                <thead className="border-b border-border bg-surface-secondary text-[11px] text-foreground-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2.5 font-medium">{f.projectColumn}</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">{f.scopeColumn}</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">{f.monthlyColumn}</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">{f.yearlyColumn}</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">{f.oneOffColumn}</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">{f.paidColumn}</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">{f.shareColumn}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {summary.byProject.filter((row) => row.recurringMonthly > 0 || row.paidTotal > 0).map((row) => {
                    const scope = projectScope(row.project);
                    const parent = row.project.parent_id ? projectById.get(row.project.parent_id) : undefined;
                    return (
                      <tr key={row.project.id} className="hover:bg-surface-hover">
                        <td className="px-3 py-2.5">
                          <button type="button" onClick={() => onOpenProject(row.project)} className="focus-ring rounded text-sm font-medium text-foreground hover:underline">{row.project.name}</button>
                          {parent && <span className="ml-2 text-xs text-foreground-subtle">{t.portfolio.subsectionOf(parent.name)}</span>}
                        </td>
                        <td className="px-3 py-2.5"><StatusBadge value={scope} label={f.scope[scope]} tone={scope === "work" ? "information" : "neutral"} /></td>
                        <td className="px-3 py-2.5 text-right tabular">{formatCurrency(row.recurringMonthly, displayCurrency)}</td>
                        <td className="px-3 py-2.5 text-right tabular text-foreground-muted">{formatCurrency(row.recurringMonthly * 12, displayCurrency)}</td>
                        <td className="px-3 py-2.5 text-right tabular text-foreground-muted">{formatCurrency(row.oneOffTotal, displayCurrency)}</td>
                        <td className="px-3 py-2.5 text-right tabular text-foreground-muted">{formatCurrency(row.paidTotal, displayCurrency)}</td>
                        <td className="px-3 py-2.5 text-right tabular text-foreground-muted">{shareOf(row.recurringMonthly)}</td>
                      </tr>
                    );
                  })}
                  {summary.unallocatedMonthly > 0 && (
                    <tr className="bg-surface-secondary/60">
                      <td className="px-3 py-2.5 text-sm text-foreground-muted" colSpan={2}>{f.unallocated}</td>
                      <td className="px-3 py-2.5 text-right tabular">{formatCurrency(summary.unallocatedMonthly, displayCurrency)}</td>
                      <td className="px-3 py-2.5 text-right tabular text-foreground-muted">{formatCurrency(summary.unallocatedMonthly * 12, displayCurrency)}</td>
                      <td className="px-3 py-2.5" colSpan={2} />
                      <td className="px-3 py-2.5 text-right tabular text-foreground-muted">{shareOf(summary.unallocatedMonthly)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            <CardHeader className="border-b border-border">
              <CardTitle>{f.byVendorTitle}</CardTitle>
              {summary.unconfirmedCount > 0 && <p className="max-w-prose text-xs text-foreground-muted">{f.unconfirmedAmountsHint}</p>}
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left">
                <thead className="border-b border-border bg-surface-secondary text-[11px] text-foreground-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2.5 font-medium">{f.vendorColumn}</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">{f.planColumn}</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">{f.amountColumn}</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">{f.monthlyColumn}</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">{f.startedColumn}</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">{f.nextColumn}</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">{f.allocationColumn}</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">{t.professional.status}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[...summary.developmentSubscriptions].sort((a, b) => Number(isActive(b)) - Number(isActive(a)) || toMonthlyIn(b, displayCurrency) - toMonthlyIn(a, displayCurrency)).map((sub) => {
                    const active = isActive(sub);
                    const confirmed = isAmountConfirmed(sub);
                    const shares = subscriptionShares(sub, allocations).filter((slice) => slice.projectId && projectById.has(slice.projectId));
                    return (
                      <tr key={sub.id} className={active ? "hover:bg-surface-hover" : "opacity-60 hover:bg-surface-hover"}>
                        <td className="px-3 py-2.5">
                          <div className="flex items-start gap-2">
                            <SubscriptionIcon name={sub.name} size={26} />
                            <div className="min-w-0">
                              <span className="text-sm font-medium">{sub.name}</span>
                              {/* The caveat the import recorded, read where the figure is read. */}
                              {sub.notes && <span className="mt-0.5 block max-w-[22rem] text-[11px] text-foreground-subtle">{sub.notes}</span>}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-foreground-muted">{sub.plan ?? "—"}</td>
                        <td className="px-3 py-2.5 text-right text-xs tabular text-foreground-muted">
                          {formatCurrency(sub.amount, sub.currency)} · {cycleLabel(sub)}
                          {confirmed
                            ? <span className="mt-0.5 block text-[11px] text-foreground-subtle">{f.amountConfirmed(sub.amount_confirmed_on!)}</span>
                            : active && <span className="mt-0.5 block text-[11px] text-warning">{f.amountUnconfirmed}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular">{formatCurrency(toMonthlyIn(sub, displayCurrency), displayCurrency)}</td>
                        <td className="px-3 py-2.5 text-xs tabular text-foreground-muted">{sub.started_on ?? "—"}{sub.ended_on ? ` – ${sub.ended_on}` : ""}</td>
                        <td className="px-3 py-2.5 text-xs tabular text-foreground-muted">{active ? sub.next_billing_date ?? "—" : sub.ended_on ?? "—"}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {shares.length === 0 ? <span className="text-xs text-foreground-subtle">{f.unallocatedShort}</span> : shares.map((slice) => <EntityBadge key={slice.projectId}>{projectById.get(slice.projectId!)!.name} · {Math.round(slice.share * 100)}%</EntityBadge>)}
                          </div>
                        </td>
                        <td className="px-3 py-2.5"><StatusBadge value={active ? "active" : "inactive"} label={active ? f.running : f.ended} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {summary.byProject.some((row) => row.costLinesMonthly > 0) && <p className="border-t border-border px-4 py-2 text-xs text-foreground-subtle">{f.manualCosts}: {formatCurrency(summary.byProject.reduce((sum, row) => sum + row.costLinesMonthly, 0), displayCurrency)}</p>}
          </Card>

          <Card className="overflow-hidden p-0">
            <CardHeader className="border-b border-border"><CardTitle><Receipt className="h-4 w-4" />{f.recentTransactions}</CardTitle></CardHeader>
            {summary.developmentTransactions.length === 0 ? <CardContent className="pt-4"><p className="text-sm text-foreground-muted">{f.noRecentTransactions}</p></CardContent> : (
              <ul className="divide-y divide-border">
                {summary.developmentTransactions.slice(0, 40).map((tx) => {
                  const sub = tx.subscription_id ? subscriptionById.get(tx.subscription_id) : undefined;
                  const project = tx.project_id ? projectById.get(tx.project_id) : undefined;
                  return (
                    <li key={tx.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="w-24 shrink-0 text-xs tabular text-foreground-subtle">{tx.occurred_on}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{tx.note || tx.category || sub?.name || project?.name}</p>
                        <p className="truncate text-[11px] text-foreground-subtle">{sub ? f.settles(sub.name) : project?.name ?? tx.category ?? ""}</p>
                      </div>
                      <span className="shrink-0 text-sm tabular">{formatCurrency(tx.amount, tx.currency)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
