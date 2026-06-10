"use client";

import { useState } from "react";
import { CalendarPlus, CheckCircle2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RelinkGoogleButton } from "@/components/calendar/relink-cta";
import { todayKey } from "@/lib/date-keys";
import { useDict } from "@/lib/i18n";

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
  date: todayKey(),
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
  const [form, setForm] = useState<FormState>(() =>
    initialTitle ? { ...empty, title: initialTitle } : empty,
  );
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Submission | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    if (!form.title.trim() || !form.date) {
      setResult({ kind: "error", message: t.calendar.titleAndDateRequired });
      return;
    }
    if (!form.allDay && (!form.startTime || !form.endTime)) {
      setResult({ kind: "error", message: t.calendar.startAndEndRequired });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/calendar/event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          date: form.date,
          startTime: form.allDay ? undefined : form.startTime,
          endTime: form.allDay ? undefined : form.endTime,
          description: form.description.trim(),
          allDay: form.allDay,
          recurrence: form.recurrence,
        }),
      });
      const json = await res.json();
      if (res.status === 401 && json.reason) {
        setResult({ kind: "expired" });
        return;
      }
      if (!res.ok) {
        setResult({
          kind: "error",
          message: json.error ?? t.calendar.couldNotCreateEvent,
        });
        return;
      }
      setResult({ kind: "ok", link: json.htmlLink });
      setForm({ ...empty, date: form.date });
    } catch (err) {
      setResult({ kind: "error", message: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="inline-flex items-center gap-1.5">
          <CalendarPlus className="h-3 w-3" /> {t.calendar.newEvent}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cal-title">{t.calendar.title}</Label>
            <Input
              id="cal-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={t.calendar.titlePlaceholder}
            />
          </div>
          <div
            className={
              "grid gap-2 " + (form.allDay ? "grid-cols-1" : "grid-cols-3")
            }
          >
            <div className="space-y-1.5">
              <Label htmlFor="cal-date">{t.calendar.date}</Label>
              <Input
                id="cal-date"
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>
            {!form.allDay && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="cal-start">{t.calendar.start}</Label>
                  <Input
                    id="cal-start"
                    type="time"
                    value={form.startTime}
                    onChange={(e) =>
                      setForm({ ...form, startTime: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cal-end">{t.calendar.end}</Label>
                  <Input
                    id="cal-end"
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
            <label className="inline-flex items-center gap-2 text-xs text-foreground-muted">
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
              <Select
                value={form.recurrence}
                onChange={(e) =>
                  setForm({
                    ...form,
                    recurrence: e.target.value as Recurrence,
                  })
                }
                className="h-7 w-32 text-xs"
              >
                <option value="none">{t.calendar.recurrence.none}</option>
                <option value="daily">{t.calendar.recurrence.daily}</option>
                <option value="weekly">{t.calendar.recurrence.weekly}</option>
                <option value="monthly">{t.calendar.recurrence.monthly}</option>
              </Select>
            </div>
          </div>
          {!compact && (
            <div className="space-y-1.5">
              <Label htmlFor="cal-desc">{t.calendar.description}</Label>
              <Textarea
                id="cal-desc"
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
            <p className="text-xs text-destructive">{result.message}</p>
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
        </form>
      </CardContent>
    </Card>
  );
}
