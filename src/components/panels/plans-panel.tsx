"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { differenceInCalendarDays, format } from "date-fns";
import {
  CalendarPlus,
  Check,
  ExternalLink,
  Pencil,
  Plus,
  Target,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, SectionLabel } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Plan, PlanStatus, Updater } from "@/lib/types";

const STATUSES: { key: PlanStatus; label: string; tone: string; dot: string }[] = [
  {
    key: "idea",
    label: "Idea",
    tone: "bg-surface-muted text-foreground-muted",
    dot: "bg-foreground-subtle",
  },
  {
    key: "active",
    label: "Active",
    tone: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    dot: "bg-blue-500",
  },
  {
    key: "done",
    label: "Done",
    tone: "bg-success/10 text-success",
    dot: "bg-success",
  },
  {
    key: "dropped",
    label: "Dropped",
    tone: "bg-surface-muted text-foreground-subtle line-through",
    dot: "bg-foreground-subtle/50",
  },
];

type FormState = {
  title: string;
  target_date: string;
  status: PlanStatus;
  notes: string;
  addToCalendar: boolean;
};

const empty: FormState = {
  title: "",
  target_date: "",
  status: "idea",
  notes: "",
  addToCalendar: false,
};

export function PlansPanel({
  plans,
  setPlans,
}: {
  plans: Plan[];
  setPlans: Updater<Plan[]>;
}) {
  const supabase = createClient();
  const [form, setForm] = useState<FormState>(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calendarNote, setCalendarNote] = useState<string | null>(null);
  const [view, setView] = useState<"board" | "timeline">("board");

  async function addPlan(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCalendarNote(null);
    if (!form.title.trim()) {
      setError("Title is required.");
      return;
    }
    if (form.addToCalendar && !form.target_date) {
      setError("Target date is required to add to calendar.");
      return;
    }
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setSaving(false);
      return;
    }
    const { data: plan, error: planErr } = await supabase
      .from("plans")
      .insert({
        user_id: userId,
        title: form.title.trim(),
        target_date: form.target_date || null,
        status: form.status,
        notes: form.notes.trim() || null,
      })
      .select()
      .single();
    if (planErr || !plan) {
      setError(planErr?.message ?? "Could not save plan.");
      setSaving(false);
      return;
    }

    let saved: Plan = plan;
    if (form.addToCalendar && form.target_date) {
      const res = await fetch("/api/calendar/event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          date: form.target_date,
          allDay: true,
          description: form.notes.trim(),
          recurrence: "none",
        }),
      });
      if (res.ok) {
        const ev = await res.json();
        const { data: updated } = await supabase
          .from("plans")
          .update({ linked_calendar_event_id: ev.id })
          .eq("id", plan.id)
          .select()
          .single();
        if (updated) saved = updated;
      } else {
        setCalendarNote(
          "Plan saved, but the calendar event couldn't be created.",
        );
      }
    }

    setPlans((prev) => [saved, ...prev]);
    setForm(empty);
    setSaving(false);
  }

  async function updateStatus(plan: Plan, status: PlanStatus) {
    setPlans((prev) =>
      prev.map((p) => (p.id === plan.id ? { ...p, status } : p)),
    );
    const { error } = await supabase
      .from("plans")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", plan.id);
    if (error) {
      setPlans((prev) =>
        prev.map((p) => (p.id === plan.id ? { ...p, status: plan.status } : p)),
      );
    }
  }

  async function removePlan(id: string) {
    const { error } = await supabase.from("plans").delete().eq("id", id);
    if (!error) setPlans((prev) => prev.filter((p) => p.id !== id));
  }

  const grouped = useMemo(() => {
    const map: Record<PlanStatus, Plan[]> = {
      idea: [],
      active: [],
      done: [],
      dropped: [],
    };
    for (const p of plans) map[p.status].push(p);
    return map;
  }, [plans]);

  const timeline = useMemo(
    () =>
      [...plans].sort((a, b) => {
        if (!a.target_date && !b.target_date) return 0;
        if (!a.target_date) return 1;
        if (!b.target_date) return -1;
        return a.target_date.localeCompare(b.target_date);
      }),
    [plans],
  );

  return (
    <div>
      <PageHeader
        title="Plans"
        description="What you're working toward."
        action={
          <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setView("board")}
              className={cn(
                "px-2.5 py-1 rounded transition-colors",
                view === "board"
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground-muted hover:text-foreground",
              )}
            >
              Board
            </button>
            <button
              type="button"
              onClick={() => setView("timeline")}
              className={cn(
                "px-2.5 py-1 rounded transition-colors",
                view === "timeline"
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground-muted hover:text-foreground",
              )}
            >
              Timeline
            </button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-1.5">
              <Target className="h-3 w-3" /> New plan
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={addPlan} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="plan-title">Title</Label>
                <Input
                  id="plan-title"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Ship the side project"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-date">Target date</Label>
                <Input
                  id="plan-date"
                  type="date"
                  value={form.target_date}
                  onChange={(e) =>
                    setForm({ ...form, target_date: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-status">Status</Label>
                <Select
                  id="plan-status"
                  value={form.status}
                  onChange={(e) =>
                    setForm({ ...form, status: e.target.value as PlanStatus })
                  }
                >
                  {STATUSES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-notes">Notes</Label>
                <Textarea
                  id="plan-notes"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Optional"
                  rows={2}
                />
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-foreground-muted">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-border-strong"
                  checked={form.addToCalendar}
                  onChange={(e) =>
                    setForm({ ...form, addToCalendar: e.target.checked })
                  }
                />
                <CalendarPlus className="h-3 w-3" />
                Add as a Google Calendar event
              </label>
              {error && <p className="text-xs text-destructive">{error}</p>}
              {calendarNote && (
                <p className="text-xs text-warning">{calendarNote}</p>
              )}
              <Button type="submit" disabled={saving} className="w-full">
                <Plus className="h-3.5 w-3.5" />
                {saving ? "Saving…" : "Add plan"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>
              {view === "board" ? "Status board" : "Timeline"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {plans.length === 0 ? (
              <EmptyState
                icon={Target}
                title="No plans yet"
                description="Add one on the left to start tracking your goals."
              />
            ) : view === "board" ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {STATUSES.map((s) => (
                  <div
                    key={s.key}
                    className="rounded-md border border-border bg-surface-muted/40 p-2.5"
                  >
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn("h-1.5 w-1.5 rounded-full", s.dot)}
                        />
                        <SectionLabel>{s.label}</SectionLabel>
                      </div>
                      <span className="text-[10px] text-foreground-subtle tabular">
                        {grouped[s.key].length}
                      </span>
                    </div>
                    <ul className="space-y-1.5">
                      {grouped[s.key].map((p) => (
                        <PlanCard
                          key={p.id}
                          plan={p}
                          onStatus={(status) => updateStatus(p, status)}
                          onDelete={() => removePlan(p.id)}
                        />
                      ))}
                      {grouped[s.key].length === 0 && (
                        <li className="text-[11px] text-foreground-subtle italic px-1">
                          empty
                        </li>
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <ul className="space-y-2">
                {timeline.map((p) => (
                  <TimelineRow
                    key={p.id}
                    plan={p}
                    onStatus={(status) => updateStatus(p, status)}
                    onDelete={() => removePlan(p.id)}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  onStatus,
  onDelete,
}: {
  plan: Plan;
  onStatus: (status: PlanStatus) => void;
  onDelete: () => void;
}) {
  const [editingStatus, setEditingStatus] = useState(false);
  return (
    <motion.li
      layout
      className="rounded-md bg-surface border border-border p-2 shadow-soft"
    >
      <div className="flex items-start gap-1">
        <p
          className={cn(
            "text-xs font-medium flex-1 min-w-0",
            plan.status === "done" && "line-through text-foreground-subtle",
            plan.status === "dropped" && "line-through text-foreground-subtle",
          )}
        >
          {plan.title}
        </p>
        <button
          type="button"
          onClick={() => setEditingStatus((v) => !v)}
          aria-label="Change status"
          className="text-foreground-subtle hover:text-foreground transition-colors"
        >
          <Pencil className="h-2.5 w-2.5" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete plan"
          className="text-foreground-subtle hover:text-destructive transition-colors"
        >
          <Trash2 className="h-2.5 w-2.5" />
        </button>
      </div>
      {(plan.target_date || plan.linked_calendar_event_id) && (
        <p className="text-[10px] text-foreground-subtle mt-1 flex items-center gap-1.5 tabular">
          {plan.target_date && <span>{plan.target_date}</span>}
          {plan.linked_calendar_event_id && (
            <span className="inline-flex items-center gap-0.5">
              <ExternalLink className="h-2 w-2" />
              cal
            </span>
          )}
        </p>
      )}
      {editingStatus && (
        <div className="mt-2 flex flex-wrap gap-1">
          {STATUSES.filter((s) => s.key !== plan.status).map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => {
                onStatus(s.key);
                setEditingStatus(false);
              }}
              className={cn(
                "text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded",
                s.tone,
              )}
            >
              <span className="inline-flex items-center gap-1">
                <Check className="h-2 w-2" />
                {s.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </motion.li>
  );
}

function TimelineRow({
  plan,
  onStatus,
  onDelete,
}: {
  plan: Plan;
  onStatus: (status: PlanStatus) => void;
  onDelete: () => void;
}) {
  const statusMeta = STATUSES.find((s) => s.key === plan.status)!;
  const daysOut = plan.target_date
    ? differenceInCalendarDays(new Date(plan.target_date), new Date())
    : null;
  return (
    <motion.li
      layout
      className="group flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2.5 transition-all duration-150 hover:border-border-strong"
    >
      <div className="w-20 shrink-0 text-xs tabular">
        {plan.target_date ? (
          <>
            <p className="font-medium text-foreground">
              {format(new Date(plan.target_date), "MMM d")}
            </p>
            <p
              className={cn(
                "text-[10px]",
                daysOut !== null && daysOut < 0 && plan.status !== "done"
                  ? "text-destructive"
                  : "text-foreground-subtle",
              )}
            >
              {daysOut === null
                ? ""
                : daysOut === 0
                  ? "today"
                  : daysOut > 0
                    ? `in ${daysOut}d`
                    : `${-daysOut}d ago`}
            </p>
          </>
        ) : (
          <p className="text-foreground-subtle">no date</p>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-sm font-medium truncate",
            (plan.status === "done" || plan.status === "dropped") &&
              "line-through text-foreground-subtle",
          )}
        >
          {plan.title}
        </p>
        {plan.notes && (
          <p className="text-[11px] text-foreground-subtle truncate">
            {plan.notes}
          </p>
        )}
      </div>
      <Select
        value={plan.status}
        onChange={(e) => onStatus(e.target.value as PlanStatus)}
        className={cn("h-7 w-24 text-[11px]", statusMeta.tone)}
      >
        {STATUSES.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </Select>
      <Tooltip content="Delete">
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onDelete}
          aria-label="Delete plan"
          className="opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </Button>
      </Tooltip>
    </motion.li>
  );
}
