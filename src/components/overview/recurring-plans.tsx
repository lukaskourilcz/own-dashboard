"use client";

import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Repeat } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { createClient } from "@/lib/supabase/client";
import { useDict } from "@/lib/i18n";
import { useNow } from "@/lib/use-now";
import { qk } from "@/lib/queries/keys";
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
  const t = useDict();
  const qc = useQueryClient();
  const supabase = createClient();
  const now = useNow();

  // Optimistic toggle of a plan's completion for the current period. Marking
  // done stamps last_completed_at = now; un-marking clears it.
  const toggleMutation = useMutation({
    mutationFn: async ({ plan, done }: { plan: Plan; done: boolean }) => {
      const stamp = done ? new Date().toISOString() : null;
      const { error } = await supabase
        .from("plans")
        .update({ last_completed_at: stamp, updated_at: new Date().toISOString() })
        .eq("id", plan.id);
      if (error) throw error;
    },
    onMutate: async ({ plan, done }) => {
      await qc.cancelQueries({ queryKey: qk.plans });
      const prev = qc.getQueryData<Plan[]>(qk.plans);
      const stamp = done ? new Date().toISOString() : null;
      setPlans((old) =>
        old.map((p) =>
          p.id === plan.id ? { ...p, last_completed_at: stamp } : p,
        ),
      );
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev) setPlans(ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.plans }),
  });

  const statuses = useMemo(
    () => (now ? recurringPlanStatuses(plans, now) : null),
    [plans, now],
  );

  const pending = statuses?.filter((s) => !s.done).length ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="inline-flex items-center gap-1.5">
          <Repeat className="h-3 w-3" />
          {t.plans.recurringTitle}
        </CardTitle>
        {statuses && statuses.length > 0 && (
          <span className="text-xs text-foreground-subtle tabular">
            {pending}/{statuses.length}
          </span>
        )}
      </CardHeader>
      <CardContent>
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
            <ul className="space-y-1.5">
              <AnimatePresence initial={false}>
                {statuses.map(({ plan, done, daysLeft }) => {
                  // recurringPlanStatuses already excludes "none".
                  const cadence = plan.recurrence as Exclude<
                    PlanRecurrence,
                    "none"
                  >;
                  return (
                  <motion.li
                    key={plan.id}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md border border-border bg-surface px-2.5 py-2 transition-colors",
                      done && "opacity-60",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggleMutation.mutate({ plan, done: !done })}
                      aria-pressed={done}
                      aria-label={done ? t.plans.markNotDone : t.plans.markDone}
                      className={cn(
                        "grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-colors focus-ring",
                        done
                          ? "border-success bg-success text-white"
                          : "border-border-strong hover:border-success",
                      )}
                    >
                      {done && <Check className="h-3 w-3" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "truncate text-xs font-medium",
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
                  </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
