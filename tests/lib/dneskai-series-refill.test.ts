import { describe, expect, it } from 'vitest';
import {
  DNESKAI_SERIES_PER_WEEK, dneskaiApifyPrepaidHeadroom, dneskaiSeriesDraftIssues, dneskaiSeriesStock, dneskaiSeriesStockDays,
  dneskaiSeriesTopicRow, dneskaiSeriesWaveCap, dneskaiSeriesWaveNeed, type DneskaiSeriesDraft, type DneskaiSeriesSource,
} from '@/lib/marketing/dneskai-series-refill';

const full = { explainer: 12, mosseri: 8, karpathy: 8, cherny: 8, mollick: 8, pocock: 8 };
const row = (series: string, status = 'approved', planDate?: string) => ({ status, evidence: { series, ...(planDate ? { planDate } : {}) } });
const source: DneskaiSeriesSource = { id: 'x-1', series: 'karpathy', url: 'https://x.com/karpathy/status/1', postedAt: '2026-11-01',
  text: 'Do not trust the model blindly. Keep it on a short leash: ask for small diffs you can actually review before you accept them.' };
const draft: DneskaiSeriesDraft = {
  sourceId: 'x-1', quote: 'Keep it on a short leash: ask for small diffs you can actually review', slug: 'karpathy-short-leash', title: 'AI píše rychle. Karpathy radí držet ji na krátkém vodítku.', keyword: 'vodítko',
  summary: 'Andrej Karpathy, spoluzakladatel OpenAI, radí nenechat model psát velké změny naráz. Lepší je chtít po něm malé kroky, které člověk opravdu přečte, a teprve pak je přijmout. Rychlost AI podle něj nic neznamená, když se chyba schová ve stovkách řádků, které nikdo neviděl. Malý krok se zkontroluje za minutu.',
};
const known = { titles: [], keywords: [], slugs: [], urls: [] };

describe('series refill stock', () => {
  it('counts the grid: three explainers a week, two of every creator series', () => {
    expect(DNESKAI_SERIES_PER_WEEK).toEqual({ explainer: 3, mosseri: 2, karpathy: 2, cherny: 2, mollick: 2, pocock: 2 });
  });

  it('counts approved topics still to come, not past, proposed or rejected ones', () => {
    const stock = dneskaiSeriesStock([row('karpathy'), row('karpathy', 'approved', '2026-11-20'), row('karpathy', 'approved', '2026-11-10'),
      row('karpathy', 'proposed'), row('karpathy', 'rejected'), row('reels'), { status: 'approved', evidence: null }], '2026-11-16');
    expect(stock.karpathy).toBe(2);
    expect(dneskaiSeriesStockDays(stock).karpathy).toBe(7);
  });

  it('skips the wave while every series has two weeks, and fills each to four weeks otherwise', () => {
    expect(dneskaiSeriesWaveNeed({ explainer: 6, mosseri: 4, karpathy: 4, cherny: 4, mollick: 4, pocock: 4 })).toEqual({});
    expect(dneskaiSeriesWaveNeed({ ...full, karpathy: 3 })).toEqual({ karpathy: 5 });
    expect(dneskaiSeriesWaveNeed({ explainer: 0, mosseri: 0, karpathy: 0, cherny: 0, mollick: 0, pocock: 0 }))
      .toEqual({ explainer: 8, mosseri: 8, karpathy: 8, cherny: 8, mollick: 8, pocock: 8 });
  });

  it('reads the wave cap and refuses a malformed one', () => {
    expect(dneskaiSeriesWaveCap({})).toBe(1.5);
    expect(dneskaiSeriesWaveCap({ MARKETING_DNESKAI_SERIES_WAVE_USD: '0.8' })).toBe(0.8);
    for (const value of ['0', '6', 'abc', '-1']) expect(() => dneskaiSeriesWaveCap({ MARKETING_DNESKAI_SERIES_WAVE_USD: value })).toThrow('series-wave-cap-invalid');
  });
});

describe('Apify prepaid headroom', () => {
  const limits = (usage: number, max = 100) => ({ data: { limits: { maxMonthlyUsageUsd: max }, current: { monthlyUsageUsd: usage } } });
  const user = (credits: number) => ({ data: { plan: { monthlyUsageCreditsUsd: credits } } });
  it('is what is left of the prepaid credit, never above the monthly limit', () => {
    expect(dneskaiApifyPrepaidHeadroom(limits(3), user(5))).toBe(2);
    expect(dneskaiApifyPrepaidHeadroom(limits(3, 4), user(5))).toBe(1);
    expect(dneskaiApifyPrepaidHeadroom(limits(6), user(5))).toBe(0);
  });
  it('is zero when the account answer is missing or malformed', () => {
    expect(dneskaiApifyPrepaidHeadroom(null, user(5))).toBe(0);
    expect(dneskaiApifyPrepaidHeadroom(limits(1), { data: {} })).toBe(0);
  });
});

describe('series draft gates', () => {
  it('passes a verified, paraphrased tip that names its speaker', () => {
    expect(dneskaiSeriesDraftIssues('karpathy', draft, [source], known)).toEqual([]);
  });

  it('refuses a quote that is not in the source, a short quote and a foreign source', () => {
    expect(dneskaiSeriesDraftIssues('karpathy', { ...draft, quote: 'Keep the model on a long leash and accept whatever it writes for you' }, [source], known)).toContain('quote-not-in-source');
    expect(dneskaiSeriesDraftIssues('karpathy', { ...draft, quote: 'short leash' }, [source], known)).toContain('quote-short');
    expect(dneskaiSeriesDraftIssues('mollick', draft, [source], known)).toContain('source-unknown');
  });

  it('refuses a question, a source mention, a missing speaker and a repeat', () => {
    expect(dneskaiSeriesDraftIssues('karpathy', { ...draft, title: 'Píše AI rychle? Karpathy radí krátké vodítko.' }, [source], known)).toContain('title-question');
    expect(dneskaiSeriesDraftIssues('karpathy', { ...draft, summary: `${draft.summary} Zdrojem je jeho příspěvek na síti X.` }, [source], known)).toContain('mentions-source');
    expect(dneskaiSeriesDraftIssues('karpathy', { ...draft, summary: draft.summary.replace(/Andrej Karpathy/g, 'Expert').replace(/Karpathy/g, 'on') }, [source], known)).toContain('speaker-missing');
    expect(dneskaiSeriesDraftIssues('karpathy', draft, [source], { ...known, keywords: ['Vodítko'], urls: [source.url] })).toEqual(expect.arrayContaining(['keyword-repeated', 'source-used']));
  });

  it('writes an approved topic in the shape of the hand-made series topics', () => {
    const topic = dneskaiSeriesTopicRow({ owner: 'o', project: 'p', series: 'karpathy', order: 5, draft, source, waveId: 'w', now: new Date('2026-11-09T04:15:00Z'), today: '2026-11-09' });
    expect(topic).toMatchObject({ kind: 'education', source_kind: 'manual', source_ref: 'manual:series-karpathy-karpathy-short-leash', status: 'approved', keyword: 'vodítko',
      evidence: { series: 'karpathy', seriesOrder: 5, urls: [source.url], approvedBy: 'dneskai-series-refill', wave: 'w' } });
  });
});
