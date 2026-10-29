import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ user: true, authError: false, authCalls: 0, google: vi.fn(), ids: ["primary"], prefsAvailable: true, owners: [] as string[], signals: [] as AbortSignal[] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => { state.authCalls++; return { data: { user: state.user ? { id: "owner" } : null }, error: state.authError ? {} : null }; } } }) }));
vi.mock("@/lib/google-token", () => ({ createGoogleFetcher: (owner: string, signal: AbortSignal) => { state.owners.push(owner); state.signals.push(signal); return state.google; } }));
vi.mock("@/lib/user-prefs", () => ({ loadUserPreferences: async () => ({ selected_calendar_ids: state.ids, sync_available: state.prefsAvailable }) }));
import { fetchLastWeekEvents, fetchTodayWindowEvents, fetchUpcomingWeekEvents } from "@/lib/calendar-server";
import { GET as list } from "@/app/api/calendar/list/route";
import { GET as events } from "@/app/api/calendar/events/route";
import { CalendarReadError, readGooglePages } from "@/lib/calendar-google-read";
import { calendarEventPage, calendarEventsResponse } from "@/lib/calendar-response";
import { calendarDescriptionSnippet, eventDateKey, eventEnd, eventStart, eventTimeLabel } from "@/lib/calendar";
const event = (id = "event") => ({ id, summary: "Review", start: { dateTime: "2026-10-24T10:00:00+02:00" }, end: { dateTime: "2026-10-24T11:00:00+02:00" } });
const range = { start: new Date("2026-10-19T00:00:00Z"), endExclusive: new Date("2026-10-26T00:00:00Z") };
const request = (suffix = "") => new NextRequest(`https://app.example/api/calendar/events${suffix}`);
beforeEach(() => { Object.assign(state, { user: true, authError: false, authCalls: 0, ids: ["primary"], prefsAvailable: true, owners: [], signals: [] }); state.google.mockReset().mockResolvedValue(Response.json({ items: [] })); });
afterEach(() => vi.restoreAllMocks());
it("reads every event page with a minimal projection and the verified owner", async () => {
  state.google.mockImplementation(async (href: string) => new URL(href).searchParams.has("pageToken") ? Response.json({ items: [event("second")] }) : Response.json({ items: [event("first")], nextPageToken: "opaque-next-page" }));
  const result = await fetchLastWeekEvents(range, { userId: "verified-owner" });
  expect(result).toMatchObject({ ok: true, events: [{ id: "first", sourceCalendarId: "primary" }, { id: "second", sourceCalendarId: "primary" }] });
  expect(state.authCalls).toBe(0); expect(state.owners).toEqual(["verified-owner"]); expect(state.google).toHaveBeenCalledTimes(2);
  const first = new URL(state.google.mock.calls[0][0]); expect(first.searchParams.get("timeMin")).toBe(range.start.toISOString()); expect(first.searchParams.get("timeMax")).toBe(range.endExclusive.toISOString()); expect(first.searchParams.get("fields")).toContain("nextPageToken"); expect(first.searchParams.get("fields")).not.toContain("attendees");
  expect(state.google.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
});
it("does not treat an empty intermediate page as the end", async () => {
  state.google.mockResolvedValueOnce(Response.json({ nextPageToken: "next" })).mockResolvedValueOnce(Response.json({ items: [event()] })); expect(await fetchUpcomingWeekEvents()).toMatchObject({ ok: true, events: [{ id: "event" }] }); expect(state.google).toHaveBeenCalledTimes(2);
});
it.each([401, 403, 429, 500])("does not return incomplete selected-calendar totals after provider %s", async status => {
  state.ids = ["primary", "secondary"];
  state.google.mockImplementation(async (href: string) => href.includes("secondary") ? new Response("private upstream detail", { status }) : Response.json({ items: [event()] }));
  const result = await fetchUpcomingWeekEvents(); expect(result).toEqual({ ok: false, reason: status === 401 ? "unauthorized" : "error" }); expect(JSON.stringify(result)).not.toContain("private");
});
it("preserves no-token and confirmed missing-auth states", async () => {
  state.google.mockResolvedValue(new Response(null, { status: 401, statusText: "no-token" })); expect(await fetchTodayWindowEvents()).toEqual({ ok: false, reason: "no-token" });
  state.user = false; state.google.mockClear(); expect(await fetchTodayWindowEvents()).toEqual({ ok: false, reason: "no-token" }); expect(state.google).not.toHaveBeenCalled();
});
it("does not guess primary on preference/auth availability failures", async () => {
  state.prefsAvailable = false; expect(await fetchTodayWindowEvents()).toEqual({ ok: false, reason: "error" }); expect(state.google).not.toHaveBeenCalled();
  state.prefsAvailable = true; state.authError = true; expect(await fetchTodayWindowEvents()).toEqual({ ok: false, reason: "error" }); expect(state.google).not.toHaveBeenCalled();
});
it.each([{ items: [{ id: "missing-times" }] }, { items: [{ ...event(), start: { dateTime: "bad" } }] }, { items: [{ ...event(), end: { dateTime: "2026-10-24T09:00:00+02:00" } }] }, { items: [event(), event()] }, { items: "wrong" }])("refuses malformed or inconsistent event pages (%j)", async page => { state.google.mockResolvedValue(Response.json(page)); expect(await fetchUpcomingWeekEvents()).toEqual({ ok: false, reason: "error" }); });
it("drops cancelled instances, unsafe links and unrelated private fields", async () => {
  state.google.mockResolvedValue(Response.json({ items: [{ status: "cancelled", id: "cancelled" }, { ...event(), htmlLink: "javascript:alert(1)", attendees: [{ email: "private@example.test" }] }] }));
  const result = await fetchUpcomingWeekEvents(); expect(result).toEqual({ ok: true, events: [{ ...event(), htmlLink: undefined, sourceCalendarId: "primary" }] });
});
it("bounds selected-calendar concurrency and namespaces identical provider ids", async () => {
  state.ids = Array.from({ length: 20 }, (_, i) => `calendar-${i}`); let active = 0, peak = 0;
  state.google.mockImplementation(async () => { peak = Math.max(peak, ++active); await new Promise(resolve => setTimeout(resolve, 2)); active--; return Response.json({ items: [event()] }); });
  const result = await fetchUpcomingWeekEvents(); expect(result.ok).toBe(true); if (result.ok) { expect(result.events).toHaveLength(20); expect(new Set(result.events.map(value => value.sourceCalendarId)).size).toBe(20); } expect(peak).toBeLessThanOrEqual(4); expect(state.google).toHaveBeenCalledTimes(20);
});
it("detects repeated pagination tokens rather than looping", async () => {
  state.google.mockImplementation(async () => Response.json({ items: [], nextPageToken: "repeated" })); expect(await fetchUpcomingWeekEvents()).toEqual({ ok: false, reason: "error" }); expect(state.google).toHaveBeenCalledTimes(2);
});
it("rejects a row limit without presenting a truncated success", async () => {
  let page = 0; state.google.mockImplementation(async () => Response.json({ items: Array.from({ length: 250 }, (_, i) => event(`${page}-${i}`)), nextPageToken: String(++page) })); expect(await fetchUpcomingWeekEvents()).toEqual({ ok: false, reason: "error" }); expect(state.google).toHaveBeenCalledTimes(9);
});
it("bounds empty-page chains, body size and cancellation without private errors", async () => {
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events"), controller = new AbortController();
  state.google.mockImplementation(async () => Response.json({ items: [], nextPageToken: String(state.google.mock.calls.length) }));
  await expect(readGooglePages(state.google, url, value => calendarEventPage.parse(value), controller.signal, { pages: 2, items: 20, characters: 1000 })).rejects.toBeInstanceOf(CalendarReadError); expect(state.google).toHaveBeenCalledTimes(2);
  state.google.mockReset().mockResolvedValue(new Response("x".repeat(2000)));
  await expect(readGooglePages(state.google, url, value => calendarEventPage.parse(value), controller.signal, { pages: 2, items: 20, characters: 1000 })).rejects.toBeInstanceOf(CalendarReadError);
  controller.abort("private"); state.google.mockClear(); await expect(fetchUpcomingWeekEvents({ userId: "owner", signal: controller.signal })).resolves.toEqual({ ok: false, reason: "error" }); expect(state.google).not.toHaveBeenCalled();
});
it("loads a complete calendar list with pagination and private headers", async () => {
  state.google.mockResolvedValueOnce(Response.json({ items: [{ id: "primary-id", summary: "Primary", primary: true }], nextPageToken: "more" })).mockResolvedValueOnce(Response.json({ items: [{ id: "shared", summary: "Shared" }] }));
  const response = await list(request()); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(await response.json()).toMatchObject({ calendars: [{ id: "primary-id" }, { id: "shared" }] }); expect(new URL(state.google.mock.calls[0][0]).searchParams.get("fields")).toContain("nextPageToken");
});
it.each([{ items: [{ id: 42, summary: "bad" }] }, { items: [{ id: "same", summary: "A" }, { id: "same", summary: "B" }] }, { items: [{ id: "bad", summary: "Bad", backgroundColor: "url(unsafe)" }] }])("does not return malformed/duplicate calendar lists (%j)", async page => { state.google.mockResolvedValue(Response.json(page)); expect((await list(request())).status).toBe(503); });
it("distinguishes calendar-list login and availability failures", async () => {
  state.user = false; expect((await list(request())).status).toBe(401); state.user = true; state.authError = true; expect((await list(request())).status).toBe(503);
});
it("authenticates the events route only once and passes its verified identity", async () => {
  const response = await events(request("?window=week")); expect(response.status).toBe(200); expect(state.authCalls).toBe(1); expect(state.owners).toEqual(["owner"]); expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("refuses invalid windows and retains auth errors", async () => {
  expect((await events(request("?window=unknown"))).status).toBe(400); expect((await events(request("?window=last-week&start=bad&end=bad"))).status).toBe(400); expect(state.google).not.toHaveBeenCalled();
  state.user = false; expect((await events(request("?window=today"))).status).toBe(401); state.user = true; state.authError = true; expect((await events(request("?window=today"))).status).toBe(503);
});
it("rejects malformed client event envelopes and never formats invalid dates", () => {
  expect(calendarEventsResponse.safeParse({ ok: true, events: [{}] }).success).toBe(false);
  const invalid = { ...event(), start: { dateTime: "bad" }, end: { dateTime: "bad" } };
  expect(eventStart(invalid)).toBeNull(); expect(eventEnd(invalid)).toBeNull(); expect(eventTimeLabel(invalid)).toBe(""); expect(eventDateKey(invalid)).toBeNull();
});
it("uses a bounded plain-text preview for long or malformed HTML", () => {
  expect(calendarDescriptionSnippet("<p>Project <b>review</b></p>", 12)).toBe("Project revi");
  expect(calendarDescriptionSnippet("<".repeat(50_000), 80)).toBe("");
  expect(calendarDescriptionSnippet("<img onerror='unsafe'>Normal text", 6)).toBe("Normal");
});
