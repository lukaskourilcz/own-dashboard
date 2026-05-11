"use client";

import { useState } from "react";
import { format } from "date-fns";
import { CalendarPlus, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type FormState = {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  description: string;
};

const todayStr = () => format(new Date(), "yyyy-MM-dd");

const empty: FormState = {
  title: "",
  date: todayStr(),
  startTime: "09:00",
  endTime: "10:00",
  description: "",
};

export function CalendarPanel({ compact = false }: { compact?: boolean }) {
  const [form, setForm] = useState<FormState>(empty);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ link?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!form.title.trim() || !form.date || !form.startTime || !form.endTime) {
      setError("Title, date, and time are required.");
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
          startTime: form.startTime,
          endTime: form.endTime,
          description: form.description.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not create event.");
      } else {
        setSuccess({ link: json.htmlLink });
        setForm({ ...empty, date: form.date });
      }
    } catch (err) {
      setError((err as Error).message);
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
            <div className="space-y-1 col-span-3 sm:col-span-1">
              <Label htmlFor="cal-date">Date</Label>
              <Input
                id="cal-date"
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>
            <div className="space-y-1 col-span-3 sm:col-span-1">
              <Label htmlFor="cal-start">Start</Label>
              <Input
                id="cal-start"
                type="time"
                value={form.startTime}
                onChange={(e) => setForm({ ...form, startTime: e.target.value })}
              />
            </div>
            <div className="space-y-1 col-span-3 sm:col-span-1">
              <Label htmlFor="cal-end">End</Label>
              <Input
                id="cal-end"
                type="time"
                value={form.endTime}
                onChange={(e) => setForm({ ...form, endTime: e.target.value })}
              />
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
          {error && <p className="text-sm text-red-600">{error}</p>}
          {success && (
            <p className="text-sm text-emerald-600 inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" />
              Event added to your Google Calendar.
              {success.link && (
                <a
                  href={success.link}
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
