/**
 * The DNESKAi recurring series (owner decision, 8 November 2026). A series post is an education topic tagged with
 * `evidence.series`; the plan step seats it in its fixed slot before it fills the rest of the plan with ordinary topics.
 *
 * - `mosseri`: "Marketing tipy od šéfa Instagramu Mosseriho", Tuesday and Thursday at 12:30.
 * - `explainer`: "… — co to vlastně znamená?", Monday, Wednesday and Friday at 12:30.
 *
 * The series start on 16 November 2026. Pure and browser-safe.
 */
export const DNESKAI_SERIES = ['mosseri', 'explainer'] as const;
export type DneskaiSeries = (typeof DNESKAI_SERIES)[number];

/** The series slot time; 12:30 posts on Instagram and Threads. */
export const DNESKAI_SERIES_TIME = '12:30';
/** The first day the plan gives the series their slots. */
export const DNESKAI_SERIES_START = '2026-11-16';

/** The weekdays (0 = Sunday) of each series. */
export const DNESKAI_SERIES_WEEKDAYS: Readonly<Record<DneskaiSeries, readonly number[]>> = {
  explainer: [1, 3, 5],
  mosseri: [2, 4],
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The series a topic belongs to, from its evidence, or null for an ordinary topic. */
export function dneskaiSeriesOf(evidence: Record<string, unknown> | null | undefined): DneskaiSeries | null {
  const value = evidence?.series;
  return typeof value === 'string' && (DNESKAI_SERIES as readonly string[]).includes(value) ? value as DneskaiSeries : null;
}

/** The weekday of a Prague `YYYY-MM-DD` date (0 = Sunday); noon UTC always falls on the same day. */
function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** The series that owns the slot at `date` and `time`, or null. */
export function dneskaiSeriesSlot(date: string, time: string): DneskaiSeries | null {
  if (!DATE.test(date) || time !== DNESKAI_SERIES_TIME || date < DNESKAI_SERIES_START) return null;
  const weekday = weekdayOf(date);
  return DNESKAI_SERIES.find((series) => DNESKAI_SERIES_WEEKDAYS[series].includes(weekday)) ?? null;
}

/**
 * Pairs empty slots with topics. A series slot takes the oldest approved topic of its series. Without one it stays
 * reserved, so a series topic approved later still gets it, until `releaseThrough`: a series slot on that date or
 * earlier is about to be prepared, so an ordinary topic takes it rather than leave the feed with a gap. Ordinary
 * topics fill the other slots in order. Pure: both inputs arrive sorted; the pairs come back in slot order.
 */
export function dneskaiSeriesAssignment<S extends { date: string; time: string }, T extends { evidence: Record<string, unknown> | null }>(
  empty: readonly S[], topics: readonly T[], releaseThrough: string,
): Array<{ slot: S; topic: T }> {
  const queues = new Map<DneskaiSeries, T[]>(DNESKAI_SERIES.map((series) => [series, []]));
  const plain: T[] = [];
  for (const topic of topics) {
    const series = dneskaiSeriesOf(topic.evidence);
    (series ? queues.get(series)! : plain).push(topic);
  }
  const pairs: Array<{ slot: S; topic: T; at: number }> = [];
  const open: Array<{ slot: S; at: number }> = [];
  for (const [at, slot] of empty.entries()) {
    const series = dneskaiSeriesSlot(slot.date, slot.time);
    if (!series) { open.push({ slot, at }); continue; }
    const topic = queues.get(series)!.shift();
    if (topic) pairs.push({ slot, topic, at });
    else if (slot.date <= releaseThrough) open.push({ slot, at });
  }
  for (const [index, { slot, at }] of open.entries()) {
    const topic = plain[index];
    if (!topic) break;
    pairs.push({ slot, topic, at });
  }
  return pairs.sort((a, b) => a.at - b.at).map(({ slot, topic }) => ({ slot, topic }));
}
