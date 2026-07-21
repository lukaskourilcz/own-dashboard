"use client";

import { FolderKanban, ListTodo, Sigma } from "lucide-react";
import { totalMonthlyIn } from "@/lib/subscriptions";
import { formatCurrency } from "@/lib/utils";
import { useDict } from "@/lib/i18n";
import type { Project, Subscription, Todo } from "@/lib/types";
import { SectionLabel } from "@/components/ui/page-header";

type Props = {
  subscriptions: Subscription[];
  todos: Todo[];
  projects: Project[];
  displayCurrency: string;
};

export function KpiCards({
  subscriptions,
  todos,
  projects,
  displayCurrency,
}: Props) {
  const t = useDict();
  const spend = totalMonthlyIn(subscriptions, displayCurrency);
  const openTodos = todos.filter((t) => !t.done).length;
  const doneTodos = todos.length - openTodos;
  const activeProjects = projects.filter((project) => project.is_active && project.status !== "archived").length;

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
        icon={FolderKanban}
        label={t.kpi.activeProjects}
        value={String(activeProjects)}
        sub={t.kpi.projectPortfolio}
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
    <div className="rounded-xl border border-border bg-surface p-4 shadow-soft transition-all duration-150 hover:border-border-strong hover:-translate-y-0.5 hover:shadow-card">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel className="!text-[10px] text-foreground-muted">
          {label}
        </SectionLabel>
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-surface-muted text-foreground-muted">
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight tabular text-foreground">
        {value}
      </p>
      <p className="mt-0.5 text-xs text-foreground-subtle truncate">{sub}</p>
    </div>
  );
}
