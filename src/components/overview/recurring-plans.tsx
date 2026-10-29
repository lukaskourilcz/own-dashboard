"use client";

import { useMemo, useState } from "react";
import { Check, Repeat } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { collectionPage } from "@/lib/collection-page";
import { CollectionPagination } from "@/components/ui/collection-pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { useDict } from "@/lib/i18n";
import { useNow } from "@/lib/use-now";
import { usePlanActions } from "@/components/plans/use-plan-actions";
import { Button } from "@/components/ui/button";
import { recurringPlanStatuses } from "@/lib/plan-recurrence";
import type { Plan, PlanRecurrence, Updater } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Overview widget: every recurring plan and whether it's still due in the
 * current period, with a one-tap "mark done" toggle. The motivator — see at a
 * glance what's left before each loop resets.
 */
export function RecurringPlans({
  plans,
  setPlans,
}: {
  plans: Plan[];
  setPlans: Updater<Plan[]>;
}) {
  const t = useDict(), actions = usePlanActions(setPlans, plans), now = useNow();

  const [page, setPage] = useState(0);
  const statuses = useMemo(
    () => (now ? recurringPlanStatuses(plans, now) : null),
    [plans, now],
  );

  const currentPage = useMemo(() => collectionPage(statuses ?? [], page), [statuses, page]);
  if (page !== currentPage.index) setPage(currentPage.index);
  const pending = statuses?.filter((s) => !s.done).length ?? 0;

  return (
    <Card role="region" aria-label={t.plans.recurringTitle}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="inline-flex items-center gap-1.5">
          <Repeat className="h-3 w-3" />
          {t.plans.recurringTitle}
        </CardTitle>
        {statuses && statuses.length > 0 && (
          <span role="status" className="text-xs text-foreground-subtle tabular">
            {pending}/{statuses.length}
          </span>
        )}
      </CardHeader>
      <CardContent>
        {actions.notice && <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 text-xs text-destructive"><span>{actions.notice === 'changed' ? t.plans.planChanged : t.plans.actionUnconfirmed}</span><Button variant="outline" disabled={actions.reloading || actions.pending.size > 0} onClick={() => void actions.reload()}>{actions.reloading ? t.common.loading : t.common.retry}</Button></div>}
        {statuses === null ? (
          // Pre-hydration placeholder — identical markup on server and client.
          <div className="min-h-[64px]" aria-hidden />
        ) : statuses.length === 0 ? (
          <EmptyState
            icon={Repeat}
            title={t.plans.recurringEmpty}
            description={t.plans.recurringEmptyHint}
            className="py-6"
          />
        ) : (
          <>
            {pending === 0 && (
              <p className="mb-2 rounded-md bg-success/10 px-3 py-2 text-center text-xs font-medium text-success">
                {t.plans.recurringAllDone}
              </p>
            )}
            <CollectionPagination page={currentPage} onPage={setPage} label={t.plans.pages} range={t.plans.pageRange} previous={t.plans.previous} next={t.plans.next} disabled={actions.pending.size > 0} />
            <ul className="space-y-1.5">
                {currentPage.items.map(({ plan, done, daysLeft }) => {
                  // recurringPlanStatuses already excludes "none".
                  const cadence = plan.recurrence as Exclude<
                    PlanRecurrence,
                    "none"
                  >;
                  return (
                  <li
                    key={plan.id}
                                  className={cn(
                      "flex items-center gap-2.5 rounded-md border border-border bg-surface px-2.5 py-2 transition-colors",
                    )}
                  >
                    <Button
                      size="icon-sm" variant="ghost"
                      type="button"
                      ref={button => actions.actionControl(plan.id, button)}
                      disabled={actions.pending.has(plan.id)}
                      aria-busy={actions.pending.has(plan.id)}
                      onClick={() => void actions.update(plan, { last_completed_at: !done ? new Date().toISOString() : null })}
                      aria-pressed={done}
                      aria-label={`${plan.title}: ${done ? t.plans.markNotDone : t.plans.markDone}`}
                      className={cn(
                        "grid shrink-0 place-items-center rounded-full border transition-colors focus-ring disabled:cursor-wait",
                        done
                          ? "border-success bg-success text-white"
                          : "border-border-strong hover:border-success",
                      )}
                    >
                      {done && <Check className="h-3 w-3" />}
                    </Button>
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "break-words text-xs font-medium [overflow-wrap:anywhere]",
                          done && "line-through text-foreground-subtle",
                        )}
                      >
                        {plan.title}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-foreground-subtle">
                        <span className="inline-flex items-center gap-0.5 font-medium text-primary">
                          <Repeat className="h-2 w-2" />
                          {t.plans.recurrenceChip[cadence]}
                        </span>
                        <span>·</span>
                        {done ? (
                          <span className="text-success">{t.plans.doneTag}</span>
                        ) : (
                          <span
                            className={cn(
                              "tabular",
                              daysLeft === 0 && "font-medium text-warning",
                            )}
                          >
                            {daysLeft === 0
                              ? t.plans.lastDayLabel
                              : t.plans.daysLeftLabel(daysLeft)}
                          </span>
                        )}
                      </p>
                    </div>
                  </li>
                  );
                })}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
