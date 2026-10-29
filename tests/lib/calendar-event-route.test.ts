import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ user: true, authError: false, google: vi.fn(), capture: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user ? { id: "owner" } : null }, error: state.authError ? Error("Synthetic auth failure") : null }) } }) }));
vi.mock("@/lib/google-token", () => ({ createGoogleFetcher: () => state.google }));
vi.mock("@/lib/sentry-server", () => ({ captureCalendarRejection: state.capture }));
import { POST, DELETE } from "@/app/api/calendar/event/route";
import { eventEnd, eventStart } from "@/lib/calendar";

const input = { title: "Project review", date: "2026-10-23", startTime: "09:00", endTime: "10:00", timeZone: "Europe/Prague" };
const request = (body: unknown, method = "POST", origin = "https://app.example") => new Request("https://app.example/api/calendar/event", { method, headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { state.user = true; state.authError = false; state.capture.mockReset(); state.google.mockReset().mockResolvedValue(Response.json({ id: "event-owner", htmlLink: "https://calendar.google.com/calendar/event?eid=fixture" })); });
afterEach(() => vi.unstubAllEnvs());

describe("calendar event write boundary", () => {
  it.each(["Europe/Prague", "America/Los_Angeles"])("preserves the requested wall time in %s on a UTC server", async zone => {
    vi.stubEnv("TZ", "UTC");
    expect((await POST(request({ ...input, timeZone: zone }))).status).toBe(200);
    const payload = JSON.parse(state.google.mock.calls[0][1].body);
    expect(payload.start).toEqual({ dateTime: "2026-10-23T09:00:00", timeZone: zone });
    expect(payload.end).toEqual({ dateTime: "2026-10-23T10:00:00", timeZone: zone });
  });
  it("keeps all-day end dates exclusive across month and leap-year boundaries", async () => {
    expect((await POST(request({ title: "Release", date: "2028-02-29", allDay: true, recurrence: "yearly" }))).status).toBe(400);
    expect((await POST(request({ title: "Release", date: "2028-02-29", allDay: true }))).status).toBe(200);
    expect(JSON.parse(state.google.mock.calls[0][1].body)).toMatchObject({ start: { date: "2028-02-29" }, end: { date: "2028-03-01" } });
  });
  it.each([
    null, [], { ...input, title: {} }, { ...input, date: "2026-02-30" },
    { ...input, startTime: "25:00" }, { ...input, endTime: "08:00" }, { ...input, endTime: "09:00" },
    { ...input, timeZone: undefined }, { ...input, timeZone: "not-a-zone" }, { ...input, timeZone: "+02:00" },
    { ...input, allDay: "true" }, { ...input, recurrence: "arbitrary" }, { ...input, title: "x".repeat(501) },
  ])("rejects malformed values before contacting Google (%j)", async body => {
    expect((await POST(request(body))).status).toBe(400);
    expect(state.google).not.toHaveBeenCalled();
  });
  it("retains authentication and same-origin protection", async () => {
    expect((await POST(request(input, "POST", "https://foreign.example"))).status).toBe(403);
    state.user = false;
    expect((await POST(request(input))).status).toBe(401);
    expect(state.google).not.toHaveBeenCalled();
  });
  it("reports an ambiguous network result without resending or exposing the cause", async () => {
    state.google.mockRejectedValue(new Error("private upstream detail"));
    const response = await POST(request(input));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ reason: "unconfirmed" });
    expect(state.google).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(state.capture.mock.calls)).not.toContain("private upstream detail");
  });
  it("keeps upstream response bodies out of telemetry", async () => {
    state.google.mockResolvedValue(new Response("private event title", { status: 500 }));
    const response = await POST(request(input));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ reason: "unconfirmed" });
    expect(state.capture).toHaveBeenCalledWith("POST", 500);
  });
  it("does not report success without a confirmed event id", async () => {
    state.google.mockResolvedValue(Response.json({}));
    expect((await POST(request(input))).status).toBe(502);
  });
  it("bounds input before sending and preserves private headers", async () => {
    const response = await POST(request({ ...input, description: "x".repeat(70_000) }));
    expect(response.status).toBe(413); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(state.google).not.toHaveBeenCalled();
  });
  it("rejects oversized/malformed receipts without exposing provider text", async () => {
    state.google.mockResolvedValue(new Response("private".repeat(12_000)));
    const response = await POST(request(input)); expect(response.status).toBe(502); expect(await response.json()).toMatchObject({ reason: "unconfirmed" }); expect(state.google).toHaveBeenCalledOnce();
  });
  it("omits an unsafe created-event link", async () => {
    state.google.mockResolvedValue(Response.json({ id: "created", htmlLink: "javascript:alert(1)" }));
    expect(await (await POST(request(input))).json()).toEqual({ id: "created" });
  });
  it("bounds a stalled provider response body and never resends an ambiguous creation", async () => {
    const stop = new AbortController(); vi.spyOn(AbortSignal, "timeout").mockReturnValue(stop.signal);
    const cancel = vi.fn(); state.google.mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const pending = POST(request(input)); await vi.waitFor(() => expect(state.google).toHaveBeenCalledOnce()); stop.abort("private");
    const response = await pending; expect(response.status).toBe(502); expect(await response.json()).toMatchObject({ reason: "unconfirmed" }); expect(state.google).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });
  it.each([404, 410])("keeps delete idempotent for an already missing event (%s)", async status => {
    state.google.mockResolvedValue(new Response(null, { status }));
    expect((await DELETE(request({ id: "event-owner" }, "DELETE"))).status).toBe(200);
  });
  it("rejects non-string delete ids before a provider call", async () => {
    expect((await DELETE(request({ id: {} }, "DELETE"))).status).toBe(400);
    expect(state.google).not.toHaveBeenCalled();
  });
  it("reads all-day ends at the exclusive midnight, including a DST day", () => {
    vi.stubEnv("TZ", "Europe/Prague");
    const event = { id: "day", start: { date: "2026-03-29" }, end: { date: "2026-03-30" } };
    expect(eventEnd(event)!.getHours()).toBe(0);
    expect(eventEnd(event)!.getDate()).toBe(30);
    expect(eventEnd(event)!.getTime() - eventStart(event)!.getTime()).toBe(23 * 60 * 60 * 1000);
  });
});

function capturedRequest(body: unknown, owner = 'owner', method = 'POST') { const req = request(body, method); req.headers.set('x-calendar-owner', owner); return req; }
it.each(['POST', 'DELETE'])('refuses a changed captured owner before any %s provider request', async method => {
 const req = capturedRequest(method === 'POST' ? input : { id: 'event-owner' }, 'other-owner', method);
 const response = await (method === 'POST' ? POST(req) : DELETE(req)); expect(response.status).toBe(409); expect(state.google).not.toHaveBeenCalled();
});
it('echoes only the verified captured owner with successful creation/cleanup', async () => {
 const created = await POST(capturedRequest(input)); expect(await created.json()).toMatchObject({ id: 'event-owner', ownerId: 'owner' });
 state.google.mockResolvedValue(new Response(null, { status: 404 })); expect(await (await DELETE(capturedRequest({ id: 'event-owner' }, 'owner', 'DELETE'))).json()).toEqual({ ok: true, ownerId: 'owner' });
});
it('rejects a malformed captured header and cached auth errors without provider work', async () => {
 expect((await POST(capturedRequest(input, 'x'.repeat(129)))).status).toBe(400); expect(state.google).not.toHaveBeenCalled();
 state.authError = true; expect((await POST(capturedRequest(input))).status).toBe(503); expect(state.google).not.toHaveBeenCalled();
});
