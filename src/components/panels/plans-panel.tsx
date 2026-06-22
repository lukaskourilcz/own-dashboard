"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { useDict, useDateLocale } from "@/lib/i18n";
import { qk } from "@/lib/queries/keys";
import type { Plan, PlanStatus, Updater } from "@/lib/types";

const STATUSES: { key: PlanStatus; tone: string; dot: string }[] = [
  {
    key: "idea",
    tone: "bg-surface-muted text-foreground-muted",
    dot: "bg-foreground-subtle",
  },
  {
    key: "active",
    tone: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    dot: "bg-blue-500",
  },
  {
    key: "done",
    tone: "bg-success/10 text-success",
    dot: "bg-success",
  },
  {
    key: "dropped",
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
  const qc = useQueryClient();
  const t = useDict();
  const [form, setForm] = useState<FormState>(empty);
  const [error, setError] = useState<string | null>(null);
  const [calendarNote, setCalendarNote] = useState<string | null>(null);
  const [view, setView] = useState<"board" | "timeline">("board");

  // CREATE: needs the server-generated row (and the linked calendar event id),
  // so this stays non-optimistic — apply to the cache in onSuccess. The
  // calendar-event fetch + follow-up linked_calendar_event_id update are part
  // of the mutation flow and are left exactly as before.
  const addMutation = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("no-user");
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
        throw new Error(planErr?.message ?? t.plans.couldNotSavePlan);
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
          setCalendarNote(t.plans.calendarEventFailed);
        }
      }
      return saved;
    },
    onSuccess: (saved) => {
      setPlans((prev) => [saved, ...prev]);
      setForm(empty);
      void qc.invalidateQueries({ queryKey: qk.plans });
    },
    onError: (e) => {
      // Original returned silently when there was no authenticated user.
      if (e instanceof Error && e.message === "no-user") return;
      setError(e instanceof Error ? e.message : t.plans.couldNotSavePlan);
    },
  });

  // Optimistic: the status flips in the cache immediately, rolls back on
  // error, and reconciles with the DB via invalidate once settled.
  const updateStatusMutation = useMutation({
    mutationFn: async ({ plan, status }: { plan: Plan; status: PlanStatus }) => {
      const { error } = await supabase
        .from("plans")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", plan.id);
      if (error) throw error;
    },
    onMutate: async ({ plan, status }) => {
      await qc.cancelQueries({ queryKey: qk.plans });
      const prev = qc.getQueryData<Plan[]>(qk.plans);
      setPlans((old) =>
        old.map((p) => (p.id === plan.id ? { ...p, status } : p)),
      );
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev) setPlans(ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.plans }),
  });

  // DELETE: original removed from state only after a successful delete, so
  // this applies the cache change in onSuccess (post-success), then fires the
  // best-effort calendar-event cleanup fetch.
  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("plans").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => {
      const plan = plans.find((p) => p.id === id);
      setPlans((prev) => prev.filter((p) => p.id !== id));
      // Best-effort: delete the linked Google Calendar event so it doesn't
      // orphan. Server treats 404/410 as success; failures here are silent.
      if (plan?.linked_calendar_event_id) {
        fetch("/api/calendar/event", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: plan.linked_calendar_event_id }),
        }).catch(() => {
          /* network blip — event will be left as is in GCal */
        });
      }
      void qc.invalidateQueries({ queryKey: qk.plans });
    },
  });

  const saving = addMutation.isPending;

  function addPlan(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCalendarNote(null);
    if (!form.title.trim()) {
      setError(t.plans.titleRequired);
      return;
    }
    if (form.addToCalendar && !form.target_date) {
      setError(t.plans.targetDateRequiredForCalendar);
      return;
    }
    addMutation.mutate();
  }

  function updateStatus(plan: Plan, status: PlanStatus) {
    updateStatusMutation.mutate({ plan, status });
  }

  function removePlan(id: string) {
    removeMutation.mutate(id);
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
        title={t.plans.title}
        description={t.plans.description}
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
              {t.plans.board}
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
              {t.plans.timeline}
            </button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-1.5">
              <Target className="h-3 w-3" /> {t.plans.newPlan}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={addPlan} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="plan-title">{t.plans.formTitle}</Label>
                <Input
                  id="plan-title"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder={t.plans.titlePlaceholder}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-date">{t.plans.targetDate}</Label>
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
                <Label htmlFor="plan-status">{t.plans.status}</Label>
                <Select
                  id="plan-status"
                  value={form.status}
                  onChange={(e) =>
                    setForm({ ...form, status: e.target.value as PlanStatus })
                  }
                >
                  {STATUSES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {t.plans.statusLabel[s.key]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-notes">{t.plans.notes}</Label>
                <Textarea
                  id="plan-notes"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder={t.plans.notesPlaceholder}
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
                {t.plans.addToCalendar}
              </label>
              {error && <p className="text-xs text-destructive">{error}</p>}
              {calendarNote && (
                <p className="text-xs text-warning">{calendarNote}</p>
              )}
              <Button type="submit" disabled={saving} className="w-full">
                <Plus className="h-3.5 w-3.5" />
                {saving ? t.plans.saving : t.plans.addPlan}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>
              {view === "board" ? t.plans.statusBoard : t.plans.timeline}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {plans.length === 0 ? (
              <EmptyState
                icon={Target}
                title={t.plans.noPlansYet}
                description={t.plans.noPlansDescription}
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
                        <SectionLabel>{t.plans.statusLabel[s.key]}</SectionLabel>
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
                          {t.plans.empty}
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
  const t = useDict();
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
          aria-label={t.plans.changeStatus}
          className="text-foreground-subtle hover:text-foreground transition-colors"
        >
          <Pencil className="h-2.5 w-2.5" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={t.plans.deletePlan}
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
              {t.plans.cal}
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
                {t.plans.statusLabel[s.key]}
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
  const t = useDict();
  const locale = useDateLocale();
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
              {format(new Date(plan.target_date), t.plans.timelineDateFormat, {
                locale,
              })}
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
                  ? t.plans.today
                  : daysOut > 0
                    ? t.plans.inDays(daysOut)
                    : t.plans.daysAgo(-daysOut)}
            </p>
          </>
        ) : (
          <p className="text-foreground-subtle">{t.plans.noDate}</p>
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
            {t.plans.statusLabel[s.key]}
          </option>
        ))}
      </Select>
      <Tooltip content={t.plans.deletePlan}>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onDelete}
          aria-label={t.plans.deletePlan}
          className="opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </Button>
      </Tooltip>
    </motion.li>
  );
}
