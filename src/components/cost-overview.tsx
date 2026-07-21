"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDict } from "@/lib/i18n";
import { CHART_COLORS } from "@/lib/chart-colors";
import { formatCurrency, cn } from "@/lib/utils";
import { projectMonthlyIn } from "@/lib/projects";
import { isActive as subIsActive, toMonthlyIn } from "@/lib/subscriptions";
import type { Cron, Project, ProjectCost, Subscription } from "@/lib/types";

const CategoryDonut = dynamic(
  () =>
    import("@/components/charts/category-donut").then((m) => m.CategoryDonut),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> },
);

type Slice = { name: string; value: number };

/**
 * Aggregate spend broken down as pies: everything together, projects only, and
 * subscriptions by category. Project cost = manual cost lines + AI cron
 * estimates (same figure the Projects section shows); subscription cost is
 * normalized to a monthly amount. A monthly ↔ yearly toggle just scales every
 * value by 12 (yearly = monthly × 12), matching the rest of the app.
 */
export function CostOverview({
  projects,
  projectCosts,
  crons,
  subscriptions,
  displayCurrency,
  className,
}: {
  projects: Project[];
  projectCosts: ProjectCost[];
  crons: Cron[];
  subscriptions: Subscription[];
  displayCurrency: string;
  className?: string;
}) {
  const t = useDict();
  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");
  const factor = period === "yearly" ? 12 : 1;

  const costsByProject = useMemo(() => {
    const map = new Map<string, ProjectCost[]>();
    for (const c of projectCosts) {
      const arr = map.get(c.project_id);
      if (arr) arr.push(c);
      else map.set(c.project_id, [c]);
    }
    return map;
  }, [projectCosts]);

  const cronsByProject = useMemo(() => {
    const map = new Map<string, Cron[]>();
    for (const c of crons) {
      const arr = map.get(c.project_id);
      if (arr) arr.push(c);
      else map.set(c.project_id, [c]);
    }
    return map;
  }, [crons]);

  // Active projects → one slice each (monthly running cost), biggest first.
  const projectSlices = useMemo<Slice[]>(
    () =>
      projects
        .filter((p) => p.is_active)
        .map((p) => ({
          name: p.name,
          value: projectMonthlyIn(
            costsByProject.get(p.id) ?? [],
            cronsByProject.get(p.id) ?? [],
            displayCurrency,
          ),
        }))
        .filter((s) => s.value > 0)
        .sort((a, b) => b.value - a.value),
    [projects, costsByProject, cronsByProject, displayCurrency],
  );

  // Active subscriptions → one slice per category (e.g. Entertainment).
  const subscriptionSlices = useMemo<Slice[]>(() => {
    const byCategory = new Map<string, number>();
    for (const s of subscriptions) {
      if (!subIsActive(s)) continue;
      const key = s.category?.trim() || t.costs.overviewUncategorized;
      byCategory.set(key, (byCategory.get(key) ?? 0) + toMonthlyIn(s, displayCurrency));
    }
    return [...byCategory.entries()]
      .map(([name, value]) => ({ name, value }))
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [subscriptions, displayCurrency, t.costs.overviewUncategorized]);

  const projectsTotal = projectSlices.reduce((a, s) => a + s.value, 0);
  const subsTotal = subscriptionSlices.reduce((a, s) => a + s.value, 0);

  // The "all costs" pie keeps projects as one slice and subscriptions split by
  // category, so the whole picture reads at a glance.
  const totalSlices = useMemo<Slice[]>(() => {
    const slices: Slice[] = [];
    if (projectsTotal > 0)
      slices.push({ name: t.costs.overviewProjects, value: projectsTotal });
    slices.push(...subscriptionSlices);
    return slices.sort((a, b) => b.value - a.value);
  }, [projectsTotal, subscriptionSlices, t.costs.overviewProjects]);

  const hasAnything = projectsTotal > 0 || subsTotal > 0;
  const perLabel =
    period === "yearly" ? t.costs.overviewPerYr : t.costs.overviewPerMo;

  return (
    <Card className={cn("mb-4", className)}>
      <div className="flex items-center justify-between gap-2 p-4 pb-0">
        <h2 className="text-sm font-semibold text-foreground">
          {t.costs.overviewTitle}
        </h2>
        <div className="inline-flex rounded-md border border-border p-0.5">
          {(["monthly", "yearly"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              aria-pressed={period === p}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors focus-ring",
                period === p
                  ? "bg-surface-muted text-foreground"
                  : "text-foreground-subtle hover:text-foreground",
              )}
            >
              {p === "monthly" ? t.costs.overviewMonthly : t.costs.overviewYearly}
            </button>
          ))}
        </div>
      </div>

      {!hasAnything ? (
        <p className="px-4 py-8 text-center text-sm text-foreground-subtle">
          {t.costs.overviewEmpty}
        </p>
      ) : (
        <div className="grid gap-6 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <PieBlock
            title={t.costs.overviewTotal}
            slices={totalSlices.map((s) => ({ ...s, value: s.value * factor }))}
            currency={displayCurrency}
            perLabel={perLabel}
          />
          <PieBlock
            title={t.costs.overviewProjects}
            slices={projectSlices.map((s) => ({ ...s, value: s.value * factor }))}
            currency={displayCurrency}
            perLabel={perLabel}
          />
          <PieBlock
            title={t.costs.overviewSubscriptions}
            slices={subscriptionSlices.map((s) => ({
              ...s,
              value: s.value * factor,
            }))}
            currency={displayCurrency}
            perLabel={perLabel}
          />
        </div>
      )}
    </Card>
  );
}

/** One titled donut with its total in the middle and a compact legend. */
function PieBlock({
  title,
  slices,
  currency,
  perLabel,
}: {
  title: string;
  slices: Slice[];
  currency: string;
  perLabel: string;
}) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
          {title}
        </h3>
        <span className="text-xs tabular text-foreground-subtle">
          {formatCurrency(total, currency)}
          {perLabel}
        </span>
      </div>
      {slices.length === 0 ? (
        <div className="grid h-40 place-items-center rounded-md border border-dashed border-border text-xs text-foreground-subtle">
          —
        </div>
      ) : (
        <>
          <div className="relative h-40">
            <CategoryDonut
              data={slices}
              currency={currency}
              innerRadius={44}
              outerRadius={68}
            />
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-sm font-semibold tabular text-foreground">
                {formatCurrency(total, currency)}
              </span>
            </div>
          </div>
          <ul className="mt-3 space-y-1">
            {slices.map((s, i) => (
              <li key={s.name} className="flex items-center gap-2 text-xs">
                <span
                  className="h-2 w-2 shrink-0 rounded-sm"
                  style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                />
                <span className="flex-1 truncate text-foreground">{s.name}</span>
                <span className="tabular text-foreground-muted">
                  {formatCurrency(s.value, currency)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
