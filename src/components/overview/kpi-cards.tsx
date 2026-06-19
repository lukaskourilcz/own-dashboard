"use client";

import { Flame, ListTodo, Sigma } from "lucide-react";
import { longestActiveStreak } from "@/lib/streaks";
import { totalMonthlyIn } from "@/lib/subscriptions";
import { formatCurrency } from "@/lib/utils";
import { useDict } from "@/lib/i18n";
import type { Streak, StreakLog, Subscription, Todo } from "@/lib/types";
import { SectionLabel } from "@/components/ui/page-header";

type Props = {
  subscriptions: Subscription[];
  todos: Todo[];
  streaks: Streak[];
  streakLogs: StreakLog[];
  displayCurrency: string;
};

export function KpiCards({
  subscriptions,
  todos,
  streaks,
  streakLogs,
  displayCurrency,
}: Props) {
  const t = useDict();
  const spend = totalMonthlyIn(subscriptions, displayCurrency);
  const openTodos = todos.filter((t) => !t.done).length;
  const doneTodos = todos.length - openTodos;
  const best = longestActiveStreak(streaks, streakLogs);

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Kpi
        icon={Sigma}
        label={t.kpi.monthlyRecurring}
        value={formatCurrency(spend, displayCurrency)}
        sub={t.kpi.subscriptions}
      />
      <Kpi
        icon={ListTodo}
        label={t.kpi.openTasks}
        value={String(openTodos)}
        sub={t.kpi.nDone(doneTodos)}
      />
      <Kpi
        icon={Flame}
        label={t.kpi.longestActiveStreak}
        value={best ? t.kpi.days(best.count) : "—"}
        sub={best ? best.streak.name : t.kpi.trackHabitHint}
      />
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Sigma;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-soft transition-all duration-150 hover:border-border-strong hover:-translate-y-0.5 hover:shadow-card">
      <div className="flex items-center gap-2 text-foreground-muted">
        <Icon className="h-3.5 w-3.5" />
        <SectionLabel className="!text-[10px]">{label}</SectionLabel>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular text-foreground">
        {value}
      </p>
      <p className="mt-0.5 text-xs text-foreground-subtle truncate">{sub}</p>
    </div>
  );
}
