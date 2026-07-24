/**
 * Shared, locale-agnostic metadata for the two task classifications added on
 * top of importance and assignee: a work "kind" and an estimated time. Labels
 * live in i18n (`t.todos.taskKind*` / `t.todos.timeBucket*`); this module holds
 * only the fixed vocabularies and the pure formatting/bucketing helpers, so the
 * Tasks panel, the daily focus, and the completed table all agree.
 */

/** The five work kinds a task can carry (see the 20260724 migration). */
export const TASK_KINDS = [
  "setup",
  "deploy",
  "legal",
  "content",
  "decision",
] as const;

export type TaskKind = (typeof TASK_KINDS)[number];

export function isTaskKind(value: unknown): value is TaskKind {
  return (
    typeof value === "string" && (TASK_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Time filter buckets. A selection keeps tasks whose estimate is at most the
 * bucket's ceiling; "all" clears the filter. `id` is stable for state/URLs.
 */
export const TIME_BUCKETS = [
  { id: "q", maxMinutes: 15 },
  { id: "h", maxMinutes: 60 },
  { id: "half", maxMinutes: 240 },
  { id: "long", maxMinutes: Number.POSITIVE_INFINITY },
] as const;

export type TimeBucketId = (typeof TIME_BUCKETS)[number]["id"];

/** Compact human duration: 45 → "45m", 120 → "2h", 90 → "1h 30m". */
export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * Parse a `[time:…]` marker value into whole minutes. Accepts "30m", "2h",
 * "1h30m", "1h 30m", or a bare number (minutes). Returns null if unparseable.
 */
export function parseTimeToMinutes(raw: string): number | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    const n = Number(value);
    return n > 0 ? n : null;
  }
  const match = value.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/);
  if (!match || (!match[1] && !match[2])) return null;
  const total = (Number(match[1] ?? 0) * 60) + Number(match[2] ?? 0);
  return total > 0 ? total : null;
}
