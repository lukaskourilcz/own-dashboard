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
        return { data: value.filter((row) => entry.calls.every(([name, args]) => name !== 'eq' || !(String(args[0]) in row) || row[String(args[0])] === args[1])), error: null };
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
  it('reads only ordinary runs of the last two Prague days', async () => {
    const { db, calls } = fakeDb({ marketing_dneskai_runs: [{ id: project, date: '2026-10-20', status: 'running' }] });
    expect(await createMarketingSchedulerPorts(db, owner, {}).collectionRuns(project, '2026-10-20')).toEqual([{ id: project, date: '2026-10-20', status: 'running' }]);
    expect(calls('marketing_dneskai_runs')[0]).toEqual(expect.arrayContaining([['eq', ['user_id', owner]], ['eq', ['project_id', project]], ['is', ['collection_pilot_owner', null]], ['gte', ['date', '2026-10-18']]]));
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
    expect(mocks.execute).toHaveBeenCalledWith(db, owner, other, { refreshSource: 'refresh-source-function', loadDneskaiMedia: 'media-loader', signal, env });
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
});
