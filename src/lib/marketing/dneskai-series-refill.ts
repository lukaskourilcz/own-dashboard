import { z } from 'zod';
import { DNESKAI_SERIES, DNESKAI_SERIES_GRID, DNESKAI_SERIES_START, type DneskaiSeries } from './dneskai-series';

/**
 * The automatic DNESKAi series refill (owner decision, 8 November 2026): the pure half. A daily Vercel cron asks
 * whether the series still have two weeks of approved posts in stock; when one does not, a wave researches new
 * tips and approves the drafts that pass these code gates. Waves are at least WAVE_GAP_DAYS apart, so the job runs
 * about once every two weeks, and each wave fills every series up to TARGET_DAYS so the stock never drops below
 * two weeks between waves. The I/O half is `dneskai-series-refill-run.ts`. Pure and browser-safe.
 */

/** A wave starts only while the thinnest series has fewer days than this in stock. */
export const DNESKAI_SERIES_STOCK_MIN_DAYS = 14;
/** A wave fills each series up to this many days, so the next wave, two weeks on, still finds two weeks. */
export const DNESKAI_SERIES_TARGET_DAYS = 28;
/** Waves start at least this many days apart, also after a wave that failed (no daily retries that spend again). */
export const DNESKAI_SERIES_WAVE_GAP_DAYS = 12;
/** The per-wave cap in USD, Apify and Claude together; `MARKETING_DNESKAI_SERIES_WAVE_USD` may lower or raise it up to $5. */
export const DEFAULT_DNESKAI_SERIES_WAVE_USD = 1.5;
/** The most of the wave cap Apify may use. The rest is for Claude. */
export const DNESKAI_SERIES_APIFY_SHARE = 0.4;
/** At most this many new tips per series and wave, whatever the stock says. */
export const DNESKAI_SERIES_MAX_PER_WAVE = 8;

/** Posts a week per series, counted from the grid. */
export const DNESKAI_SERIES_PER_WEEK: Readonly<Record<DneskaiSeries, number>> = Object.fromEntries(DNESKAI_SERIES.map((series) => [series,
  Object.values(DNESKAI_SERIES_GRID).reduce((count, day) => count + Object.values(day).filter((value) => value === series).length, 0)])) as Record<DneskaiSeries, number>;

/** The speaker of each creator series, as a Czech summary must name him. The explainer has none. */
export const DNESKAI_SERIES_SPEAKERS: Readonly<Record<Exclude<DneskaiSeries, 'explainer'>, { name: string; surname: RegExp }>> = {
  mosseri: { name: 'Adam Mosseri', surname: /Mosseri/u },
  karpathy: { name: 'Andrej Karpathy', surname: /Karpath/u },
  cherny: { name: 'Boris Cherny', surname: /Chern/u },
  mollick: { name: 'Ethan Mollick', surname: /Mollick/u },
  pocock: { name: 'Matt Pocock', surname: /Pocock/u },
};

/**
 * Where a wave looks. `x` handles go into one Apify X run, `threads` usernames into one Apify Threads run (both from
 * prepaid credit only), `pages` are read free through Jina Reader. Public profiles and pages of the speakers only.
 */
export const DNESKAI_SERIES_SOURCES: Readonly<Record<Exclude<DneskaiSeries, 'explainer'>, { x: readonly string[]; threads: readonly string[]; pages: readonly string[] }>> = {
  mosseri: { x: [], threads: ['mosseri'], pages: [] },
  karpathy: { x: ['karpathy'], threads: [], pages: ['https://karpathy.bearblog.dev/blog/'] },
  cherny: { x: ['bcherny'], threads: [], pages: [] },
  mollick: { x: ['emollick'], threads: [], pages: ['https://www.oneusefulthing.org/archive'] },
  pocock: { x: ['mattpocockuk'], threads: [], pages: ['https://www.aihero.dev/'] },
};

export type DneskaiSeriesStockRow = { status: string; evidence: Record<string, unknown> | null };

/**
 * Approved series topics still to come, per series: approved and either not yet seated or seated today or later.
 * A rejected, proposed or published topic does not count.
 */
export function dneskaiSeriesStock(rows: readonly DneskaiSeriesStockRow[], today: string): Record<DneskaiSeries, number> {
  const stock = Object.fromEntries(DNESKAI_SERIES.map((series) => [series, 0])) as Record<DneskaiSeries, number>;
  for (const row of rows) {
    const series = row.evidence?.series;
    if (row.status !== 'approved' || typeof series !== 'string' || !(series in stock)) continue;
    const planDate = row.evidence?.planDate;
    if (typeof planDate === 'string' && planDate < today) continue;
    stock[series as DneskaiSeries]++;
  }
  return stock;
}

/** Days of stock per series, counted from the later of today and the series start. */
export function dneskaiSeriesStockDays(stock: Readonly<Record<DneskaiSeries, number>>): Record<DneskaiSeries, number> {
  return Object.fromEntries(DNESKAI_SERIES.map((series) => [series, Math.floor((stock[series] / DNESKAI_SERIES_PER_WEEK[series]) * 7)])) as Record<DneskaiSeries, number>;
}

/** How many new tips each series needs to reach TARGET_DAYS, capped per wave; empty when every series has two weeks. */
export function dneskaiSeriesWaveNeed(stock: Readonly<Record<DneskaiSeries, number>>): Partial<Record<DneskaiSeries, number>> {
  const days = dneskaiSeriesStockDays(stock);
  if (Math.min(...DNESKAI_SERIES.map((series) => days[series])) >= DNESKAI_SERIES_STOCK_MIN_DAYS) return {};
  const need: Partial<Record<DneskaiSeries, number>> = {};
  for (const series of DNESKAI_SERIES) {
    const target = Math.ceil((DNESKAI_SERIES_TARGET_DAYS / 7) * DNESKAI_SERIES_PER_WEEK[series]);
    const missing = Math.min(DNESKAI_SERIES_MAX_PER_WAVE, target - stock[series]);
    if (missing > 0) need[series] = missing;
  }
  return need;
}

/** The wave cap from the environment: the default, or a positive value up to $5. A malformed value refuses the wave. */
export function dneskaiSeriesWaveCap(env: Record<string, string | undefined>): number {
  const raw = env.MARKETING_DNESKAI_SERIES_WAVE_USD?.trim();
  if (!raw) return DEFAULT_DNESKAI_SERIES_WAVE_USD;
  const value = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value) || value <= 0 || value > 5) throw new Error('series-wave-cap-invalid');
  return value;
}

/** The first day a wave's stock is counted from: the series start until it has passed. */
export const dneskaiSeriesStockFrom = (today: string) => (today < DNESKAI_SERIES_START ? DNESKAI_SERIES_START : today);

/**
 * Apify headroom inside the prepaid credit (owner rule: never the card). The usage of this billing cycle plus the
 * Apify cap must stay within both the account's monthly usage limit and the prepaid credit the plan includes.
 * Anything missing or unreadable means no headroom.
 */
export const ApifyLimitsSchema = z.object({ data: z.object({ limits: z.object({ maxMonthlyUsageUsd: z.number().nonnegative() }), current: z.object({ monthlyUsageUsd: z.number().nonnegative() }) }) });
export const ApifyUserSchema = z.object({ data: z.object({ plan: z.object({ monthlyUsageCreditsUsd: z.number().nonnegative() }) }) });
export function dneskaiApifyPrepaidHeadroom(limits: unknown, user: unknown): number {
  const parsedLimits = ApifyLimitsSchema.safeParse(limits), parsedUser = ApifyUserSchema.safeParse(user);
  if (!parsedLimits.success || !parsedUser.success) return 0;
  const ceiling = Math.min(parsedLimits.data.data.limits.maxMonthlyUsageUsd, parsedUser.data.data.plan.monthlyUsageCreditsUsd);
  return Math.max(0, ceiling - parsedLimits.data.data.current.monthlyUsageUsd);
}

/** One piece of source text a draft may quote: a post, a page or an encyclopedia entry. */
export type DneskaiSeriesSource = { id: string; series: DneskaiSeries; url: string; text: string; postedAt: string | null };

/** What the model returns for one tip; every field is checked by `dneskaiSeriesDraftIssues` before it is used. */
export const DneskaiSeriesDraftSchema = z.object({
  sourceId: z.string().min(1).max(80),
  quote: z.string().min(1).max(600),
  slug: z.string().min(1).max(80),
  term: z.string().max(80).optional(),
  title: z.string().min(1).max(200),
  keyword: z.string().min(1).max(40),
  summary: z.string().min(1).max(1500),
});
export type DneskaiSeriesDraft = z.infer<typeof DneskaiSeriesDraftSchema>;
export const DneskaiSeriesDraftsSchema = z.object({ tips: z.array(DneskaiSeriesDraftSchema).max(DNESKAI_SERIES_MAX_PER_WAVE * 2) });

const squash = (text: string) => text.normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”„]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
/** A topic's identity for de-duplication: lower case, no diacritics, letters and digits only. */
export const dneskaiSeriesKey = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Words the post itself may never carry (DNESKAi post rules: no sources, credits, handles or links). */
const FORBIDDEN = /https?:\/\/|www\.|@\w|\bzdroj|\bpodle (?:článku|webu|příspěvku|zdroj)|\bdostupn(?:ý|ých) (?:text|zdroj)|#\w/iu;

export type DneskaiSeriesKnown = { titles: readonly string[]; keywords: readonly string[]; slugs: readonly string[]; urls: readonly string[] };

/**
 * The code gates a draft must pass to be approved without the owner (same rule as the main pipeline: what passes the
 * gates is approved). Empty means it passes.
 * - its quote is at least 40 characters and stands word for word in the source it names;
 * - the source belongs to the same series and its page was not used by an earlier tip;
 * - title and summary follow the house rules: a statement (no question mark), no source, link, handle or hashtag;
 * - a creator tip names its speaker in the summary;
 * - it repeats no earlier title, keyword or slug of the series.
 */
export function dneskaiSeriesDraftIssues(series: DneskaiSeries, draft: DneskaiSeriesDraft, sources: readonly DneskaiSeriesSource[], known: DneskaiSeriesKnown): string[] {
  const issues: string[] = [];
  const source = sources.find((item) => item.id === draft.sourceId);
  if (!source || source.series !== series) issues.push('source-unknown');
  else {
    if (squash(draft.quote).length < 40) issues.push('quote-short');
    else if (!squash(source.text).includes(squash(draft.quote))) issues.push('quote-not-in-source');
    if (known.urls.includes(source.url)) issues.push('source-used');
  }
  const title = draft.title.trim(), summary = draft.summary.trim();
  if (title.length < 20 || title.length > 120) issues.push('title-length');
  if (title.includes('?')) issues.push('title-question');
  if (summary.length < 200 || summary.length > 900) issues.push('summary-length');
  if (FORBIDDEN.test(title) || FORBIDDEN.test(summary)) issues.push('mentions-source');
  if (series !== 'explainer' && !DNESKAI_SERIES_SPEAKERS[series].surname.test(summary)) issues.push('speaker-missing');
  if (series === 'explainer' && !draft.term?.trim()) issues.push('term-missing');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug)) issues.push('slug-invalid');
  const keys = (values: readonly string[]) => new Set(values.map(dneskaiSeriesKey));
  if (keys(known.titles).has(dneskaiSeriesKey(title))) issues.push('title-repeated');
  if (keys(known.keywords).has(dneskaiSeriesKey(draft.keyword))) issues.push('keyword-repeated');
  if (known.slugs.includes(draft.slug)) issues.push('slug-repeated');
  return issues;
}

/** The topic row of an approved draft, in the shape the hand-made series topics already use. */
export function dneskaiSeriesTopicRow(input: { owner: string; project: string; series: DneskaiSeries; order: number; draft: DneskaiSeriesDraft; source: DneskaiSeriesSource; waveId: string; now: Date; today: string }) {
  const { draft, source } = input;
  const at = input.now.toISOString();
  return {
    user_id: input.owner, project_id: input.project, kind: 'education', source_kind: 'manual',
    source_ref: `manual:series-${input.series}-${draft.slug}`.slice(0, 300), title_cs: draft.title.trim(), summary: draft.summary.trim(),
    keyword: draft.keyword.trim().toLowerCase(), status: 'approved', proposed_for: input.today, approved_at: at, updated_at: at,
    evidence: {
      series: input.series, seriesOrder: input.order, urls: [source.url], quote: draft.quote.trim(), said: source.postedAt,
      ...(draft.term ? { term: draft.term.trim() } : {}), confidence: 'gated', approvedBy: 'dneskai-series-refill', wave: input.waveId,
    },
  };
}
