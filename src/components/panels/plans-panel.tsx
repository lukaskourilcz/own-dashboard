"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { differenceInCalendarDays, format } from "date-fns";
import {
  CalendarPlus,
  Check,
  ExternalLink,
  Pencil,
  Plus,
  Repeat,
  Target,
  Trash2,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { collectionPage } from "@/lib/collection-page";
import { CollectionPagination } from "@/components/ui/collection-pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, SectionLabel } from "@/components/ui/page-header";
import { SimpleSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { useOwnerPreferences } from "@/lib/owner-preferences";
import { useGuardedNavigation, useUnsavedDraft } from "@/components/navigation-guard";
import { usePlanActions } from "@/components/plans/use-plan-actions";
import { PlanRecordError } from "@/lib/plan-records";
import { guestReadOnlyError, isGuestTour } from "@/lib/guest-requests";
import { cn } from "@/lib/utils";
import { useDict, useDateLocale } from "@/lib/i18n";
import { parseDateOnly } from "@/lib/date-keys";
import { useNow } from "@/lib/use-now";
import type { Plan, PlanRecurrence, PlanStatus, Updater } from "@/lib/types";

const RECURRENCES: PlanRecurrence[] = ["none", "weekly", "biweekly", "monthly"];

const STATUSES: { key: PlanStatus; tone: string; dot: string }[] = [
  {
    key: "idea",
    tone: "bg-surface-muted text-foreground-muted",
    dot: "bg-foreground-subtle",
  },
  {
    key: "active",
    tone: "bg-information-soft text-information",
    dot: "bg-information",
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
  recurrence: PlanRecurrence;
  notes: string;
  addToCalendar: boolean;
};

const empty: FormState = {
  title: "",
  target_date: "",
  status: "idea",
  recurrence: "none",
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
  const owner = useOwnerPreferences(), navigate = useGuardedNavigation();
  const lifetime = useRef(new AbortController());
  useLayoutEffect(() => { if (lifetime.current.signal.aborted) lifetime.current = new AbortController(); return () => lifetime.current.abort(); }, []);
  const actions = usePlanActions(setPlans, plans), t = useDict(), now = useNow();
  const [formOpen, setFormOpen] = useState(false), [form, setForm] = useState<FormState>(empty);
  const [error, setError] = useState<string | null>(null), [saving, setSaving] = useState(false);
  const [page, setPage] = useState(0);
  const [view, setView] = useState<"board" | "timeline">("board");
  const savingRef = useRef(false), creationId = useRef<string | null>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(empty);
  const valid = !!form.title.trim() && form.title.trim().length <= 500 && (!form.addToCalendar || !!form.target_date);
  const reset = () => { creationId.current = null; setError(null); setForm(empty); setFormOpen(false); };
  const close = (open: boolean) => { if (open) setFormOpen(true); else if (!savingRef.current) navigate(reset); };
  async function savePlan(): Promise<boolean> {
    if (savingRef.current || !formOpen) return false;
    if (isGuestTour()) { guestReadOnlyError(); return false; }
    setError(null);
    if (!form.title.trim() || form.title.trim().length > 500) { setError(t.plans.titleRequired); return false; }
    if (form.addToCalendar && !form.target_date) { setError(t.plans.targetDateRequiredForCalendar); return false; }
    const original = owner?.capture();
    const captured = original ? { ownerId: original.ownerId, signal: AbortSignal.any([original.signal, lifetime.current.signal]) } : null;
    if (!captured || captured.signal.aborted) { setError(t.plans.saveUnconfirmed); return false; }
    savingRef.current = true; setSaving(true); creationId.current ??= crypto.randomUUID();
    try {
      await actions.create(creationId.current, { title: form.title.trim(), target_date: form.target_date || null, status: form.status, recurrence: form.recurrence, notes: form.notes.trim() || null }, form.addToCalendar);
      captured.signal.throwIfAborted(); setPage(0); reset(); return true;
    } catch (error) {
      if (!captured.signal.aborted) setError(error instanceof PlanRecordError && error.reason === 'changed' ? t.plans.planChanged : t.plans.saveUnconfirmed);
      return false;
    } finally { savingRef.current = false; if (!captured.signal.aborted) setSaving(false); }
  }
  useUnsavedDraft({ dirty: formOpen && dirty, pending: saving, canSave: valid && !saving, save: savePlan, discard: reset });

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

  const currentPage = useMemo(() => collectionPage(view === 'board' ? plans : timeline, page), [view, plans, timeline, page]);
  if (page !== currentPage.index) setPage(currentPage.index);
  const grouped = useMemo(() => {
    const map: Record<PlanStatus, Plan[]> = { idea: [], active: [], done: [], dropped: [] };
    for (const plan of currentPage.items) map[plan.status].push(plan);
    return map;
  }, [currentPage.items]);
  const totals = useMemo(() => {
    const result: Record<PlanStatus, number> = { idea: 0, active: 0, done: 0, dropped: 0 };
    for (const plan of plans) result[plan.status]++;
    return result;
  }, [plans]);

  return (
    <div>
      <PageHeader
        title={t.plans.title}
        description={t.plans.description}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button ref={button => actions.registerNewControl(button)} onClick={() => setFormOpen(true)}><Plus />{t.plans.newPlan}</Button>
            <div className="inline-flex gap-1">
              <Button variant={view === 'board' ? 'subtle' : 'ghost'} aria-pressed={view === 'board'} onClick={() => { setPage(0); setView('board'); }}>{t.plans.board}</Button>
              <Button variant={view === 'timeline' ? 'subtle' : 'ghost'} aria-pressed={view === 'timeline'} onClick={() => { setPage(0); setView('timeline'); }}>{t.plans.timeline}</Button>
            </div>
          </div>
        }
      />

      <Dialog open={formOpen} onOpenChange={close}><DialogContent className="max-w-lg" aria-describedby={undefined} aria-busy={saving} showClose={!saving} onEscapeKeyDown={event => { if (savingRef.current) event.preventDefault(); }} onPointerDownOutside={event => { if (savingRef.current) event.preventDefault(); }}><DialogHeader><DialogTitle>{t.plans.newPlan}</DialogTitle></DialogHeader><form onSubmit={event => { event.preventDefault(); void savePlan(); }} className="space-y-3"><fieldset disabled={saving} className="min-w-0 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="plan-title">{t.plans.formTitle}</Label>
                <Input
                  id="plan-title"
                  autoFocus maxLength={500}
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder={t.plans.titlePlaceholder}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5">
                <Label htmlFor="plan-status">{t.plans.status}</Label>
                <SimpleSelect
                  id="plan-status"
                  value={form.status}
                  onValueChange={(v) =>
                    setForm({ ...form, status: v as PlanStatus })
                  }
                  options={STATUSES.map((s) => ({
                    value: s.key,
                    label: t.plans.statusLabel[s.key],
                  }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-recurrence">
                  <span className="inline-flex items-center gap-1.5">
                    <Repeat className="h-3 w-3" />
                    {t.plans.recurrence}
                  </span>
                </Label>
                <SimpleSelect
                  id="plan-recurrence"
                  value={form.recurrence}
                  onValueChange={(v) => {
                    const recurrence = v as PlanRecurrence;
                    // A recurring plan has no single end date, so drop the
                    // target date + one-off calendar event when one is chosen.
                    setForm((f) => ({
                      ...f,
                      recurrence,
                      ...(recurrence !== "none"
                        ? { target_date: "", addToCalendar: false }
                        : {}),
                    }));
                  }}
                  options={RECURRENCES.map((r) => ({
                    value: r,
                    label: t.plans.recurrenceLabel[r],
                  }))}
                />
              </div>
              </div>
              {form.recurrence === "none" && (
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
              )}
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
              <label
                className={cn(
                  "inline-flex min-h-11 items-center gap-2 text-xs text-foreground-muted md:min-h-8",
                  form.recurrence !== "none" && "hidden",
                )}
              >
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
              {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
              <Button type="submit" disabled={saving} className="w-full">
                <Plus className="h-3.5 w-3.5" />
                {saving ? t.plans.saving : t.plans.addPlan}
              </Button>
            </fieldset></form></DialogContent></Dialog>
      {actions.calendarNotice && <p role="status" className="mb-3 text-sm text-warning">{t.plans[actions.calendarNotice]}</p>}
      {actions.notice && <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 text-sm text-destructive"><span>{actions.notice === 'changed' ? t.plans.planChanged : t.plans.actionUnconfirmed}</span><Button variant="outline" disabled={actions.reloading || actions.pending.size > 0} onClick={() => void actions.reload()}>{actions.reloading ? t.common.loading : t.common.retry}</Button></div>}
      <CollectionPagination page={currentPage} onPage={setPage} label={t.plans.pages} range={t.plans.pageRange} previous={t.plans.previous} next={t.plans.next} disabled={actions.pending.size > 0} />
      <section aria-label={view === "board" ? t.plans.statusBoard : t.plans.timeline}>
            {plans.length === 0 ? (
              <EmptyState
                icon={Target}
                title={t.plans.noPlansYet}
                description={t.plans.noPlansDescription}
              />
            ) : view === "board" ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
                        {grouped[s.key].length === totals[s.key] ? totals[s.key] : `${grouped[s.key].length}/${totals[s.key]}`}
                      </span>
                    </div>
                    <ul className="space-y-1.5">
                      {grouped[s.key].map((p) => (
                        <PlanCard
                          key={p.id}
                          plan={p}
                          pending={actions.pending.has(p.id)}
                          deleteRef={button => actions.deleteControl(p.id, button)}
                          actionRef={button => actions.actionControl(p.id, button)}
                          onStatus={(status) => void actions.update(p, { status })}
                          onDelete={() => void actions.remove(p)}
                        />
                      ))}
                      {grouped[s.key].length === 0 && (
                        <li className="text-[11px] text-foreground-subtle italic px-1">
                          {totals[s.key] ? t.plans.noneOnPage : t.plans.empty}
                        </li>
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <ul className="space-y-2">
                {currentPage.items.map((p) => (
                  <TimelineRow
                    key={p.id}
                    plan={p}
                    now={now}
                    pending={actions.pending.has(p.id)}
                    deleteRef={button => actions.deleteControl(p.id, button)}
                    actionRef={button => actions.actionControl(p.id, button)}
                    onStatus={(status) => void actions.update(p, { status })}
                    onDelete={() => void actions.remove(p)}
                  />
                ))}
              </ul>
            )}
      </section>
    </div>
  );
}

function PlanCard({
  plan,
  onStatus,
  onDelete,
  pending, deleteRef, actionRef,
}: {
  plan: Plan;
  onStatus: (status: PlanStatus) => void;
  onDelete: () => void;
  pending: boolean; deleteRef: (button: HTMLButtonElement | null) => void; actionRef: (button: HTMLButtonElement | null) => void;
}) {
  const t = useDict();
  const [editingStatus, setEditingStatus] = useState(false);
  return (
    <li
      aria-busy={pending}
      className="rounded-md bg-surface border border-border p-2"
    >
      <div className="flex items-start gap-1">
        <p
          className={cn(
            "text-xs font-medium flex-1 min-w-0 break-words [overflow-wrap:anywhere]",
            plan.status === "done" && "line-through text-foreground-subtle",
            plan.status === "dropped" && "line-through text-foreground-subtle",
          )}
        >
          {plan.title}
        </p>
        <button
          type="button"
          disabled={pending}
          ref={actionRef}
          onClick={() => setEditingStatus((v) => !v)}
          aria-label={`${plan.title}: ${t.plans.changeStatus}`}
          className="inline-flex min-h-11 min-w-11 md:min-h-7 md:min-w-7 items-center justify-center text-foreground-subtle hover:text-foreground transition-colors focus-ring disabled:opacity-40 disabled:cursor-wait"
        >
          <Pencil className="h-2.5 w-2.5" />
        </button>
        <button
          type="button"
          ref={deleteRef} disabled={pending}
          onClick={onDelete}
          aria-label={`${plan.title}: ${t.plans.deletePlan}`}
          className="inline-flex min-h-11 min-w-11 md:min-h-7 md:min-w-7 items-center justify-center text-foreground-subtle hover:text-destructive transition-colors focus-ring disabled:opacity-40 disabled:cursor-wait"
        >
          <Trash2 className="h-2.5 w-2.5" />
        </button>
      </div>
      {(plan.target_date ||
        plan.linked_calendar_event_id ||
        plan.recurrence !== "none") && (
        <p className="text-[10px] text-foreground-subtle mt-1 flex flex-wrap items-center gap-1.5 tabular">
          {plan.recurrence !== "none" && (
            <span className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-[7px] py-[3px] font-medium text-primary">
              <Repeat className="h-2 w-2" />
              {t.plans.recurrenceChip[plan.recurrence]}
            </span>
          )}
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
              disabled={pending}
              className={cn(
                "min-h-11 min-w-11 md:min-h-8 focus-ring disabled:opacity-40 disabled:cursor-wait rounded px-[7px] py-[3px] text-[10px] font-medium uppercase tracking-wide",
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
    </li>
  );
}

function TimelineRow({
  plan,
  now,
  onStatus,
  onDelete,
  pending, deleteRef, actionRef,
}: {
  plan: Plan;
  now: Date | null;
  onStatus: (status: PlanStatus) => void;
  onDelete: () => void;
  pending: boolean; deleteRef: (button: HTMLButtonElement | null) => void; actionRef: (button: HTMLButtonElement | null) => void;
}) {
  const t = useDict();
  const locale = useDateLocale();
  const statusMeta = STATUSES.find((s) => s.key === plan.status)!;
  const daysOut = plan.target_date && now
    ? differenceInCalendarDays(parseDateOnly(plan.target_date), now)
    : null;
  return (
    <li
      aria-busy={pending}
      ref={element => actionRef(element?.querySelector<HTMLButtonElement>('button[role="combobox"]') ?? null)}
      className="group grid grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-border bg-surface px-3 py-2.5 transition-colors hover:border-border-strong sm:grid-cols-[5rem_minmax(0,1fr)_6rem_auto]"
    >
      <div className="w-20 shrink-0 text-xs tabular">
        {plan.target_date ? (
          <>
            <p className="font-medium text-foreground">
              {format(parseDateOnly(plan.target_date), t.plans.timelineDateFormat, {
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
            "text-sm font-medium flex flex-wrap items-center gap-1.5",
            (plan.status === "done" || plan.status === "dropped") &&
              "line-through text-foreground-subtle",
          )}
        >
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{plan.title}</span>
          {plan.recurrence !== "none" && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-primary/10 px-[7px] py-[3px] text-[10px] font-medium text-primary no-underline">
              <Repeat className="h-2 w-2" />
              {t.plans.recurrenceChip[plan.recurrence]}
            </span>
          )}
        </p>
        {plan.notes && (
          <p className="break-words text-[11px] text-foreground-subtle [overflow-wrap:anywhere]">
            {plan.notes}
          </p>
        )}
      </div>
      <SimpleSelect
        aria-label={`${plan.title}: ${t.plans.status}`}
        value={plan.status}
        disabled={pending}
        onValueChange={(v) => onStatus(v as PlanStatus)}
        className={cn("col-start-2 row-start-2 w-24 text-[11px] sm:col-start-3 sm:row-start-1", statusMeta.tone)}
        options={STATUSES.map((s) => ({
          value: s.key,
          label: t.plans.statusLabel[s.key],
        }))}
      />
      <Tooltip content={t.plans.deletePlan}>
        <Button
          size="icon-sm"
          variant="ghost"
          ref={deleteRef} disabled={pending}
          onClick={onDelete}
          aria-label={`${plan.title}: ${t.plans.deletePlan}`}
          className="col-start-3 row-start-1 transition-opacity sm:col-start-4 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </Button>
      </Tooltip>
    </li>
  );
}
