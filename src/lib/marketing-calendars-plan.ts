import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pragueDayAfter } from "@/lib/marketing/dneskai-workspace";
import type { MarketingCalendar, MarketingEntry, MarketingSourceResult } from "@/lib/marketing-calendars";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the generated database types do not cover marketing tables
type Database = SupabaseClient<any>;

/**
 * The marketing calendars after Quorum (13 November 2026): OwnDashboard's own plan is the source of truth.
 *
 * What publishes is decided by the plan tables, `marketing_dneskai_plan` and `marketing_devshark_plan`, which the
 * marketing tick fills and publishes from. The `marketing-calendar/1` documents in `content/marketing-calendars` are a
 * frozen archive of the Quorum era (4 October to 2 November 2026): they keep the tip citations (`tipRefs`) IG TIPS
 * counts, but from today on a calendar shows only what the plan holds. Nobody has to update the archive.
 */
export const PLAN_CALENDAR_DAYS = 30;

export type PlanCalendarProject = "devshark" | "dneskai";
/** Upcoming plan entries per project; a project whose plan could not be read is missing. */
export type PlanCalendarEntries = Partial<Record<PlanCalendarProject, MarketingEntry[]>>;

type SlotRow = { id: string; date: string; local_time: string | null; instagram: boolean; threads: boolean; status: string; kind?: string | null };
const time = (value: string | null) => (value && /^\d{2}:\d{2}/.test(value) ? value.slice(0, 5) : null);

function slotEntries(slot: SlotRow, title: string, kind: string): MarketingEntry[] {
  if (!z.iso.date().safeParse(slot.date).success) return [];
  const platforms = [slot.instagram ? "instagram" : null, slot.threads ? "threads" : null].filter((value): value is string => !!value);
  return platforms.map((platform) => ({
    id: `${slot.id}:${platform}`, date: slot.date, time: time(slot.local_time), platform, kind,
    title: title.trim().slice(0, 300), status: String(slot.status || "planned").toLowerCase(), tipRefs: [],
  }));
}

async function devsharkEntries(db: Database, owner: string, from: string, until: string): Promise<MarketingEntry[]> {
  const slots = await db.from("marketing_devshark_plan").select("id,date,local_time,instagram,threads,status,draft_id")
    .eq("user_id", owner).gte("date", from).lte("date", until).order("date").order("local_time").limit(400);
  if (slots.error) throw new Error("devshark-plan-unavailable");
  const rows = (slots.data ?? []) as Array<SlotRow & { draft_id: string | null }>;
  const ids = [...new Set(rows.flatMap((row) => (row.draft_id ? [row.draft_id] : [])))];
  const drafts = ids.length ? await db.from("marketing_devshark_drafts").select("id,title").eq("user_id", owner).in("id", ids) : { data: [], error: null };
  if (drafts.error) throw new Error("devshark-plan-unavailable");
  const titles = new Map(((drafts.data ?? []) as Array<{ id: string; title: string }>).map((row) => [row.id, row.title]));
  return rows.flatMap((row) => slotEntries(row, (row.draft_id && titles.get(row.draft_id)) || "devShark", "carousel"));
}

async function dneskaiEntries(db: Database, owner: string, from: string, until: string): Promise<MarketingEntry[]> {
  const slots = await db.from("marketing_dneskai_plan").select("id,date,local_time,instagram,threads,status,kind,topic_id")
    .eq("user_id", owner).gte("date", from).lte("date", until).order("date").order("local_time").limit(400);
  if (slots.error) throw new Error("dneskai-plan-unavailable");
  const rows = (slots.data ?? []) as Array<SlotRow & { topic_id: string | null }>;
  const ids = [...new Set(rows.flatMap((row) => (row.topic_id ? [row.topic_id] : [])))];
  const topics = ids.length ? await db.from("marketing_dneskai_topics").select("id,title_cs").eq("user_id", owner).in("id", ids) : { data: [], error: null };
  if (topics.error) throw new Error("dneskai-plan-unavailable");
  const titles = new Map(((topics.data ?? []) as Array<{ id: string; title_cs: string }>).map((row) => [row.id, row.title_cs]));
  return rows.flatMap((row) => slotEntries(row, (row.topic_id && titles.get(row.topic_id)) || "DNESKAi", String(row.kind || "carousel").toLowerCase()));
}

/** The plan's entries from `from` (a Prague date) for `days` days, read through the owner's session (own-only RLS). */
export async function readPlanCalendarEntries(db: Database, owner: string, from: string, days = PLAN_CALENDAR_DAYS): Promise<PlanCalendarEntries> {
  z.uuid().parse(owner);
  const until = pragueDayAfter(from, days - 1);
  const [devshark, dneskai] = await Promise.allSettled([devsharkEntries(db, owner, from, until), dneskaiEntries(db, owner, from, until)]);
  return {
    ...(devshark.status === "fulfilled" ? { devshark: devshark.value } : {}),
    ...(dneskai.status === "fulfilled" ? { dneskai: dneskai.value } : {}),
  };
}

/**
 * One calendar with the plan laid over the archive: archived entries before `today` stay (their tip citations still
 * count), everything from `today` on comes from the plan, and the archive's pre-launch items are dropped (both
 * launches are past). Without a readable plan the calendar is returned as it was.
 */
export function withPlanEntries(source: MarketingSourceResult, project: string, plan: PlanCalendarEntries, today: string): MarketingSourceResult {
  const entries = plan[project as PlanCalendarProject];
  if (!entries || source.status !== "ok" || !source.calendar) return source;
  const archived = source.calendar.entries.filter((entry) => entry.date < today);
  const merged = [...archived, ...entries].sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""));
  const last = entries.reduce<string | null>((max, entry) => (!max || entry.date > max ? entry.date : max), source.calendar.periodEnd);
  const calendar: MarketingCalendar = { ...source.calendar, entries: merged, prelaunch: [], periodEnd: last };
  return { ...source, calendar, upcoming: "plan" };
}
