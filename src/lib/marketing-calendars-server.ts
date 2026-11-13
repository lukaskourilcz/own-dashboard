import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  MARKETING_CALENDAR_SOURCES,
  parseMarketingCalendar,
  type MarketingCalendarSource,
  type MarketingCalendarsResponse,
  type MarketingSourceResult,
} from "@/lib/marketing-calendars";
import { withPlanEntries, type PlanCalendarEntries } from "@/lib/marketing-calendars-plan";

/**
 * Reads the configured marketing calendars from the archived documents in this
 * repository (`content/marketing-calendars`, migrated out of Quorum on
 * 9 November 2026) and lays the owner's plan over them. Nothing is fetched and
 * nothing is written: every source comes back either as a trimmed calendar or
 * with the reason it could not be read.
 */

/** A 30-day plan is about 250 kB; a document four times that is refused, not cut. */
const MAX_CALENDAR_CHARACTERS = 1024 * 1024;
/** Only the committed calendar directory, by exact shape; never an arbitrary path. */
const FILE_RE = /^content\/marketing-calendars\/[A-Za-z0-9._-]+\.json$/;

async function readSource(source: MarketingCalendarSource): Promise<MarketingSourceResult> {
  const base = { id: source.id, label: source.label, file: source.file, calendarUrl: source.calendarUrl, detail: null, calendar: null };
  if (!FILE_RE.test(source.file) || source.file.includes("..")) return { ...base, status: "error", detail: "invalid-path" };
  let text: string;
  try {
    text = await readFile(path.join(process.cwd(), source.file), "utf8");
  } catch {
    return { ...base, status: "error", detail: "unreadable" };
  }
  if (text.length > MAX_CALENDAR_CHARACTERS) return { ...base, status: "too-large" };
  const parsed = parseMarketingCalendar(text, source.project);
  if (!parsed.ok) return { ...base, status: parsed.status, detail: parsed.detail };
  return { ...base, status: "ok", calendar: parsed.calendar };
}

/**
 * Every configured calendar. With `plan`, each archived calendar's entries from `plan.today` on are replaced by the
 * owner's plan (`withPlanEntries`); a project whose plan could not be read keeps its archive.
 */
export async function readMarketingCalendars(
  sources: readonly MarketingCalendarSource[] = MARKETING_CALENDAR_SOURCES,
  checkedAt = new Date().toISOString(),
  plan?: { entries: PlanCalendarEntries; today: string },
): Promise<MarketingCalendarsResponse> {
  const results = await Promise.all(sources.map(async (source) => {
    const result = await readSource(source);
    return plan ? withPlanEntries(result, source.project, plan.entries, plan.today) : result;
  }));
  return { checkedAt, sources: results };
}
