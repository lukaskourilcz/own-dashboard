import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  MARKETING_DAILY_DUTIES, MARKETING_TICK_CATEGORIES, runMarketingTick, signedUrlExpiresAt, schedulerFailureCode,
  type MarketingSchedulerPorts, type MarketingSchedulerStore, type MarketingTickResult, type MarketingTickStep, type SchedulerLeaseResult,
} from '@/lib/marketing/scheduler';
import type { MetaTokenMetadata } from '@/lib/marketing/meta-credentials';

const owner = '11111111-1111-4111-8111-111111111111';
const project = '22222222-2222-4222-8222-222222222222';
const runId = '33333333-3333-4333-8333-333333333333', finishedRun = '44444444-4444-4444-8444-444444444444';
const jobA = '55555555-5555-4555-8555-555555555555', jobB = '66666666-6666-4666-8666-666666666666';
const publication = '77777777-7777-4777-8777-777777777777', account = '88888888-8888-4888-8888-888888888888';
// 20 October 2026 is summer time in Prague (UTC+2): 20:30Z is 22:30 there, 12:00Z is 14:00.
const evening = Date.parse('2026-10-20T20:30:00Z'), afternoon = Date.parse('2026-10-20T12:00:00Z');
let tickCounter = 0;
const tickId = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++tickCounter).padStart(12, '0')}`;
const on = {
  MARKETING_DNESKAI_COLLECTION_ENABLED: 'true', MARKETING_DNESKAI_PAID_ENABLED: 'true', MARKETING_AI_CONSENT: 'true',
  MARKETING_PUBLISH_ENABLED: 'true', MARKETING_DNESKAI_PUBLISH_ENABLED: 'true',
};
const iso = (ms: number) => new Date(ms).toISOString();

class Clock { constructor(public at: number) {} now = () => new Date(this.at); advance(ms: number) { this.at += ms; } }

/** The lease semantics of marketing_scheduler_acquire/release, in memory. */
function memoryStore(clock: Clock) {
  const ticks = new Map<string, { kind: string; did?: MarketingTickStep[]; errors?: unknown[] }>();
  const leases = new Map<string, { holder: string | null; until: number; next: number | null; state: Record<string, unknown> }>();
  const store: MarketingSchedulerStore & { ticks: typeof ticks; leases: typeof leases; acquired: string[] } = {
    ticks, leases, acquired: [],
    async beginTick(tick, kind) { if (ticks.has(tick)) return false; ticks.set(tick, { kind }); return true; },
    async finishTick(tick, did, errors) { const row = ticks.get(tick); if (!row || row.did) return false; row.did = did; row.errors = errors; return true; },
    async acquire(lease, holder, seconds): Promise<SchedulerLeaseResult> {
      const at = clock.at;
      const row = leases.get(lease) ?? { holder: null, until: 0, next: null, state: {} };
      if (row.holder && row.until > at && row.holder !== holder) return { acquired: false, reason: 'busy', until: iso(row.until) };
      if (row.next !== null && row.next > at) return { acquired: false, reason: 'backoff', until: iso(row.next) };
      row.holder = holder; row.until = at + seconds * 1000; leases.set(lease, row); store.acquired.push(lease);
      return { acquired: true, until: iso(row.until), state: structuredClone(row.state) };
    },
    async release(lease, holder, update) {
      const row = leases.get(lease);
      if (!row || row.holder !== holder) return false;
      row.holder = null; row.until = 0; row.next = update.nextAllowedAt ? Date.parse(update.nextAllowedAt) : null;
      if (update.state) row.state = structuredClone(update.state);
      return true;
    },
    async saveState(lease, holder, state) {
      const row = leases.get(lease);
      if (!row || row.holder !== holder || row.until <= clock.at) return false;
      row.state = structuredClone(state);
      return true;
    },
    async pruneTicks() { return 3; },
  };
  return store;
}

const dueToken = (refreshedAt = iso(evening - 50 * 86_400_000)): MetaTokenMetadata => ({
  accountId: account, brand: 'dneskai', platform: 'instagram', expiresAt: iso(evening + 5 * 86_400_000), refreshedAt, scopes: ['instagram_business_basic'], loginMode: 'instagram',
});

/** Ports with nothing to do; each test switches on the work it needs. Every call is recorded in order. */
function harness(overrides: Partial<MarketingSchedulerPorts> = {}, clock = new Clock(afternoon), store = memoryStore(clock)) {
  const calls: Array<[string, unknown[]]> = [];
  const base: MarketingSchedulerPorts = {
    store,
    dneskaiProject: async () => project,
    collectionRuns: async () => [],
    tickCollection: async () => ({ runId, status: 'running', continue: true, retryAfterSeconds: 15 }),
    pendingMedia: async () => [],
    collectMedia: async (_project, ids) => ({ complete: true, candidates: ids.map((candidateId) => ({ candidateId, status: 'complete' as const, assets: 2, downloaded: 2, reused: 0, skipped: [] })) }),
    mediaCollectionActive: async () => false,
    purgeMedia: async () => ({ purged: 0, errorCode: null }),
    createBriefs: async () => { throw new Error('briefs-unwired'); },
    queuedGenerationJobs: async () => [],
    executeJob: async () => ({ claimed: true, status: 'review' }),
    publicationDueSoon: async () => false,
    publicationWork: async () => false,
    publishDue: async () => ({ outcomes: [] }),
    nextReconciliation: async () => null,
    reconcile: async () => ({ status: 'published', errorCode: null }),
    tokenMetadata: async () => [],
    refreshToken: async (token) => ({ status: 'refreshed', accountId: token.accountId, expiresAt: iso(evening + 60 * 86_400_000), refreshedAt: iso(evening) }),
    renewableRevisions: async () => [],
    renewRevision: async () => ({ renewed: 1 }),
    ...overrides,
  };
  const ports = Object.fromEntries(Object.entries(base).map(([name, value]) => [name, typeof value === 'function'
    ? async (...args: unknown[]) => { calls.push([name, args]); return (value as (...input: unknown[]) => unknown)(...args); }
    : value])) as unknown as MarketingSchedulerPorts;
  const tick = (env: Record<string, string | undefined> = on, kind: 'minute' | 'daily' = 'minute', id = tickId(), signal?: AbortSignal) => runMarketingTick({ owner, env, ports, now: clock.now, ...(signal ? { signal } : {}) }, { tick: id, kind });
  const called = (name: string) => calls.filter(([entry]) => entry === name);
  return { ports, calls, called, store, clock, tick };
}
const WORK = ['tickCollection', 'collectMedia', 'createBriefs', 'executeJob', 'publishDue', 'reconcile', 'refreshToken', 'renewRevision', 'purgeMedia'];
const step = (result: MarketingTickResult, category: string) => result.did.find((entry) => entry.category === category)!;
const statuses = (result: MarketingTickResult) => Object.fromEntries(result.did.map((entry) => [entry.category, entry.code ? `${entry.status}:${entry.code}` : entry.status]));
/** Every category has work and the clock stands still, so every category has its full budget. */
const busyDay = (): Partial<MarketingSchedulerPorts> => ({
  collectionRuns: async () => [{ id: runId, date: '2026-10-20', status: 'running', pilot: false }, { id: finishedRun, date: '2026-10-19', status: 'partial', pilot: false }],
  pendingMedia: async () => ['candidate-1', 'candidate-2'],
  createBriefs: async () => ({ created: [{ briefId: 'brief-1', eventId: 'event-1', jobId: jobA }], skipped: [], pending: false }),
  queuedGenerationJobs: async () => [jobA, jobB],
  publicationWork: async () => true,
  publishDue: async () => ({ outcomes: [{ publicationId: publication, status: 'published', errorCode: null }] }),
  nextReconciliation: async () => publication,
  tokenMetadata: async () => [dueToken()],
});

describe('a tick with nothing to do', () => {
  it('reads cheaply, takes no lease, calls no work and records seven no-ops', async () => {
    const { tick, called, store } = harness();
    const result = await tick();
    expect(result.did.map((entry) => entry.category)).toEqual([...MARKETING_TICK_CATEGORIES]);
    expect(statuses(result)).toEqual({ collection: 'noop:collection-not-due', media: 'noop', briefs: 'noop:briefs-no-finished-run', generation: 'noop', publishing: 'noop', reconciliation: 'noop', token: 'noop' });
    for (const name of WORK) expect(called(name)).toEqual([]);
    expect(store.acquired).toEqual([]);
    expect(result).toMatchObject({ duplicate: false, recorded: true, errors: [], next: { pending: [] } });
    expect([...store.ticks.values()][0].did).toEqual(result.did);
  });
  it('does nothing at all for a replayed tick id', async () => {
    const { tick, calls } = harness(busyDay());
    const id = tickId();
    await tick(on, 'minute', id);
    const before = calls.length;
    expect(await tick(on, 'minute', id)).toMatchObject({ duplicate: true, recorded: false, did: [], errors: [] });
    // The store answered "seen before"; no port was asked anything.
    expect(calls.slice(before)).toEqual([]);
  });
});

describe('a tick with work in every category', () => {
  it('runs exactly one unit of each, in order, one after another', async () => {
    const { tick, calls, called, clock } = harness(busyDay(), new Clock(evening));
    const result = await tick();
    expect(result.did.map((entry) => `${entry.category}:${entry.status}`)).toEqual(MARKETING_TICK_CATEGORIES.map((category) => `${category}:done`));
    const work = calls.map(([name]) => name).filter((name) => WORK.includes(name));
    expect(work).toEqual(['tickCollection', 'collectMedia', 'createBriefs', 'executeJob', 'publishDue', 'reconcile', 'refreshToken']);
    expect(called('tickCollection')[0][1].slice(0, 2)).toEqual([project, runId]);
    expect(called('collectMedia')[0][1].slice(0, 2)).toEqual([project, ['candidate-1', 'candidate-2']]);
    expect((called('collectMedia')[0][1][2] as { budgetMs: number }).budgetMs).toBe(40_000);
    expect(called('createBriefs')[0][1][0]).toMatchObject({ owner, project, runId: finishedRun });
    expect(called('executeJob').map(([, args]) => args[0])).toEqual([jobA]);
    expect(called('publishDue')[0][1][0]).toBe(false);
    expect(called('reconcile')[0][1][0]).toBe(publication);
    expect(result.next.pending).toEqual(['collection', 'generation']);
    expect(step(result, 'collection').detail).toMatchObject({ runId, continue: true, admitted: false });
    void clock;
  });
  it('defers what no longer fits the tick budget and leaves it pending', async () => {
    const clock = new Clock(evening);
    const { tick, called } = harness({ ...busyDay(), tickCollection: async () => { clock.advance(30_000); return { runId, status: 'running', continue: true, retryAfterSeconds: 15 }; } }, clock);
    const result = await tick();
    // 18 s are left after collection: too little for media (25 s), generation (43 s) and a live publish (30 s).
    expect(statuses(result)).toMatchObject({ collection: 'done', media: 'deferred:tick-budget-exhausted', briefs: 'done', generation: 'deferred:tick-budget-exhausted', publishing: 'deferred:tick-budget-exhausted', reconciliation: 'done', token: 'done' });
    expect(called('collectMedia')).toEqual([]);
    expect(called('executeJob')).toEqual([]);
    expect(called('publishDue')).toEqual([]);
    expect(result.next.pending).toEqual(expect.arrayContaining(['media', 'generation', 'publishing']));
  });
  it('starts a live publish only with 30 s left and a dry run with 15 s', async () => {
    const run = async (spentMs: number, env: Record<string, string | undefined>) => {
      const clock = new Clock(evening);
      const h = harness({ publicationWork: async () => true, publishDue: async () => ({ outcomes: [] }), queuedGenerationJobs: async () => { clock.advance(spentMs); return []; } }, clock);
      return { status: statuses(await h.tick(env)).publishing, calls: h.called('publishDue').length };
    };
    expect(await run(17_000, on)).toEqual({ status: 'done', calls: 1 });
    expect(await run(19_000, on)).toEqual({ status: 'deferred:tick-budget-exhausted', calls: 0 });
    const dry = { ...on, MARKETING_DNESKAI_PUBLISH_ENABLED: 'false' };
    expect(await run(19_000, dry)).toEqual({ status: 'done', calls: 1 });
    expect(await run(34_000, dry)).toEqual({ status: 'deferred:tick-budget-exhausted', calls: 0 });
  });
  it('isolates every failure: each category still runs and each error is recorded with a stable code', async () => {
    const fail = (message: string) => async () => { throw Object.assign(new Error(message), message === 'with code' ? { code: 'claude-configuration-required' } : {}); };
    const { tick, called, store } = harness({
      ...busyDay(),
      tickCollection: fail('collection-store-unavailable'), collectMedia: fail('Network said: <html>secret</html>'), createBriefs: fail('brief store unavailable'),
      executeJob: fail('with code'), publishDue: fail('publication-state-unavailable'), reconcile: fail('publication-unavailable'), refreshToken: fail('boom'),
    }, new Clock(evening));
    const result = await tick();
    expect(result.did.map((entry) => entry.status)).toEqual(Array(7).fill('error'));
    expect(result.errors).toEqual([
      { category: 'collection', code: 'collection-store-unavailable' }, { category: 'media', code: 'media-failed' }, { category: 'briefs', code: 'briefs-failed' },
      { category: 'generation', code: 'claude-configuration-required' }, { category: 'publishing', code: 'publication-state-unavailable' },
      { category: 'reconciliation', code: 'publication-unavailable' }, { category: 'token', code: 'refresh-request-uncertain' },
    ]);
    expect(JSON.stringify(result)).not.toContain('secret');
    for (const name of ['tickCollection', 'collectMedia', 'createBriefs', 'executeJob', 'publishDue', 'reconcile', 'refreshToken']) expect(called(name)).toHaveLength(1);
    expect([...store.leases.values()].every((lease) => lease.holder === null)).toBe(true);
    expect(result.recorded).toBe(true);
  });
  it('keeps going when a precheck read fails', async () => {
    const { tick } = harness({ ...busyDay(), dneskaiProject: async () => { throw new Error('dneskai-project-unavailable'); } }, new Clock(evening));
    const result = await tick();
    expect(statuses(result)).toMatchObject({ collection: 'error:dneskai-project-unavailable', media: 'error:dneskai-project-unavailable', briefs: 'error:dneskai-project-unavailable', generation: 'done', publishing: 'done', token: 'done' });
  });
});

describe('pauses', () => {
  it('records a $0 skip for every paused category and calls none of their work', async () => {
    const { tick, called } = harness(busyDay(), new Clock(evening));
    const result = await tick({});
    expect(statuses(result)).toEqual({
      collection: 'skipped:collection-disabled', media: 'skipped:collection-disabled', briefs: 'skipped:collection-disabled', generation: 'skipped:generation-consent-required',
      publishing: 'done', reconciliation: 'done', token: 'done',
    });
    for (const name of ['tickCollection', 'collectMedia', 'createBriefs', 'executeJob', 'pendingMedia', 'queuedGenerationJobs']) expect(called(name)).toEqual([]);
    // Publishing without both switches is a dry run: no Meta write.
    expect(called('publishDue')[0][1][0]).toBe(true);
    expect(step(result, 'publishing').detail).toMatchObject({ dryRun: true });
  });
  it.each([
    [{ MARKETING_PUBLISH_ENABLED: 'false' }, true], [{ MARKETING_DNESKAI_PUBLISH_ENABLED: undefined }, true], [{}, false],
  ])('publishes live only with both switches (%j)', async (patch, dryRun) => {
    const { tick, called } = harness(busyDay(), new Clock(evening));
    await tick({ ...on, ...patch });
    expect(called('publishDue')[0][1][0]).toBe(dryRun);
  });
  it('makes collection, media, briefs and generation wait while a live publication is due', async () => {
    const { tick, called } = harness({ ...busyDay(), publicationDueSoon: async () => true }, new Clock(evening));
    const result = await tick();
    expect(statuses(result)).toMatchObject({ collection: 'deferred:yield-to-publication', media: 'deferred:yield-to-publication', briefs: 'deferred:yield-to-publication', generation: 'deferred:yield-to-publication', publishing: 'done' });
    for (const name of ['tickCollection', 'collectMedia', 'createBriefs', 'executeJob']) expect(called(name)).toEqual([]);
    expect(called('publicationDueSoon')).toHaveLength(1);
    const dry = harness({ ...busyDay(), publicationDueSoon: async () => true }, new Clock(evening));
    expect(statuses(await dry.tick({ ...on, MARKETING_PUBLISH_ENABLED: 'false' }))).toMatchObject({ collection: 'done', media: 'done', briefs: 'done', generation: 'done' });
    expect(dry.called('publicationDueSoon')).toEqual([]);
  });
});

describe('collection', () => {
  it('admits today after 22:00 Prague, never before, and stops once today has a finished run', async () => {
    const before = harness({}, new Clock(Date.parse('2026-10-20T19:59:00Z')));
    expect(step(await before.tick(), 'collection')).toMatchObject({ status: 'noop', code: 'collection-not-due' });
    expect(before.called('tickCollection')).toEqual([]);
    const after = harness({}, new Clock(Date.parse('2026-10-20T20:00:00Z')));
    expect(step(await after.tick(), 'collection')).toMatchObject({ status: 'done', pending: true, detail: { admitted: true } });
    expect(after.called('tickCollection')[0][1][1]).toBeUndefined();
    const finished = harness({ collectionRuns: async () => [{ id: runId, date: '2026-10-20', status: 'complete', pilot: false }] }, new Clock(evening));
    expect(step(await finished.tick(), 'collection')).toMatchObject({ status: 'noop', code: 'collection-finished' });
  });
  it('records how long the run list read took on a not-due no-op, and reads it once for collection and briefs', async () => {
    const clock = new Clock(Date.parse('2026-10-20T12:00:00Z'));
    const slow = harness({ collectionRuns: async () => { clock.advance(16_000); return []; } }, clock);
    expect(step(await slow.tick(), 'collection')).toMatchObject({ status: 'noop', code: 'collection-not-due', detail: { yieldMs: 0, runsMs: 16_000 } });
    expect(slow.called('collectionRuns')).toHaveLength(1);
  });
  it('still continues a run that is running after midnight, before 22:00 Prague', async () => {
    const h = harness({ collectionRuns: async () => [{ id: runId, date: '2026-10-20', status: 'running', pilot: false }] }, new Clock(Date.parse('2026-10-20T22:30:00Z')));
    expect(step(await h.tick(), 'collection')).toMatchObject({ status: 'done', detail: { admitted: false } });
    expect(h.called('tickCollection')[0][1][1]).toBe(runId);
  });
  it('leaves a date held by a retained pilot run alone and never ticks or briefs a pilot run', async () => {
    const h = harness({ collectionRuns: async () => [{ id: runId, date: '2026-10-20', status: 'running', pilot: true }, { id: finishedRun, date: '2026-10-19', status: 'complete', pilot: true }] }, new Clock(evening));
    const result = await h.tick();
    expect(statuses(result)).toMatchObject({ collection: 'noop:collection-pilot-today', briefs: 'noop:briefs-no-finished-run' });
    expect(result.errors).toEqual([]);
    for (const name of ['tickCollection', 'createBriefs']) expect(h.called(name)).toEqual([]);
    // Yesterday's pilot run does not hold today: ordinary admission goes ahead.
    const yesterday = harness({ collectionRuns: async () => [{ id: finishedRun, date: '2026-10-19', status: 'complete', pilot: true }] }, new Clock(evening));
    expect(step(await yesterday.tick(), 'collection')).toMatchObject({ status: 'done', detail: { admitted: true } });
  });
  it('respects retryAfterSeconds and stops after continue=false', async () => {
    const h = harness({ collectionRuns: async () => [{ id: runId, date: '2026-10-20', status: 'running', pilot: false }] }, new Clock(evening));
    await h.tick();
    expect(h.store.leases.get('collection')?.next).toBe(evening + 15_000);
    h.clock.advance(10_000);
    expect(step(await h.tick(), 'collection')).toMatchObject({ status: 'backoff', pending: true });
    h.clock.advance(5_000);
    expect(step(await h.tick(), 'collection').status).toBe('done');
    expect(h.called('tickCollection')).toHaveLength(2);
    const done = harness({ collectionRuns: async () => [{ id: runId, date: '2026-10-20', status: 'running', pilot: false }], tickCollection: async () => ({ runId, status: 'complete', continue: false }) }, new Clock(evening));
    const result = await done.tick();
    expect(step(result, 'collection')).toMatchObject({ status: 'done', detail: { continue: false, runStatus: 'complete' } });
    expect(step(result, 'collection').pending).toBeUndefined();
    expect(done.store.leases.get('collection')?.next).toBeNull();
  });
});

describe('media, briefs and generation', () => {
  it('backs off past the 120 s media claim after a busy candidate and ten minutes after a failure', async () => {
    let busy = true, broken = false;
    const h = harness({
      pendingMedia: async () => ['candidate-1'],
      collectMedia: async () => { if (broken) throw new Error('media-store-unavailable'); return { complete: !busy, candidates: [{ candidateId: 'candidate-1', status: busy ? 'busy' as const : 'complete' as const, assets: 1, downloaded: 0, reused: 0, skipped: [] }] }; },
    }, new Clock(evening));
    expect(step(await h.tick(), 'media')).toMatchObject({ status: 'done', pending: true, detail: { busy: 1 } });
    h.clock.advance(120_000);
    expect(step(await h.tick(), 'media').status).toBe('backoff');
    h.clock.advance(6_000); busy = false; broken = true;
    expect(step(await h.tick(), 'media')).toMatchObject({ status: 'error', code: 'media-store-unavailable' });
    h.clock.advance(9 * 60_000);
    expect(step(await h.tick(), 'media').status).toBe('backoff');
    h.clock.advance(61_000); broken = false;
    expect(step(await h.tick(), 'media')).toMatchObject({ status: 'done', detail: { complete: true } });
    expect(h.called('collectMedia')).toHaveLength(3);
  });
  it('records briefs-unwired as a skip, not an error', async () => {
    const { tick, called } = harness({ collectionRuns: async () => [{ id: finishedRun, date: '2026-10-19', status: 'partial', pilot: false }] }, new Clock(evening));
    const result = await tick();
    expect(step(result, 'briefs')).toMatchObject({ status: 'skipped', code: 'briefs-unwired' });
    expect(result.errors).toEqual([]);
    expect(called('createBriefs')).toHaveLength(1);
  });
  it('creates briefs for a finished run until nothing is pending, then leaves that run alone', async () => {
    let pending = true;
    const h = harness({
      collectionRuns: async () => [{ id: finishedRun, date: '2026-10-19', status: 'partial', pilot: false }],
      createBriefs: async () => ({ created: pending ? [{ briefId: 'b1', eventId: 'e1', jobId: jobA }] : [], skipped: [{ eventId: 'e2', code: 'brief-media-missing' }], pending }),
    }, new Clock(evening));
    expect(step(await h.tick(), 'briefs')).toMatchObject({ status: 'done', pending: true, detail: { created: 1, jobs: 1, skipped: 1 } });
    pending = false;
    expect(step(await h.tick(), 'briefs')).toMatchObject({ status: 'noop' });
    expect(step(await h.tick(), 'briefs')).toMatchObject({ status: 'noop', code: 'briefs-current' });
    expect(h.called('createBriefs')).toHaveLength(2);
  });
  it('also takes up runs with a brief the owner reopened, even after the newest run went current (briefs-07)', async () => {
    const olderRun = '77777777-7777-4777-8777-777777777777';
    let reopened: string[] = [];
    const h = harness({
      collectionRuns: async () => [{ id: finishedRun, date: '2026-10-19', status: 'partial', pilot: false }],
      createBriefs: async (input: { runId: string }) => ({ created: input.runId === olderRun ? [{ briefId: 'b9', eventId: 'e9', jobId: jobB }] : [], skipped: [], pending: false }),
      pendingBriefRuns: async () => reopened,
    }, new Clock(evening));
    expect(step(await h.tick(), 'briefs')).toMatchObject({ status: 'noop' });
    expect(step(await h.tick(), 'briefs')).toMatchObject({ status: 'noop', code: 'briefs-current' });
    reopened = [olderRun, finishedRun];
    expect(step(await h.tick(), 'briefs')).toMatchObject({ status: 'done', detail: { created: 1, jobs: 1, reopenedRuns: 2 } });
    expect(h.called('createBriefs').map(([, args]) => (args[0] as { runId: string }).runId)).toEqual([finishedRun, olderRun, finishedRun]);
    expect(h.called('pendingBriefRuns').map(([, args]) => args[1])).toEqual([finishedRun, '', '']);
    reopened = [];
    expect(step(await h.tick(), 'briefs')).toMatchObject({ status: 'noop', code: 'briefs-current' });
  });
  it('executes the oldest queued job and sets a job that keeps throwing aside for an hour', async () => {
    const h = harness({
      queuedGenerationJobs: async () => [jobA, jobB],
      executeJob: async (id) => { if (id === jobA) throw Object.assign(new Error('job-claim-failed'), { code: 'job-claim-failed' }); return { claimed: true, status: 'review' }; },
    }, new Clock(evening));
    expect(step(await h.tick(), 'generation')).toMatchObject({ status: 'error', code: 'job-claim-failed', detail: { jobId: jobA } });
    expect(step(await h.tick(), 'generation')).toMatchObject({ status: 'done', detail: { jobId: jobB, claimed: true, jobStatus: 'review' } });
    h.clock.advance(61 * 60_000);
    expect(step(await h.tick(), 'generation').detail).toMatchObject({ jobId: jobA });
    expect(h.called('executeJob').map(([, args]) => args[0])).toEqual([jobA, jobB, jobA]);
  });
});

describe('a job queued again for its deferred retry (GEN-14)', () => {
  it('stays pending, and the next tick runs its second attempt', async () => {
    let attempts = 0;
    const h = harness({ queuedGenerationJobs: async () => attempts < 2 ? [jobA] : [], executeJob: async () => (++attempts === 1 ? { claimed: true, status: 'queued', retry: { attempt: 2 } } : { claimed: true, status: 'review' }) }, new Clock(evening));
    const first = await h.tick();
    expect(step(first, 'generation')).toMatchObject({ status: 'done', pending: true, detail: { jobId: jobA, jobStatus: 'queued' } });
    h.clock.advance(5 * 60_000);
    expect(step(await h.tick(), 'generation')).toMatchObject({ status: 'done', detail: { jobId: jobA, jobStatus: 'review' } });
    expect(h.called('executeJob')).toHaveLength(2);
  });
});

describe('generation priority (production-03)', () => {
  // 20:30Z is an even five-minute slot (collection's turn), 20:35Z an odd one.
  const odd = evening + 5 * 60_000;
  const order = (result: MarketingTickResult) => result.did.map((entry) => entry.category);
  it('runs a queued job first, before media and briefs eat its 43 s', async () => {
    const clock = new Clock(afternoon);
    const h = harness({
      queuedGenerationJobs: async () => [jobA], pendingMedia: async () => ['candidate-1'],
      collectMedia: async (_project, ids) => { clock.advance(20_000); return { complete: true, candidates: ids.map((candidateId) => ({ candidateId, status: 'complete' as const, assets: 1, downloaded: 1, reused: 0, skipped: [] })) }; },
      collectionRuns: async () => [{ id: finishedRun, date: '2026-10-20', status: 'complete', pilot: false }],
      createBriefs: async () => { clock.advance(4_000); return { created: [], skipped: [], pending: true }; },
    }, clock);
    const result = await h.tick();
    expect(order(result)).toEqual(['generation', 'collection', 'media', 'briefs', 'publishing', 'reconciliation', 'token']);
    expect(step(result, 'generation')).toMatchObject({ status: 'done', detail: { jobId: jobA } });
    expect(h.called('queuedGenerationJobs')).toHaveLength(1);
    expect(h.called('executeJob').map(([, args]) => args[0])).toEqual([jobA]);
  });
  it('keeps collection first in its own slot while a collection run is in progress', async () => {
    const clock = new Clock(afternoon);
    const h = harness({
      queuedGenerationJobs: async () => [jobA],
      collectionRuns: async () => [{ id: runId, date: '2026-10-20', status: 'running', pilot: false }],
      tickCollection: async () => { clock.advance(15_000); return { runId, status: 'running', continue: true, retryAfterSeconds: 15 }; },
    }, clock);
    const result = await h.tick();
    // Even slot and a collection run in progress: collection keeps its place and generation waits for the next slot.
    expect(order(result)[0]).toBe('collection');
    expect(statuses(result)).toMatchObject({ collection: 'done', generation: 'deferred:tick-budget-exhausted' });
  });
  it('alternates with a running collection by slot, so neither starves at night', async () => {
    const clock = new Clock(evening);
    const h = harness({
      queuedGenerationJobs: async () => [jobA, jobB],
      collectionRuns: async () => [{ id: runId, date: '2026-10-20', status: 'running', pilot: false }],
      tickCollection: async () => { clock.advance(15_000); return { runId, status: 'running', continue: true, retryAfterSeconds: 15 }; },
      executeJob: async () => { clock.advance(40_000); return { claimed: true, status: 'review' }; },
    }, clock);
    const seen: string[] = [];
    for (let slot = 0; slot < 4; slot++) {
      clock.at = evening + slot * 5 * 60_000;
      const result = await h.tick();
      seen.push(`${order(result)[0]} ${statuses(result).collection} ${statuses(result).generation}`);
    }
    expect(seen).toEqual([
      'collection done deferred:tick-budget-exhausted', 'generation deferred:tick-budget-exhausted done',
      'collection done deferred:tick-budget-exhausted', 'generation deferred:tick-budget-exhausted done',
    ]);
    expect(h.called('tickCollection')).toHaveLength(2);
    expect(h.called('executeJob')).toHaveLength(2);
  });
  it('keeps the usual order when nothing is runnable: no job, no consent, or a live publication due', async () => {
    const run = async (overrides: Partial<MarketingSchedulerPorts>, env = on) => order(await harness({ ...busyDay(), collectionRuns: async () => [], ...overrides }, new Clock(odd)).tick(env));
    expect(await run({ queuedGenerationJobs: async () => [] })).toEqual([...MARKETING_TICK_CATEGORIES]);
    expect(await run({}, { ...on, MARKETING_AI_CONSENT: 'false' })).toEqual([...MARKETING_TICK_CATEGORIES]);
    expect(await run({ publicationDueSoon: async () => true })).toEqual([...MARKETING_TICK_CATEGORIES]);
    expect(await run({ queuedGenerationJobs: async () => { throw new Error('jobs-unavailable'); } })).toEqual([...MARKETING_TICK_CATEGORIES]);
    expect(await run({})).toEqual(['generation', ...MARKETING_TICK_CATEGORIES.filter((category) => category !== 'generation')]);
  });
  it('reads each precheck once even when it chose the order', async () => {
    const h = harness({ ...busyDay() }, new Clock(evening));
    await h.tick();
    expect(h.called('queuedGenerationJobs')).toHaveLength(1);
    expect(h.called('collectionRuns')).toHaveLength(2); // once before collection ran, once after it changed the run list
    expect(h.called('publicationDueSoon')).toHaveLength(1);
  });
});

describe('Instagram token refresh', () => {
  it('refreshes one due token per tick and never retries an uncertain refresh of the same token', async () => {
    let token = dueToken();
    let outcome: 'uncertain' | 'refreshed' = 'uncertain';
    const h = harness({
      tokenMetadata: async () => [token],
      refreshToken: async (value) => outcome === 'uncertain' ? { status: 'uncertain', accountId: value.accountId, code: 'refresh-store-failed' } : { status: 'refreshed', accountId: value.accountId, expiresAt: iso(evening + 60 * 86_400_000), refreshedAt: iso(evening) },
    }, new Clock(evening));
    const first = await h.tick();
    expect(step(first, 'token')).toMatchObject({ status: 'error', code: 'refresh-store-failed' });
    expect(first.errors).toEqual([{ category: 'token', code: 'refresh-store-failed' }]);
    for (let index = 0; index < 3; index++) { h.clock.advance(5 * 60_000); expect(step(await h.tick(), 'token')).toMatchObject({ status: 'skipped', code: 'token-refresh-uncertain' }); }
    expect(h.called('refreshToken')).toHaveLength(1);
    // A new stored token (account verification) is a new identity and may be refreshed.
    token = dueToken(iso(evening - 2 * 86_400_000)); outcome = 'refreshed';
    expect(step(await h.tick(), 'token')).toMatchObject({ status: 'done', detail: { accountId: account } });
    expect(h.called('refreshToken')).toHaveLength(2);
  });
  it('marks the refresh before sending it, so a lost release never leads to a second refresh', async () => {
    const clock = new Clock(evening), store = memoryStore(clock);
    const release = store.release.bind(store);
    store.release = async (lease, holder, update) => { if (lease === 'token') throw new Error('scheduler-state-unavailable'); return release(lease, holder, update); };
    const h = harness({ tokenMetadata: async () => [dueToken()], refreshToken: async (value) => ({ status: 'uncertain', accountId: value.accountId, code: 'refresh-request-uncertain' }) }, clock, store);
    expect(step(await h.tick(), 'token')).toMatchObject({ status: 'error', code: 'refresh-request-uncertain' });
    // The release failed; the lease runs out on its own and the mark written before the request remains.
    clock.advance(5 * 60_000);
    expect(step(await h.tick(), 'token')).toMatchObject({ status: 'skipped', code: 'token-refresh-uncertain' });
    expect(h.called('refreshToken')).toHaveLength(1);
  });
  it('sends no refresh when the mark cannot be stored', async () => {
    const clock = new Clock(evening), store = memoryStore(clock);
    store.saveState = async () => { throw new Error('scheduler-state-unavailable'); };
    const h = harness({ tokenMetadata: async () => [dueToken()] }, clock, store);
    const result = await h.tick();
    expect(step(result, 'token')).toMatchObject({ status: 'error', code: 'scheduler-state-unavailable', detail: { accountId: account } });
    expect(h.called('refreshToken')).toEqual([]);
    expect(store.leases.get('token')?.holder).toBeNull();
  });
  it('waits a day after a refused refresh and skips tokens that are not due', async () => {
    const h = harness({ tokenMetadata: async () => [dueToken()], refreshToken: async (value) => ({ status: 'failed', accountId: value.accountId, code: 'refresh-http-400' }) }, new Clock(evening));
    expect(step(await h.tick(), 'token')).toMatchObject({ status: 'error', code: 'refresh-http-400' });
    h.clock.advance(23 * 60 * 60_000);
    expect(step(await h.tick(), 'token')).toMatchObject({ status: 'skipped', code: 'token-refresh-backoff' });
    h.clock.advance(2 * 60 * 60_000);
    expect(step(await h.tick(), 'token').status).toBe('error');
    const fresh = harness({ tokenMetadata: async () => [{ ...dueToken(), expiresAt: iso(evening + 30 * 86_400_000) }, { ...dueToken(), platform: 'threads', loginMode: 'threads' }] }, new Clock(evening));
    expect(step(await fresh.tick(), 'token').status).toBe('noop');
    expect(fresh.called('refreshToken')).toEqual([]);
  });
});

describe('two ticks at the same time', () => {
  it('never runs one category twice at once: the second tick finds the lease held', async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => { open = resolve; });
    let inFlight = 0, most = 0;
    const clock = new Clock(evening);
    const store = memoryStore(clock);
    const shared = { ...busyDay(), tickCollection: async () => { inFlight++; most = Math.max(most, inFlight); await gate; inFlight--; return { runId, status: 'running' as const, continue: true, retryAfterSeconds: 15 }; } };
    const first = harness(shared, clock, store), second = harness(shared, clock, store);
    const running = first.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const other = await second.tick();
    expect(step(other, 'collection')).toMatchObject({ status: 'busy', code: 'lease-held', pending: true });
    open();
    const result = await running;
    expect(step(result, 'collection').status).toBe('done');
    expect(most).toBe(1);
    expect(first.called('tickCollection').length + second.called('tickCollection').length).toBe(1);
  });
});

describe('the daily tick', () => {
  const token = (exp: number) => `header.${Buffer.from(JSON.stringify({ url: 'marketing-assets/x.jpg', iat: 1, exp: Math.floor(exp / 1000) })).toString('base64url')}.signature`;
  const signed = (exp: number) => `https://project.supabase.co/storage/v1/object/sign/marketing-assets/owner/marketing/dneskai/slides/a.jpg?token=${token(exp)}`;
  it('runs only its duties: URL renewal inside 48 h, media retention and tick retention', async () => {
    const h = harness({
      renewableRevisions: async () => [
        { id: 'soon', assetUrls: [signed(evening + 6 * 86_400_000), signed(evening + 24 * 3_600_000)] },
        { id: 'later', assetUrls: [signed(evening + 6 * 86_400_000)] },
        { id: 'unreadable', assetUrls: ['https://project.supabase.co/storage/v1/object/sign/marketing-assets/x.jpg?token=opaque'] },
      ],
      purgeMedia: async () => ({ purged: 4, errorCode: null }),
      ...busyDay(),
    }, new Clock(evening));
    const result = await h.tick(on, 'daily');
    expect(result.did.map((entry) => entry.category)).toEqual([...MARKETING_DAILY_DUTIES]);
    expect(statuses(result)).toEqual({ renewal: 'done', purge: 'done', retention: 'done' });
    expect(h.called('renewRevision').map(([, args]) => args[0])).toEqual(['soon', 'unreadable']);
    expect(step(result, 'renewal').detail).toEqual({ checked: 3, expiring: 2, renewed: 2, failed: 0, setAside: 0 });
    expect(h.called('purgeMedia')[0][1]).toEqual([30]);
    expect(step(result, 'retention').detail).toEqual({ removed: 3 });
    for (const name of ['tickCollection', 'collectMedia', 'createBriefs', 'executeJob', 'publishDue', 'reconcile', 'refreshToken']) expect(h.called(name)).toEqual([]);
  });
  it('never purges while media collection holds a candidate or the media lease', async () => {
    const active = harness({ mediaCollectionActive: async () => true }, new Clock(evening));
    expect(step(await active.tick(on, 'daily'), 'purge')).toMatchObject({ status: 'skipped', code: 'media-collection-in-progress' });
    expect(active.called('purgeMedia')).toEqual([]);
    const clock = new Clock(evening), store = memoryStore(clock);
    await store.acquire('media', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 90);
    const leased = harness({}, clock, store);
    expect(step(await leased.tick(on, 'daily'), 'purge')).toMatchObject({ status: 'busy', code: 'lease-held' });
    expect(leased.called('purgeMedia')).toEqual([]);
  });
  it('sets a revision that can never be renewed aside for a week and retries a transient failure the next day', async () => {
    const failures: Record<string, string> = { old: 'revision-identity-mismatch', flaky: 'asset-storage-unavailable' };
    const h = harness({
      renewableRevisions: async () => ['old', 'flaky', 'fine'].map((id) => ({ id, assetUrls: [signed(h.clock.at + 3_600_000)] })),
      renewRevision: async (id) => { if (failures[id]) throw Object.assign(new Error(failures[id]), { code: failures[id] }); return { renewed: 1 }; },
    }, new Clock(evening));
    const first = await h.tick(on, 'daily');
    expect(step(first, 'renewal')).toMatchObject({ status: 'error', code: 'revision-identity-mismatch', detail: { expiring: 3, renewed: 1, failed: 2, setAside: 0 } });
    h.clock.advance(24 * 60 * 60_000);
    const second = await h.tick(on, 'daily');
    expect(step(second, 'renewal')).toMatchObject({ status: 'error', code: 'asset-storage-unavailable', detail: { expiring: 3, renewed: 1, failed: 1, setAside: 1 } });
    h.clock.advance(7 * 24 * 60 * 60_000);
    await h.tick(on, 'daily');
    expect(h.called('renewRevision').map(([, args]) => args[0])).toEqual(['old', 'flaky', 'fine', 'flaky', 'fine', 'old', 'flaky', 'fine']);
  });
  it('writes the tick record when a renewal or a purge hangs, and leaves the purge holding the media lease', async () => {
    const hang = () => new Promise<never>(() => {});
    const clock = new Clock(evening), store = memoryStore(clock);
    const h = harness({
      renewableRevisions: async () => [{ id: 'soon', assetUrls: [signed(evening + 3_600_000)] }, { id: 'next', assetUrls: [signed(evening + 3_600_000)] }],
      renewRevision: hang, purgeMedia: hang,
    }, clock, store);
    const controller = new AbortController();
    const running = h.tick(on, 'daily', tickId(), controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    const result = await running;
    expect(statuses(result)).toEqual({ renewal: 'error:renewal-cut-off', purge: 'deferred:tick-budget-exhausted', retention: 'deferred:tick-budget-exhausted' });
    expect(h.called('renewRevision')).toHaveLength(1);
    expect(result.recorded).toBe(true);
    // The cut-off renewal keeps its lease until it expires.
    expect(store.leases.get('renewal')?.holder).toBe(result.tick);
    // A purge cut off the same way keeps the media lease, so media collection cannot start beside it.
    const purgeClock = new Clock(evening), purgeStore = memoryStore(purgeClock);
    const purging = harness({ purgeMedia: hang }, purgeClock, purgeStore);
    const purgeController = new AbortController();
    const pending = purging.tick(on, 'daily', tickId(), purgeController.signal);
    await new Promise((resolve) => setTimeout(resolve, 5));
    purgeController.abort();
    const purged = await pending;
    expect(statuses(purged)).toEqual({ renewal: 'noop', purge: 'error:purge-cut-off', retention: 'deferred:tick-budget-exhausted' });
    expect(purgeStore.leases.get('media')?.holder).toBe(purged.tick);
    expect(purged.recorded).toBe(true);
  });
  it('records a failed renewal and a storage failure of the purge without stopping the next duty', async () => {
    const h = harness({
      renewableRevisions: async () => [{ id: 'soon', assetUrls: [signed(evening + 3_600_000)] }],
      renewRevision: async () => { throw Object.assign(new Error('stored-asset-proof-invalid'), { code: 'stored-asset-proof-invalid' }); },
      purgeMedia: async () => ({ purged: 0, errorCode: 'media-purge-storage-failed' }),
    }, new Clock(evening));
    const result = await h.tick(on, 'daily');
    expect(result.errors).toEqual([{ category: 'renewal', code: 'stored-asset-proof-invalid' }, { category: 'purge', code: 'media-purge-storage-failed' }]);
    expect(step(result, 'retention').status).toBe('done');
  });
});

describe('helpers', () => {
  it('reads a signed URL expiry and refuses anything else', () => {
    const exp = Math.floor(evening / 1000);
    const url = `https://x.supabase.co/storage/v1/object/sign/marketing-assets/a.jpg?token=h.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.s`;
    expect(signedUrlExpiresAt(url)).toBe(exp * 1000);
    for (const value of ['not a url', 'https://x.test/a.jpg', 'https://x.test/a.jpg?token=a.b.c', `https://x.test/a.jpg?token=h.${Buffer.from('{"exp":"soon"}').toString('base64url')}.s`]) expect(signedUrlExpiresAt(value)).toBeNull();
  });
  it('passes only code-shaped failure messages to the record', () => {
    expect(schedulerFailureCode(new Error('collection-store-unavailable'), 'collection')).toBe('collection-store-unavailable');
    expect(schedulerFailureCode(Object.assign(new Error('x'), { code: 'meta-login-mode-required' }), 'token')).toBe('meta-login-mode-required');
    expect(schedulerFailureCode(new Error('Bearer abc.def leaked'), 'token')).toBe('token-failed');
    expect(schedulerFailureCode('string', 'media')).toBe('media-failed');
  });
});

describe('review reminder step (owner decision 7)', () => {
  it('runs last in a minute tick, holds no lease and records what it sent', async () => {
    const reviewReminders = vi.fn(async () => ({ due: 2, sent: 1 }));
    const { tick, store } = harness({ reviewReminders });
    const result = await tick();
    expect(result.did.at(-1)).toMatchObject({ category: 'reminder', status: 'done', detail: { due: 2, sent: 1 } });
    expect(reviewReminders).toHaveBeenCalledWith(project, expect.any(Date));
    expect(store.acquired).not.toContain('reminder');
    const quiet = await harness({ reviewReminders: async () => ({ due: 1, sent: 0 }) }).tick();
    expect(step(quiet, 'reminder')).toMatchObject({ status: 'noop' });
  });

  it('is absent without the port, skipped when switched off, and a failure never stops the tick', async () => {
    expect((await harness().tick()).did.map((entry) => entry.category)).not.toContain('reminder');
    const reviewReminders = vi.fn(async () => ({ due: 0, sent: 0 }));
    const off = await harness({ reviewReminders }).tick({ ...on, DNESKAI_REVIEW_REMINDERS_ENABLED: 'false' });
    expect(step(off, 'reminder')).toMatchObject({ status: 'skipped', code: 'reminders-disabled' });
    expect(reviewReminders).not.toHaveBeenCalled();
    const failed = await harness({ reviewReminders: async () => { throw new Error('reminder-write-failed'); } }).tick();
    expect(step(failed, 'reminder')).toMatchObject({ status: 'error', code: 'reminder-write-failed' });
    expect(failed.recorded).toBe(true);
  });
});

describe('scouting step (#151)', () => {
  // 23:00 in Prague, the first five-minute slot of the hour.
  const night = Date.parse('2026-10-20T21:00:00Z');
  const scoutingOn = { ...on, DNESKAI_SCOUTING_ENABLED: 'true', DNESKAI_TOPICS_ENABLED: 'true' };
  const result = { reports: 3, library: 1, inserted: 4, skipped: 2 };

  it('runs right after collection in its hourly night slot, holds no lease and records what it inserted', async () => {
    const scoutTopics = vi.fn(async () => result);
    const { tick, store } = harness({ scoutTopics }, new Clock(night));
    const done = await tick(scoutingOn);
    expect(done.did.map((entry) => entry.category).slice(0, 2)).toEqual(['collection', 'scouting']);
    expect(step(done, 'scouting')).toMatchObject({ status: 'done', detail: result });
    expect(scoutTopics).toHaveBeenCalledWith(project, expect.any(Date));
    expect(store.acquired).not.toContain('scouting');
    const quiet = await harness({ scoutTopics: async () => ({ reports: 0, library: 0, inserted: 0, skipped: 5 }) }, new Clock(night)).tick(scoutingOn);
    expect(step(quiet, 'scouting')).toMatchObject({ status: 'noop' });
  });

  it('waits outside the night and outside its slot', async () => {
    const scoutTopics = vi.fn(async () => result);
    expect(step(await harness({ scoutTopics }).tick(scoutingOn), 'scouting')).toMatchObject({ status: 'noop', code: 'scouting-not-due' });
    expect(step(await harness({ scoutTopics }, new Clock(night + 5 * 60_000)).tick(scoutingOn), 'scouting')).toMatchObject({ status: 'noop', code: 'scouting-not-this-slot' });
    expect(scoutTopics).not.toHaveBeenCalled();
  });

  it('is absent while either switch is off or the port is not wired, and a failure never stops the tick', async () => {
    const scoutTopics = vi.fn(async () => result);
    for (const env of [on, { ...on, DNESKAI_SCOUTING_ENABLED: 'true' }, { ...on, DNESKAI_TOPICS_ENABLED: 'true' }]) {
      expect((await harness({ scoutTopics }, new Clock(night)).tick(env)).did.map((entry) => entry.category)).not.toContain('scouting');
    }
    expect((await harness({}, new Clock(night)).tick(scoutingOn)).did.map((entry) => entry.category)).not.toContain('scouting');
    expect(scoutTopics).not.toHaveBeenCalled();
    const failed = await harness({ scoutTopics: async () => { throw new Error('scouting-write-failed'); } }, new Clock(night)).tick(scoutingOn);
    expect(step(failed, 'scouting')).toMatchObject({ status: 'error', code: 'scouting-write-failed' });
    expect(failed.recorded).toBe(true);
  });
});

describe('daily trending audio (#167)', () => {
  it('runs after the daily duties only with its switch on and the port wired', async () => {
    const audioTrends = vi.fn(async () => ({ status: 'done' as const, stored: 7 }));
    const off = harness({ audioTrends }, new Clock(evening));
    expect((await off.tick(on, 'daily')).did.map((entry) => entry.category)).toEqual([...MARKETING_DAILY_DUTIES]);
    expect(audioTrends).not.toHaveBeenCalled();
    const h = harness({ audioTrends }, new Clock(evening));
    const result = await h.tick({ ...on, DNESKAI_AUDIO_TRENDS_ENABLED: 'true' }, 'daily');
    expect(result.did.map((entry) => entry.category)).toEqual([...MARKETING_DAILY_DUTIES, 'audio-trends']);
    expect(step(result, 'audio-trends')).toMatchObject({ status: 'done', detail: { stored: 7 } });
  });
  it('records Instagram Login as a skip with its code, not an error', async () => {
    const h = harness({ audioTrends: async () => ({ status: 'skipped', code: 'audio-trends-facebook-login-required', stored: 0 }) }, new Clock(evening));
    const result = await h.tick({ ...on, DNESKAI_AUDIO_TRENDS_ENABLED: 'true' }, 'daily');
    expect(statuses(result)['audio-trends']).toBe('skipped:audio-trends-facebook-login-required');
    expect(result.errors).toEqual([]);
  });
});
