"use client";

import { Flame, ListTodo, Sigma } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { longestActiveStreak } from "@/lib/streaks";
import { totalMonthlyIn } from "@/lib/subscriptions";
import { formatCurrency } from "@/lib/utils";
import type { Streak, StreakLog, Subscription, Todo } from "@/lib/types";

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
  const spend = totalMonthlyIn(subscriptions, displayCurrency);
  const openTodos = todos.filter((t) => !t.done).length;
  const best = longestActiveStreak(streaks, streakLogs);

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <Sigma className="h-3.5 w-3.5" /> Spend this month
          </div>
          <p className="text-2xl font-semibold mt-1">
            {formatCurrency(spend, displayCurrency)}
          </p>
          <p className="text-xs text-zinc-400 mt-0.5">recurring subscriptions</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <ListTodo className="h-3.5 w-3.5" /> Open todos
          </div>
          <p className="text-2xl font-semibold mt-1">{openTodos}</p>
          <p className="text-xs text-zinc-400 mt-0.5">
            {todos.length - openTodos} done
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <Flame className="h-3.5 w-3.5" /> Longest active streak
          </div>
          <p className="text-2xl font-semibold mt-1">
            {best ? `${best.count} day${best.count === 1 ? "" : "s"}` : "—"}
          </p>
          <p className="text-xs text-zinc-400 mt-0.5 truncate">
            {best ? best.streak.name : "Track a habit to see it here"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
