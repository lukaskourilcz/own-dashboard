import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Recurrence = "none" | "daily" | "weekly" | "monthly";

type Payload = {
  title?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  description?: string;
  allDay?: boolean;
  recurrence?: Recurrence;
};

type GcalTime = { dateTime: string; timeZone: string } | { date: string };

type GcalPayload = {
  summary: string;
  description: string;
  start: GcalTime;
  end: GcalTime;
  recurrence?: string[];
};

function rrule(rec: Recurrence): string[] | undefined {
  if (rec === "daily") return ["RRULE:FREQ=DAILY"];
  if (rec === "weekly") return ["RRULE:FREQ=WEEKLY"];
  if (rec === "monthly") return ["RRULE:FREQ=MONTHLY"];
  return undefined;
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const accessToken = session.provider_token;
  if (!accessToken) {
    return NextResponse.json(
      {
        error: "Google Calendar access has lapsed.",
        reason: "no-token",
      },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Payload;
  const { title, date, startTime, endTime, description, allDay, recurrence } = body;

  if (!title || !date) {
    return NextResponse.json(
      { error: "title and date are required." },
      { status: 400 },
    );
  }

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  let event: GcalPayload;

  if (allDay) {
    // Google expects an exclusive end date for all-day events.
    event = {
      summary: title,
      description: description ?? "",
      start: { date },
      end: { date: addDays(date, 1) },
    };
  } else {
    if (!startTime || !endTime) {
      return NextResponse.json(
        { error: "startTime and endTime are required for timed events." },
        { status: 400 },
      );
    }
    const start = new Date(`${date}T${startTime}:00`);
    const end = new Date(`${date}T${endTime}:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return NextResponse.json({ error: "Invalid date/time." }, { status: 400 });
    }
    if (end <= start) {
      return NextResponse.json(
        { error: "End time must be after start time." },
        { status: 400 },
      );
    }
    event = {
      summary: title,
      description: description ?? "",
      start: { dateTime: `${date}T${startTime}:00`, timeZone },
      end: { dateTime: `${date}T${endTime}:00`, timeZone },
    };
  }

  const rule = rrule((recurrence ?? "none") as Recurrence);
  if (rule) event.recurrence = rule;

  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    },
  );

  if (res.status === 401) {
    return NextResponse.json(
      { error: "Google rejected the calendar token.", reason: "expired" },
      { status: 401 },
    );
  }

  if (!res.ok) {
    const errText = await res.text();
    return NextResponse.json(
      {
        error: "Google Calendar API rejected the event.",
        details: errText,
      },
      { status: res.status },
    );
  }

  const created = await res.json();
  return NextResponse.json({ id: created.id, htmlLink: created.htmlLink });
}
