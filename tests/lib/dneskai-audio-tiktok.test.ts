import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { advanceDneskaiTikTokChart, dneskaiTikTokDailyCeiling, dneskaiTikTokInput, dneskaiTikTokSounds, DNESKAI_TIKTOK_ACTOR, DNESKAI_TIKTOK_PASS_MS, DNESKAI_TIKTOK_RESPONSE_BYTES } from '@/lib/marketing/dneskai-audio-tiktok';
import type { MetaPublisherConfig } from '@/lib/marketing/publisher';
import { createClient } from '@supabase/supabase-js';

// #167: the TikTok CZ chart against stand-ins for Apify, Meta and the spend ledger. Nothing leaves the process.
const owner = '11111111-1111-4111-8111-111111111111';
const spendId = '44444444-4444-4444-8444-444444444444';
const config = (patch: Partial<MetaPublisherConfig> = {}): MetaPublisherConfig => ({ enabled: true, apiVersion: 'v99.0', apiVersionVerifiedAt: '2026-10-20T06:00:00Z', loginMode: 'facebook',
  accessToken: 'TEST-ONLY-FB-TOKEN-0000001', tokenExpiresAt: '2099-01-01T00:00:00Z', scopes: [], approvedAssetHosts: [], ...patch });
const paid = { DNESKAI_TIKTOK_TRENDS_ENABLED: 'true', MARKETING_DNESKAI_APIFY_ENABLED: 'true', MARKETING_DNESKAI_PAID_ENABLED: 'true', MARKETING_AI_CONSENT: 'true', APIFY_TOKEN: 'TEST-ONLY-APIFY-TOKEN' };
const now = new Date('2026-10-24T02:30:00Z');
const run = (patch: Record<string, unknown> = {}) => ({ id: 'run_1', actId: DNESKAI_TIKTOK_ACTOR.id, buildNumber: '1.0.0', userId: 'user', defaultDatasetId: 'dataset_1', status: 'SUCCEEDED', finishedAt: '2026-10-23T03:00:00Z', usageTotalUsd: 0.076, ...patch });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });
function rpcQuery<T>(work: Promise<T>) {
  return { retry() { return this; }, abortSignal() { return this; }, then: work.then.bind(work) };
}

function harness(runs: Array<{ id: string; ref: string; reserved_at: string; settled: boolean }>, reserve: { admitted: boolean; id?: string } = { admitted: true, id: spendId }) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'marketing_dneskai_tiktok_runs') return { data: runs, error: null };
    if (name === 'marketing_reserve_dneskai_topic_spend') return { data: reserve, error: null };
    if (name === 'marketing_settle_dneskai_topic_spend') return { data: true, error: null };
    if (name === 'marketing_dneskai_tiktok_bind') return { data: args.p_ref === 'tiktok:run_2:dataset_2', error: null };
    throw new Error(name);
  });
  const writes: unknown[] = [];
  const query = { upsert: (row: unknown) => { writes.push(row); return query; }, update: () => query, eq: () => query, retry: () => query, abortSignal: () => query, then: (resolve: (value: { error: null }) => unknown) => resolve({ error: null }) };
  const calls: string[] = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    calls.push(`${init.method ?? 'GET'} ${url.replace(/\?.*$/, '')}`);
    if (url.includes('/actor-runs/run_1')) return Response.json({ data: run() });
    if (url.includes('/datasets/dataset_1/items')) return Response.json([{ title: 'Ruka ruku myje', author: 'Interpret', rank: 1 }, { error: 'x' }, { title: 'Unknown song' }]);
    if (url.includes('/acts/') && init.method === 'POST') { expect(JSON.parse(String(init.body))).toEqual(dneskaiTikTokInput()); return Response.json({ data: run({ id: 'run_2', defaultDatasetId: 'dataset_2', status: 'READY', finishedAt: null, usageTotalUsd: null }) }); }
    if (url.includes('/ig_audio')) {
      const query = new URL(url).searchParams.get('search_query') ?? '';
      return Response.json({ data: query.startsWith('Ruka') ? [{ audio_id: '777', title: 'Ruka ruku myje', display_artist: 'Interpret' }] : [] });
    }
    throw new Error(`unexpected ${url}`);
  }) as unknown as typeof fetch;
  return { db: { rpc: (name: string, args: Record<string, unknown>) => rpcQuery(rpc(name, args)), from: () => query } as never, rpc, writes, calls, fetcher };
}

describe('the TikTok CZ chart (#167)', () => {
  it('asks only for Czech surging songs', () => {
    expect(dneskaiTikTokInput()).toEqual({ adsScrapeSounds: true, adsSoundsCountryCode: 'CZ', adsRankType: 'surging', adsScrapeHashtags: false, adsScrapeCreators: false, adsScrapeVideos: false, resultsPerPage: 25 });
    expect(dneskaiTikTokSounds([{ name: ' A ' }, { title: '' }, { title: 'B', artist: 'X', rank: 2 }, { error: 'blocked' }])).toEqual([{ title: 'A', artist: null, rank: null }, { title: 'B', artist: 'X', rank: 2 }]);
    expect(dneskaiTikTokDailyCeiling({})).toBe(0.1);
    expect(() => dneskaiTikTokDailyCeiling({ MARKETING_DNESKAI_TIKTOK_DAILY_USD: 'lots' })).toThrow('tiktok-budget-invalid');
  });

  it('reads yesterday\'s run, marks sounds Meta knows, settles its cost, then reserves and starts today\'s', async () => {
    const h = harness([{ id: spendId, ref: 'tiktok:run_1:dataset_1', reserved_at: '2026-10-23T02:30:00Z', settled: false }]);
    expect(await advanceDneskaiTikTokChart(h.db, owner, { config: config(), igUserId: '17841400000000001', today: '2026-10-24', env: paid, fetcher: h.fetcher, signal: AbortSignal.timeout(5000), now }))
      .toEqual({ status: 'done', started: true, read: 2, matched: 1 });
    expect(h.writes).toEqual([expect.objectContaining({ audio_id: '777', title: 'Ruka ruku myje', tiktok: true })]);
    expect(h.rpc).toHaveBeenCalledWith('marketing_settle_dneskai_topic_spend', { p_owner: owner, p_id: spendId, p_cost: 0.076 });
    expect(h.rpc).toHaveBeenCalledWith('marketing_reserve_dneskai_topic_spend', expect.objectContaining({ p_kind: 'tiktok', p_reservation: 0.1, p_ceiling: 0.1 }));
    expect(h.calls).toContain('POST https://api.apify.com/v2/acts/clockworks~tiktok-trends-scraper/runs');
  });

  it('spends nothing while switched off, under Instagram Login, without the paid switches or at the cap', async () => {
    for (const [env, cfg, code] of [[{}, config(), 'tiktok-trends-disabled'], [paid, config({ loginMode: 'instagram' }), 'audio-trends-facebook-login-required']] as const) {
      const h = harness([]);
      expect(await advanceDneskaiTikTokChart(h.db, owner, { config: cfg, igUserId: '1', today: '2026-10-24', env, fetcher: h.fetcher, signal: AbortSignal.timeout(5000), now })).toMatchObject({ status: 'skipped', code });
      expect(h.fetcher).not.toHaveBeenCalled();
    }
    const unpaid = harness([]);
    expect(await advanceDneskaiTikTokChart(unpaid.db, owner, { config: config(), igUserId: '1', today: '2026-10-24', env: { DNESKAI_TIKTOK_TRENDS_ENABLED: 'true' }, fetcher: unpaid.fetcher, signal: AbortSignal.timeout(5000), now })).toMatchObject({ code: 'tiktok-paid-disabled', started: false });
    expect(unpaid.rpc.mock.calls.map(([name]) => name)).not.toContain('marketing_reserve_dneskai_topic_spend');
    const capped = harness([], { admitted: false });
    expect(await advanceDneskaiTikTokChart(capped.db, owner, { config: config(), igUserId: '1', today: '2026-10-24', env: paid, fetcher: capped.fetcher, signal: AbortSignal.timeout(5000), now })).toMatchObject({ code: 'tiktok-budget-exhausted', started: false });
    expect(capped.fetcher).not.toHaveBeenCalled();
  });

  it('starts at most one run a day', async () => {
    const h = harness([{ id: spendId, ref: 'tiktok:run_1:dataset_1', reserved_at: '2026-10-24T01:00:00Z', settled: true }]);
    expect(await advanceDneskaiTikTokChart(h.db, owner, { config: config(), igUserId: '1', today: '2026-10-24', env: paid, fetcher: h.fetcher, signal: AbortSignal.timeout(5000), now })).toMatchObject({ started: false });
    expect(h.fetcher).not.toHaveBeenCalled();
  });
});

describe('captured TikTok day and cancellation boundaries', () => {
  const options = (h: ReturnType<typeof harness>, patch: Record<string, unknown> = {}) => ({ config: config(), igUserId: '1', today: '2026-10-24', env: paid, fetcher: h.fetcher, signal: new AbortController().signal, now, ...patch });
  it.each([
    { now: new Date(Number.NaN) }, { today: '2026-02-30' }, { today: '2026-10-23' }, { igUserId: 'not-an-id' }, { config: config({ apiVersion: 'v99.0/path' }) },
  ])('rejects invalid captured inputs before database/provider work (%j)', async patch => {
    const h = harness([]);
    expect(await advanceDneskaiTikTokChart(h.db, owner, options(h, patch))).toMatchObject({ status: 'skipped', code: 'tiktok-input-invalid', started: false });
    expect(h.rpc).not.toHaveBeenCalled(); expect(h.fetcher).not.toHaveBeenCalled();
  });
  it('does no work for an already-cancelled caller and hides its abort reason', async () => {
    const h = harness([]), abort = new AbortController(); abort.abort('synthetic-private-abort-reason');
    await expect(advanceDneskaiTikTokChart(h.db, owner, options(h, { signal: abort.signal }))).rejects.toThrow(/^tiktok-cancelled$/);
    expect(h.rpc).not.toHaveBeenCalled(); expect(h.fetcher).not.toHaveBeenCalled();
  });
  it('cannot reserve after a delayed run read returns to a cancelled caller', async () => {
    const h = harness([]), abort = new AbortController();
    h.rpc.mockImplementationOnce(async () => { abort.abort(); return { data: [], error: null }; });
    await expect(advanceDneskaiTikTokChart(h.db, owner, options(h, { signal: abort.signal }))).rejects.toThrow('tiktok-cancelled');
    expect(h.rpc.mock.calls.map(([name]) => name)).toEqual(['marketing_dneskai_tiktok_runs']); expect(h.fetcher).not.toHaveBeenCalled();
  });
  it('keeps an accepted reservation uncertain and starts no provider work after cancellation', async () => {
    const h = harness([]), abort = new AbortController(), original = h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation(async (name, args) => { const result = await original(name, args); if (name === 'marketing_reserve_dneskai_topic_spend') abort.abort(); return result; });
    await expect(advanceDneskaiTikTokChart(h.db, owner, options(h, { signal: abort.signal }))).rejects.toThrow('tiktok-cancelled');
    expect(h.rpc.mock.calls.map(([name]) => name)).toEqual(['marketing_dneskai_tiktok_runs', 'marketing_reserve_dneskai_topic_spend']); expect(h.fetcher).not.toHaveBeenCalled();
  });
  it('does not bind or settle an ambiguously started provider call after cancellation', async () => {
    const h = harness([]), abort = new AbortController();
    const fetcher = vi.fn(async () => { abort.abort(); return Response.json({ data: run({ id: 'run_2', defaultDatasetId: 'dataset_2' }) }); }) as unknown as typeof fetch;
    await expect(advanceDneskaiTikTokChart(h.db, owner, options(h, { signal: abort.signal, fetcher }))).rejects.toThrow('tiktok-cancelled');
    expect(h.rpc.mock.calls.map(([name]) => name)).toEqual(['marketing_dneskai_tiktok_runs', 'marketing_reserve_dneskai_topic_spend']); expect(fetcher).toHaveBeenCalledOnce();
  });
  it('cannot turn a paid switch on by mutating the caller environment during a read', async () => {
    const h = harness([]), env = { ...paid, MARKETING_DNESKAI_PAID_ENABLED: 'false' };
    h.rpc.mockImplementationOnce(async () => { env.MARKETING_DNESKAI_PAID_ENABLED = 'true'; return { data: [], error: null }; });
    expect(await advanceDneskaiTikTokChart(h.db, owner, options(h, { env }))).toMatchObject({ started: false, code: 'tiktok-paid-disabled' });
    expect(h.fetcher).not.toHaveBeenCalled(); expect(h.rpc.mock.calls.map(([name]) => name)).toEqual(['marketing_dneskai_tiktok_runs']);
  });
  it('checks Prague calendar dates rather than twenty-hour windows', async () => {
    const current = new Date('2026-10-24T20:30:00Z');
    const same = harness([{ id: spendId, ref: 'tiktok:run_1:dataset_1', reserved_at: '2026-10-24T00:15:00Z', settled: true }]);
    expect(await advanceDneskaiTikTokChart(same.db, owner, options(same, { now: current }))).toMatchObject({ started: false });
    expect(same.fetcher).not.toHaveBeenCalled(); expect(same.rpc).toHaveBeenCalledOnce();
    const previous = harness([{ id: spendId, ref: 'tiktok:run_1:dataset_1', reserved_at: '2026-10-24T21:50:00Z', settled: true }]);
    expect(await advanceDneskaiTikTokChart(previous.db, owner, options(previous, { now: new Date('2026-10-24T22:10:00Z'), today: '2026-10-25' }))).toMatchObject({ started: true });
  });
  it.each(['missing', 'malformed', 'future', 'duplicate'])('refuses uncertain run evidence before admission (%s)', async kind => {
    const h = harness([]), row = { id: spendId, ref: 'tiktok:pending', reserved_at: kind === 'future' ? '2026-10-25T00:00:00Z' : kind === 'malformed' ? 'invalid' : '2026-10-23T02:30:00Z', settled: false };
    h.rpc.mockResolvedValueOnce({ data: kind === 'missing' ? null : kind === 'duplicate' ? [row, row] : [row], error: null } as never);
    await expect(advanceDneskaiTikTokChart(h.db, owner, options(h))).rejects.toThrow('tiktok-budget-unavailable');
    expect(h.fetcher).not.toHaveBeenCalled(); expect(h.rpc).toHaveBeenCalledOnce();
  });
});

describe('one bounded TikTok pass', () => {
  const options = (h: ReturnType<typeof harness>, fetcher = h.fetcher) => ({ config: config(), igUserId: '1', today: '2026-10-24', env: paid, fetcher, signal: new AbortController().signal, now });
  it.each(['runs', 'reserve', 'settle', 'bind'])('bounds an uncooperative %s RPC and ignores its late receipt', async phase => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = harness(phase === 'settle' ? [{ id: spendId, ref: 'tiktok:run_1:dataset_1', reserved_at: '2026-10-23T02:30:00Z', settled: false }] : []);
    const original = h.rpc.getMockImplementation()!, blocked = { runs: 'marketing_dneskai_tiktok_runs', reserve: 'marketing_reserve_dneskai_topic_spend', settle: 'marketing_settle_dneskai_topic_spend', bind: 'marketing_dneskai_tiktok_bind' }[phase]!;
    let finish!: (value: Awaited<ReturnType<typeof original>>) => void;
    h.rpc.mockImplementation((name, args) => name === blocked ? new Promise(resolve => { finish = resolve; }) : original(name, args));
    const result = advanceDneskaiTikTokChart(h.db, owner, options(h)).catch(error => error);
    await vi.waitFor(() => expect(h.rpc).toHaveBeenCalledWith(blocked, expect.anything()));
    await vi.advanceTimersByTimeAsync(DNESKAI_TIKTOK_PASS_MS + 1);
    expect(await result).toHaveProperty('message', 'tiktok-deadline');
    const rpcCalls = h.rpc.mock.calls.length, providerCalls = h.calls.length, writes = h.writes.length;
    finish({ data: phase === 'runs' ? [] : phase === 'reserve' ? { admitted: true, id: spendId } : true, error: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.rpc).toHaveBeenCalledTimes(rpcCalls); expect(h.calls).toHaveLength(providerCalls); expect(h.writes).toHaveLength(writes);
  });
  it('cancels a response that arrives after the fetch deadline without binding or retrying', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = harness([]), cancel = vi.fn(); let finish!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })) as unknown as typeof fetch;
    const result = advanceDneskaiTikTokChart(h.db, owner, options(h, fetcher)).catch(error => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(DNESKAI_TIKTOK_PASS_MS + 1); expect(await result).toHaveProperty('message', 'tiktok-deadline');
    finish(new Response(new ReadableStream({ cancel }))); await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce(); expect(h.rpc.mock.calls.map(([name]) => name)).toEqual(['marketing_dneskai_tiktok_runs', 'marketing_reserve_dneskai_topic_spend']);
  });
  it('bounds a stalled provider body and releases its reader', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = harness([]), cancel = vi.fn(), response = new Response(new ReadableStream({ cancel }));
    const fetcher = vi.fn(async () => response) as unknown as typeof fetch;
    const result = advanceDneskaiTikTokChart(h.db, owner, options(h, fetcher)).catch(error => error);
    await vi.waitFor(() => expect(response.body!.locked).toBe(true));
    await vi.advanceTimersByTimeAsync(DNESKAI_TIKTOK_PASS_MS + 1);
    expect(await result).toHaveProperty('message', 'tiktok-deadline'); expect(cancel).toHaveBeenCalledOnce(); expect(response.body!.locked).toBe(false); expect(fetcher).toHaveBeenCalledOnce();
  });
  it('refuses a truncated structured response and releases the rest without a retry', async () => {
    const h = harness([]), cancel = vi.fn();
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(' '.repeat(DNESKAI_TIKTOK_RESPONSE_BYTES + 1))); }, cancel }));
    const fetcher = vi.fn(async () => response) as unknown as typeof fetch;
    expect(await advanceDneskaiTikTokChart(h.db, owner, options(h, fetcher))).toMatchObject({ started: false, code: 'tiktok-response-unavailable' });
    expect(cancel).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce(); expect(h.rpc.mock.calls.map(([name]) => name)).not.toContain('marketing_dneskai_tiktok_bind');
  });
  it('refuses an HTTP error without reading a stalled or private error body', async () => {
    const h = harness([]), cancel = vi.fn();
    const fetcher = vi.fn(async () => new Response(new ReadableStream({ cancel }), { status: 503 })) as unknown as typeof fetch;
    expect(await advanceDneskaiTikTokChart(h.db, owner, options(h, fetcher))).toMatchObject({ started: false, code: 'tiktok-http-503' });
    expect(cancel).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each(['refused', 'stalled'])('uses one actual SDK request with cancellation and no retry for a %s read', async kind => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const requests: { path: string; signal: AbortSignal | null | undefined }[] = [];
    let finish!: (response: Response) => void;
    const database = createClient('https://offline.supabase.test', 'TEST-ONLY-public', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: async (input, init) => {
      requests.push({ path: new URL(String(input)).pathname, signal: init?.signal });
      return kind === 'refused' ? Response.json({ message: 'synthetic-private-database-detail' }, { status: 503 }) : new Promise<Response>(resolve => { finish = resolve; });
    } } });
    const h = harness([]), result = advanceDneskaiTikTokChart(database, owner, options(h)).catch(error => error);
    if (kind === 'stalled') { await vi.waitFor(() => expect(requests).toHaveLength(1)); await vi.advanceTimersByTimeAsync(DNESKAI_TIKTOK_PASS_MS + 1); }
    expect(await result).toHaveProperty('message', kind === 'stalled' ? 'tiktok-deadline' : 'tiktok-budget-unavailable');
    expect(requests).toHaveLength(1); expect(requests[0].path).toBe('/rest/v1/rpc/marketing_dneskai_tiktok_runs'); expect(requests[0].signal?.aborted).toBe(true); expect(h.fetcher).not.toHaveBeenCalled();
    if (kind === 'stalled') { finish(Response.json([])); await vi.advanceTimersByTimeAsync(0); expect(requests).toHaveLength(1); expect(h.fetcher).not.toHaveBeenCalled(); }
  });
});

describe('conservative TikTok to Meta identity',()=>{
 const sourceRun={id:spendId,ref:'tiktok:run_1:dataset_1',reserved_at:'2026-10-23T02:30:00Z',settled:false};
 const options=(fetcher:typeof fetch)=>({config:config(),igUserId:'1',today:'2026-10-24',env:{DNESKAI_TIKTOK_TRENDS_ENABLED:'true',APIFY_TOKEN:'TEST-ONLY-chart-read'},fetcher,signal:new AbortController().signal,now});
 function search(body:unknown,chartArtist:string|null='Interpret'){
  const h=harness([sourceRun]),base=h.fetcher;
  const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
   if(String(url).includes('/datasets/'))return Response.json([{title:'Ruka ruku myje',...(chartArtist?{artist:chartArtist}:{})}]);
   if(String(url).includes('/ig_audio'))return Response.json(body);
   return base(url,init);
  }) as typeof fetch;
  return{h,fetcher};
 }
 it('uses the explicit artist instead of the first same-title recording',async()=>{const f=search({data:[{audio_id:'1',title:'Ruka ruku myje',display_artist:'Different artist'},{audio_id:'2',title:'Ruka ruku myje',display_artist:'Interpret'}]});await advanceDneskaiTikTokChart(f.h.db,owner,options(f.fetcher));expect(f.h.writes).toEqual([expect.objectContaining({audio_id:'2'})]);});
 it.each([
  ['two recordings',{data:[{audio_id:'1',title:'Ruka ruku myje',display_artist:'Interpret'},{audio_id:'2',title:'Ruka ruku myje',display_artist:'Interpret'}]}],
  ['conflicting duplicate id',{data:[{audio_id:'1',title:'Ruka ruku myje',display_artist:'Interpret'},{audio_id:'1',title:'Ruka ruku myje',display_artist:'Different artist'}]}],
  ['continued search',{data:[{audio_id:'1',title:'Ruka ruku myje',display_artist:'Interpret'}],paging:{next:'https://graph.facebook.com/synthetic-next'}}],
  ['missing artist',{data:[{audio_id:'1',title:'Ruka ruku myje'}]}],
  ['different diacritics',{data:[{audio_id:'1',title:'Růka ruku myje',display_artist:'Interpret'}]}],
  ['different recording title',{data:[{audio_id:'1',title:'Ruka ruku myje (Remix)',display_artist:'Interpret'}]}],
 ] as const)('leaves %s unmatched rather than selecting an arbitrary recording',async(_label,body)=>{const f=search(body);expect(await advanceDneskaiTikTokChart(f.h.db,owner,options(f.fetcher))).toMatchObject({matched:0});expect(f.h.writes).toHaveLength(0);});
 it('accepts identical duplicate evidence and normalizes only equivalent spacing/case',async()=>{const value={audio_id:'2',title:' RUKA  RUKU MYJE ',display_artist:' INTERPRET '};const f=search({data:[value,value]});expect(await advanceDneskaiTikTokChart(f.h.db,owner,options(f.fetcher))).toMatchObject({matched:1});expect(f.h.writes).toHaveLength(1);});
 it('accepts one title-only result when the chart artist is unknown',async()=>{const f=search({data:[{audio_id:'2',title:'Ruka ruku myje',display_artist:'Interpret'}]},null);expect(await advanceDneskaiTikTokChart(f.h.db,owner,options(f.fetcher))).toMatchObject({matched:1});});
 it.each([{data:[{audio_id:Number.MAX_SAFE_INTEGER+1,title:'Ruka ruku myje',display_artist:'Interpret'}]},{data:null},{data:[{audio_id:'1',title:'Ruka ruku myje',display_artist:'Interpret'}],error:{message:'Synthetic private Graph error'}},{data:Array.from({length:51},(_,index)=>({audio_id:String(index+1),title:'Ruka ruku myje',display_artist:'Interpret'}))}])('retains unavailable search for reconciliation rather than settling as an empty match: %j',async body=>{const f=search(body);await expect(advanceDneskaiTikTokChart(f.h.db,owner,options(f.fetcher))).rejects.toThrow(/^tiktok-audio-unavailable$/);expect(f.h.writes).toHaveLength(0);expect(f.h.rpc.mock.calls.map(([name])=>name)).toEqual(['marketing_dneskai_tiktok_runs']);});
 it('retains a failed metadata request and discards its body without settling or starting a new paid run',async()=>{const h=harness([sourceRun]),cancel=vi.fn(),base=h.fetcher;const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>String(url).includes('/ig_audio')?new Response(new ReadableStream({cancel}),{status:503}):base(url,init)) as typeof fetch;await expect(advanceDneskaiTikTokChart(h.db,owner,{...options(fetcher),env:paid})).rejects.toThrow('tiktok-audio-unavailable');expect(cancel).toHaveBeenCalledOnce();expect(h.writes).toHaveLength(0);expect(h.rpc.mock.calls.map(([name])=>name)).toEqual(['marketing_dneskai_tiktok_runs']);});
 it('refuses conflicting duplicate evidence in either order without hiding another possible recording',async()=>{for(const data of [[{audio_id:'1',title:'Ruka ruku myje',display_artist:'Different'},{audio_id:'1',title:'Ruka ruku myje',display_artist:'Interpret'},{audio_id:'2',title:'Ruka ruku myje',display_artist:'Interpret'}],[{audio_id:'2',title:'Ruka ruku myje',display_artist:'Interpret'},{audio_id:'1',title:'Ruka ruku myje',display_artist:'Interpret'},{audio_id:'1',title:'Ruka ruku myje',display_artist:'Different'}]]){const f=search({data});expect(await advanceDneskaiTikTokChart(f.h.db,owner,options(f.fetcher))).toMatchObject({matched:0});expect(f.h.writes).toHaveLength(0);}});
 it('deduplicates equivalent chart identities before Meta searches',async()=>{const h=harness([sourceRun]),base=h.fetcher,fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>String(url).includes('/datasets/')?Response.json([{title:'Ruka ruku myje',artist:'Interpret'},{title:' RUKA  RUKU MYJE ',artist:'INTERPRET'}]):base(url,init)) as typeof fetch;expect(await advanceDneskaiTikTokChart(h.db,owner,options(fetcher))).toMatchObject({read:1,matched:1});expect(h.calls.filter(call=>call.includes('/ig_audio'))).toHaveLength(1);expect(h.writes).toHaveLength(1);});
 it('refuses two title-only recordings when the chart artist is unknown',async()=>{const f=search({data:[{audio_id:'1',title:'Ruka ruku myje',display_artist:'One'},{audio_id:'2',title:'Ruka ruku myje',display_artist:'Two'}]},null);expect(await advanceDneskaiTikTokChart(f.h.db,owner,options(f.fetcher))).toMatchObject({matched:0});expect(f.h.writes).toHaveLength(0);});
});


it.each([['multibyte overflow',new TextEncoder().encode('á'.repeat(DNESKAI_TIKTOK_RESPONSE_BYTES/2+1))],['invalid UTF8',new Uint8Array([0xff])]])('bounds actual bytes and decoding for %s',async(_label,bytes)=>{const h=harness([]),fetcher=vi.fn(async()=>new Response(bytes)) as unknown as typeof fetch;expect(await advanceDneskaiTikTokChart(h.db,owner,{config:config(),igUserId:'1',today:'2026-10-24',env:paid,fetcher,signal:new AbortController().signal,now})).toMatchObject({started:false,code:'tiktok-response-unavailable'});expect(h.rpc.mock.calls.map(([name])=>name)).toEqual(['marketing_dneskai_tiktok_runs','marketing_reserve_dneskai_topic_spend']);});
