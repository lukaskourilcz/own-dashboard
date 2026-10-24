"use client";

import { useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/queries/keys";
import { CalendarPlus, CheckCircle2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RelinkGoogleButton } from "@/components/calendar/relink-cta";
import { todayKey } from "@/lib/date-keys";
import { useDict } from "@/lib/i18n";
import { awaitWithSignal } from "@/lib/abortable";
import { readTextPrefix } from "@/lib/bounded-text";
import { safeWebUrl } from "@/lib/web-url";
import { useUnsavedDraft } from "@/components/navigation-guard";

type Recurrence = "none" | "daily" | "weekly" | "monthly";

type FormState = {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  description: string;
  allDay: boolean;
  recurrence: Recurrence;
};

const empty: FormState = {
  title: "",
  date: "",
  startTime: "09:00",
  endTime: "10:00",
  description: "",
  allDay: false,
  recurrence: "none",
};

type Submission =
  | { kind: "ok"; link?: string }
  | { kind: "expired" }
  | { kind: "error"; message: string };

export function CalendarPanel({
  compact = false,
  initialTitle,
}: {
  compact?: boolean;
  initialTitle?: string;
}) {
  const t = useDict();
  const id = useId();
  const [open, setOpen] = useState(false);
  const pending = useRef(false);
  const qc = useQueryClient();
  const [defaultDate, setDefaultDate] = useState(todayKey);
  const [form, setForm] = useState<FormState>(() =>
    ({ ...empty, date: defaultDate, ...(initialTitle ? { title: initialTitle } : {}) }),
  );
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Submission | null>(null);
  const [baseline, setBaseline] = useState(() => JSON.stringify(form));
  useUnsavedDraft({ dirty: submitting || JSON.stringify(form) !== baseline, canSave: !submitting && !!form.title.trim() && !!form.date && (form.allDay || (!!form.startTime && form.endTime > form.startTime)), save: saveEvent });

  async function saveEvent(): Promise<boolean> {
    if (pending.current) return false;
    setResult(null);
    if (!form.title.trim() || !form.date) {
      setResult({ kind: "error", message: t.calendar.titleAndDateRequired });
      return false;
    }
    if (!form.allDay && (!form.startTime || !form.endTime)) {
      setResult({ kind: "error", message: t.calendar.startAndEndRequired });
      return false;
    }
    if (!form.allDay && form.endTime <= form.startTime) {
      setResult({ kind: "error", message: t.calendar.endAfterStart });
      return false;
    }
    pending.current = true;
    setSubmitting(true);
    try {
      const signal = AbortSignal.timeout(25_000);
      const res = await awaitWithSignal(fetch("/api/calendar/event", {
        method: "POST",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          date: form.date,
          startTime: form.allDay ? undefined : form.startTime,
          endTime: form.allDay ? undefined : form.endTime,
          description: form.description.trim(),
          allDay: form.allDay,
          recurrence: form.recurrence,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      }), signal);
      const prefix = await awaitWithSignal(readTextPrefix(res, 65_536, signal), signal);
      if (prefix.truncated) throw Error("Unconfirmed calendar result");
      const json = JSON.parse(prefix.text);
      if (res.status === 401 && json.reason) {
        setResult({ kind: "expired" });
        return false;
      }
      if (!res.ok) {
        setResult({
          kind: "error",
          message: json.reason === "unconfirmed" ? t.calendar.resultUnconfirmed : json.error === t.guest.readOnlyAction ? json.error : t.calendar.couldNotCreateEvent,
        });
        return false;
      }
      if (typeof json.id !== "string" || !json.id || json.id.length > 1024 || /\p{Cc}/u.test(json.id)) {
        setResult({ kind: "error", message: t.calendar.resultUnconfirmed });
        return false;
      }
      setResult({ kind: "ok", link: safeWebUrl(json.htmlLink) ?? undefined });
      const next = { ...empty, date: form.date };
      setBaseline(JSON.stringify(next));
      setForm(next);
      return true;
    } catch {
      setResult({ kind: "error", message: t.calendar.resultUnconfirmed });
      return false;
    } finally {
      pending.current = false;
      setSubmitting(false);
      for (const queryKey of [qk.calendarToday, qk.calendarWeek, qk.calendarLastWeek]) void qc.invalidateQueries({ queryKey });
    }
  }

  return (
    <Dialog open={open} onOpenChange={next => {
      if (pending.current) return;
      setOpen(next);
      if (!next) return;
      const date = todayKey();
      if (JSON.stringify(form) === baseline && form.date === defaultDate) setBaseline(JSON.stringify({ ...form, date }));
      setForm(previous => ({ ...previous, date: previous.date === defaultDate ? date : previous.date }));
      setDefaultDate(date);
    }}><DialogTrigger asChild><Button variant="outline"><CalendarPlus />{t.calendar.newEvent}</Button></DialogTrigger><DialogContent aria-describedby={undefined} showClose={!submitting} onEscapeKeyDown={event => { if (pending.current) event.preventDefault(); }} onPointerDownOutside={event => { if (pending.current) event.preventDefault(); }}><DialogHeader>
        <DialogTitle className="inline-flex items-center gap-1.5">
          <CalendarPlus className="h-3 w-3" /> {t.calendar.newEvent}
        </DialogTitle>
      </DialogHeader>
        <form onSubmit={event => { event.preventDefault(); void saveEvent(); }} className="space-y-3">
          <fieldset disabled={submitting} className="min-w-0 space-y-3 border-0 p-0" aria-busy={submitting}>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-title`}>{t.calendar.title}</Label>
            <Input
              id={`${id}-title`}
              maxLength={500}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={t.calendar.titlePlaceholder}
            />
          </div>
          <div
            className={
              "grid gap-2 " +
              (form.allDay ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-3")
            }
          >
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-date`}>{t.calendar.date}</Label>
              <Input
                id={`${id}-date`}
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>
            {!form.allDay && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-start`}>{t.calendar.start}</Label>
                  <Input
                    id={`${id}-start`}
                    type="time"
                    value={form.startTime}
                    onChange={(e) =>
                      setForm({ ...form, startTime: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-end`}>{t.calendar.end}</Label>
                  <Input
                    id={`${id}-end`}
                    type="time"
                    value={form.endTime}
                    onChange={(e) =>
                      setForm({ ...form, endTime: e.target.value })
                    }
                  />
                </div>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-4 items-end">
            <label className="inline-flex min-h-11 md:min-h-8 items-center gap-2 text-xs text-foreground-muted">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-border-strong"
                checked={form.allDay}
                onChange={(e) =>
                  setForm({ ...form, allDay: e.target.checked })
                }
              />
              {t.calendar.allDay}
            </label>
            <div className="space-y-1">
              <SimpleSelect
                value={form.recurrence}
                aria-label={t.calendar.repeats}
                onValueChange={(v) =>
                  setForm({
                    ...form,
                    recurrence: v as Recurrence,
                  })
                }
                className="h-11 md:h-7 w-32 text-xs"
                options={[
                  { value: "none", label: t.calendar.recurrence.none },
                  { value: "daily", label: t.calendar.recurrence.daily },
                  { value: "weekly", label: t.calendar.recurrence.weekly },
                  { value: "monthly", label: t.calendar.recurrence.monthly },
                ]}
              />
            </div>
          </div>
          {!compact && (
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-desc`}>{t.calendar.description}</Label>
              <Textarea
                id={`${id}-desc`}
                maxLength={10_000}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder={t.calendar.descriptionPlaceholder}
                rows={2}
              />
            </div>
          )}
          {result?.kind === "error" && (
            <p role="alert" className="text-xs text-destructive">{result.message}</p>
          )}
          {result?.kind === "expired" && (
            <div className="space-y-2 rounded-md border border-warning/30 bg-warning/5 p-3">
              <p className="text-xs text-foreground-muted">
                {t.calendar.tokenRejected}
              </p>
              <RelinkGoogleButton reason="expired" />
            </div>
          )}
          {result?.kind === "ok" && (
            <p className="text-xs text-success inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t.calendar.eventAdded}
              {result.link && (
                <a
                  href={result.link}
                  target="_blank"
                  rel="noreferrer"
                  className="underline inline-flex items-center gap-0.5"
                >
                  {t.calendar.open} <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </p>
          )}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? t.calendar.adding : t.calendar.addToGoogleCalendar}
          </Button>
          </fieldset>
        </form>
    </DialogContent></Dialog>
  );
}
