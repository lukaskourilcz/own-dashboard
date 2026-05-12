"use client";

import { useState } from "react";
import { format } from "date-fns";
import { CalendarPlus, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RelinkGoogleButton } from "@/components/calendar/relink-cta";

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

const todayStr = () => format(new Date(), "yyyy-MM-dd");

const empty: FormState = {
  title: "",
  date: todayStr(),
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
  const [form, setForm] = useState<FormState>(() =>
    initialTitle ? { ...empty, title: initialTitle } : empty,
  );
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Submission | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    if (!form.title.trim() || !form.date) {
      setResult({ kind: "error", message: "Title and date are required." });
      return;
    }
    if (!form.allDay && (!form.startTime || !form.endTime)) {
      setResult({ kind: "error", message: "Start and end time are required." });
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
          message: json.error ?? "Could not create event.",
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
        <CardTitle>
          <span className="inline-flex items-center gap-1.5">
            <CalendarPlus className="h-4 w-4" />
            New calendar event
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="cal-title">Title</Label>
            <Input
              id="cal-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Dentist appointment"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div
              className={
                "space-y-1 col-span-3 " +
                (form.allDay ? "sm:col-span-3" : "sm:col-span-1")
              }
            >
              <Label htmlFor="cal-date">Date</Label>
              <Input
                id="cal-date"
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>
            {!form.allDay && (
              <>
                <div className="space-y-1 col-span-3 sm:col-span-1">
                  <Label htmlFor="cal-start">Start</Label>
                  <Input
                    id="cal-start"
                    type="time"
                    value={form.startTime}
                    onChange={(e) =>
                      setForm({ ...form, startTime: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1 col-span-3 sm:col-span-1">
                  <Label htmlFor="cal-end">End</Label>
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
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-zinc-300"
                checked={form.allDay}
                onChange={(e) =>
                  setForm({ ...form, allDay: e.target.checked })
                }
              />
              All day
            </label>
            <div className="space-y-1">
              <Label htmlFor="cal-recurrence" className="text-xs">
                Repeats
              </Label>
              <Select
                id="cal-recurrence"
                value={form.recurrence}
                onChange={(e) =>
                  setForm({
                    ...form,
                    recurrence: e.target.value as Recurrence,
                  })
                }
                className="h-8 w-32"
              >
                <option value="none">Doesn&apos;t repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </Select>
            </div>
          </div>
          {!compact && (
            <div className="space-y-1">
              <Label htmlFor="cal-desc">Description</Label>
              <Textarea
                id="cal-desc"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="Optional notes"
              />
            </div>
          )}
          {result?.kind === "error" && (
            <p className="text-sm text-red-600">{result.message}</p>
          )}
          {result?.kind === "expired" && (
            <div className="space-y-2 rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/40 p-3">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                Google rejected the calendar token. Re-link to refresh access.
              </p>
              <RelinkGoogleButton reason="expired" />
            </div>
          )}
          {result?.kind === "ok" && (
            <p className="text-sm text-emerald-600 inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" />
              Event added to your Google Calendar.
              {result.link && (
                <a
                  href={result.link}
                  target="_blank"
                  rel="noreferrer"
                  className="underline ml-1"
                >
                  Open
                </a>
              )}
            </p>
          )}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Adding…" : "Add to Google Calendar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
