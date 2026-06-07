import { format } from "date-fns";

export type GcalEventTime = {
  dateTime?: string;
  date?: string;
  timeZone?: string;
};

export type GcalEvent = {
  id: string;
  summary?: string;
  start: GcalEventTime;
  end: GcalEventTime;
  htmlLink?: string;
  location?: string;
  recurrence?: string[];
  recurringEventId?: string;
};

export type EventsResult =
  | { ok: true; events: GcalEvent[] }
  | { ok: false; reason: "no-token" | "unauthorized" | "error"; message?: string };

export function eventStart(ev: GcalEvent): Date | null {
  if (ev.start.dateTime) return new Date(ev.start.dateTime);
  if (ev.start.date) return new Date(`${ev.start.date}T00:00:00`);
  return null;
}

export function eventEnd(ev: GcalEvent): Date | null {
  if (ev.end.dateTime) return new Date(ev.end.dateTime);
  if (ev.end.date) return new Date(`${ev.end.date}T23:59:59`);
  return null;
}

export function eventTimeLabel(ev: GcalEvent): string {
  if (ev.start.date && !ev.start.dateTime) return "all day";
  if (ev.start.dateTime) return format(new Date(ev.start.dateTime), "HH:mm");
  return "";
}

export function eventDateKey(ev: GcalEvent): string | null {
  if (ev.start.dateTime) return format(new Date(ev.start.dateTime), "yyyy-MM-dd");
  if (ev.start.date) return ev.start.date;
  return null;
}
