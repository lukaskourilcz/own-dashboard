import { z } from "zod";
import { safeWebUrl } from "@/lib/web-url";

const identifier = z.string().min(1).max(1024).refine(value => !/\p{Cc}/u.test(value));
const eventTime = z.union([
  z.object({ date: z.iso.date(), dateTime: z.never().optional(), timeZone: z.string().max(100).optional() }),
  z.object({ dateTime: z.iso.datetime({ offset: true }), date: z.never().optional(), timeZone: z.string().max(100).optional() }),
]);
export const calendarEventSchema = z.object({
  id: identifier, summary: z.string().max(20_000).optional(), description: z.string().max(50_000).optional(),
  start: eventTime, end: eventTime,
  htmlLink: z.string().max(2000).transform(value => safeWebUrl(value) ?? undefined).optional(),
  location: z.string().max(20_000).optional(), recurrence: z.array(z.string().max(2000)).max(100).optional(),
  recurringEventId: identifier.optional(), sourceCalendarId: identifier.optional(),
}).refine(event => {
  if (event.start.date && event.end.date) return event.end.date > event.start.date;
  if (event.start.dateTime && event.end.dateTime) return Date.parse(event.end.dateTime) > Date.parse(event.start.dateTime);
  return false;
});
const cancelled = z.object({ status: z.literal("cancelled"), id: identifier });
export const calendarEventPage = z.object({
  items: z.array(z.union([cancelled, calendarEventSchema])).max(250).default([]),
  nextPageToken: z.string().min(1).max(4096).optional(),
});
export const calendarEntrySchema = z.object({
  id: identifier, summary: z.string().max(20_000), primary: z.boolean().optional(),
  backgroundColor: z.string().regex(/^#[a-f\d]{6}$/i).optional(),
  accessRole: z.enum(["freeBusyReader", "reader", "writer", "owner", "writerWithoutPrivateAccess"]).optional(),
  selected: z.boolean().optional(),
});
export type GcalCalendarEntry = z.infer<typeof calendarEntrySchema>;
export const calendarListPage = z.object({ items: z.array(calendarEntrySchema).max(250).default([]), nextPageToken: z.string().min(1).max(4096).optional() });
export const calendarListResponse = z.object({ calendars: z.array(calendarEntrySchema).max(500) });
export const calendarEventsResponse = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), events: z.array(calendarEventSchema).max(2000) }),
  z.object({ ok: z.literal(false), reason: z.enum(["no-token", "unauthorized", "error"]) }),
]);
