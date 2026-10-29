import { NextResponse } from "next/server";
import { captureCalendarRejection } from "@/lib/sentry-server";
import { createClient } from "@/lib/supabase/server";
import { createGoogleFetcher } from "@/lib/google-token";
import { rejectCrossOrigin } from "@/lib/csrf";
import { calendarDeleteInput, calendarEventInput, googleCalendarEvent } from "@/lib/calendar-event";
import { awaitWithSignal } from "@/lib/abortable";
import { readTextPrefix } from "@/lib/bounded-text";
import { safeWebUrl } from "@/lib/web-url";

export const maxDuration = 30;
const headers = { "cache-control": "private, no-store" };
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers });
const unconfirmed = () => reply({ error: "Calendar result was not confirmed.", reason: "unconfirmed" }, 502);

async function write(request: Request, method: "POST" | "DELETE") {
  const rejected = rejectCrossOrigin(request);
  if (rejected) { rejected.headers.set("cache-control", "private, no-store"); return rejected; }
  const expectedOwner = request.headers.get("x-calendar-owner");
  if (expectedOwner !== null && (!expectedOwner || expectedOwner.length > 128 || expectedOwner !== expectedOwner.trim())) return reply({ error: "Invalid captured account." }, 400);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]);
  try {
    const supabase = await awaitWithSignal(createClient(signal), signal);
    const auth = await awaitWithSignal(supabase.auth.getUser(), signal);
    if (auth.error) return reply({ error: "Authentication unavailable." }, 503);
    if (!auth.data.user) return reply({ error: "Not authenticated." }, 401);
    if (expectedOwner !== null && expectedOwner !== auth.data.user.id) return reply({ error: "Captured account changed." }, 409);
    // Legacy callers retain their receipt shape. Captured callers additionally
    // confirm the same verified account before accepting a provider result.
    const confirmed = (body: object) => reply({ ...body, ...(expectedOwner !== null ? { ownerId: auth.data.user.id } : {}) });
    const prefix = await awaitWithSignal(readTextPrefix(new Response(request.body), 65_536, signal), signal);
    if (prefix.truncated) return reply({ error: "Calendar request too large." }, 413);
    let body: unknown;
    try { body = JSON.parse(prefix.text); } catch { return reply({ error: "Invalid calendar request." }, 400); }
    const fetcher = createGoogleFetcher(auth.data.user.id, signal);
    let url = "https://www.googleapis.com/calendar/v3/calendars/primary/events", payload: string | undefined;
    if (method === "POST") {
      const parsed = calendarEventInput.safeParse(body);
      if (!parsed.success) return reply({ error: "Invalid calendar event." }, 400);
      payload = JSON.stringify(googleCalendarEvent(parsed.data));
    } else {
      const parsed = calendarDeleteInput.safeParse(body);
      if (!parsed.success) return reply({ error: "Invalid event id." }, 400);
      url += `/${encodeURIComponent(parsed.data.id)}?sendUpdates=none`;
    }
    // Never retry an ambiguous write. The owner must inspect Google Calendar
    // before sending another creation when its result cannot be confirmed.
    const res = await awaitWithSignal(fetcher(url, { method, signal, ...(payload ? { headers: { "Content-Type": "application/json" }, body: payload } : {}) }), signal);
    if (method === "DELETE" && (res.status === 404 || res.status === 410 || res.ok)) {
      if (res.body) void res.body.cancel().catch(() => undefined);
      return confirmed({ ok: true });
    }
    if (!res.ok) {
      if (res.body) void res.body.cancel().catch(() => undefined);
      if (res.status === 401) return reply({ error: "Google Calendar access has lapsed.", reason: res.statusText === "no-token" ? "no-token" : "expired" }, 401);
      // Fixed method/status only: upstream bodies can echo private event text.
      await awaitWithSignal(captureCalendarRejection(method, res.status), signal);
      return reply({ error: "Google Calendar rejected the request.", ...(res.status >= 500 ? { reason: "unconfirmed" } : {}) }, res.status);
    }
    const created = await awaitWithSignal(readTextPrefix(res, 65_536, signal), signal);
    if (created.truncated) return unconfirmed();
    const receipt = JSON.parse(created.text);
    if (typeof receipt?.id !== "string" || !receipt.id || receipt.id.length > 1024 || /\p{Cc}/u.test(receipt.id)) return unconfirmed();
    return confirmed({ id: receipt.id, htmlLink: safeWebUrl(receipt.htmlLink) ?? undefined });
  } catch { return unconfirmed(); }
}

export function POST(request: Request) { return write(request, "POST"); }
/** Already absent events (404/410) remain a confirmed, idempotent cleanup. */
export function DELETE(request: Request) { return write(request, "DELETE"); }
