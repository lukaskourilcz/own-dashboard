import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { advanceDneskaiTikTokChart, dneskaiTikTokDailyCeiling, dneskaiTikTokInput, dneskaiTikTokSounds, DNESKAI_TIKTOK_ACTOR, DNESKAI_TIKTOK_PASS_MS, DNESKAI_TIKTOK_RESPONSE_BYTES } from '@/lib/marketing/dneskai-audio-tiktok';
import type { MetaPublisherConfig } from '@/lib/marketing/publisher';
import {tikTokAdmissionReceipt,tikTokBindingReceipt} from '../helpers/dneskai-tiktok-admission-fixtures';
import {observationAccount} from '../helpers/dneskai-audio-observation-fixtures';
const account=(remote='1')=>({...observationAccount,remote_account_id:remote});
import { createClient } from '@supabase/supabase-js';

// #167: the TikTok CZ chart against stand-ins for Apify, Meta and the spend ledger. Nothing leaves the process.
const owner = '11111111-1111-4111-8111-111111111111';
const spendId = '44444444-4444-4444-8444-444444444444';
const config = (patch: Partial<MetaPublisherConfig> = {}): MetaPublisherConfig => ({ enabled: true, apiVersion: 'v99.0', apiVersionVerifiedAt: '2026-10-20T06:00:00Z', loginMode: 'facebook',
  accessToken: 'TEST-ONLY-FB-TOKEN-0000001', tokenExpiresAt: '2099-01-01T00:00:00Z', scopes: [], approvedAssetHosts: [], ...patch });
const paid = { DNESKAI_TIKTOK_TRENDS_ENABLED: 'true', MARKETING_DNESKAI_APIFY_ENABLED: 'true', MARKETING_DNESKAI_PAID_ENABLED: 'true', MARKETING_AI_CONSENT: 'true', APIFY_TOKEN: 'TEST-ONLY-APIFY-TOKEN' };
const now = new Date('2026-10-24T02:30:00Z');
const run = (patch: Record<string, unknown> = {}) => ({ id: 'run_1', actId: DNESKAI_TIKTOK_ACTOR.id, buildNumber: '1.0.0', userId: 'user', defaultDatasetId: 'dataset_1', status: 'SUCCEEDED', startedAt:'2026-10-23T02:30:00Z', finishedAt: '2026-10-23T03:00:00Z', usageTotalUsd: 0.076, ...patch });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });
function rpcQuery<T>(work: Promise<T>) {
  return { retry() { return this; }, abortSignal() { return this; }, then: work.then.bind(work) };
}

function harness(runs: Array<{ id: string; ref: string; reserved_at: string; settled: boolean }>, reserve: { admitted: boolean; id?: string } = { admitted: true, id: spendId }) {
  let admittedAt=now.toISOString();
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>):Promise<{data:unknown;error:{message:string}|null}> => {
    if (name === 'read_dneskai_tiktok_progress') return {data:{ownerId:owner,until:args.p_until,rows:runs.map(row=>({...row,cost_usd:row.settled?0.076:null,reserved_usd:0.1,processed:row.settled}))},error:null};
    if(name==='complete_dneskai_tiktok_run'){const matches=args.p_matches as Array<{audioId:string;title:string;artist:string|null}>;writes.push(...matches);return{data:{ownerId:owner,accountId:args.p_account,remoteAccountId:args.p_remote,verifiedAt:args.p_verified_at,spendId:args.p_spend,ref:args.p_ref,reservedAt:args.p_reserved_at,day:args.p_day,observedAt:args.p_observed_at,sourceDay:'2026-10-23',costUsd:0.076,completedAt:args.p_observed_at,rows:matches.map(item=>({audioId:item.audioId,outcome:'stored',sourceDay:'2026-10-23',observedAt:args.p_observed_at,accountId:args.p_account,remoteAccountId:args.p_remote,verifiedAt:args.p_verified_at,spendId:args.p_spend}))},error:null};}
    if (name === 'reserve_dneskai_tiktok_run'){admittedAt=String(args.p_requested_at);return {data:tikTokAdmissionReceipt(args,reserve),error:null};}
    if (name === 'marketing_settle_dneskai_topic_spend') return { data: true, error: null };
    if(name==='bind_dneskai_tiktok_run')return{data:tikTokBindingReceipt(args),error:null};
    throw new Error(name);
  });
  const writes: unknown[] = [];
  const query = { upsert: (row: unknown) => { writes.push(row); return query; }, update: () => query, eq: () => query, retry: () => query, abortSignal: () => query, then: (resolve: (value: { error: null }) => unknown) => resolve({ error: null }) };
  const calls: string[] = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    calls.push(`${init.method ?? 'GET'} ${url.replace(/\?.*$/, '')}`);
    if (url.includes('/actor-runs/run_1')) return Response.json({ data: run() });
    if (url.includes('/datasets/dataset_1/items')) return Response.json([{ title: 'Ruka ruku myje', author: 'Interpret', rank: 1 }, { error: 'x' }, { title: 'Unknown song' }]);
    if (url.includes('/acts/') && init.method === 'POST') { expect(JSON.parse(String(init.body))).toEqual(dneskaiTikTokInput()); return Response.json({ data: run({ id: 'run_2', defaultDatasetId: 'dataset_2', status: 'READY', startedAt:admittedAt, finishedAt: null, usageTotalUsd: null }) }); }
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
    expect(await advanceDneskaiTikTokChart(h.db, owner, { account:account('17841400000000001'), config: config(), igUserId: '17841400000000001', today: '2026-10-24', env: paid, fetcher: h.fetcher, signal: AbortSignal.timeout(5000), now }))
      .toEqual({ status: 'done', started: true, read: 2, matched: 1 });
    expect(h.writes).toEqual([expect.objectContaining({ audioId: '777', title: 'Ruka ruku myje' })]);
    expect(h.rpc).toHaveBeenCalledWith('complete_dneskai_tiktok_run',expect.objectContaining({p_owner:owner,p_spend:spendId,p_matches:[{audioId:'777',title:'Ruka ruku myje',artist:'Interpret'}]}));
    expect(h.rpc).toHaveBeenCalledWith('reserve_dneskai_tiktok_run', expect.objectContaining({ p_account:account().id,p_day:'2026-10-24',p_ceiling:0.1 }));
    expect(h.calls).toContain('POST https://api.apify.com/v2/acts/clockworks~tiktok-trends-scraper/runs');
  });

  it('spends nothing while switched off, under Instagram Login, without the paid switches or at the cap', async () => {
    for (const [env, cfg, code] of [[{}, config(), 'tiktok-trends-disabled'], [paid, config({ loginMode: 'instagram' }), 'audio-trends-facebook-login-required']] as const) {
      const h = harness([]);
      expect(await advanceDneskaiTikTokChart(h.db, owner, { account:account(), config: cfg, igUserId: '1', today: '2026-10-24', env, fetcher: h.fetcher, signal: AbortSignal.timeout(5000), now })).toMatchObject({ status: 'skipped', code });
      expect(h.fetcher).not.toHaveBeenCalled();
    }
    const unpaid = harness([]);
    expect(await advanceDneskaiTikTokChart(unpaid.db, owner, { account:account(), config: config(), igUserId: '1', today: '2026-10-24', env: { DNESKAI_TIKTOK_TRENDS_ENABLED: 'true' }, fetcher: unpaid.fetcher, signal: AbortSignal.timeout(5000), now })).toMatchObject({ code: 'tiktok-paid-disabled', started: false });
    expect(unpaid.rpc.mock.calls.map(([name]) => name)).not.toContain('reserve_dneskai_tiktok_run');
    const capped = harness([], { admitted: false });
    expect(await advanceDneskaiTikTokChart(capped.db, owner, { account:account(), config: config(), igUserId: '1', today: '2026-10-24', env: paid, fetcher: capped.fetcher, signal: AbortSignal.timeout(5000), now })).toMatchObject({ code: 'tiktok-budget-exhausted', started: false });
    expect(capped.fetcher).not.toHaveBeenCalled();
  });

  it('starts at most one run a day', async () => {
    const h = harness([{ id: spendId, ref: 'tiktok:run_1:dataset_1', reserved_at: '2026-10-24T01:00:00Z', settled: true }]);
    expect(await advanceDneskaiTikTokChart(h.db, owner, { account:account(), config: config(), igUserId: '1', today: '2026-10-24', env: paid, fetcher: h.fetcher, signal: AbortSignal.timeout(5000), now })).toMatchObject({ started: false });
    expect(h.fetcher).not.toHaveBeenCalled();
  });
});

describe('captured TikTok day and cancellation boundaries', () => {
  const options = (h: ReturnType<typeof harness>, patch: Record<string, unknown> = {}) => ({ account:account(), config: config(), igUserId: '1', today: '2026-10-24', env: paid, fetcher: h.fetcher, signal: new AbortController().signal, now, ...patch });
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
    h.rpc.mockImplementationOnce(async () => { abort.abort(); return { data: {ownerId:owner,until:now.toISOString(),rows:[]}, error: null }; });
    await expect(advanceDneskaiTikTokChart(h.db, owner, options(h, { signal: abort.signal }))).rejects.toThrow('tiktok-cancelled');
    expect(h.rpc.mock.calls.map(([name]) => name)).toEqual(['read_dneskai_tiktok_progress']); expect(h.fetcher).not.toHaveBeenCalled();
  });
  it('keeps an accepted reservation uncertain and starts no provider work after cancellation', async () => {
    const h = harness([]), abort = new AbortController(), original = h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation(async (name, args) => { const result = await original(name, args); if (name === 'reserve_dneskai_tiktok_run') abort.abort(); return result; });
    await expect(advanceDneskaiTikTokChart(h.db, owner, options(h, { signal: abort.signal }))).rejects.toThrow('tiktok-cancelled');
    expect(h.rpc.mock.calls.map(([name]) => name)).toEqual(['read_dneskai_tiktok_progress', 'reserve_dneskai_tiktok_run']); expect(h.fetcher).not.toHaveBeenCalled();
  });
  it('does not bind or settle an ambiguously started provider call after cancellation', async () => {
    const h = harness([]), abort = new AbortController();
    const fetcher = vi.fn(async () => { abort.abort(); return Response.json({ data: run({ id: 'run_2', defaultDatasetId: 'dataset_2' }) }); }) as unknown as typeof fetch;
    await expect(advanceDneskaiTikTokChart(h.db, owner, options(h, { signal: abort.signal, fetcher }))).rejects.toThrow('tiktok-cancelled');
    expect(h.rpc.mock.calls.map(([name]) => name)).toEqual(['read_dneskai_tiktok_progress', 'reserve_dneskai_tiktok_run']); expect(fetcher).toHaveBeenCalledOnce();
  });
  it('cannot turn a paid switch on by mutating the caller environment during a read', async () => {
    const h = harness([]), env = { ...paid, MARKETING_DNESKAI_PAID_ENABLED: 'false' };
    h.rpc.mockImplementationOnce(async () => { env.MARKETING_DNESKAI_PAID_ENABLED = 'true'; return { data: {ownerId:owner,until:now.toISOString(),rows:[]}, error: null }; });
    expect(await advanceDneskaiTikTokChart(h.db, owner, options(h, { env }))).toMatchObject({ started: false, code: 'tiktok-paid-disabled' });
    expect(h.fetcher).not.toHaveBeenCalled(); expect(h.rpc.mock.calls.map(([name]) => name)).toEqual(['read_dneskai_tiktok_progress']);
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
    h.rpc.mockResolvedValueOnce({ data: kind === 'missing' ? null : {ownerId:owner,until:now.toISOString(),rows:kind==='duplicate'?[row,row]:[row]}, error: null } as never);
    await expect(advanceDneskaiTikTokChart(h.db, owner, options(h))).rejects.toThrow('tiktok-budget-unavailable');
    expect(h.fetcher).not.toHaveBeenCalled(); expect(h.rpc).toHaveBeenCalledOnce();
  });
});

describe('one bounded TikTok pass', () => {
  const options = (h: ReturnType<typeof harness>, fetcher = h.fetcher) => ({ account:account(), config: config(), igUserId: '1', today: '2026-10-24', env: paid, fetcher, signal: new AbortController().signal, now });
  it.each(['runs', 'reserve', 'complete', 'bind'])('bounds an uncooperative %s RPC and ignores its late receipt', async phase => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = harness(phase === 'complete' ? [{ id: spendId, ref: 'tiktok:run_1:dataset_1', reserved_at: '2026-10-23T02:30:00Z', settled: false }] : []);
    const original = h.rpc.getMockImplementation()!, blocked = { runs: 'read_dneskai_tiktok_progress', reserve: 'reserve_dneskai_tiktok_run', complete: 'complete_dneskai_tiktok_run', bind: 'bind_dneskai_tiktok_run' }[phase]!;
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
    expect(cancel).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce(); expect(h.rpc.mock.calls.map(([name]) => name)).toEqual(['read_dneskai_tiktok_progress', 'reserve_dneskai_tiktok_run']);
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
    expect(cancel).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce(); expect(h.rpc.mock.calls.map(([name]) => name)).not.toContain('bind_dneskai_tiktok_run');
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
    expect(requests).toHaveLength(1); expect(requests[0].path).toBe('/rest/v1/rpc/read_dneskai_tiktok_progress'); expect(requests[0].signal?.aborted).toBe(true); expect(h.fetcher).not.toHaveBeenCalled();
    if (kind === 'stalled') { finish(Response.json([])); await vi.advanceTimersByTimeAsync(0); expect(requests).toHaveLength(1); expect(h.fetcher).not.toHaveBeenCalled(); }
  });
});

describe('conservative TikTok to Meta identity',()=>{
 const sourceRun={id:spendId,ref:'tiktok:run_1:dataset_1',reserved_at:'2026-10-23T02:30:00Z',settled:false};
 const options=(fetcher:typeof fetch)=>({account:account(),config:config(),igUserId:'1',today:'2026-10-24',env:{DNESKAI_TIKTOK_TRENDS_ENABLED:'true',APIFY_TOKEN:'TEST-ONLY-chart-read'},fetcher,signal:new AbortController().signal,now});
 function search(body:unknown,chartArtist:string|null='Interpret'){
  const h=harness([sourceRun]),base=h.fetcher;
  const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
   if(String(url).includes('/datasets/'))return Response.json([{title:'Ruka ruku myje',...(chartArtist?{artist:chartArtist}:{})}]);
   if(String(url).includes('/ig_audio'))return Response.json(body);
   return base(url,init);
  }) as typeof fetch;
  return{h,fetcher};
 }
 it('uses the explicit artist instead of the first same-title recording',async()=>{const f=search({data:[{audio_id:'1',title:'Ruka ruku myje',display_artist:'Different artist'},{audio_id:'2',title:'Ruka ruku myje',display_artist:'Interpret'}]});await advanceDneskaiTikTokChart(f.h.db,owner,options(f.fetcher));expect(f.h.writes).toEqual([expect.objectContaining({audioId:'2'})]);});
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
 it.each([{data:[{audio_id:Number.MAX_SAFE_INTEGER+1,title:'Ruka ruku myje',display_artist:'Interpret'}]},{data:null},{data:[{audio_id:'1',title:'Ruka ruku myje',display_artist:'Interpret'}],error:{message:'Synthetic private Graph error'}},{data:Array.from({length:51},(_,index)=>({audio_id:String(index+1),title:'Ruka ruku myje',display_artist:'Interpret'}))}])('retains unavailable search for reconciliation rather than settling as an empty match: %j',async body=>{const f=search(body);await expect(advanceDneskaiTikTokChart(f.h.db,owner,options(f.fetcher))).rejects.toThrow(/^tiktok-audio-unavailable$/);expect(f.h.writes).toHaveLength(0);expect(f.h.rpc.mock.calls.map(([name])=>name)).toEqual(['read_dneskai_tiktok_progress']);});
 it('retains a failed metadata request and discards its body without settling or starting a new paid run',async()=>{const h=harness([sourceRun]),cancel=vi.fn(),base=h.fetcher;const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>String(url).includes('/ig_audio')?new Response(new ReadableStream({cancel}),{status:503}):base(url,init)) as typeof fetch;await expect(advanceDneskaiTikTokChart(h.db,owner,{...options(fetcher),env:paid})).rejects.toThrow('tiktok-audio-unavailable');expect(cancel).toHaveBeenCalledTimes(2);expect(h.writes).toHaveLength(0);expect(h.rpc.mock.calls.map(([name])=>name)).toEqual(['read_dneskai_tiktok_progress']);});
 it('refuses conflicting duplicate evidence in either order without hiding another possible recording',async()=>{for(const data of [[{audio_id:'1',title:'Ruka ruku myje',display_artist:'Different'},{audio_id:'1',title:'Ruka ruku myje',display_artist:'Interpret'},{audio_id:'2',title:'Ruka ruku myje',display_artist:'Interpret'}],[{audio_id:'2',title:'Ruka ruku myje',display_artist:'Interpret'},{audio_id:'1',title:'Ruka ruku myje',display_artist:'Interpret'},{audio_id:'1',title:'Ruka ruku myje',display_artist:'Different'}]]){const f=search({data});expect(await advanceDneskaiTikTokChart(f.h.db,owner,options(f.fetcher))).toMatchObject({matched:0});expect(f.h.writes).toHaveLength(0);}});
 it('deduplicates equivalent chart identities before Meta searches',async()=>{const h=harness([sourceRun]),base=h.fetcher,fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>String(url).includes('/datasets/')?Response.json([{title:'Ruka ruku myje',artist:'Interpret'},{title:' RUKA  RUKU MYJE ',artist:'INTERPRET'}]):base(url,init)) as typeof fetch;expect(await advanceDneskaiTikTokChart(h.db,owner,options(fetcher))).toMatchObject({read:1,matched:1});expect(h.calls.filter(call=>call.includes('/ig_audio'))).toHaveLength(1);expect(h.writes).toHaveLength(1);});
 it('refuses two title-only recordings when the chart artist is unknown',async()=>{const f=search({data:[{audio_id:'1',title:'Ruka ruku myje',display_artist:'One'},{audio_id:'2',title:'Ruka ruku myje',display_artist:'Two'}]},null);expect(await advanceDneskaiTikTokChart(f.h.db,owner,options(f.fetcher))).toMatchObject({matched:0});expect(f.h.writes).toHaveLength(0);});
});


it.each([['multibyte overflow',new TextEncoder().encode('á'.repeat(DNESKAI_TIKTOK_RESPONSE_BYTES/2+1))],['invalid UTF8',new Uint8Array([0xff])]])('bounds actual bytes and decoding for %s',async(_label,bytes)=>{const h=harness([]),fetcher=vi.fn(async()=>new Response(bytes)) as unknown as typeof fetch;expect(await advanceDneskaiTikTokChart(h.db,owner,{account:account(),config:config(),igUserId:'1',today:'2026-10-24',env:paid,fetcher,signal:new AbortController().signal,now})).toMatchObject({started:false,code:'tiktok-response-unavailable'});expect(h.rpc.mock.calls.map(([name])=>name)).toEqual(['read_dneskai_tiktok_progress','reserve_dneskai_tiktok_run']);});

it('does not claim matched or settle the run when its atomic completion is unconfirmed',async()=>{
 const h=harness([{id:spendId,ref:'tiktok:run_1:dataset_1',reserved_at:'2026-10-23T02:30:00Z',settled:false}]),original=h.rpc.getMockImplementation()!;
 h.rpc.mockImplementation((name,args)=>name==='complete_dneskai_tiktok_run'?Promise.resolve({data:null,error:{message:'Synthetic private persistence refusal'}}) as ReturnType<typeof original>:original(name,args));
 await expect(advanceDneskaiTikTokChart(h.db,owner,{account:account(),config:config(),igUserId:'1',today:'2026-10-24',env:{DNESKAI_TIKTOK_TRENDS_ENABLED:'true',APIFY_TOKEN:'TEST-ONLY-chart-read'},fetcher:h.fetcher,signal:new AbortController().signal,now})).rejects.toThrow('tiktok-completion-unavailable');
});

it.each([{id:'different'},{actId:'different'},{defaultDatasetId:'different'},{startedAt:'2026-10-22T00:00:00Z'},{finishedAt:'2026-10-25T00:00:00Z'}])('refuses changed or impossible provider run identity before matching: %j',async patch=>{
 const h=harness([{id:spendId,ref:'tiktok:run_1:dataset_1',reserved_at:'2026-10-23T02:30:00Z',settled:false}]),base=h.fetcher;
 const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>String(url).includes('/actor-runs/')?Response.json({data:run(patch)}):base(url,init)) as typeof fetch;
 await expect(advanceDneskaiTikTokChart(h.db,owner,{account:account(),config:config(),igUserId:'1',today:'2026-10-24',env:paid,fetcher,signal:new AbortController().signal,now})).rejects.toThrow('tiktok-run-unavailable');expect(h.rpc.mock.calls.map(([name])=>name)).toEqual(['read_dneskai_tiktok_progress']);expect(h.writes).toHaveLength(0);
});
it('keeps unmetered runs unresolved without searching, completing or starting new paid work',async()=>{const h=harness([{id:spendId,ref:'tiktok:run_1:dataset_1',reserved_at:'2026-10-23T02:30:00Z',settled:false}]),fetcher=vi.fn(async()=>Response.json({data:run({usageTotalUsd:null})})) as unknown as typeof fetch;await expect(advanceDneskaiTikTokChart(h.db,owner,{account:account(),config:config(),igUserId:'1',today:'2026-10-24',env:paid,fetcher,signal:new AbortController().signal,now})).rejects.toThrow('tiktok-cost-unavailable');expect(fetcher).toHaveBeenCalledOnce();expect(h.rpc.mock.calls.map(([name])=>name)).toEqual(['read_dneskai_tiktok_progress']);});
it('settles an old chart without issuing new dataset or matching requests',async()=>{const h=harness([{id:spendId,ref:'tiktok:run_1:dataset_1',reserved_at:'2026-10-22T02:30:00Z',settled:false}]),base=h.fetcher;h.rpc.mockImplementationOnce(async(name,args)=>{void name;return{data:{ownerId:owner,until:args.p_until,rows:[{id:spendId,ref:'tiktok:run_1:dataset_1',reserved_at:'2026-10-22T02:30:00Z',settled:false,cost_usd:null,reserved_usd:0.1,processed:false}]},error:null};});const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>String(url).includes('/actor-runs/')?Response.json({data:run({startedAt:'2026-10-22T02:30:00Z',finishedAt:'2026-10-22T03:00:00Z'})}):base(url,init)) as typeof fetch;h.rpc.mockImplementationOnce(async()=>({data:{ownerId:owner,accountId:account().id,remoteAccountId:'1',verifiedAt:account().verified_at,spendId,ref:'tiktok:run_1:dataset_1',reservedAt:'2026-10-22T02:30:00Z',day:'2026-10-24',observedAt:now.toISOString(),sourceDay:'2026-10-22',costUsd:0.076,completedAt:now.toISOString(),rows:[]},error:null}));expect(await advanceDneskaiTikTokChart(h.db,owner,{account:account(),config:config(),igUserId:'1',today:'2026-10-24',env:{DNESKAI_TIKTOK_TRENDS_ENABLED:'true',APIFY_TOKEN:'TEST-ONLY-read'},fetcher,signal:new AbortController().signal,now})).toMatchObject({matched:0,read:0,started:false});expect(fetcher).toHaveBeenCalledOnce();expect(h.writes).toHaveLength(0);});
it('keeps the original parent cancellation identity when the caller replaces its options signal',async()=>{const h=harness([]),parent=new AbortController();let finish!:(value:{data:unknown;error:null})=>void;h.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const options={account:account(),config:config(),igUserId:'1',today:'2026-10-24',env:paid,fetcher:h.fetcher,signal:parent.signal,now};const pending=advanceDneskaiTikTokChart(h.db,owner,options).catch(error=>error);await vi.waitFor(()=>expect(h.rpc).toHaveBeenCalledTimes(1));options.signal=new AbortController().signal;parent.abort('Synthetic private caller reason');expect(await pending).toHaveProperty('message','tiktok-cancelled');finish({data:{ownerId:owner,until:now.toISOString(),rows:[]},error:null});expect(h.fetcher).not.toHaveBeenCalled();});

it('starts no paid provider work from a reservation receipt stamped for another owner',async()=>{const h=harness([]),original=h.rpc.getMockImplementation()!;h.rpc.mockImplementation((name,args)=>['reserve_dneskai_tiktok_run','reserve_dneskai_tiktok_run'].includes(name)?Promise.resolve({data:{...tikTokAdmissionReceipt(args),ownerId:'99999999-9999-4999-8999-999999999999'},error:null}):original(name,args));await expect(advanceDneskaiTikTokChart(h.db,owner,{account:account(),config:config(),igUserId:'1',today:'2026-10-24',env:paid,fetcher:h.fetcher,signal:new AbortController().signal,now})).rejects.toThrow('tiktok-admission-unavailable');expect(h.fetcher).not.toHaveBeenCalled();});
it('does not report a durable provider start from an unscoped Boolean binding acknowledgement',async()=>{const h=harness([]),original=h.rpc.getMockImplementation()!;h.rpc.mockImplementation((name,args)=>['bind_dneskai_tiktok_run','bind_dneskai_tiktok_run'].includes(name)?Promise.resolve({data:true,error:null}):original(name,args));expect(await advanceDneskaiTikTokChart(h.db,owner,{account:account(),config:config(),igUserId:'1',today:'2026-10-24',env:paid,fetcher:h.fetcher,signal:new AbortController().signal,now})).toMatchObject({started:false,code:'tiktok-bind-unavailable'});});
it('finishes all 25 bounded metadata searches under the existing pass deadline',async()=>{vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});const h=harness([{id:spendId,ref:'tiktok:run_1:dataset_1',reserved_at:'2026-10-23T02:30:00Z',settled:false}]),base=h.fetcher;let active=0,maximum=0,searches=0;const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{if(String(url).includes('/datasets/'))return Response.json(Array.from({length:25},(_,i)=>({title:`Synthetic track ${i+1}`,artist:'Artist'})));if(String(url).includes('/ig_audio')){const match=/^Synthetic track (\d+) Artist$/.exec(new URL(String(url)).searchParams.get('search_query')??'');expect(match).not.toBeNull();active++;maximum=Math.max(maximum,active);searches++;await new Promise(resolve=>setTimeout(resolve,500));active--;return Response.json({data:[{audio_id:String(Number(match![1])+1000),title:`Synthetic track ${match![1]}`,display_artist:'Artist'}]});}return base(url,init);}) as typeof fetch;const pending=advanceDneskaiTikTokChart(h.db,owner,{account:account(),config:config(),igUserId:'1',today:'2026-10-24',env:{DNESKAI_TIKTOK_TRENDS_ENABLED:'true',APIFY_TOKEN:'TEST-ONLY-read'},fetcher,signal:new AbortController().signal,now}).catch(error=>error);await vi.advanceTimersByTimeAsync(12_001);expect(await pending).toMatchObject({status:'done',read:25,matched:25,started:false});expect(searches).toBe(25);expect(maximum).toBeGreaterThan(1);expect(maximum).toBeLessThanOrEqual(3);expect(h.rpc.mock.calls.map(([name])=>name)).toEqual(['read_dneskai_tiktok_progress','complete_dneskai_tiktok_run']);});
it('cancels sibling lookups after failure and never launches queued sounds or completion',async()=>{const h=harness([{id:spendId,ref:'tiktok:run_1:dataset_1',reserved_at:'2026-10-23T02:30:00Z',settled:false}]),base=h.fetcher;const requests:{signal:AbortSignal|null|undefined;finish?:(response:Response)=>void}[]=[];const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{if(String(url).includes('/datasets/'))return Response.json(Array.from({length:25},(_,index)=>({title:`Synthetic ${index+1}`,artist:'Artist'})));if(String(url).includes('/ig_audio')){const request:{signal:AbortSignal|null|undefined;finish?:(response:Response)=>void}={signal:init?.signal};requests.push(request);if(requests.length===1)return new Response('Synthetic error',{status:503});return new Promise<Response>(resolve=>{request.finish=resolve;});}return base(url,init);}) as typeof fetch;const result=await advanceDneskaiTikTokChart(h.db,owner,{account:account(),config:config(),igUserId:'1',today:'2026-10-24',env:paid,fetcher,signal:new AbortController().signal,now}).catch(error=>error);expect(result).toHaveProperty('message','tiktok-audio-unavailable');expect(requests).toHaveLength(3);expect(requests.every(request=>request.signal?.aborted)).toBe(true);const cancel=vi.fn();for(const request of requests.slice(1))request.finish!(new Response(new ReadableStream({cancel})));await vi.waitFor(()=>expect(cancel).toHaveBeenCalledTimes(2));expect(requests).toHaveLength(3);expect(h.rpc.mock.calls.map(([name])=>name)).toEqual(['read_dneskai_tiktok_progress']);expect(h.writes).toHaveLength(0);});
it('preserves chart order when metadata responses complete out of order',async()=>{vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});const h=harness([{id:spendId,ref:'tiktok:run_1:dataset_1',reserved_at:'2026-10-23T02:30:00Z',settled:false}]),base=h.fetcher;const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{if(String(url).includes('/datasets/'))return Response.json(Array.from({length:3},(_,i)=>({title:`Ordered ${i+1}`,artist:'Artist'})));if(String(url).includes('/ig_audio')){const index=Number(/Ordered (\d+)/.exec(new URL(String(url)).searchParams.get('search_query')??'')![1]);await new Promise(resolve=>setTimeout(resolve,(4-index)*100));return Response.json({data:[{audio_id:String(index),title:`Ordered ${index}`,display_artist:'Artist'}]});}return base(url,init);}) as typeof fetch;const pending=advanceDneskaiTikTokChart(h.db,owner,{account:account(),config:config(),igUserId:'1',today:'2026-10-24',env:{DNESKAI_TIKTOK_TRENDS_ENABLED:'true',APIFY_TOKEN:'TEST-ONLY-read'},fetcher,signal:new AbortController().signal,now});await vi.advanceTimersByTimeAsync(500);expect(await pending).toMatchObject({matched:3});expect(h.writes.map(value=>(value as {audioId:string}).audioId)).toEqual(['1','2','3']);});
