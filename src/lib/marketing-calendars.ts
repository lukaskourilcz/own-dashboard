import { addDays, format, startOfWeek } from "date-fns";
import { parseDateOnly } from "@/lib/date-keys";

/**
 * The marketing calendars OwnDashboard reads but never writes.
 *
 * Each project's 30-day marketing plan is a `marketing-calendar/1` JSON
 * document committed in that project's own repository and rendered as a
 * calendar there (BoardlessAI admin for devShark and DNESKAi). OwnDashboard
 * closes the loop in two read-only places: IG TIPS counts the calendar
 * entries that apply each tip (`entries[].tipRefs` cite tips by exact title),
 * and the Work overview lists the next seven days across every calendar.
 *
 * Nothing here is stored. The server reads the documents through the owner's
 * GitHub connection on request (`src/lib/marketing-calendars-server.ts`) and
 * the browser keeps the answer for the page session under
 * `qk.marketingCalendars`.
 */

export const MARKETING_CALENDAR_SCHEMA = "marketing-calendar/1";

export type MarketingCalendarSource = {
  /** Stable id: the venture id the calendar page uses. */
  id: string;
  /** The `project` field the document must carry. */
  project: string;
  /** How the project is named in the interface. */
  label: string;
  /** `owner/name` on GitHub. */
  repo: string;
  /** The document's path on the repository's default branch. */
  path: string;
  /** The page that renders this calendar; it takes `q`, `week` and `entry`. */
  calendarUrl: string;
};

/**
 * The calendars to read, in display order. Add a calendar here and both IG
 * TIPS and the Work overview pick it up; nothing else needs to change.
 */
export const MARKETING_CALENDAR_SOURCES = [
  {
    id: "marketingshark",
    project: "devshark",
    label: "devShark",
    repo: "lukaskourilcz/quorum",
    path: "state/marketing-calendar/marketingshark.json",
    calendarUrl: "https://boardless-ai.vercel.app/admin/calendar?venture=marketingshark",
  },
  {
    id: "caught-up",
    project: "dneskai",
    label: "DNESKAi",
    repo: "lukaskourilcz/quorum",
    path: "state/marketing-calendar/caught-up.json",
    calendarUrl: "https://boardless-ai.vercel.app/admin/calendar?venture=caught-up",
  },
] as const satisfies readonly MarketingCalendarSource[];

/** Upper bounds on what one document may contribute. */
export const MAX_CALENDAR_ENTRIES = 1_000;
export const MAX_PRELAUNCH_ITEMS = 200;
const MAX_TIP_REFS = 20;
const MAX_TEXT = 300;

export type MarketingEntry = {
  id: string;
  date: string;
  time: string | null;
  platform: string;
  kind: string;
  title: string;
  status: string;
  tipRefs: string[];
};

export type PrelaunchItem = {
  id: string;
  due: string;
  title: string;
  owner: string | null;
  repo: string | null;
  issue: string | null;
  status: string;
};

export type MarketingCalendar = {
  name: string;
  launch: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  entries: MarketingEntry[];
  prelaunch: PrelaunchItem[];
  /** Entries or pre-launch items left out because a required field was unusable. */
  skipped: number;
};

/**
 * Why a calendar could not be used. `not-found` means the repository is
 * visible but the file is not on its default branch yet; `unreadable` means
 * GitHub does not show the repository to the connected account.
 */
export type CalendarReadStatus =
  | "ok"
  | "not-found"
  | "unreadable"
  | "disconnected"
  | "invalid-json"
  | "wrong-schema"
  | "wrong-project"
  | "too-large"
  | "error";

export type MarketingSourceResult = {
  id: string;
  label: string;
  repo: string;
  path: string;
  calendarUrl: string;
  status: CalendarReadStatus;
  /** The HTTP status behind `error`, or the project a `wrong-project` document names. */
  detail: string | null;
  calendar: MarketingCalendar | null;
};

export type MarketingCalendarsResponse = {
  checkedAt: string;
  sources: MarketingSourceResult[];
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_TEXT) : fallback;
}

function date(value: unknown): string | null {
  if (typeof value !== "string" || !DATE_RE.test(value)) return null;
  return Number.isNaN(parseDateOnly(value).getTime()) ? null : value;
}

function parseEntry(value: unknown): MarketingEntry | null {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  const day = date(value.date);
  const title = text(value.title);
  if (!id || !day || !title) return null;
  const time = typeof value.time === "string" && TIME_RE.test(value.time) ? value.time : null;
  const tipRefs = Array.isArray(value.tipRefs)
    ? value.tipRefs.map((ref) => text(ref)).filter(Boolean).slice(0, MAX_TIP_REFS)
    : [];
  return {
    id,
    date: day,
    time,
    platform: text(value.platform).toLowerCase(),
    kind: text(value.kind).toLowerCase(),
    title,
    status: text(value.status, "planned").toLowerCase() || "planned",
    tipRefs,
  };
}

function parsePrelaunch(value: unknown): PrelaunchItem | null {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  const due = date(value.due);
  const title = text(value.title);
  if (!id || !due || !title) return null;
  const repo = text(value.repo);
  const issue = typeof value.issue === "number" ? `#${value.issue}` : text(value.issue);
  return {
    id,
    due,
    title,
    owner: text(value.owner) || null,
    repo: /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo) ? repo : null,
    issue: /^#?\d+$/.test(issue) ? `#${issue.replace(/^#/, "")}` : null,
    status: text(value.status, "planned").toLowerCase() || "planned",
  };
}

export type ParsedCalendar =
  | { ok: true; calendar: MarketingCalendar }
  | { ok: false; status: "invalid-json" | "wrong-schema" | "wrong-project"; detail: string | null };

/**
 * A calendar document, validated and trimmed to what OwnDashboard shows.
 * The document must declare `marketing-calendar/1`, name the expected project
 * and carry an `entries` array; entries and pre-launch items without an id,
 * a date or a title are skipped and counted rather than failing the whole
 * calendar.
 */
export function parseMarketingCalendar(raw: string, expectedProject: string): ParsedCalendar {
  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch {
    return { ok: false, status: "invalid-json", detail: null };
  }
  if (!isRecord(document) || document.schemaVersion !== MARKETING_CALENDAR_SCHEMA || !Array.isArray(document.entries)) {
    return { ok: false, status: "wrong-schema", detail: null };
  }
  const project = text(document.project);
  if (project !== expectedProject) return { ok: false, status: "wrong-project", detail: project || null };

  const rawEntries = document.entries.slice(0, MAX_CALENDAR_ENTRIES);
  const rawPrelaunch = Array.isArray(document.prelaunch) ? document.prelaunch.slice(0, MAX_PRELAUNCH_ITEMS) : [];
  const entries = rawEntries.map(parseEntry).filter((entry): entry is MarketingEntry => entry !== null);
  const prelaunch = rawPrelaunch.map(parsePrelaunch).filter((item): item is PrelaunchItem => item !== null);
  const period = isRecord(document.period) ? document.period : {};
  return {
    ok: true,
    calendar: {
      name: text(document.name) || project,
      launch: date(document.launch),
      periodStart: date(period.start),
      periodEnd: date(period.end),
      entries: entries.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "")),
      prelaunch: prelaunch.sort((a, b) => a.due.localeCompare(b.due)),
      skipped: rawEntries.length - entries.length + (rawPrelaunch.length - prelaunch.length),
    },
  };
}

/** The same tip title however the calendar spaced or cased it. */
export function tipTitleKey(title: string): string {
  return title
    .normalize("NFC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en");
}

export type TipUsage = {
  sourceId: string;
  label: string;
  /** Entries in that calendar that apply the tip. */
  count: number;
  /** The calendar filtered to this tip. */
  url: string;
};

export type TipUsageIndex = {
  /** Tip title key → one usage per calendar, in source order. */
  byTitle: Map<string, TipUsage[]>;
  /** The calendars the counts come from. */
  readSources: string[];
};

/** A calendar page URL with extra query parameters. */
export function calendarLink(calendarUrl: string, params: Record<string, string>): string {
  const url = new URL(calendarUrl);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

/**
 * How many entries in each readable calendar cite each tip. An entry that
 * names the same tip twice counts once; calendars that could not be read
 * contribute nothing and are left out of `readSources`.
 */
export function aggregateTipUsage(sources: readonly MarketingSourceResult[]): TipUsageIndex {
  const byTitle = new Map<string, TipUsage[]>();
  const readSources: string[] = [];
  for (const source of sources) {
    if (source.status !== "ok" || !source.calendar) continue;
    readSources.push(source.id);
    const counts = new Map<string, { title: string; count: number }>();
    for (const entry of source.calendar.entries) {
      for (const key of new Set(entry.tipRefs.map(tipTitleKey))) {
        if (!key) continue;
        const current = counts.get(key);
        counts.set(key, { title: current?.title ?? entry.tipRefs.find((ref) => tipTitleKey(ref) === key)!, count: (current?.count ?? 0) + 1 });
      }
    }
    for (const [key, { title, count }] of counts) {
      const usage: TipUsage = { sourceId: source.id, label: source.label, count, url: calendarLink(source.calendarUrl, { q: title }) };
      byTitle.set(key, [...(byTitle.get(key) ?? []), usage]);
    }
  }
  return { byTitle, readSources };
}

/** The calendar usages of one tip, empty when no readable calendar cites it. */
export function usageForTip(index: TipUsageIndex, title: string): TipUsage[] {
  return index.byTitle.get(tipTitleKey(title)) ?? [];
}

/** Titles the calendars cite that match none of the given tips. */
export function unmatchedTipRefs(index: TipUsageIndex, tipTitles: readonly string[]): number {
  const known = new Set(tipTitles.map(tipTitleKey));
  let unmatched = 0;
  for (const key of index.byTitle.keys()) if (!known.has(key)) unmatched += 1;
  return unmatched;
}

export const MARKETING_WEEK_DAYS = 7;

export type WeekEntry = MarketingEntry & { sourceId: string; label: string; url: string };
export type WeekPrelaunch = PrelaunchItem & { sourceId: string; label: string; url: string; overdue: boolean };

export type MarketingWeek = {
  from: string;
  to: string;
  entries: WeekEntry[];
  /** Pre-launch items due in the window, plus earlier ones not done yet. */
  prelaunch: WeekPrelaunch[];
  /** The earliest launch still ahead of today, when a calendar names one. */
  upcomingLaunch: { date: string; labels: string[] } | null;
};

function mondayOf(day: string): string {
  return format(startOfWeek(parseDateOnly(day), { weekStartsOn: 1 }), "yyyy-MM-dd");
}

/**
 * The next seven days, today included, across every readable calendar:
 * entries by date, time and calendar order; pre-launch items due in the
 * window or already overdue and not done; and the next launch date. `today`
 * is a local `yyyy-MM-dd` key, so the window follows the browser's calendar
 * day rather than the server's clock.
 */
export function marketingWeek(sources: readonly MarketingSourceResult[], today: string, days = MARKETING_WEEK_DAYS): MarketingWeek {
  const to = format(addDays(parseDateOnly(today), days - 1), "yyyy-MM-dd");
  const entries: WeekEntry[] = [];
  const prelaunch: WeekPrelaunch[] = [];
  const launches = new Map<string, string[]>();
  const order = new Map(sources.map((source, index) => [source.id, index]));

  for (const source of sources) {
    const calendar = source.status === "ok" ? source.calendar : null;
    if (!calendar) continue;
    for (const entry of calendar.entries) {
      if (entry.date < today || entry.date > to) continue;
      entries.push({
        ...entry,
        sourceId: source.id,
        label: source.label,
        url: calendarLink(source.calendarUrl, { week: mondayOf(entry.date), entry: entry.id }),
      });
    }
    for (const item of calendar.prelaunch) {
      const overdue = item.due < today && item.status !== "done";
      if (!overdue && (item.due < today || item.due > to)) continue;
      const issueNumber = item.issue?.replace(/^#/, "");
      prelaunch.push({
        ...item,
        sourceId: source.id,
        label: source.label,
        url: item.repo && issueNumber ? `https://github.com/${item.repo}/issues/${issueNumber}` : source.calendarUrl,
        overdue,
      });
    }
    const launch = calendar.launch ?? calendar.periodStart;
    if (launch && launch > today) launches.set(launch, [...(launches.get(launch) ?? []), source.label]);
  }

  const byCalendar = (a: { sourceId: string }, b: { sourceId: string }) =>
    (order.get(a.sourceId) ?? 0) - (order.get(b.sourceId) ?? 0);
  entries.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || byCalendar(a, b));
  prelaunch.sort((a, b) => a.due.localeCompare(b.due) || byCalendar(a, b));
  const next = [...launches.keys()].sort()[0];
  return { from: today, to, entries, prelaunch, upcomingLaunch: next ? { date: next, labels: launches.get(next)! } : null };
}

/**
 * The IG TIPS deep link, `/ig-tips?q=<title>`: the `q` search parameter as
 * the server page receives it, reduced to the search to prefill, or null.
 */
export function tipDeepLinkQuery(value: string | string[] | null | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  const query = first?.replace(/\s+/g, " ").trim().slice(0, 500);
  return query ? query : null;
}

/** The tip whose title is the deep-link query, ignoring case and spacing. */
export function tipForDeepLink<T extends { id: string; title: string }>(query: string | null, tips: readonly T[]): T | null {
  if (!query) return null;
  const key = tipTitleKey(query);
  return tips.find((tip) => tipTitleKey(tip.title) === key) ?? null;
}

export type MarketingCalendarsResult =
  | { kind: "ok"; data: MarketingCalendarsResponse }
  | { kind: "rate-limited" }
  | { kind: "signed-out" }
  | { kind: "error" };

/** GET /api/marketing/calendars from the browser. The token stays on the server. */
export async function loadMarketingCalendars(): Promise<MarketingCalendarsResult> {
  try {
    const response = await fetch("/api/marketing/calendars", { cache: "no-store" });
    if (response.status === 429) return { kind: "rate-limited" };
    if (response.status === 401) return { kind: "signed-out" };
    if (!response.ok) return { kind: "error" };
    const data = (await response.json()) as MarketingCalendarsResponse;
    if (!data || !Array.isArray(data.sources)) return { kind: "error" };
    return { kind: "ok", data };
  } catch {
    return { kind: "error" };
  }
}
