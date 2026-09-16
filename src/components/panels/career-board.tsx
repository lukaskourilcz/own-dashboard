"use client";

import { useMemo } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type ClientRect,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { format } from "date-fns";
import { CalendarClock, GripVertical, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SimpleSelect } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { useDateLocale, useDict, useLang } from "@/lib/i18n";
import {
  BOARD_COLUMNS,
  columnForApplication,
  groupApplicationsByColumn,
  isBoardColumn,
  isFollowUpDue,
  statusForColumn,
  type BoardColumn,
} from "@/lib/jobs/board";
import { readinessLabel } from "@/lib/jobs/pipeline";
import type {
  JobApplication,
  JobApplicationStatus,
  SavedJobPosition,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/** The columns a card can actually be dropped on. "saved" is never one. */
const DROP_COLUMNS = BOARD_COLUMNS.filter(
  (column): column is Exclude<BoardColumn, "saved"> => column !== "saved",
);

type ColumnRect = { id: UniqueIdentifier; rect: ClientRect };

function nearestColumn(rects: ColumnRect[], x: number): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  rects.forEach((entry, index) => {
    const distance = Math.abs(entry.rect.left + entry.rect.width / 2 - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

/**
 * Left/right arrows jump a keyboard drag to the neighbouring column instead of
 * nudging it 25 px at a time, which is the default and is unusable across a
 * five-column board. The per-card stage menu remains the simpler keyboard path;
 * this only makes the drag handle behave for anyone who reaches it by tab.
 */
const boardKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { currentCoordinates, context },
) => {
  if (event.code !== "ArrowLeft" && event.code !== "ArrowRight") return;
  const rects: ColumnRect[] = [];
  for (const column of DROP_COLUMNS) {
    const rect = context.droppableRects.get(column);
    if (rect) rects.push({ id: column, rect });
  }
  if (rects.length < 2) return;
  const reference = context.collisionRect;
  const centre = reference
    ? reference.left + reference.width / 2
    : currentCoordinates.x;
  const from = nearestColumn(rects, centre);
  const to = event.code === "ArrowRight"
    ? Math.min(from + 1, rects.length - 1)
    : Math.max(from - 1, 0);
  const target = rects[to];
  if (to === from || !target) return;
  event.preventDefault();
  return {
    x: currentCoordinates.x + (target.rect.left + target.rect.width / 2 - centre),
    y: currentCoordinates.y,
  };
};

export function CareerBoard({
  applications,
  savedPositions,
  statusLabel,
  statuses,
  onStatus,
  onProgress,
  onPrepare,
}: {
  applications: JobApplication[];
  savedPositions: SavedJobPosition[];
  statusLabel: Record<JobApplicationStatus, string>;
  statuses: JobApplicationStatus[];
  onStatus: (app: JobApplication, status: JobApplicationStatus) => void;
  onProgress: (app: JobApplication) => void;
  onPrepare: (position: SavedJobPosition) => void;
}) {
  const t = useDict();
  const cs = useLang().lang === "cs";
  const groups = useMemo(
    () => groupApplicationsByColumn(applications, savedPositions),
    [applications, savedPositions],
  );
  const byId = useMemo(
    () => new Map(applications.map((app) => [app.id, app])),
    [applications],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: boardKeyboardCoordinates }),
  );

  const columnTitle: Record<BoardColumn, string> = {
    saved: t.jobs.savedTab,
    applied: t.jobs.statusApplied,
    interviewing: t.jobs.statusInterviewing,
    offer: t.jobs.statusOffer,
    closed: t.jobs.boardColumnClosed,
  };

  function handleDragEnd(event: DragEndEvent) {
    const overId = event.over?.id;
    if (typeof overId !== "string" || !isBoardColumn(overId)) return;
    const app = byId.get(String(event.active.id));
    if (!app || columnForApplication(app) === overId) return;
    const status = statusForColumn(overId);
    if (!status) return;
    onStatus(app, status);
  }

  return (
    <div>
      <p className="mb-3 text-sm text-foreground-muted">{t.jobs.boardHint}</p>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div
          // The board is the only horizontal scroller on the page, so the
          // document itself never overflows. It is focusable and labelled
          // because a scrollable region must be reachable by keyboard.
          role="region"
          aria-label={t.jobs.boardRegion}
          tabIndex={0}
          className="flex min-w-0 snap-x gap-3 overflow-x-auto p-1 focus-ring"
        >
          {BOARD_COLUMNS.map((column) => (
            <BoardColumnPanel
              key={column}
              column={column}
              title={columnTitle[column]}
              count={groups[column].length}
              emptyLabel={t.jobs.boardColumnEmpty}
            >
              {column === "saved"
                ? groups.saved.map((position) => (
                    <SavedCard
                      key={position.id}
                      position={position}
                      cs={cs}
                      onPrepare={() => onPrepare(position)}
                    />
                  ))
                : groups[column].map((app) => (
                    <ApplicationCard
                      key={app.id}
                      app={app}
                      cs={cs}
                      statusLabel={statusLabel}
                      statuses={statuses}
                      onStatus={(status) => onStatus(app, status)}
                      onProgress={() => onProgress(app)}
                    />
                  ))}
            </BoardColumnPanel>
          ))}
        </div>
      </DndContext>
    </div>
  );
}

function BoardColumnPanel({
  column,
  title,
  count,
  emptyLabel,
  children,
}: {
  column: BoardColumn;
  title: string;
  count: number;
  emptyLabel: string;
  children: React.ReactNode;
}) {
  // "saved" holds positions, not applications, so it accepts no drop.
  const { setNodeRef, isOver } = useDroppable({
    id: column,
    disabled: column === "saved",
  });

  return (
    // A plain container with a heading, not a labelled <section>: five more
    // landmarks inside the board would bury the page's real ones.
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-64 shrink-0 snap-start flex-col rounded-lg border bg-surface-secondary",
        isOver ? "border-primary bg-surface-hover" : "border-border",
      )}
    >
      <h3 className="flex items-baseline justify-between gap-2 border-b border-border px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-foreground-muted">
        <span className="min-w-0 truncate">{title}</span>
        <span className="shrink-0 tabular text-foreground-subtle">{count}</span>
      </h3>
      <div className="flex flex-col gap-2 p-2">
        {count === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-foreground-subtle">
            {emptyLabel}
          </p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function ApplicationCard({
  app,
  cs,
  statusLabel,
  statuses,
  onStatus,
  onProgress,
}: {
  app: JobApplication;
  cs: boolean;
  statusLabel: Record<JobApplicationStatus, string>;
  statuses: JobApplicationStatus[];
  onStatus: (status: JobApplicationStatus) => void;
  onProgress: () => void;
}) {
  const t = useDict();
  const locale = useDateLocale();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } =
    useDraggable({ id: app.id });
  const due = isFollowUpDue(app);

  return (
    <div
      ref={setNodeRef}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={cn("relative", isDragging ? "z-10" : "z-0")}
    >
    <Card className={cn("p-2.5 shadow-none", isDragging && "border-primary opacity-90")}>
      <div className="flex items-start gap-1.5">
        <button
          type="button"
          // Only the handle carries the drag listeners; the card's text stays
          // selectable and its links and controls stay ordinary controls.
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={t.jobs.boardMoveCard(app.title)}
          style={{ touchAction: "none" }}
          className="-ml-1 inline-flex h-11 w-6 shrink-0 cursor-grab items-center justify-center rounded-md text-foreground-subtle hover:bg-surface-hover hover:text-foreground focus-ring"
        >
          <GripVertical className="h-3.5 w-3.5" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          {app.url ? (
            <a
              href={app.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block break-words text-sm font-medium hover:underline focus-ring rounded-sm"
            >
              {app.title}
            </a>
          ) : (
            <p className="break-words text-sm font-medium">{app.title}</p>
          )}
          {app.company && (
            <p className="mt-0.5 break-words text-xs text-foreground-muted">
              {app.company}
            </p>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <StatusBadge value={app.status} label={statusLabel[app.status]} />
        <span className="text-[11px] tabular text-foreground-subtle">
          {format(new Date(`${app.applied_on}T00:00:00`), "PP", { locale })}
        </span>
      </div>

      {app.next_follow_up_at && (
        <p
          className={cn(
            "mt-2 inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-[11px]",
            due
              ? "border-warning/25 bg-warning-soft text-warning"
              : "border-border bg-surface-inset text-foreground-muted",
          )}
        >
          <CalendarClock className="h-3 w-3 shrink-0" aria-hidden />
          <span>
            {due ? t.jobs.followUpDue : t.jobs.followUpOn}
            {": "}
            {app.next_follow_up_at.slice(0, 10)}
          </span>
        </p>
      )}

      {(app.contact_name || app.contact_email) && (
        <p className="mt-2 break-words text-[11px] text-foreground-muted">
          {t.jobs.contactLabel}:{" "}
          {[app.contact_name, app.contact_email].filter(Boolean).join(" · ")}
        </p>
      )}

      {app.notes && (
        <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-[11px] text-foreground-muted">
          {app.notes}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <SimpleSelect
          value={app.status}
          onValueChange={(value) => onStatus(value as JobApplicationStatus)}
          className="h-9 w-auto min-w-28 text-[11px]"
          aria-label={`${t.jobs.statusLabel} — ${app.title}`}
          options={statuses.map((status) => ({
            value: status,
            label: statusLabel[status],
          }))}
        />
        <Button size="sm" variant="outline" onClick={onProgress}>
          {cs ? "Odpověď / další postup" : "Response / follow-up"}
        </Button>
      </div>
    </Card>
    </div>
  );
}

function SavedCard({
  position,
  cs,
  onPrepare,
}: {
  position: SavedJobPosition;
  cs: boolean;
  onPrepare: () => void;
}) {
  const t = useDict();

  return (
    <Card className="p-2.5 shadow-none">
      <a
        href={position.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block break-words text-sm font-medium hover:underline focus-ring rounded-sm"
      >
        {position.title}
      </a>
      {position.company && (
        <p className="mt-0.5 break-words text-xs text-foreground-muted">
          {position.company}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex min-h-[22px] items-center rounded-sm border border-border bg-surface-inset px-1.5 py-[3px] text-[11px] text-foreground-muted">
          {readinessLabel(position.readiness, cs)}
        </span>
        <span className="text-[11px] text-foreground-subtle">
          {t.jobs.boardSavedNotDraggable}
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="mt-2.5"
        onClick={onPrepare}
      >
        <Send className="h-3.5 w-3.5" />
        {position.cover_letter_url
          ? cs
            ? "Zkontrolovat / označit odeslání"
            : "Review / mark as sent"
          : t.jobs.prepareApplication}
      </Button>
    </Card>
  );
}
