/**
 * The DNESKAi recurring series (owner decisions, 8 November 2026). A series post is an education topic tagged with
 * `evidence.series`; the plan step seats it in its fixed slot before it fills the rest of the plan with ordinary
 * topics. Every series posts at least twice a week (owner rule, 8 November 2026), from 16 November 2026, on the two
 * daytime slots that post on Instagram and Threads; 08:00 and Threads at 20:00 stay with the news every day:
 *
 * | Day | 12:30 | 17:00 |
 * |---|---|---|
 * | Monday | `explainer` | `karpathy` |
 * | Tuesday | `mosseri` | `cherny` |
 * | Wednesday | `explainer` | `mollick` |
 * | Thursday | `mosseri` | `pocock` |
 * | Friday | `explainer` | `karpathy` |
 * | Saturday | `cherny` | `mollick` |
 * | Sunday | `pocock` | news |
 *
 * Each post carries its series label and running number (`dneskaiSeriesNumber`) on the cover, at the start of the
 * Instagram caption and of the Threads post. Pure and browser-safe.
 */
export const DNESKAI_SERIES = ['explainer', 'mosseri', 'karpathy', 'cherny', 'mollick', 'pocock'] as const;
export type DneskaiSeries = (typeof DNESKAI_SERIES)[number];

/** The first day the plan gives the series their slots. */
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

/** The weekly grid: weekday (0 = Sunday) to the series that own its slots. */
export const DNESKAI_SERIES_GRID: Readonly<Record<number, Readonly<Partial<Record<string, DneskaiSeries>>>>> = {
  1: { '12:30': 'explainer', '17:00': 'karpathy' },
  2: { '12:30': 'mosseri', '17:00': 'cherny' },
  3: { '12:30': 'explainer', '17:00': 'mollick' },
  4: { '12:30': 'mosseri', '17:00': 'pocock' },
  5: { '12:30': 'explainer', '17:00': 'karpathy' },
  6: { '12:30': 'cherny', '17:00': 'mollick' },
  0: { '12:30': 'pocock' },
};
/** The slot times the grid uses; both post on Instagram and Threads. */
export const DNESKAI_SERIES_TIMES = ['12:30', '17:00'] as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The series a topic belongs to, from its evidence, or null for an ordinary topic. */
export function dneskaiSeriesOf(evidence: Record<string, unknown> | null | undefined): DneskaiSeries | null {
  const value = evidence?.series;
  return typeof value === 'string' && (DNESKAI_SERIES as readonly string[]).includes(value) ? value as DneskaiSeries : null;
}

/** The series that owns the slot at `date` and `time`, or null. Noon UTC always falls on the Prague calendar day. */
export function dneskaiSeriesSlot(date: string, time: string): DneskaiSeries | null {
  if (!DATE.test(date) || date < DNESKAI_SERIES_START) return null;
  return DNESKAI_SERIES_GRID[new Date(`${date}T12:00:00Z`).getUTCDay()]?.[time] ?? null;
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

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A first caption line that is already a series heading, of any series and number. */
const HEADING_LINE = new RegExp(`^(?:${Object.values(DNESKAI_SERIES_LABELS).map(escape).join('|')}) #\\d{1,4}$`, 'u');

/**
 * The caption with the series heading as its first line (owner decision, 8 November 2026). The heading shares the
 * first paragraph, so the Threads text, which keeps only that paragraph, starts with it too. A heading already there
 * (an earlier number) is replaced, never stacked.
 */
export function dneskaiSeriesCaption(caption: string, heading: string): string {
  const lines = caption.replace(/^\s+/, '').split('\n');
  const rest = HEADING_LINE.test(lines[0]?.trim() ?? '') ? lines.slice(1).join('\n').replace(/^\s+/, '') : lines.join('\n');
  return rest ? `${heading}\n${rest}` : heading;
}

/** The deck with the series heading on its cover; a deck without a cover photo slide first is left as it is. */
export function dneskaiSeriesDeck<D extends { slides: ReadonlyArray<{ type: string; series?: string }> }>(deck: D, heading: string): D {
  const [cover, ...rest] = deck.slides;
  if (!cover || cover.type !== 'cover-photo') return deck;
  return { ...deck, slides: [{ ...cover, series: heading }, ...rest] };
}

