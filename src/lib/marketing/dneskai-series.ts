/**
 * The DNESKAi recurring series (owner decisions, 8 November 2026). A series post is an education topic tagged with
 * `evidence.series`; the plan step seats it in its fixed slot before it fills the rest of the plan with ordinary
 * topics. Every series slot is at 12:30 (Instagram and Threads) from 16 November 2026:
 *
 * | Day | Series |
 * |---|---|
 * | Monday, Wednesday, Friday | `explainer`, "Slovník AI #N" |
 * | Tuesday, Thursday | `mosseri`, "Tipy od šéfa Instagramu Mosseriho #N" |
 * | Saturday | `karpathy`, "Tipy od leadera vibecodingu Karpathyho #N" |
 * | Sunday, by turns week after week | `cherny`, `mollick`, `pocock` |
 *
 * Each post carries its series label and running number (`dneskaiSeriesNumber`) on the cover, at the start of the
 * Instagram caption and of the Threads post. Pure and browser-safe.
 */
export const DNESKAI_SERIES = ['explainer', 'mosseri', 'karpathy', 'cherny', 'mollick', 'pocock'] as const;
export type DneskaiSeries = (typeof DNESKAI_SERIES)[number];

/** The series slot time; 12:30 posts on Instagram and Threads. */
export const DNESKAI_SERIES_TIME = '12:30';
/** The first day the plan gives the series their slots (a Monday; Sunday turns count weeks from it). */
export const DNESKAI_SERIES_START = '2026-11-16';

/** The label each post of a series carries before its number, in the owner's words. */
export const DNESKAI_SERIES_LABELS: Readonly<Record<DneskaiSeries, string>> = {
  explainer: 'Slovník AI',
  mosseri: 'Tipy od šéfa Instagramu Mosseriho',
  karpathy: 'Tipy od leadera vibecodingu Karpathyho',
  cherny: 'Tipy od tvůrce Claude Code Borise Chernyho',
  mollick: 'Tipy profesora AI Ethana Mollicka',
  pocock: 'Tipy Matta Pococka na AI skills',
};

/** Weekday (0 = Sunday) to the series that own it; a day with several series gives them the day by turns. */
export const DNESKAI_SERIES_WEEK: Readonly<Record<number, readonly DneskaiSeries[]>> = {
  1: ['explainer'], 2: ['mosseri'], 3: ['explainer'], 4: ['mosseri'], 5: ['explainer'], 6: ['karpathy'], 0: ['cherny', 'mollick', 'pocock'],
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** The series a topic belongs to, from its evidence, or null for an ordinary topic. */
export function dneskaiSeriesOf(evidence: Record<string, unknown> | null | undefined): DneskaiSeries | null {
  const value = evidence?.series;
  return typeof value === 'string' && (DNESKAI_SERIES as readonly string[]).includes(value) ? value as DneskaiSeries : null;
}

/** Noon UTC of a Prague `YYYY-MM-DD` date: always the same calendar day. */
const noon = (date: string) => Date.parse(`${date}T12:00:00Z`);

/** The series that owns the slot at `date` and `time`, or null. */
export function dneskaiSeriesSlot(date: string, time: string): DneskaiSeries | null {
  if (!DATE.test(date) || time !== DNESKAI_SERIES_TIME || date < DNESKAI_SERIES_START) return null;
  const owners = DNESKAI_SERIES_WEEK[new Date(noon(date)).getUTCDay()] ?? [];
  if (owners.length <= 1) return owners[0] ?? null;
  const week = Math.floor((noon(date) - noon(DNESKAI_SERIES_START)) / (7 * DAY_MS));
  return owners[week % owners.length]!;
}

/** The label with the running number, as the cover, the caption and the Threads post start: "Slovník AI #3". */
export function dneskaiSeriesHeading(series: DneskaiSeries, number: number): string {
  return `${DNESKAI_SERIES_LABELS[series]} #${number}`;
}

/**
 * The running number of each series post in the plan (owner decision, 8 November 2026: numbered on publication, no
 * gaps). Published posts are numbered in the order they went out; the ones still to come follow in slot order. A post
 * skipped or failed before publication gets no number, so the later ones close up. Pure; returns slot id → number.
 */
export function dneskaiSeriesNumbers(slots: ReadonlyArray<{ id: string; date: string; local_time: string; series: DneskaiSeries; status: string }>): Map<string, number> {
  const numbers = new Map<string, number>();
  const counts = new Map<DneskaiSeries, number>();
  const live = slots.filter((slot) => slot.status !== 'skipped' && slot.status !== 'failed');
  const ordered = [...live].sort((a, b) => Number(b.status === 'published') - Number(a.status === 'published') || `${a.date} ${a.local_time}`.localeCompare(`${b.date} ${b.local_time}`));
  for (const slot of ordered) {
    const next = (counts.get(slot.series) ?? 0) + 1;
    counts.set(slot.series, next);
    numbers.set(slot.id, next);
  }
  return numbers;
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
