"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { LucideIcon } from "lucide-react";
import {
  CalendarDays,
  BriefcaseBusiness,
  Command,
  CreditCard,
  GripVertical,
  LayoutDashboard,
  ListTodo,
  Plus,
  Repeat,
  RotateCcw,
  Settings2,
  Sigma,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useDict } from "@/lib/i18n";
import {
  availableWidgets,
  moveWidget,
  withWidget,
  withoutWidget,
  type WidgetId,
} from "@/lib/dashboard-layout";
import { useDashboardLayout } from "@/lib/use-dashboard-layout";
import { useNavVisibility } from "@/lib/use-prefs";
import { cn } from "@/lib/utils";

// Widgets that mirror a hideable nav section — hidden in Settings ⇒ hidden on
// the overview too. Overview-only widgets (today-hero, quick-add, kpi) have no
// entry and always show.
const WIDGET_SECTION: Partial<Record<WidgetId, string>> = {
  todos: "tasks",
  "work-attention": "work",
  subscriptions: "subscriptions",
  calendar: "calendar",
  goals: "goals",
};

// Icon + grid footprint per widget. "full" widgets span both columns on large
// screens; "half" widgets sit two-per-row. Labels/descriptions live in i18n.
const WIDGET_META: Record<WidgetId, { icon: LucideIcon; size: "full" | "half" }> =
  {
    "today-hero": { icon: LayoutDashboard, size: "full" },
    "quick-add": { icon: Command, size: "full" },
    kpi: { icon: Sigma, size: "full" },
    todos: { icon: ListTodo, size: "full" },
    "work-attention": { icon: BriefcaseBusiness, size: "full" },
    subscriptions: { icon: CreditCard, size: "half" },
    calendar: { icon: CalendarDays, size: "half" },
    goals: { icon: Repeat, size: "half" },
  };

type Props = {
  /** Rendered content for every widget the overview can show. */
  nodes: Record<WidgetId, React.ReactNode>;
};

export function CustomizableOverview({ nodes }: Props) {
  const t = useDict();
  const { layout, setLayout, reset } = useDashboardLayout();
  const { isHidden } = useNavVisibility();
  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  // Respect the Settings nav-visibility choices: drop widgets whose section
  // the user hid. Kept out of `layout` state so unhiding restores position.
  const visibleLayout = layout.filter((id) => {
    const section = WIDGET_SECTION[id];
    return !section || !isHidden(section);
  });

  // Pointer for mouse/touch, keyboard for accessibility — matches notes-panel.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const from = layout.indexOf(e.active.id as WidgetId);
    const to = layout.indexOf(e.over.id as WidgetId);
    if (from < 0 || to < 0) return;
    setLayout(moveWidget(layout, from, to));
  }

  const available = availableWidgets(layout);

  return (
    <div className="space-y-4">
      {/* Toolbar — Customize toggles edit mode; while editing, add/reset/done. */}
      <div className="flex flex-wrap items-center gap-2">
        <p className="hidden min-w-0 flex-1 truncate text-xs text-foreground-subtle sm:block">
          {editing ? t.dashboard.editingHint : ""}
        </p>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {editing ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAddOpen(true)}
                disabled={available.length === 0}
              >
                <Plus className="h-3.5 w-3.5" />
                {t.dashboard.addWidget}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (window.confirm(t.dashboard.resetConfirm)) reset();
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t.dashboard.reset}
              </Button>
              <Button size="sm" onClick={() => setEditing(false)}>
                {t.dashboard.done}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
            >
              <Settings2 className="h-3.5 w-3.5" />
              {t.dashboard.customize}
            </Button>
          )}
        </div>
      </div>

      {layout.length === 0 ? (
        <EmptyState
          icon={LayoutDashboard}
          title={t.dashboard.emptyTitle}
          description={t.dashboard.emptyDescription}
          className="py-16"
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditing(true);
                setAddOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              {t.dashboard.addWidget}
            </Button>
          }
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={[...visibleLayout]}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {visibleLayout.map((id) => (
                <SortableWidget
                  key={id}
                  id={id}
                  size={WIDGET_META[id].size}
                  icon={WIDGET_META[id].icon}
                  label={t.dashboard.widgetNames[id]}
                  editing={editing}
                  onRemove={() => setLayout(withoutWidget(layout, id))}
                >
                  {nodes[id]}
                </SortableWidget>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <AddWidgetDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        available={available}
        onAdd={(id) => setLayout(withWidget(layout, id))}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */

function SortableWidget({
  id,
  size,
  icon: Icon,
  label,
  editing,
  onRemove,
  children,
}: {
  id: WidgetId;
  size: "full" | "half";
  icon: LucideIcon;
  label: string;
  editing: boolean;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  const t = useDict();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !editing });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "min-w-0",
        size === "full" ? "lg:col-span-2" : "lg:col-span-1",
        isDragging && "z-20 opacity-80",
      )}
    >
      <div
        className={cn(
          "rounded-xl border border-transparent transition-colors",
          editing &&
            "border-dashed border-border-strong bg-surface-muted/30 p-2",
        )}
      >
        {editing && (
          <div className="mb-2 flex items-center gap-1.5">
            <button
              type="button"
              aria-label={t.dashboard.dragToReorder}
              {...attributes}
              {...listeners}
              className="inline-flex h-6 w-6 cursor-grab items-center justify-center rounded text-foreground-subtle hover:bg-surface-hover hover:text-foreground active:cursor-grabbing focus-ring"
            >
              <GripVertical className="h-3.5 w-3.5" />
            </button>
            <Icon className="h-3.5 w-3.5 text-foreground-muted" />
            <span className="flex-1 truncate text-xs font-medium text-foreground">
              {label}
            </span>
            <button
              type="button"
              onClick={onRemove}
              aria-label={t.dashboard.remove}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-foreground-subtle hover:bg-surface-hover hover:text-destructive focus-ring"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {/* Disable inner interactions while editing so drags/clicks don't fire
            the widget's own handlers. */}
        <div className={cn(editing && "pointer-events-none select-none")}>
          {children}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */

function AddWidgetDialog({
  open,
  onOpenChange,
  available,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  available: WidgetId[];
  onAdd: (id: WidgetId) => void;
}) {
  const t = useDict();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.dashboard.addTitle}</DialogTitle>
          <DialogDescription>{t.dashboard.addDescription}</DialogDescription>
        </DialogHeader>

        <div className="mt-4">
          {available.length === 0 ? (
            <p className="py-8 text-center text-xs text-foreground-subtle">
              {t.dashboard.allAdded}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {available.map((id) => {
                const Icon = WIDGET_META[id].icon;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => onAdd(id)}
                      className="flex w-full items-start gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-border-strong hover:bg-surface-hover focus-ring"
                    >
                      <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-foreground">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-foreground">
                          {t.dashboard.widgetNames[id]}
                        </span>
                        <span className="block text-xs text-foreground-subtle">
                          {t.dashboard.widgetDescriptions[id]}
                        </span>
                      </span>
                      <Plus className="mt-1 h-4 w-4 shrink-0 text-foreground-subtle" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <DialogClose asChild>
            <Button size="sm" variant="ghost">
              {t.dashboard.done}
            </Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
