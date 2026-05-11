import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Payload = {
  title?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  description?: string;
};

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
        error:
          "Google access token not available. Sign out and sign in again to grant Calendar access.",
      },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Payload;
  const { title, date, startTime, endTime, description } = body;

  if (!title || !date || !startTime || !endTime) {
    return NextResponse.json(
      { error: "title, date, startTime, endTime are required." },
      { status: 400 },
    );
  }

  const timeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

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

  const event = {
    summary: title,
    description: description ?? "",
    start: {
      dateTime: `${date}T${startTime}:00`,
      timeZone,
    },
    end: {
      dateTime: `${date}T${endTime}:00`,
      timeZone,
    },
  };

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

  if (!res.ok) {
    const errText = await res.text();
    return NextResponse.json(
      {
        error:
          "Google Calendar API rejected the event. You may need to sign in again.",
        details: errText,
      },
      { status: res.status },
    );
  }

  const created = await res.json();
  return NextResponse.json({
    id: created.id,
    htmlLink: created.htmlLink,
  });
}
