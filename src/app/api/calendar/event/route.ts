import { NextResponse } from "next/server";
import { captureCalendarRejection } from "@/lib/sentry-server";
import { createClient } from "@/lib/supabase/server";
import { fetchWithGoogleAuth } from "@/lib/google-token";
import { rejectCrossOrigin } from "@/lib/csrf";
import { calendarDeleteInput, calendarEventInput, googleCalendarEvent } from "@/lib/calendar-event";

export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request);
  if (csrf) return csrf;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const parsed = calendarEventInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid calendar event." }, { status: 400 });
  const event = googleCalendarEvent(parsed.data);

  const res = await fetchWithGoogleAuth(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    },
  ).catch(() => null);
  if (!res) return NextResponse.json({ error: "Calendar result was not confirmed.", reason: "unconfirmed" }, { status: 502 });

  if (res.status === 401 && res.statusText === "no-token") {
    return NextResponse.json(
      { error: "Google Calendar access has lapsed.", reason: "no-token" },
      { status: 401 },
    );
  }
  if (res.status === 401) {
    return NextResponse.json(
      { error: "Google rejected the calendar token.", reason: "expired" },
      { status: 401 },
    );
  }

  if (!res.ok) {
    // Keep upstream bodies out of telemetry: they can echo private event text.
    await captureCalendarRejection("POST", res.status);
    return NextResponse.json(
      { error: "Google Calendar API rejected the event.", ...(res.status >= 500 ? { reason: "unconfirmed" } : {}) },
      { status: res.status },
    );
  }

  const created = await res.json().catch(() => null);
  if (!created || typeof created.id !== "string" || !created.id) {
    return NextResponse.json({ error: "Calendar result was not confirmed.", reason: "unconfirmed" }, { status: 502 });
  }
  return NextResponse.json({ id: created.id, htmlLink: typeof created.htmlLink === "string" ? created.htmlLink : undefined });
}

/**
 * Delete an event from the user's primary calendar. Body: { id: string }.
 * Used to keep linked_calendar_event_id in sync when a plan is deleted.
 */
export async function DELETE(request: Request) {
  const csrf = rejectCrossOrigin(request);
  if (csrf) return csrf;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const parsed = calendarDeleteInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid event id." }, { status: 400 });

  const res = await fetchWithGoogleAuth(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(parsed.data.id)}?sendUpdates=none`,
    { method: "DELETE", signal: AbortSignal.timeout(15_000) },
  ).catch(() => null);
  if (!res) return NextResponse.json({ error: "Calendar result was not confirmed.", reason: "unconfirmed" }, { status: 502 });

  // 404 / 410 — event already gone. Treat as success so plan deletion proceeds.
  if (res.status === 404 || res.status === 410 || res.ok) {
    return NextResponse.json({ ok: true });
  }

  if (res.status === 401 && res.statusText === "no-token") {
    return NextResponse.json(
      { error: "Google Calendar access has lapsed.", reason: "no-token" },
      { status: 401 },
    );
  }
  if (res.status === 401) {
    return NextResponse.json(
      { error: "Google rejected the calendar token.", reason: "expired" },
      { status: 401 },
    );
  }

  await captureCalendarRejection("DELETE", res.status);
  return NextResponse.json(
    { error: "Could not delete event." },
    { status: res.status },
  );
}
