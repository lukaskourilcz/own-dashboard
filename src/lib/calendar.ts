import { format } from "date-fns";

type GcalEventTime = {
  dateTime?: string;
  date?: string;
  timeZone?: string;
};

export type GcalEvent = {
  id: string;
  summary?: string;
  description?: string;
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

/** The longest window a last-week read may ask for: seven days plus a DST hour, with margin. */
const LAST_WEEK_MAX_MS = 8 * 24 * 60 * 60 * 1000;

/**
 * The browser's last week as two instants, or null when they are not a
 * plausible week. The weekly planning flow computes Monday 00:00 to the next
 * Monday 00:00 in the owner's own timezone and sends both instants; the server
 * never works the week out itself, because its clock (UTC on Vercel) would
 * fetch a window offset from the one the flow sums.
 */
export function parseLastWeekWindow(
  start: string | null,
  end: string | null,
): { start: Date; endExclusive: Date } | null {
  if (!start || !end) return null;
  const from = new Date(start);
  const to = new Date(end);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  const span = to.getTime() - from.getTime();
  if (span <= 0 || span > LAST_WEEK_MAX_MS) return null;
  return { start: from, endExclusive: to };
}
