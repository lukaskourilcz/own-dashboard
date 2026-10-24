import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ user: true, google: vi.fn(), capture: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user ? { id: "owner" } : null } }) } }) }));
vi.mock("@/lib/google-token", () => ({ createGoogleFetcher: () => state.google }));
vi.mock("@/lib/sentry-server", () => ({ captureCalendarRejection: state.capture }));
import { POST, DELETE } from "@/app/api/calendar/event/route";
import { eventEnd, eventStart } from "@/lib/calendar";

const input = { title: "Project review", date: "2026-10-23", startTime: "09:00", endTime: "10:00", timeZone: "Europe/Prague" };
const request = (body: unknown, method = "POST", origin = "https://app.example") => new Request("https://app.example/api/calendar/event", { method, headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { state.user = true; state.capture.mockReset(); state.google.mockReset().mockResolvedValue(Response.json({ id: "event-owner", htmlLink: "https://calendar.google.com/calendar/event?eid=fixture" })); });
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
