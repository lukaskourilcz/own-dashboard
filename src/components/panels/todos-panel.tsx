"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  Flag,
  FolderKanban,
  ListTodo,
  Plus,
  RefreshCw,
  RotateCcw,
  Tag,
  Trash2,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SimpleSelect } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tooltip } from "@/components/ui/tooltip";
import { GithubIcon } from "@/components/icons/github";
import { useTasksPerCategory } from "@/lib/use-prefs";
import { useDict, useDateLocale, type Dict } from "@/lib/i18n";
import { daysUntilDate, parseDateOnly } from "@/lib/date-keys";
import { buildProjectTaskIndex, type ProjectTaskIndex } from "@/lib/project-match";
import { assigneeForTodo, type Assignee } from "@/lib/needed";
import { useTaskRepositories } from "@/components/tasks/use-task-repositories";
import { useTaskActions } from "@/components/tasks/use-task-actions";
import { TaskTitle } from "@/components/tasks/task-title";
import { TaskComposer } from "@/components/tasks/task-composer";
import { TaskTags } from "@/components/tasks/task-tags";
import {
  TASK_KINDS,
  TIME_BUCKETS,
  type TaskKind,
  type TimeBucketId,
} from "@/lib/task-meta";
import type { Locale } from "date-fns";
import type { Organization, Project, Todo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useNow } from "@/lib/use-now";

export function TodosPanel({
  taskIndex,
  todos,
  ownerId,
  projects = [],
  organizations = [],
  compact = false,
}: {
  todos: Todo[];
  ownerId: string;
  taskIndex?: ProjectTaskIndex;
  projects?: Project[];
  organizations?: Organization[];
  compact?: boolean;
}) {
  const t = useDict();
  const locale = useDateLocale();
  const [addOpen, setAddOpen] = useState(false);
  const [showFinished, setShowFinished] = useState(false);
  // Tasks filter: 0 = show all (scored + unscored); 1–5 = only tasks whose
  // importance is at least this. Applies to the full view's open-task groups.
  const [minImportance, setMinImportance] = useState(0);
  // Who the task is for: "all" | "me" | "ai" (from the NEEDED.md `[owner:…]`
  // marker, carried on the stored `needed_raw` line).
  const [assigneeFilter, setAssigneeFilter] = useState<"all" | Assignee>("all");
  // Estimated-time ceiling ("all" = no filter) and work-kind category filter.
  const [timeFilter, setTimeFilter] = useState<"all" | TimeBucketId>("all");
  const [kindFilter, setKindFilter] = useState<"all" | TaskKind>("all");
  // How many tasks each category shows before "show all" (Settings; 0 = all).
  const { count: tasksPerCategory } = useTasksPerCategory();
  // Repos are only needed for the full view's Refresh / NEEDED sync — keep the
  // query off in the compact dashboard widget.
  const repositories = useTaskRepositories(ownerId, todos, !compact);
  const projectByTodo = useMemo(() => (taskIndex ?? buildProjectTaskIndex(projects, todos)).byTodo, [taskIndex, todos, projects]);

  const { toggle, remove, pendingIds } = useTaskActions(ownerId);

  const open = todos.filter((td) => !td.done);
  const done = todos.filter((td) => td.done);
  const visible = compact ? open.slice(0, 5) : todos;

  if (compact) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>{t.todos.compactTitle}</CardTitle>
          <span className="text-xs text-foreground-subtle tabular">
            {t.todos.openDoneCount(open.length, done.length)}
          </span>
        </CardHeader>
        <CardContent>
          <TaskComposer ownerId={ownerId} projects={projects} organizations={organizations} compact open={false} onOpenChange={() => {}} />
          {visible.length === 0 ? (
            <EmptyState
              icon={ListTodo}
              title={t.todos.allClear}
              description={t.todos.allClearDescription}
              className="py-6"
            />
          ) : (
            <TodoList
              t={t}
              locale={locale}
              items={visible}
              pendingIds={pendingIds}
              onToggle={toggle}
              compact
            />
          )}
        </CardContent>
      </Card>
    );
  }

  // Full view: task groups use shared row dividers;
  // hand-added tasks collect in a "Personal" card. The importance filter (0 =
  // all) narrows to tasks scoring at least `minImportance`; unscored tasks
  // (null) count as 0, so any active filter hides them.
  const passesImportance = (td: Todo) =>
    minImportance === 0 || (td.importance ?? 0) >= minImportance;
  // Assignee comes from the task's `[owner:…]` marker on its NEEDED.md line.
  // Hand-added tasks (no source line) count as "me" — they're the user's own.
  const passesAssignee = (td: Todo) => {
    if (assigneeFilter === "all") return true;
    return assigneeForTodo(td.needed_raw, td.needed_assignee) === assigneeFilter;
  };
  // Time: keep tasks whose estimate fits within the chosen ceiling. Unestimated
  // tasks are hidden while a time filter is active (like unscored + importance).
  const passesTime = (td: Todo) => {
    if (timeFilter === "all") return true;
    const bucket = TIME_BUCKETS.find((b) => b.id === timeFilter);
    return (
      bucket != null &&
      td.estimated_minutes != null &&
      td.estimated_minutes <= bucket.maxMinutes
    );
  };
  const passesKind = (td: Todo) =>
    kindFilter === "all" || td.task_kind === kindFilter;
  const openVisible = open.filter(
    (td) =>
      passesImportance(td) &&
      passesAssignee(td) &&
      passesTime(td) &&
      passesKind(td),
  );
  const hiddenByFilter = open.length - openVisible.length;
  const openGlobal = openVisible
    .filter((td) => td.is_global)
    .sort(byImportanceThenDue);

  const projectForTodo = (todo: Todo) => projectByTodo.get(todo.id);

  const taskGroupMap = new Map<
    string,
    {
      id: string;
      name: string;
      fullName: string | null;
      url: string | null;
      project: boolean;
      items: Todo[];
    }
  >();
  for (const td of openVisible.filter((item) => !item.is_global)) {
    const project = projectForTodo(td);
    const isGithubOrphan =
      !project && td.source === "github" && Boolean(td.repo_id);
    if (!project && !isGithubOrphan) continue;
    const key = project ? `project:${project.id}` : `repo:${td.repo_id}`;
    const g = taskGroupMap.get(key);
    if (g) g.items.push(td);
    else
      taskGroupMap.set(key, {
        id: key,
        name: project?.name ?? td.repo_name ?? td.category ?? key,
        fullName: project?.repo_full_name ?? td.repo_full_name,
        url:
          project?.repo_full_name != null
            ? `https://github.com/${project.repo_full_name}`
            : td.repo_url,
        project: Boolean(project),
        items: [td],
      });
  }
  const taskGroups = [...taskGroupMap.values()]
    .map((group) => ({
      ...group,
      items: group.items.sort(byImportanceThenDue),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const openPersonal = openVisible
    .filter(
      (td) =>
        !td.is_global &&
        !projectForTodo(td) &&
        !(td.source === "github" && td.repo_id),
    )
    .sort(byImportanceThenDue);

  const finishedNeeded = done.filter(
    (td) => td.source === "github" && td.needed_raw,
  ).length;

  return (
    <div>
      <PageHeader
        title={t.todos.title}
        description={t.todos.description}
        action={
          <div className="flex items-center gap-2">
            <Tooltip content={t.todos.refreshHint}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { void repositories.refresh(); }}
                disabled={repositories.pending !== null || repositories.repositoriesPending}
              >
                <RefreshCw
                  className={cn(
                    "h-3.5 w-3.5",
                    repositories.pending === "refresh" && "animate-spin",
                  )}
                />
                {repositories.pending === "refresh" ? t.todos.refreshing : t.todos.refresh}
              </Button>
            </Tooltip>
            <Tooltip content={t.todos.addTask}>
              <Button
                size="icon"
                onClick={() => setAddOpen(true)}
                aria-label={t.todos.addTask}
                data-task-focus-fallback
              >
                <Plus className="h-4 w-4" />
              </Button>
            </Tooltip>
          </div>
        }
      />
      <div className="space-y-4">
          {open.length > 0 && (
            <TaskFilterBar
              t={t}
              importance={minImportance}
              onImportanceChange={setMinImportance}
              time={timeFilter}
              onTimeChange={setTimeFilter}
              kind={kindFilter}
              onKindChange={setKindFilter}
              assignee={assigneeFilter}
              onAssigneeChange={setAssigneeFilter}
              hidden={hiddenByFilter}
              total={open.length}
            />
          )}
          {open.length === 0 ? (
            <Card>
              <CardContent className="pt-5">
                <EmptyState
                  icon={ListTodo}
                  title={t.todos.nothingOnPlate}
                  description={t.todos.nothingOnPlateDescription}
                />
              </CardContent>
            </Card>
          ) : openVisible.length === 0 ? (
            <Card>
              <CardContent className="pt-5">
                <EmptyState
                  icon={Flag}
                  title={t.todos.filterEmptyTitle}
                  description={t.todos.filtersEmpty}
                />
              </CardContent>
            </Card>
          ) : (
            <div className={cn("columns-1 gap-4", Number(openGlobal.length > 0) + taskGroups.length + Number(openPersonal.length > 0) > 1 ? "lg:columns-2" : "mx-auto max-w-2xl")}>
              {openGlobal.length > 0 && (
                <TaskGroupCard
                  t={t}
                  locale={locale}
                  label={t.todos.globalGroup}
                  items={openGlobal}
                  limit={tasksPerCategory}
                  pendingIds={pendingIds}
                  onToggle={toggle}
                  onRemove={remove}
                  header={
                    <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Flag className="h-4 w-4 shrink-0 text-warning" />
                      {t.todos.globalGroup}
                    </span>
                  }
                />
              )}
              {taskGroups.map((g) => (
                <TaskGroupCard
                  key={g.id}
                  t={t}
                  locale={locale}
                  label={g.name}
                  items={g.items}
                  limit={tasksPerCategory}
                  pendingIds={pendingIds}
                  onToggle={toggle}
                  onRemove={remove}
                  header={
                    g.url ? (
                      <a
                        href={g.url}
                        target="_blank"
                        rel="noreferrer"
                        title={g.fullName ?? g.name}
                        className="inline-flex min-w-0 items-center gap-1 text-sm font-semibold text-foreground hover:underline"
                      >
                        {g.project ? (
                          <FolderKanban className="h-4 w-4 shrink-0 text-foreground-muted" />
                        ) : (
                          <GithubIcon className="h-4 w-4 shrink-0 text-foreground-muted" />
                        )}
                        <span className="break-words [overflow-wrap:anywhere]">{g.name}</span>
                        <ExternalLink className="h-3 w-3 shrink-0 text-foreground-subtle" />
                      </a>
                    ) : (
                      <span className="inline-flex min-w-0 items-center gap-1 text-sm font-semibold text-foreground">
                        {g.project ? (
                          <FolderKanban className="h-4 w-4 shrink-0 text-foreground-muted" />
                        ) : (
                          <GithubIcon className="h-4 w-4 shrink-0 text-foreground-muted" />
                        )}
                        <span className="break-words [overflow-wrap:anywhere]">{g.name}</span>
                      </span>
                    )
                  }
                />
              ))}
              {openPersonal.length > 0 && (
                <TaskGroupCard
                  t={t}
                  locale={locale}
                  label={t.todos.personalGroup}
                  items={openPersonal}
                  limit={tasksPerCategory}
                  pendingIds={pendingIds}
                  onToggle={toggle}
                  onRemove={remove}
                  header={
                    <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                      <ListTodo className="h-4 w-4 shrink-0 text-foreground-muted" />
                      {t.todos.personalGroup}
                    </span>
                  }
                />
              )}
            </div>
          )}

          {done.length > 0 && (
            <div className={Number(openGlobal.length > 0) + taskGroups.length + Number(openPersonal.length > 0) <= 1 ? "mx-auto max-w-2xl" : undefined}>
            <FinishedSection
              t={t}
              locale={locale}
              items={done}
              open={showFinished}
              onToggleOpen={() => setShowFinished((v) => !v)}
              pendingIds={pendingIds}
              onReopen={toggle}
              onRemove={remove}
              canClearNeeded={finishedNeeded > 0}
              cleanupDisabled={repositories.pending !== null}
              clearing={repositories.pending === "clear"}
              onClearNeeded={() => { void repositories.clear(); }}
            />
            </div>
          )}

      </div>

      <TaskComposer ownerId={ownerId} projects={projects} organizations={organizations} open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

/* ---------------------------- Task group card ---------------------------- */

/** Order tasks within a category: highest importance first (unscored last),
 * then soonest due date first. */
function byImportanceThenDue(a: Todo, b: Todo): number {
  const ia = a.importance ?? 0;
  const ib = b.importance ?? 0;
  if (ia !== ib) return ib - ia;
  if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
  if (a.due_date) return -1;
  if (b.due_date) return 1;
  return 0;
}

/**
 * A collapsible category card (one repo, or "Personal"). Shows the first
 * `limit` tasks (0 = all) with a "show all / show less" control, and the whole
 * body can be collapsed from the header. Tasks arrive pre-sorted by importance.
 */
function TaskGroupCard({
  pendingIds,
  t,
  locale,
  header,
  label,
  items,
  limit,
  onToggle,
  onRemove,
}: {
  pendingIds: ReadonlySet<string>;
  t: Dict;
  locale: Locale;
  header: React.ReactNode;
  label: string;
  items: Todo[];
  limit: number;
  onToggle: (td: Todo) => void;
  onRemove: (td: Todo) => void;
}) {
  const listId = useId();
  const [collapsed, setCollapsed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const total = items.length;
  const capped = limit > 0 && !showAll;
  const shown = capped ? items.slice(0, limit) : items;
  const canExpand = limit > 0 && total > limit;

  return (
    <Card className="mb-4 inline-block w-full break-inside-avoid overflow-hidden p-0 align-top">
      <div className="flex items-center gap-2 border-b border-border bg-surface-muted/40 px-2 py-2.5 pr-4">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          aria-controls={listId}
          aria-label={`${collapsed ? t.todos.expandGroup : t.todos.collapseGroup}: ${label}`}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground focus-ring md:size-8"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
        <div className="min-w-0 flex-1">{header}</div>
        <span className="shrink-0 rounded-full bg-surface px-2 py-[3px] text-[10px] font-semibold tabular text-foreground-muted">
          {t.todos.repoTaskCount(total)}
        </span>
      </div>
      {!collapsed && (
        <>
          <ul id={listId} className="divide-y divide-border/60">
              {shown.map((td) => (
                <TaskRow
                  key={td.id}
                  t={t}
                  locale={locale}
                  td={td}
                  pendingIds={pendingIds}
                  onToggle={onToggle}
                  onRemove={onRemove}
                />
              ))}
          </ul>
          {canExpand && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              aria-expanded={showAll}
              aria-controls={listId}
              className="min-h-11 w-full border-t border-border/60 px-4 py-2 text-xs font-medium text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground focus-ring"
            >
              {showAll ? t.todos.showLess : t.todos.showAllCount(total)}
            </button>
          )}
        </>
      )}
    </Card>
  );
}

/** One task row; metadata shares a wrapping line instead of stacking nested cards. */
function TaskRow({
  pendingIds,
  t,
  locale,
  td,
  onToggle,
  onRemove,
}: {
  pendingIds: ReadonlySet<string>;
  t: Dict;
  locale: Locale;
  td: Todo;
  onToggle: (td: Todo) => void;
  onRemove: (td: Todo) => void;
}) {
  return (
    <li data-task-id={td.id} className="group flex items-start gap-2 px-3 py-2">
      <Checkbox
        disabled={pendingIds.has(td.id)}
        aria-busy={pendingIds.has(td.id)}
        checked={td.done}
        onCheckedChange={() => onToggle(td)}
        aria-label={td.title}
      />
      <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-3 gap-y-1">
        <TaskTitle title={td.title} className="min-w-[min(100%,14rem)] flex-1" />
        <div className="flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-foreground-subtle">
        <TaskTags
          t={t}
          importance={td.importance}
          kind={td.task_kind}
          minutes={td.estimated_minutes}
          assignee={assigneeForTodo(td.needed_raw, td.needed_assignee)}
          className="contents"
        />
          {td.generated_at && (
            <span className="tabular">
              {t.todos.generatedOn(
                format(new Date(td.generated_at), t.todos.dueDateFormat, {
                  locale,
                }),
              )}
            </span>
          )}
          {td.due_date && <TimeChip t={t} due={td.due_date} />}
        </div>
      </div>
      <Tooltip content={t.common.delete}>
        <button
          type="button"
          disabled={pendingIds.has(td.id)}
          aria-busy={pendingIds.has(td.id)}
          onClick={() => onRemove(td)}
          aria-label={t.common.delete}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-foreground-subtle hover:bg-surface-hover hover:text-destructive focus-ring disabled:opacity-50 md:size-8"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
    </li>
  );
}

/** The "time to finish" chip — colour shifts as the 7-day timer runs down. */
function TimeChip({ t, due }: { t: Dict; due: string }) {
  const now = useNow();
  if (!now) return null;
  const left = daysUntilDate(due, now);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-[7px] py-[3px] font-medium tabular",
        left < 0
          ? "bg-destructive/10 text-destructive"
          : left <= 2
            ? "bg-warning/10 text-warning"
            : "bg-surface text-foreground-muted",
      )}
    >
      {t.todos.timeLeft(left)}
    </span>
  );
}

/* ------------------------------- Finished -------------------------------- */

function FinishedSection({
  pendingIds,
  t,
  locale,
  items,
  open,
  onToggleOpen,
  onReopen,
  onRemove,
  canClearNeeded,
  cleanupDisabled,
  clearing,
  onClearNeeded,
}: {
  pendingIds: ReadonlySet<string>;
  t: Dict;
  locale: Locale;
  items: Todo[];
  open: boolean;
  onToggleOpen: () => void;
  onReopen: (td: Todo) => void;
  onRemove: (td: Todo) => void;
  canClearNeeded: boolean;
  cleanupDisabled: boolean;
  clearing: boolean;
  onClearNeeded: () => void;
}) {
  const listId = useId();
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-muted/40 px-4 py-2.5">
        <button
          type="button"
          onClick={onToggleOpen}
          aria-expanded={open}
          aria-controls={listId}
          className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-semibold text-foreground focus-ring md:min-h-8"
        >
          {t.todos.finishedTitle}
          <span className="rounded-full bg-surface px-2 py-[3px] text-[10px] font-semibold tabular text-foreground-muted">
            {t.todos.finishedCount(items.length)}
          </span>
          <span className="text-[11px] font-normal text-foreground-subtle">
            {open ? t.todos.finishedHide : t.todos.finishedShow}
          </span>
        </button>
        {canClearNeeded && (
          <Tooltip content={t.todos.clearFromNeededHint}>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={onClearNeeded}
              disabled={cleanupDisabled}
            >
              {clearing ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <GithubIcon className="h-3.5 w-3.5" />
              )}
              {clearing ? t.todos.clearingFromNeeded : t.todos.clearFromNeeded}
            </Button>
          </Tooltip>
        )}
      </div>
      {open && (
        <ul id={listId} className="divide-y divide-border/60">
          {items.map((td) => (
            <li
              key={td.id}
              data-task-id={td.id}
              className="group flex items-start gap-2 px-3 py-2"
            >
              <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-3 gap-y-1">
                <TaskTitle title={td.title} done className="min-w-[min(100%,14rem)] flex-1" />
                <div className="flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-foreground-subtle">
                <TaskTags
                  t={t}
                  importance={td.importance}
                  kind={td.task_kind}
                  minutes={td.estimated_minutes}
                  assignee={assigneeForTodo(td.needed_raw, td.needed_assignee)}
                  className="contents"
                />
                  {td.repo_name && <span className="truncate">{td.repo_name}</span>}
                  {td.due_date && (
                    <span className="tabular">
                      {t.todos.due(
                        format(parseDateOnly(td.due_date), t.todos.dueDateFormat, {
                          locale,
                        }),
                      )}
                    </span>
                  )}
                </div>
              </div>
              <Tooltip content={t.todos.reopen}>
                <button
                  type="button"
                  disabled={pendingIds.has(td.id)}
                  aria-busy={pendingIds.has(td.id)}
                  onClick={() => onReopen(td)}
                  aria-label={t.todos.reopen}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-foreground-subtle hover:bg-surface-hover hover:text-foreground focus-ring disabled:opacity-50 md:size-8"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
              <Tooltip content={t.common.delete}>
                <button
                  type="button"
                  disabled={pendingIds.has(td.id)}
                  aria-busy={pendingIds.has(td.id)}
                  onClick={() => onRemove(td)}
                  aria-label={t.common.delete}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-foreground-subtle hover:bg-surface-hover hover:text-destructive focus-ring disabled:opacity-50 md:size-8"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* -------------------------------- Filters -------------------------------- */

/** Minimum-importance levels: 0 = all; 1–5 = at-least-N. */
const IMPORTANCE_LEVELS = [0, 1, 2, 3, 4, 5];

/**
 * One labelled filter field. The label and its control stay on the same line
 * at every width — the field is what wraps, never its own two halves — so each
 * row of the bar reads as an aligned set of columns. The field grows to take a
 * share of the free space on its row and hands that space to the control.
 */
function FilterField({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 grow items-center gap-2">
      <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs font-medium text-foreground-muted">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * The segmented option group behind the importance, time, and assignee
 * filters. Sized to the shared select height so every control in the bar lines
 * up. It grows into the space its field is given; each caller passes the
 * max-width at which its segments stop reading as a control.
 */
function SegmentedFilter<T extends string | number>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        // No `overflow-hidden` here: it would clip the buttons' focus ring.
        // The end segments round themselves instead.
        "inline-flex h-11 min-w-0 grow rounded-md border border-border md:h-8",
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            // The buttons share the group's width, so the padding only sets
            // their floor — kept tight on the narrowest screens so six
            // importance segments still fit beside their label.
            "flex-1 whitespace-nowrap border-l border-border px-1.5 text-xs font-medium tabular transition-colors first:border-l-0 first:rounded-l-[5px] last:rounded-r-[5px] focus-ring focus-visible:relative focus-visible:z-10 sm:px-2.5",
            value === o.value
              ? "bg-primary text-primary-foreground"
              : "bg-surface text-foreground-muted hover:bg-surface-hover",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The task filter bar: a single full-width band whose fields share the whole
 * content width instead of bunching at the left. Everything sits on one line
 * while it fits; below that the fields wrap whole (`flex-wrap`) and each row
 * fills the width again.
 */
function TaskFilterBar({
  t,
  importance,
  onImportanceChange,
  time,
  onTimeChange,
  kind,
  onKindChange,
  assignee,
  onAssigneeChange,
  hidden, total,
}: {
  t: Dict;
  importance: number;
  onImportanceChange: (v: number) => void;
  time: "all" | TimeBucketId;
  onTimeChange: (v: "all" | TimeBucketId) => void;
  kind: "all" | TaskKind;
  onKindChange: (v: "all" | TaskKind) => void;
  assignee: "all" | Assignee;
  onAssigneeChange: (v: "all" | Assignee) => void;
  hidden: number; total: number;
}) {
  const [open, setOpen] = useState(false);
  const active = Number(importance > 0) + Number(time !== 'all') + Number(kind !== 'all') + Number(assignee !== 'all');
  const clear = () => { onImportanceChange(0); onTimeChange('all'); onKindChange('all'); onAssigneeChange('all'); };
  const filters = (
    <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-border bg-surface-secondary px-3 py-2">
      <FilterField icon={Flag} label={t.todos.importanceFilterLabel}>
        <SegmentedFilter
          label={t.todos.importanceFilterLabel}
          className="max-w-[40rem]"
          value={importance}
          onChange={onImportanceChange}
          options={IMPORTANCE_LEVELS.map((lvl) => ({
            value: lvl,
            label: lvl === 0 ? t.todos.filterAll : t.todos.filterMin(lvl),
          }))}
        />
      </FilterField>
      <FilterField icon={Clock} label={t.todos.timeFilterLabel}>
        <SegmentedFilter
          label={t.todos.timeFilterLabel}
          className="max-w-[26rem]"
          value={time}
          onChange={onTimeChange}
          options={[
            { value: "all" as const, label: t.todos.filterAll },
            ...TIME_BUCKETS.map((b) => ({
              value: b.id,
              label: t.todos.timeBucketLabel(b.id),
            })),
          ]}
        />
      </FilterField>
      <FilterField icon={Tag} label={t.todos.categoryFilterLabel}>
        <SimpleSelect
          aria-label={t.todos.categoryFilterLabel}
          className="h-11 min-w-32 max-w-[22rem] md:h-8"
          value={kind}
          onValueChange={(v) => onKindChange(v as "all" | TaskKind)}
          options={[
            { value: "all", label: t.todos.filterAll },
            ...TASK_KINDS.map((k) => ({ value: k, label: t.todos.taskKindLabel(k) })),
          ]}
        />
      </FilterField>
      <FilterField icon={UserRound} label={t.todos.assigneeFilterLabel}>
        <SegmentedFilter
          label={t.todos.assigneeFilterLabel}
          className="max-w-[20rem]"
          value={assignee}
          onChange={onAssigneeChange}
          options={[
            { value: "all" as const, label: t.todos.filterAll },
            { value: "me" as const, label: t.todos.assigneeMe },
            { value: "ai" as const, label: t.todos.assigneeAi },
          ]}
        />
      </FilterField>
      {active > 0 && <Button variant="ghost" size="sm" onClick={clear}>{t.todos.clearFilters}</Button>}
      {hidden > 0 && (
        <span className="shrink-0 whitespace-nowrap text-[11px] tabular text-foreground-subtle">
          {t.todos.filterHidden(hidden)}
        </span>
      )}
    </div>
  );
  return <Dialog open={open} onOpenChange={setOpen}>
    <div className="flex items-center justify-between gap-2 md:hidden">
      <DialogTrigger asChild><Button variant="outline">{t.todos.filters}{active > 0 ? ` (${active})` : ''}</Button></DialogTrigger>
      {active > 0 && <Button variant="ghost" size="sm" onClick={clear}>{t.todos.clearFilters}</Button>}
      <span role="status" className="text-xs text-foreground-muted tabular">{t.todos.results(total - hidden)}</span>
    </div>
    <div className="hidden md:block">{filters}</div>
    <DialogContent className="max-w-xl" aria-describedby={undefined}><DialogHeader><DialogTitle>{t.todos.filters}</DialogTitle></DialogHeader>{filters}</DialogContent>
  </Dialog>;
}

/* ------------------------------- Shared UI ------------------------------- */

function TodoList({
  pendingIds,
  t,
  locale,
  items,
  onToggle,
  onRemove,
  compact,
}: {
  pendingIds: ReadonlySet<string>;
  t: Dict;
  locale: Locale;
  items: Todo[];
  onToggle: (todo: Todo) => void;
  onRemove?: (td: Todo) => void;
  compact?: boolean;
}) {
  return (
    <ul className="-mx-2">
        {items.map((td) => (
          <li key={td.id} data-task-id={td.id} className="group flex items-start gap-2 rounded-md px-2 py-1.5 row-hover">
            <Checkbox
              disabled={pendingIds.has(td.id)}
              aria-busy={pendingIds.has(td.id)}
              checked={td.done}
              onCheckedChange={() => onToggle(td)}
              aria-label={td.title}
            />
            <div className="flex-1 min-w-0">
              <TaskTitle title={td.title} done={td.done} />
              {td.due_date && (
                <p className="text-[11px] text-foreground-subtle tabular">
                  {t.todos.due(
                    format(parseDateOnly(td.due_date), t.todos.dueDateFormat, {
                      locale,
                    }),
                  )}
                </p>
              )}
            </div>
            {!compact && onRemove && (
              <Tooltip content={t.common.delete}>
                <button
                  type="button"
                  disabled={pendingIds.has(td.id)}
                  aria-busy={pendingIds.has(td.id)}
                  onClick={() => onRemove(td)}
                  aria-label={t.common.delete}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-foreground-subtle hover:bg-surface-hover hover:text-destructive focus-ring disabled:opacity-50 md:size-8"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            )}
          </li>
        ))}
    </ul>
  );
}
