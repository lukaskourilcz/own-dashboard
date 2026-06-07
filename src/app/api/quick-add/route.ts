import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { rejectCrossOrigin } from "@/lib/csrf";

/**
 * Natural-language quick-add. The client sends one short string ("dinner with
 * mom 7pm tomorrow") and we route it to a tool-use call against Claude Haiku.
 * The model picks ONE of {add_todo, mark_streak, add_calendar_event} and
 * returns structured args. We return the planned action — the client executes
 * the actual mutation against Supabase / the existing /api/calendar/event
 * route, so this endpoint stays read-only on user data.
 *
 * If ANTHROPIC_API_KEY is unset, returns a `disabled` flag so the client can
 * fall back to the literal !todo / !streak / !cal grammar.
 */

type Action =
  | { kind: "todo"; title: string; due_date?: string }
  | { kind: "streak"; streak_name: string }
  | {
      kind: "calendar_event";
      title: string;
      date: string;
      startTime?: string;
      endTime?: string;
      allDay?: boolean;
      description?: string;
    };

const TOOLS = [
  {
    name: "add_todo",
    description:
      "Add a personal task to the user's todo list. Use when the user describes something they need to do (not a one-off event with a time).",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short task description." },
        due_date: {
          type: "string",
          description: "ISO date (YYYY-MM-DD) if a deadline is implied.",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "mark_streak",
    description:
      "Mark a habit/streak as done for today. Use when the user says they did a habit (e.g. 'read 30 min', 'meditated', 'gym done').",
    input_schema: {
      type: "object",
      properties: {
        streak_name: {
          type: "string",
          description:
            "Name of the streak/habit to mark. Match by name — the client looks it up case-insensitively.",
        },
      },
      required: ["streak_name"],
    },
  },
  {
    name: "add_calendar_event",
    description:
      "Create a Google Calendar event. Use when the user describes something at a specific time/date (meeting, appointment, plan).",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        date: { type: "string", description: "ISO date YYYY-MM-DD." },
        startTime: { type: "string", description: "HH:MM 24h." },
        endTime: { type: "string", description: "HH:MM 24h." },
        allDay: { type: "boolean" },
        description: { type: "string" },
      },
      required: ["title", "date"],
    },
  },
] as const;

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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ disabled: true });
  }

  const body = (await request.json().catch(() => ({}))) as {
    input?: string;
    timezone?: string;
  };
  const input = (body.input ?? "").trim();
  if (!input) {
    return NextResponse.json({ error: "input is required." }, { status: 400 });
  }
  if (input.length > 500) {
    return NextResponse.json({ error: "input too long." }, { status: 400 });
  }

  const client = new Anthropic({ apiKey });
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const tz = body.timezone || "UTC";

  let response;
  try {
    response = await client.messages.create({
      // Per the project's AGENTS.md, Haiku 4.5 is the latest small-fast tier.
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      tools: TOOLS as unknown as Anthropic.Messages.Tool[],
      tool_choice: { type: "auto" },
      system:
        `You are a strict intent parser for a personal dashboard. The user pastes one short line; you call EXACTLY ONE tool that captures their intent.\n\n` +
        `Today is ${todayIso} (${tz}). Resolve relative dates from this.\n\n` +
        `Heuristics:\n` +
        `- If the line has an explicit time of day → add_calendar_event.\n` +
        `- If the line says something was done past-tense ("read 30 min", "did yoga") → mark_streak with the habit name.\n` +
        `- Otherwise → add_todo. Include due_date only if a deadline is clearly stated.\n` +
        `- Output ONLY a tool call. Do not include free-form text.`,
      messages: [{ role: "user", content: input }],
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 },
    );
  }

  // Find the first tool_use block in the response.
  const toolBlock = response.content.find((b) => b.type === "tool_use") as
    | Anthropic.Messages.ToolUseBlock
    | undefined;

  if (!toolBlock) {
    return NextResponse.json({
      action: null,
      note: "Could not parse. Try a more specific phrasing or !todo/!streak/!cal.",
    });
  }

  let action: Action | null = null;
  const inputArgs = toolBlock.input as Record<string, unknown>;

  if (toolBlock.name === "add_todo" && typeof inputArgs.title === "string") {
    action = {
      kind: "todo",
      title: inputArgs.title,
      due_date:
        typeof inputArgs.due_date === "string" ? inputArgs.due_date : undefined,
    };
  } else if (
    toolBlock.name === "mark_streak" &&
    typeof inputArgs.streak_name === "string"
  ) {
    action = { kind: "streak", streak_name: inputArgs.streak_name };
  } else if (
    toolBlock.name === "add_calendar_event" &&
    typeof inputArgs.title === "string" &&
    typeof inputArgs.date === "string"
  ) {
    action = {
      kind: "calendar_event",
      title: inputArgs.title,
      date: inputArgs.date,
      startTime:
        typeof inputArgs.startTime === "string" ? inputArgs.startTime : undefined,
      endTime:
        typeof inputArgs.endTime === "string" ? inputArgs.endTime : undefined,
      allDay: typeof inputArgs.allDay === "boolean" ? inputArgs.allDay : undefined,
      description:
        typeof inputArgs.description === "string"
          ? inputArgs.description
          : undefined,
    };
  }

  return NextResponse.json({ action });
}
