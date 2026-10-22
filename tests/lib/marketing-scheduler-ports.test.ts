import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  tick: vi.fn(), pending: vi.fn(), collect: vi.fn(), purge: vi.fn(), loader: vi.fn(), briefs: vi.fn(), briefsGetter: vi.fn(),
  execute: vi.fn(), publish: vi.fn(), reconcile: vi.fn(), list: vi.fn(), refresh: vi.fn(), renew: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/marketing/dneskai-collection', () => ({ tickDneskaiCollection: (...args: unknown[]) => mocks.tick(...args) }));
vi.mock('@/lib/marketing/dneskai-media', () => ({
  pendingDneskaiMediaCandidates: (...args: unknown[]) => mocks.pending(...args), collectDneskaiMedia: (...args: unknown[]) => mocks.collect(...args),
  purgeUnusedDneskaiMedia: (...args: unknown[]) => mocks.purge(...args), createDneskaiMediaLoader: (...args: unknown[]) => mocks.loader(...args),
}));
vi.mock('@/lib/marketing/dneskai-wiring', () => ({ getCreateDneskaiBriefs: (...args: unknown[]) => { mocks.briefsGetter(...args); return mocks.briefs; } }));
vi.mock('@/lib/marketing/worker-runtime', () => ({ executeMarketingJob: (...args: unknown[]) => mocks.execute(...args) }));
vi.mock('@/lib/marketing/source-refresh', () => ({ refreshSource: 'refresh-source-function' }));
vi.mock('@/lib/marketing/orchestrator', () => ({ publishDueMarketing: (...args: unknown[]) => mocks.publish(...args), reconcileStoredMarketingPublication: (...args: unknown[]) => mocks.reconcile(...args) }));
vi.mock('@/lib/marketing/meta-credentials', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/marketing/meta-credentials')>(), listMetaTokenMetadata: (...args: unknown[]) => mocks.list(...args), refreshInstagramToken: (...args: unknown[]) => mocks.refresh(...args) }));
vi.mock('@/lib/marketing/asset-urls', () => ({ renewStoredRevisionAssetUrls: (...args: unknown[]) => mocks.renew(...args) }));
import { createMarketingSchedulerPorts, resolveDneskaiProjectId } from '@/lib/marketing/scheduler-ports';
import { runMarketingTick, type MarketingSchedulerPorts, type MarketingSchedulerStore } from '@/lib/marketing/scheduler';

const owner = '11111111-1111-4111-8111-111111111111', project = '22222222-2222-4222-8222-222222222222', other = '33333333-3333-4333-8333-333333333333';
type Call = [string, unknown[]];
/** A PostgREST-shaped builder that records every call and applies plain `eq` filters to its rows. */
function fakeDb(tables: Record<string, Array<Record<string, unknown>> | { error: string }>) {
  const log: Array<{ table: string; calls: Call[] }> = [];
  const db = {
    rpc: vi.fn(),
    from(table: string) {
      const entry = { table, calls: [] as Call[] }; log.push(entry);
      const rows = () => {
        const value = tables[table] ?? [];
        if (!Array.isArray(value)) return { data: null, error: { message: value.error } };
        return { data: value.filter((row) => entry.calls.every(([name, args]) => !(String(args[0]) in row) || (name === 'eq' ? row[String(args[0])] === args[1] : name !== 'in' || (args[1] as unknown[]).includes(row[String(args[0])])))), error: null };
      };
      const builder: Record<string, unknown> = new Proxy({}, {
        get(_target, property) {
          if (property === 'then') return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(rows()).then(resolve, reject);
          if (property === 'maybeSingle') return async () => { const result = rows(); return { data: result.data?.[0] ?? null, error: result.error }; };
          return (...args: unknown[]) => { entry.calls.push([String(property), args]); return builder; };
        },
      });
      return builder;
    },
  };
  return { db: db as never, log, calls: (table: string) => log.filter((entry) => entry.table === table).map((entry) => entry.calls) };
}
const dneskai = { id: project, user_id: owner, portfolio_key: 'aifirst', repo_full_name: 'lukaskourilcz/aifirst', previous_repo_full_names: [], parent_id: null };
const devshark = { id: other, user_id: owner, portfolio_key: 'own-dashboard', repo_full_name: 'lukaskourilcz/own-dashboard', previous_repo_full_names: [], parent_id: null };

beforeEach(() => { vi.clearAllMocks(); });

describe('DNESKAi project resolution', () => {
  it('finds the one aifirst project through the registry and the existing ownership check', async () => {
    const { db, calls } = fakeDb({ projects: [devshark, dneskai] });
    expect(await resolveDneskaiProjectId(db, owner)).toBe(project);
    expect(calls('projects')[0]).toContainEqual(['eq', ['user_id', owner]]);
    // requireDneskaiProject read the project again by owner and id.
    expect(calls('projects')[1]).toEqual(expect.arrayContaining([['eq', ['user_id', owner]], ['eq', ['id', project]]]));
  });
  it.each([
    [[devshark], 'dneskai-project-unavailable'], [[dneskai, { ...dneskai, id: other }], 'dneskai-project-ambiguous'],
    [[{ ...dneskai, user_id: other }], 'dneskai-project-unavailable'],
  ])('refuses %j', async (rows, code) => {
    await expect(resolveDneskaiProjectId(fakeDb({ projects: rows }).db, owner)).rejects.toThrow(code);
  });
  it('treats a failed read as unavailable', async () => {
    await expect(resolveDneskaiProjectId(fakeDb({ projects: { error: 'down' } }).db, owner)).rejects.toThrow('dneskai-project-unavailable');
  });
});

describe('scheduler ports', () => {
  it('reads the runs of the last two Prague days and flags a retained pilot run', async () => {
    const { db, calls } = fakeDb({ marketing_dneskai_runs: [
      { id: project, date: '2026-10-20', status: 'running', collection_pilot_owner: null },
      { id: other, date: '2026-10-19', status: 'complete', collection_pilot_owner: owner },
    ] });
    expect(await createMarketingSchedulerPorts(db, owner, {}).collectionRuns(project, '2026-10-20')).toEqual([
      { id: project, date: '2026-10-20', status: 'running', pilot: false }, { id: other, date: '2026-10-19', status: 'complete', pilot: true },
    ]);
    expect(calls('marketing_dneskai_runs')[0]).toEqual(expect.arrayContaining([['select', ['id,date,status,collection_pilot_owner']], ['eq', ['user_id', owner]], ['eq', ['project_id', project]], ['gte', ['date', '2026-10-18']]]));
  });
  it('lists queued jobs of the DNESKAi brand only, oldest first', async () => {
    const { db, calls } = fakeDb({ marketing_jobs: [{ id: project }] });
    expect(await createMarketingSchedulerPorts(db, owner, {}).queuedGenerationJobs(5)).toEqual([project]);
    expect(calls('marketing_jobs')[0]).toEqual(expect.arrayContaining([['eq', ['status', 'queued']], ['eq', ['request->generation->source->>brand', 'dneskai']], ['order', ['created_at']], ['limit', [5]]]));
  });
  it('reconciles a publication not checked within the interval and stamps it first', async () => {
    const { db, log } = fakeDb({ marketing_publications: [{ id: other }] });
    const ports = createMarketingSchedulerPorts(db, owner, {});
    expect(await ports.nextReconciliation('2026-10-20T20:00:00.000Z')).toBe(other);
    expect(log[0].calls).toEqual(expect.arrayContaining([['eq', ['marketing_revisions.brand', 'dneskai']], ['eq', ['status', 'reconciliation']], ['or', ['last_checked_at.is.null,last_checked_at.lt."2026-10-20T20:00:00.000Z"']]]));
    mocks.reconcile.mockResolvedValue({ status: 'reconciliation', errorCode: 'remote-status-unavailable', remoteMediaId: 'private' });
    expect(await ports.reconcile(other)).toEqual({ status: 'reconciliation', errorCode: 'remote-status-unavailable' });
    expect(log[1].calls[0][0]).toBe('update');
    expect(mocks.reconcile).toHaveBeenCalledWith(db, owner, other);
  });
  it('reads a claim whose lease expired when no publication is in reconciliation', async () => {
    const { db, log } = fakeDb({ marketing_publications: [{ id: other, status: 'claimed' }] });
    expect(await createMarketingSchedulerPorts(db, owner, {}).nextReconciliation('2026-10-20T20:00:00.000Z')).toBe(other);
    expect(log[0].calls).toContainEqual(['eq', ['status', 'reconciliation']]);
    expect(log[1].calls).toEqual(expect.arrayContaining([['eq', ['status', 'claimed']], ['lt', ['lease_until', expect.any(String)]], ['or', ['last_checked_at.is.null,last_checked_at.lt."2026-10-20T20:00:00.000Z"']]]));
    expect(await createMarketingSchedulerPorts(fakeDb({ marketing_publications: [{ id: other, status: 'queued' }] }).db, owner, {}).nextReconciliation('2026-10-20T20:00:00.000Z')).toBeNull();
  });
  it('offers approved and ready revisions with their asset URLs for renewal', async () => {
    const asset = (url: string) => ({ url, sha256: 'a'.repeat(64) });
    const { db } = fakeDb({ marketing_revisions: [
      { id: 'approved', status: 'approved', ready: true, assets: [asset('https://a/1'), asset('https://a/2')] },
      { id: 'draft', status: 'review', ready: false, assets: [asset('https://a/3')] },
      { id: 'ready', status: 'review', ready: true, assets: [asset('https://a/4')] },
      { id: 'empty', status: 'approved', ready: true, assets: [] },
    ] });
    expect(await createMarketingSchedulerPorts(db, owner, {}).renewableRevisions()).toEqual([{ id: 'approved', assetUrls: ['https://a/1', 'https://a/2'] }, { id: 'ready', assetUrls: ['https://a/4'] }]);
  });
  it('calls the owning modules with the owner, the project and the tick signal', async () => {
    const { db } = fakeDb({});
    const env = { MARKETING_DNESKAI_COLLECTION_ENABLED: 'true' };
    const ports = createMarketingSchedulerPorts(db, owner, env);
    const signal = new AbortController().signal;
    mocks.tick.mockResolvedValue({ runId: project, status: 'running', continue: true });
    await ports.tickCollection(project, undefined, signal);
    await ports.tickCollection(project, other, signal);
    expect(mocks.tick.mock.calls[0]).toEqual([owner, { projectId: project }, { store: expect.anything(), signal, env }]);
    expect(mocks.tick.mock.calls[1][1]).toEqual({ projectId: project, runId: other });
    await ports.collectMedia(project, ['c1'], { signal, budgetMs: 40_000 });
    expect(mocks.collect).toHaveBeenCalledWith(db, owner, project, ['c1'], { signal, budgetMs: 40_000 });
    await ports.purgeMedia(30);
    expect(mocks.purge).toHaveBeenCalledWith(db, owner, 30);
    mocks.loader.mockReturnValue('media-loader');
    await ports.executeJob(other, signal);
    expect(mocks.execute).toHaveBeenCalledWith(db, owner, other, { refreshSource: 'refresh-source-function', loadDneskaiMedia: 'media-loader', signal, env, deferRetry: true });
    mocks.publish.mockResolvedValue({ outcomes: [{ publicationId: other, status: 'dry-run', errorCode: null, remoteUrl: null }] });
    expect(await ports.publishDue(true, signal)).toEqual({ outcomes: [{ publicationId: other, status: 'dry-run', errorCode: null }] });
    expect(mocks.publish).toHaveBeenCalledWith(db, owner, 'dneskai', true, signal);
    await ports.refreshToken({ accountId: other, brand: 'dneskai', platform: 'instagram', expiresAt: '', refreshedAt: '', scopes: [], loginMode: 'instagram' }, signal);
    expect(mocks.refresh).toHaveBeenCalledWith(db, owner, { id: other, user_id: owner, brand: 'dneskai', platform: 'instagram' }, { signal, env });
    await ports.renewRevision(other);
    expect(mocks.renew).toHaveBeenCalledWith(db, owner, other);
    // Brief creation goes through the #115 wiring getter, never around it.
    expect(mocks.briefsGetter).toHaveBeenCalledWith(db);
    expect(ports.createBriefs).toBe(mocks.briefs);
  });
  it('detects publishing work and a live media claim from bounded reads', async () => {
    const empty = createMarketingSchedulerPorts(fakeDb({}).db, owner, {});
    expect(await empty.publicationWork()).toBe(false);
    expect(await empty.mediaCollectionActive()).toBe(false);
    expect(await empty.publicationDueSoon(300_000)).toBe(false);
    const busy = fakeDb({ marketing_publications: [{ id: other }], marketing_media_collections: [{ candidate_id: 'c1' }] });
    const ports = createMarketingSchedulerPorts(busy.db, owner, {});
    expect(await ports.publicationWork()).toBe(true);
    expect(await ports.mediaCollectionActive()).toBe(true);
    expect(busy.calls('marketing_media_collections')[0]).toEqual(expect.arrayContaining([['eq', ['user_id', owner]], ['gt', ['lease_until', expect.any(String)]]]));
    await expect(createMarketingSchedulerPorts(fakeDb({ marketing_publications: { error: 'down' } }).db, owner, {}).publicationWork()).rejects.toThrow('publication-state-unavailable');
  });
  it('counts a claimed carousel waiting for its container as a publication due soon', async () => {
    const claimed = { id: other, status: 'claimed', error_code: 'container-pending' };
    const pending = fakeDb({ marketing_publications: [claimed] });
    const ports = createMarketingSchedulerPorts(pending.db, owner, {});
    expect(await ports.publicationDueSoon(300_000)).toBe(true);
    const reads = pending.calls('marketing_publications');
    // The queued read finds nothing; only the claimed continuation answers.
    expect(reads).toContainEqual(expect.arrayContaining([['eq', ['status', 'queued']]]));
    expect(reads).toContainEqual(expect.arrayContaining([['eq', ['status', 'claimed']], ['in', ['error_code', ['container-pending', 'container-retry']]], ['gt', ['lease_until', expect.any(String)]]]));
    expect(await createMarketingSchedulerPorts(fakeDb({ marketing_publications: [{ ...claimed, error_code: 'publish-intent' }] }).db, owner, {}).publicationDueSoon(300_000)).toBe(false);
    // A claim whose containers failed transiently is continued the same way: the next tick recreates them.
    expect(await createMarketingSchedulerPorts(fakeDb({ marketing_publications: [{ ...claimed, error_code: 'container-retry' }] }).db, owner, {}).publicationDueSoon(300_000)).toBe(true);
  });
});

describe('a carousel left at container-pending by the slot tick', () => {
  const on = { MARKETING_DNESKAI_COLLECTION_ENABLED: 'true', MARKETING_DNESKAI_PAID_ENABLED: 'true', MARKETING_AI_CONSENT: 'true', MARKETING_PUBLISH_ENABLED: 'true', MARKETING_DNESKAI_PUBLISH_ENABLED: 'true' };
  const job = '44444444-4444-4444-8444-444444444444', run = '55555555-5555-4555-8555-555555555555', finished = '66666666-6666-4666-8666-666666666666';
  const store = (): MarketingSchedulerStore => ({
    beginTick: async () => true, finishTick: async () => true, pruneTicks: async () => 0, release: async () => true, saveState: async () => true,
    acquire: async () => ({ acquired: true, until: new Date(Date.now() + 90_000).toISOString(), state: {} }),
  });
  it('gets its continuation: collection, media, briefs and generation yield and the publisher runs first', async () => {
    // Only the claimed row exists; no queued publication is in its window.
    const { db } = fakeDb({ marketing_publications: [{ id: other, status: 'claimed', error_code: 'container-pending' }] });
    const real = createMarketingSchedulerPorts(db, owner, on);
    let clock = Date.parse('2026-10-20T20:35:00Z');
    const work: string[] = [];
    const ports: MarketingSchedulerPorts = {
      ...real,
      store: store(),
      dneskaiProject: async () => project,
      collectionRuns: async () => [{ id: run, date: '2026-10-20', status: 'running', pilot: false }, { id: finished, date: '2026-10-19', status: 'partial', pilot: false }],
      tickCollection: async () => { work.push('tickCollection'); clock += 30_000; return { runId: run, status: 'running', continue: true }; },
      pendingMedia: async () => ['candidate-1'],
      collectMedia: async () => { work.push('collectMedia'); clock += 40_000; return { complete: true, candidates: [] }; },
      createBriefs: async () => { work.push('createBriefs'); clock += 20_000; return { created: [], skipped: [], pending: false }; },
      queuedGenerationJobs: async () => [job],
      executeJob: async () => { work.push('executeJob'); clock += 40_000; return { claimed: true, status: 'review' }; },
      nextReconciliation: async () => null,
      tokenMetadata: async () => [],
    };
    mocks.publish.mockImplementation(async () => { work.push('publishDue'); return { outcomes: [{ publicationId: other, status: 'published', errorCode: null }] }; });
    const result = await runMarketingTick({ owner, env: on, ports, now: () => new Date(clock) }, { tick: '77777777-7777-4777-8777-777777777777', kind: 'minute' });
    const status = Object.fromEntries(result.did.map((entry) => [entry.category, entry.code ? `${entry.status}:${entry.code}` : entry.status]));
    expect(status).toMatchObject({
      collection: 'deferred:yield-to-publication', media: 'deferred:yield-to-publication', briefs: 'deferred:yield-to-publication',
      generation: 'deferred:yield-to-publication', publishing: 'done',
    });
    expect(work).toEqual(['publishDue']);
    // Live: the publisher is asked for a real publish, not a dry run.
    expect(mocks.publish).toHaveBeenCalledWith(db, owner, 'dneskai', false, expect.any(AbortSignal));
    expect(result.did.find((entry) => entry.category === 'publishing')?.detail).toMatchObject({ dryRun: false, published: 1 });
  });
});
