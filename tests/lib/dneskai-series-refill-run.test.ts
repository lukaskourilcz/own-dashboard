import { describe, expect, it, vi } from 'vitest';
import { runDneskaiSeriesRefill } from '@/lib/marketing/dneskai-series-refill-run';
import type { DneskaiTopicModel } from '@/lib/marketing/dneskai-topic-model';

vi.mock('server-only', () => ({}));

const owner = '11111111-1111-4111-8111-111111111111', project = '33333333-3333-4333-8333-333333333333';
const waveId = '44444444-4444-4444-8444-444444444444';
const env = { MARKETING_AI_CONSENT: 'true', ANTHROPIC_API_KEY: 'test-only-key', APIFY_TOKEN: 'test-only-token' };
const now = new Date('2026-11-09T04:15:00Z');
const approved = (series: string, order: number) => ({ status: 'approved', title_cs: `${series} ${order}`, keyword: `${series}${order}`, source_ref: `manual:series-${series}-t${order}`, evidence: { series, seriesOrder: order, urls: [`https://example.com/${series}/${order}`] } });
const stocked = ['explainer', 'mosseri', 'karpathy', 'cherny', 'mollick', 'pocock'].flatMap((series) => Array.from({ length: series === 'explainer' ? 6 : 4 }, (_, i) => approved(series, i + 1)));

function fakeDb(rows: unknown[], admitted = true) {
  const inserted: Record<string, unknown>[] = [], rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  const query = { select: () => query, eq: () => query, not: () => query, limit: async () => ({ data: rows, error: null }) };
  return {
    inserted, rpcs,
    db: {
      from: () => ({ ...query, insert: async (row: Record<string, unknown>) => { inserted.push(row); return { error: null }; } }),
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcs.push({ name, args });
        return name === 'marketing_reserve_dneskai_series_wave' ? { data: admitted ? { admitted: true, id: waveId } : { admitted: false }, error: null } : { data: true, error: null };
      },
    },
  };
}

const tweet = { author: { userName: 'karpathy' }, url: 'https://x.com/karpathy/status/9', createdAt: '2026-11-01', fullText: 'Do not trust the model blindly. Keep it on a short leash: ask for small diffs you can actually review before you accept them.' };
function fakeApify(headroom = { usage: 1, credits: 5 }) {
  const calls: string[] = [];
  const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input); calls.push(`${init?.method ?? 'GET'} ${url.replace('https://api.apify.com/v2/', '')}`);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.endsWith('users/me/limits')) return json({ data: { limits: { maxMonthlyUsageUsd: 100 }, current: { monthlyUsageUsd: headroom.usage } } });
    if (url.endsWith('users/me')) return json({ data: { plan: { monthlyUsageCreditsUsd: headroom.credits } } });
    if (url.includes('/runs?')) return json({ data: { id: 'run1', status: 'SUCCEEDED', defaultDatasetId: 'ds1', usageTotalUsd: 0.03 } });
    if (url.includes('datasets/ds1/items')) return json([tweet, { ...tweet, author: { userName: 'stranger' } }]);
    return new Response('{}', { status: 404 });
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

const tip = {
  sourceId: 'x-0', quote: 'Keep it on a short leash: ask for small diffs you can actually review', slug: 'karpathy-short-leash', title: 'AI píše rychle. Karpathy radí držet ji na krátkém vodítku.', keyword: 'vodítko',
  summary: 'Andrej Karpathy, spoluzakladatel OpenAI, radí nenechat model psát velké změny naráz. Lepší je chtít po něm malé kroky, které člověk opravdu přečte, a teprve pak je přijmout. Rychlost AI podle něj nic neznamená, když se chyba schová ve stovkách řádků, které nikdo neviděl. Malý krok se zkontroluje za minutu.',
};
const model: DneskaiTopicModel = { model: 'claude-sonnet-5-5', pricing: { inputPerMillionUsd: 2, outputPerMillionUsd: 10 },
  invoke: vi.fn(async () => ({ output: { tips: [tip, { ...tip, slug: 'karpathy-made-up', quote: 'Something Karpathy never wrote anywhere in the posts we read' }] }, usage: { inputTokens: 2000, outputTokens: 1000 } })) as never };

describe('a series refill wave', () => {
  it('does nothing paid and writes nothing while every series has two weeks in stock', async () => {
    const { db, rpcs, inserted } = fakeDb(stocked);
    const { fetcher, calls } = fakeApify();
    const result = await runDneskaiSeriesRefill({ db: db as never, owner, project, env, now, fetcher, model, reader: async () => null });
    expect(result).toMatchObject({ status: 'skipped', code: 'series-stock-covered', need: {} });
    expect(rpcs).toEqual([]); expect(inserted).toEqual([]); expect(calls).toEqual([]);
  });

  it('stops before reserving when the wave ledger says the last wave was too recent', async () => {
    const { db, inserted } = fakeDb(stocked.filter((row) => row.evidence.series !== 'karpathy'), false);
    const { fetcher, calls } = fakeApify();
    expect(await runDneskaiSeriesRefill({ db: db as never, owner, project, env, now, fetcher, model, reader: async () => null })).toMatchObject({ code: 'series-wave-too-soon' });
    expect(inserted).toEqual([]); expect(calls).toEqual([]);
  });

  it('researches inside the prepaid credit, approves the gated tip, drops the made-up one and settles', async () => {
    const { db, rpcs, inserted } = fakeDb(stocked.filter((row) => row.evidence.series !== 'karpathy'));
    const { fetcher, calls } = fakeApify();
    const result = await runDneskaiSeriesRefill({ db: db as never, owner, project, env, now, fetcher, model, reader: async () => null });
    // Once a wave starts it fills every series to four weeks, so Mosseri's Threads run goes too.
    expect(result).toMatchObject({ status: 'done', need: { karpathy: 8, mosseri: 4, explainer: 6 }, inserted: { karpathy: 1 }, waveId, apifyUsd: 0.06 });
    expect(result.dropped['quote-not-in-source']).toBe(1);
    expect(calls.some((call) => call.startsWith('POST acts/apidojo~tweet-scraper/runs?') && call.includes('maxTotalChargeUsd=0.30'))).toBe(true);
    expect(inserted).toEqual([expect.objectContaining({ status: 'approved', evidence: expect.objectContaining({ series: 'karpathy', seriesOrder: 1, approvedBy: 'dneskai-series-refill' }) })]);
    expect(rpcs.at(-1)).toMatchObject({ name: 'marketing_settle_dneskai_series_wave', args: { p_id: waveId, p_apify: 0.06, p_inserted: 1 } });
  });

  it('starts no Apify run without prepaid headroom (never the card)', async () => {
    const { db } = fakeDb(stocked.filter((row) => row.evidence.series !== 'karpathy'));
    const { fetcher, calls } = fakeApify({ usage: 5, credits: 5 });
    const result = await runDneskaiSeriesRefill({ db: db as never, owner, project, env, now, fetcher, model, reader: async () => null });
    expect(result.code).toBe('series-apify-no-prepaid-headroom');
    expect(calls.some((call) => call.includes('/runs?'))).toBe(false);
    expect(result.apifyUsd).toBe(0);
  });

  it('reserves nothing without model consent', async () => {
    const { db, rpcs } = fakeDb([]);
    expect(await runDneskaiSeriesRefill({ db: db as never, owner, project, env: { ...env, MARKETING_AI_CONSENT: 'false' }, now, model })).toMatchObject({ code: 'series-model-unconfigured' });
    expect(rpcs).toEqual([]);
  });
});
