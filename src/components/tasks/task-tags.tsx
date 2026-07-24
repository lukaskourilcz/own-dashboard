"use client";

import * as React from "react";
import {
  Bot,
  Clock,
  Flag,
  Image as ImageIcon,
  KeyRound,
  Lightbulb,
  Rocket,
  Scale,
  UserRound,
} from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import type { Dict } from "@/lib/i18n";
import type { Assignee } from "@/lib/needed";
import { formatMinutes, type TaskKind } from "@/lib/task-meta";
import { cn } from "@/lib/utils";

/** Tailwind classes per importance score, warmer/stronger as it climbs. */
const IMPORTANCE_STYLES: Record<number, string> = {
  1: "bg-surface text-foreground-subtle border-border",
  2: "bg-surface text-foreground-muted border-border",
  3: "bg-primary/10 text-primary border-primary/20",
  4: "bg-warning/10 text-warning border-warning/20",
  5: "bg-destructive/10 text-destructive border-destructive/20",
  6: "bg-warning/15 text-warning border-warning/30",
};

const KIND_ICON: Record<TaskKind, typeof KeyRound> = {
  setup: KeyRound,
  deploy: Rocket,
  legal: Scale,
  content: ImageIcon,
  decision: Lightbulb,
};

const chipBase =
  "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium tabular";

/** Small pill showing a task's 1–6 importance score. */
export function ImportanceBadge({ t, value }: { t: Dict; value: number }) {
  return (
    <Tooltip content={t.todos.importanceOf(value)}>
      <span
        className={cn(
          chipBase,
          "font-semibold",
          IMPORTANCE_STYLES[value] ?? IMPORTANCE_STYLES[1],
        )}
        aria-label={t.todos.importanceOf(value)}
      >
        <Flag className="h-2.5 w-2.5" />
        {value}
      </span>
    </Tooltip>
  );
}

/** Work-kind (category) pill — neutral chip with the kind's icon + label. */
export function TaskKindBadge({ t, kind }: { t: Dict; kind: TaskKind }) {
  const Icon = KIND_ICON[kind];
  const label = t.todos.taskKindLabel(kind);
  return (
    <span
      className={cn(chipBase, "border-border bg-surface text-foreground-muted")}
      aria-label={`${t.todos.categoryLabel}: ${label}`}
    >
      <Icon className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

/** Estimated-time pill. */
export function TaskTimeBadge({ t, minutes }: { t: Dict; minutes: number }) {
  const value = formatMinutes(minutes);
  if (!value) return null;
  return (
    <span
      className={cn(chipBase, "border-border bg-surface text-foreground-muted")}
      aria-label={t.todos.estimatedTimeLabel(value)}
    >
      <Clock className="h-2.5 w-2.5" />
      {value}
    </span>
  );
}

/** Assignee pill — AI-doable tasks get a subtle tint so they stand out. */
export function AssigneeBadge({ t, assignee }: { t: Dict; assignee: Assignee }) {
  const ai = assignee === "ai";
  return (
    <span
      className={cn(
        chipBase,
        ai
          ? "border-primary/20 bg-primary/10 text-primary"
          : "border-border bg-surface text-foreground-subtle",
      )}
      aria-label={`${t.todos.assigneeFilterLabel}: ${ai ? t.todos.assigneeAi : t.todos.assigneeMe}`}
    >
      {ai ? <Bot className="h-2.5 w-2.5" /> : <UserRound className="h-2.5 w-2.5" />}
      {ai ? t.todos.assigneeAi : t.todos.assigneeMe}
    </span>
  );
}

/**
 * The full metadata tag row for a task, shown wherever a task is rendered:
 * importance, category (kind), estimated time, and who it's for. Each tag only
 * appears when its value is present. `showAssignee` lets a surface hide the
 * assignee tag (e.g. a card that is already grouped by owner).
 */
export function TaskTags({
  t,
  importance,
  kind,
  minutes,
  assignee,
  className,
}: {
  t: Dict;
  importance?: number | null;
  kind?: TaskKind | null;
  minutes?: number | null;
  assignee?: Assignee | null;
  className?: string;
}) {
  const hasAny =
    importance != null || kind != null || (minutes != null && minutes > 0) || assignee != null;
  if (!hasAny) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {importance != null && <ImportanceBadge t={t} value={importance} />}
      {kind != null && <TaskKindBadge t={t} kind={kind} />}
      {minutes != null && minutes > 0 && <TaskTimeBadge t={t} minutes={minutes} />}
      {assignee != null && <AssigneeBadge t={t} assignee={assignee} />}
    </div>
  );
}
