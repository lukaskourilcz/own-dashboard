import { eventEnd, eventStart, type GcalEvent } from "@/lib/calendar";
import type {
  DailyFocusItem,
  Organization,
  Project,
  Todo,
  WeeklyObjective,
  WeeklyReview,
} from "@/lib/types";

/**
 * Weekly planning — the pure half of the guided weekly flow.
 *
 * Everything here is deterministic and DOM-free: no `new Date()` without an
 * explicit reference, no Supabase client, no dictionary. The component in
 * `src/components/work/weekly-planning.tsx` supplies last week's calendar
 * window, the owner's projects and organizations, and the daily-focus rows, and
 * renders what these functions return.
 *
 * Only aggregates ever reach `weekly_reviews.items`: minutes per channel and
 * event counts. Calendar event titles are read to classify a block and are then
 * dropped, because the application does not store Google Calendar event bodies.
 */

export const WORK_CHANNELS = ["client", "project", "admin"] as const;
export type WorkChannel = (typeof WORK_CHANNELS)[number];

export const WEEKLY_PLANNING_STEPS = [
  "time",
  "done",
  "carry",
  "objectives",
  "summary",
] as const;
export type WeeklyPlanningStep = (typeof WEEKLY_PLANNING_STEPS)[number];

/** The six free-text lists the flat weekly review wrote before this flow. */
export const LEGACY_REVIEW_KEYS = [
  "facts",
  "risks",
  "decisions",
  "priorities",
  "followUps",
  "sources",
] as const;
export type LegacyReviewKey = (typeof LEGACY_REVIEW_KEYS)[number];

export type TimeByChannel = {
  minutes: Record<WorkChannel, number>;
  totalMinutes: number;
  /** Counted events whose title named a project or an organization. */
  matchedEvents: number;
  /** Counted events that named neither, so they fell to the admin channel. */
  unmatchedEvents: number;
  /** All-day entries, which carry no duration worth measuring. */
  skippedAllDay: number;
};

export type FocusRecap = {
  completed: number;
  total: number;
  /** Days last week that had a focus set at all. */
  days: number;
};

/** The aggregate snapshot persisted with a review; never event titles. */
export type StoredTimeByChannel = {
  minutes: Record<WorkChannel, number>;
  unmatchedEvents: number;
  source: "google" | "unavailable";
};

export type WeeklyReviewItems = Record<LegacyReviewKey, string[]> & {
  objectives: WeeklyObjective[];
  timeByChannel: StoredTimeByChannel;
  focusRecap: FocusRecap;
  step: WeeklyPlanningStep;
};

export type CarryForwardOrigin = "objective" | "focus";

export type CarryForwardCandidate = {
  /** Stable id of the record this candidate came from. */
  id: string;
  text: string;
  origin: CarryForwardOrigin;
};

const WORD_BOUNDARY = /[\p{L}\p{N}]/u;

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("en-US")
    .trim();
}

/**
 * Whole-word containment without a lookbehind, which older Safari still cannot
 * parse. "acme" matches "Acme s.r.o." and "call with Acme" but not "acmestore".
 */
export function containsWord(haystack: string, needle: string): boolean {
  if (needle.length < 2) return false;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;
    const before = at === 0 ? "" : haystack[at - 1] ?? "";
    const after = haystack[at + needle.length] ?? "";
    if (!WORD_BOUNDARY.test(before) && !WORD_BOUNDARY.test(after)) return true;
    from = at + 1;
  }
}

export type ChannelRefs = {
  projects: Project[];
  organizations: Organization[];
};

/** Organization types that represent paid delivery rather than an employer. */
const CLIENT_ORGANIZATION_TYPES = new Set(["client", "prospective_client"]);

/**
 * Legal-form tokens that a calendar entry almost never repeats. "Acme s.r.o."
 * is written in the register and "Acme" is written in the calendar, so the
 * registered form is matched as well as the trading name it reduces to.
 */
const LEGAL_FORMS = [
  "s.r.o.",
  "s. r. o.",
  "spol. s r.o.",
  "sro",
  "a.s.",
  "a. s.",
  "z.s.",
  "z.u.",
  "o.p.s.",
  "s.p.",
  "k.s.",
  "v.o.s.",
  "ltd.",
  "ltd",
  "llc",
  "inc.",
  "inc",
  "gmbh",
  "plc",
  "s.a.",
  "b.v.",
];

/** The names an organization may appear under, longest first. */
export function organizationNeedles(name: string): string[] {
  const full = normalize(name);
  if (!full) return [];
  let core = full;
  for (;;) {
    const stripped = LEGAL_FORMS.find((form) => core.endsWith(` ${form}`) || core.endsWith(`,${form}`));
    if (!stripped) break;
    core = core.slice(0, core.length - stripped.length).replace(/[\s,]+$/, "");
  }
  return core && core !== full ? [full, core] : [full];
}

/**
 * Which channel a calendar block belongs to, and what it matched.
 *
 * A client organization named in the title, location or description is client
 * work; an employer is not, because an interview is not delivery.
 * A project is client work when it is a client engagement
 * (`engagement === "client"`) or belongs to an organization, and own-project
 * work otherwise. Anything that
 * names neither is admin — the honest default, not a guess, which is why the
 * unmatched count is shown next to the result.
 */
export function classifyEvent(
  event: GcalEvent,
  refs: ChannelRefs,
): { channel: WorkChannel; matched: string | null } {
  const haystack = normalize(
    [event.summary, event.location, event.description].filter(Boolean).join(" "),
  );
  if (!haystack) return { channel: "admin", matched: null };

  for (const organization of refs.organizations) {
    if (!CLIENT_ORGANIZATION_TYPES.has(organization.type)) continue;
    if (organizationNeedles(organization.name).some((needle) => containsWord(haystack, needle))) {
      return { channel: "client", matched: organization.name };
    }
  }

  for (const project of refs.projects) {
    // Earlier slugs count too: a calendar still says "aifirst" after the
    // project became DNESKAi (#76).
    const needles = [project.name, project.slug, ...(project.previous_slugs ?? [])].filter(Boolean);
    if (!needles.some((needle) => containsWord(haystack, normalize(needle)))) continue;
    const isClientWork = project.engagement === "client" || Boolean(project.organization_id);
    return { channel: isClientWork ? "client" : "project", matched: project.name };
  }

  return { channel: "admin", matched: null };
}

function emptyMinutes(): Record<WorkChannel, number> {
  return { client: 0, project: 0, admin: 0 };
}

function isAllDay(event: GcalEvent): boolean {
  return Boolean(event.start.date) && !event.start.dateTime;
}

/**
 * Minutes per channel across a half-open range. Events are clamped to the
 * range, all-day entries are counted separately rather than guessed at, and a
 * zero-length or reversed event contributes nothing.
 */
export function summarizeTimeByChannel(
  events: GcalEvent[],
  refs: ChannelRefs,
  range: { start: Date; endExclusive: Date },
): TimeByChannel {
  const minutes = emptyMinutes();
  let matchedEvents = 0;
  let unmatchedEvents = 0;
  let skippedAllDay = 0;

  for (const event of events) {
    if (isAllDay(event)) {
      skippedAllDay++;
      continue;
    }
    const start = eventStart(event);
    const end = eventEnd(event);
    if (!start || !end) continue;

    const from = Math.max(start.getTime(), range.start.getTime());
    const to = Math.min(end.getTime(), range.endExclusive.getTime());
    const span = to - from;
    if (span <= 0) continue;

    const { channel, matched } = classifyEvent(event, refs);
    minutes[channel] += Math.round(span / 60_000);
    if (matched) matchedEvents++;
    else unmatchedEvents++;
  }

  const totalMinutes = WORK_CHANNELS.reduce((sum, channel) => sum + minutes[channel], 0);
  return { minutes, totalMinutes, matchedEvents, unmatchedEvents, skippedAllDay };
}

/** Whole-percent share of each channel; an empty week is all zeroes. */
export function channelShares(summary: TimeByChannel): Record<WorkChannel, number> {
  const shares = emptyMinutes();
  if (summary.totalMinutes <= 0) return shares;
  for (const channel of WORK_CHANNELS) {
    shares[channel] = Math.round((summary.minutes[channel] / summary.totalMinutes) * 100);
  }
  return shares;
}

/** Minutes split into whole hours and the remainder, for tabular display. */
export function hoursAndMinutes(total: number): { hours: number; minutes: number } {
  const safe = Math.max(0, Math.round(total));
  return { hours: Math.floor(safe / 60), minutes: safe % 60 };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Tolerant reader for one of the six legacy free-text lists. */
export function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

/**
 * Objectives out of a stored `items` blob.
 *
 * Accepts both shapes: the object list this flow writes, and a bare `string[]`,
 * which is what the flat review wrote into every key it owned. A review saved
 * before this flow existed therefore still opens with its priorities visible as
 * objectives instead of an empty list.
 */
export function readObjectives(items: unknown): WeeklyObjective[] {
  const raw = asRecord(items).objectives;
  if (!Array.isArray(raw)) return [];

  const objectives: WeeklyObjective[] = [];
  raw.forEach((entry, index) => {
    if (typeof entry === "string") {
      const text = entry.trim();
      if (text) objectives.push({ id: `legacy-${index}`, text, done: false });
      return;
    }
    const record = asRecord(entry);
    const text = typeof record.text === "string" ? record.text.trim() : "";
    if (!text) return;
    const id = typeof record.id === "string" && record.id ? record.id : `objective-${index}`;
    const carriedFrom =
      typeof record.carriedFrom === "string" && record.carriedFrom
        ? record.carriedFrom
        : undefined;
    objectives.push({
      id,
      text,
      done: record.done === true,
      ...(carriedFrom ? { carriedFrom } : {}),
    });
  });
  return objectives;
}

export function readStep(items: unknown): WeeklyPlanningStep {
  const step = asRecord(items).step;
  return WEEKLY_PLANNING_STEPS.includes(step as WeeklyPlanningStep)
    ? (step as WeeklyPlanningStep)
    : WEEKLY_PLANNING_STEPS[0];
}

export function readTimeByChannel(items: unknown): StoredTimeByChannel | null {
  const raw = asRecord(asRecord(items).timeByChannel);
  if (Object.keys(raw).length === 0) return null;
  const minutes = asRecord(raw.minutes);
  const read = (channel: WorkChannel) =>
    typeof minutes[channel] === "number" && Number.isFinite(minutes[channel])
      ? Math.max(0, Math.round(minutes[channel] as number))
      : 0;
  return {
    minutes: { client: read("client"), project: read("project"), admin: read("admin") },
    unmatchedEvents:
      typeof raw.unmatchedEvents === "number" ? Math.max(0, raw.unmatchedEvents) : 0,
    source: raw.source === "google" ? "google" : "unavailable",
  };
}

/**
 * Merge a patch into a stored `items` blob without losing anything.
 *
 * The six legacy lists survive every save, whether or not the patch mentions
 * them, and unknown keys written by an older build are carried through
 * untouched — a review record is owner data, not a cache to be rebuilt.
 */
export function writeReviewItems(
  previous: unknown,
  patch: Partial<WeeklyReviewItems>,
): Record<string, unknown> {
  const base: Record<string, unknown> = { ...asRecord(previous) };
  for (const key of LEGACY_REVIEW_KEYS) {
    const next = patch[key];
    base[key] = next ? readStringList(next) : readStringList(base[key]);
  }
  if (patch.objectives) base.objectives = patch.objectives;
  if (patch.timeByChannel) base.timeByChannel = patch.timeByChannel;
  if (patch.focusRecap) base.focusRecap = patch.focusRecap;
  if (patch.step) base.step = patch.step;
  return base;
}

/**
 * What last week left behind: objectives that were never ticked off, and focus
 * tasks that were never completed and whose task is still open.
 *
 * A focus item whose objective already says the same thing is dropped, so the
 * owner is asked about each loose end exactly once.
 */
export function carryForwardCandidates({
  previousReview,
  focusItems,
  todos,
}: {
  previousReview: WeeklyReview | null | undefined;
  focusItems: Pick<DailyFocusItem, "id" | "todo_id" | "title_snapshot" | "completed_at">[];
  todos: Todo[];
}): CarryForwardCandidate[] {
  const candidates: CarryForwardCandidate[] = [];
  const seen = new Set<string>();

  const push = (candidate: CarryForwardCandidate) => {
    const fingerprint = normalize(candidate.text);
    if (!fingerprint || seen.has(fingerprint)) return;
    seen.add(fingerprint);
    candidates.push(candidate);
  };

  for (const objective of readObjectives(previousReview?.items)) {
    if (objective.done) continue;
    push({ id: objective.id, text: objective.text, origin: "objective" });
  }

  const openTodos = new Set(todos.filter((todo) => !todo.done).map((todo) => todo.id));
  for (const item of focusItems) {
    if (item.completed_at) continue;
    // A focus item whose task was deleted or finished elsewhere is done with,
    // even though the snapshot on the focus row still reads as unfinished.
    if (!item.todo_id || !openTodos.has(item.todo_id)) continue;
    push({ id: item.id, text: item.title_snapshot, origin: "focus" });
  }

  return candidates;
}

/**
 * Add the selected carry-forward candidates to next week's objectives, keeping
 * the objectives that are already there. An objective that was already carried
 * from the same record is not added a second time, which is what makes stepping
 * back and forward through the flow safe.
 */
export function mergeCarriedObjectives(
  objectives: WeeklyObjective[],
  carried: CarryForwardCandidate[],
): WeeklyObjective[] {
  const byOrigin = new Set(
    objectives.map((objective) => objective.carriedFrom).filter(Boolean) as string[],
  );
  const byText = new Set(objectives.map((objective) => normalize(objective.text)));

  const additions = carried
    .filter((candidate) => !byOrigin.has(candidate.id) && !byText.has(normalize(candidate.text)))
    .map((candidate) => ({
      id: `carry-${candidate.id}`,
      text: candidate.text,
      done: false,
      carriedFrom: candidate.id,
    }));

  return additions.length === 0 ? objectives : [...objectives, ...additions];
}

export function nextStep(step: WeeklyPlanningStep): WeeklyPlanningStep {
  const index = WEEKLY_PLANNING_STEPS.indexOf(step);
  return WEEKLY_PLANNING_STEPS[Math.min(index + 1, WEEKLY_PLANNING_STEPS.length - 1)]!;
}

export function previousStep(step: WeeklyPlanningStep): WeeklyPlanningStep {
  const index = WEEKLY_PLANNING_STEPS.indexOf(step);
  return WEEKLY_PLANNING_STEPS[Math.max(index - 1, 0)]!;
}

/**
 * One set per day: the newest generation.
 *
 * Regenerating a day's seven tasks writes a second `daily_focus_sets` row for
 * the same date, and counting both would report fourteen tasks for one day. The
 * newest generation is the one the owner actually worked from.
 */
export function latestFocusSets<T extends { focus_date: string; generation: number }>(
  sets: T[],
): T[] {
  const newest = new Map<string, T>();
  for (const set of sets) {
    const current = newest.get(set.focus_date);
    if (!current || set.generation > current.generation) newest.set(set.focus_date, set);
  }
  return [...newest.values()].sort((a, b) => a.focus_date.localeCompare(b.focus_date));
}

/** Aggregate the daily-focus rows of one week into the recap the flow shows. */
export function summarizeFocusWeek(
  sets: { focus_date: string; items: Pick<DailyFocusItem, "completed_at">[] }[],
): FocusRecap {
  const days = new Set<string>();
  let completed = 0;
  let total = 0;
  for (const set of sets) {
    days.add(set.focus_date);
    total += set.items.length;
    completed += set.items.filter((item) => item.completed_at).length;
  }
  return { completed, total, days: days.size };
}
