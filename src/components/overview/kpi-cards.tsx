"use client";

import { FolderKanban, ListTodo, Sigma } from "lucide-react";
import { totalMonthlyIn } from "@/lib/subscriptions";
import { formatCurrency } from "@/lib/utils";
import { useDict } from "@/lib/i18n";
import type { Project, Subscription, Todo } from "@/lib/types";
import { Metric } from "@/components/ui/metric";

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
    <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
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
    <Metric label={label} value={value} detail={sub} icon={Icon} />
  );
}
