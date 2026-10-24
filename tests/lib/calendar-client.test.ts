import { afterEach, expect, it, vi } from "vitest";
import { fetchCalendarEvents, fetchCalendarList } from "@/lib/calendar-client";
const signal = () => new AbortController().signal;
afterEach(() => vi.unstubAllGlobals());
it.each([{ calendars: [{ id: "duplicate", summary: "A" }, { id: "duplicate", summary: "B" }] }, { calendars: [{ id: "a", summary: "A", primary: true }, { id: "b", summary: "B", primary: true }] }, { calendars: [{}] }, {}])("refuses malformed successful calendar lists (%j)", async body => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body))); await expect(fetchCalendarList({ signal: signal() })).rejects.toThrow();
});
it("requires a complete typed event envelope", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ ok: true })).mockResolvedValueOnce(Response.json({ ok: false, reason: "error", message: "private" })); vi.stubGlobal("fetch", fetcher);
  await expect(fetchCalendarEvents(new URLSearchParams({ window: "week" }))).rejects.toThrow();
  expect(await fetchCalendarEvents(new URLSearchParams({ window: "week" }))).toEqual({ ok: false, reason: "error" });
  expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: "no-store", signal: expect.any(AbortSignal) });
});
it("cancels a stalled body when the query stops", async () => {
  const cancel = vi.fn(), stop = new AbortController();
  const response = new Response(new ReadableStream({ cancel }));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  const pending = fetchCalendarList({ signal: stop.signal }); const failed = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(response.body!.locked).toBe(true)); stop.abort("private"); await failed; expect(cancel).toHaveBeenCalledOnce();
});
