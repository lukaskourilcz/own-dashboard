import { z } from "zod";

const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const timeZone = z.string().min(1).max(100).refine(value => {
  if (/^[+-]/.test(value)) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
});

export const calendarEventInput = z.object({
  title: z.string().trim().min(1).max(500),
  date: z.iso.date(),
  startTime: localTime.optional(),
  endTime: localTime.optional(),
  timeZone: timeZone.optional(),
  description: z.string().max(10_000).default(""),
  allDay: z.boolean().default(false),
  recurrence: z.enum(["none", "daily", "weekly", "monthly"]).default("none"),
}).superRefine((value, context) => {
  if (!value.allDay && (!value.startTime || !value.endTime || !value.timeZone || value.endTime <= value.startTime)) {
    context.addIssue({ code: "custom", message: "Timed events require a time zone and an increasing time range." });
  }
});

export const calendarDeleteInput = z.object({ id: z.string().min(1).max(1024) });

/** Google accepts local wall time with an explicit IANA zone; end is exclusive.
 * https://developers.google.com/workspace/calendar/api/v3/reference/events
 */
export function googleCalendarEvent(input: z.output<typeof calendarEventInput>) {
  const nextDay = new Date(`${input.date}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return {
    summary: input.title,
    description: input.description,
    start: input.allDay ? { date: input.date } : { dateTime: `${input.date}T${input.startTime}:00`, timeZone: input.timeZone! },
    end: input.allDay ? { date: nextDay.toISOString().slice(0, 10) } : { dateTime: `${input.date}T${input.endTime}:00`, timeZone: input.timeZone! },
    ...(input.recurrence === "none" ? {} : { recurrence: [`RRULE:FREQ=${input.recurrence.toUpperCase()}`] }),
  };
}
