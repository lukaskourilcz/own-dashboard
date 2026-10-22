import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ enqueue: vi.fn(), execute: vi.fn(), acquire: vi.fn(), release: vi.fn(), createBriefs: vi.fn(), feedback: vi.fn(async () => false) }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/marketing/worker-runtime', async (actual) => ({ ...(await actual<typeof import('@/lib/marketing/worker-runtime')>()), enqueueMarketingJob: mocks.enqueue, executeMarketingJob: mocks.execute }));
vi.mock('@/lib/marketing/scheduler', async (actual) => ({ ...(await actual<typeof import('@/lib/marketing/scheduler')>()), createMarketingSchedulerStore: () => ({ acquire: mocks.acquire, release: mocks.release }) }));
vi.mock('@/lib/marketing/dneskai-wiring', () => ({ getCreateDneskaiBriefs: () => mocks.createBriefs }));
vi.mock('@/lib/marketing/dneskai-media', () => ({ createDneskaiMediaLoader: () => vi.fn() }));
vi.mock('@/lib/marketing/source-refresh', () => ({ refreshSource: vi.fn() }));
vi.mock('@/lib/marketing/owner-feedback', () => ({ recordMarketingOwnerFeedback: mocks.feedback }));
import { DneskaiPaidActionError, dneskaiPaidActionCapabilities, dneskaiRegenerateJobKey, generateDneskaiBriefNow, regenerateDneskaiRevision, runDneskaiJobNow } from '@/lib/marketing/dneskai-paid-actions';
import { MarketingWorkerRuntimeError } from '@/lib/marketing/worker-runtime';
import { revisionContentHash } from '@/lib/marketing/hashes';
import { deckRevision } from './marketing-dneskai-revision-fixture';

const owner = '11111111-1111-4111-8111-111111111111';
const revisionId = '33333333-3333-4333-8333-333333333333', jobId = '44444444-4444-4444-8444-444444444444', briefId = '55555555-5555-4555-8555-555555555555';
const env = { MARKETING_AI_CONSENT: 'true', DNESKAI_REGENERATE_ENABLED: 'true' };
const revision = deckRevision();
const hash = revisionContentHash(revision);
const future = () => new Date(Date.now() + 6 * 3_600_000).toISOString();

/** A query builder over fixed rows per table; `rpc` answers the spend read and the decision. */
function fakeDb(tables: Record<string, unknown[]>, rpc: Record<string, { data: unknown; error: unknown }> = {}) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const from = (table: string) => {
    const query = { select: () => query, eq: () => query, order: () => query, limit: () => query,
      maybeSingle: async () => ({ data: (tables[table] ?? [])[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve) };
    return query;
  };
  return { from, rpc: vi.fn(async (name: string, args: Record<string, unknown>) => { calls.push([name, args]); return rpc[name] ?? { data: null, error: null }; }), calls };
}
const originalJob = () => ({ id: jobId, request: { schemaVersion: 'marketing-job/1', idempotencyKey: '66666666-6666-4666-8666-666666666666', calendarEntryId: '77777777-7777-4777-8777-777777777777', calendarEntryVersion: 1,
  generation: { source: { kind: 'brief', brand: 'dneskai' }, account: revision.account, scheduledAt: future(), templateVersion: 'carousel-studio', knowledge: [], consent: true, revisionId: '66666666-6666-4666-8666-666666666666' } } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.acquire.mockResolvedValue({ acquired: true, until: future(), state: {} });
  mocks.release.mockResolvedValue(true);
  mocks.enqueue.mockResolvedValue({ jobId, status: 'queued', duplicate: false });
  mocks.execute.mockResolvedValue({ claimed: true, status: 'review', revisionId: '88888888-8888-4888-8888-888888888888' });
});

describe('switches', () => {
  it('offers regenerate only with consent and its switch, generate now with consent', () => {
    expect(dneskaiPaidActionCapabilities({})).toEqual({ regenerate: false, generateNow: false });
    expect(dneskaiPaidActionCapabilities({ MARKETING_AI_CONSENT: 'true' })).toEqual({ regenerate: false, generateNow: true });
    expect(dneskaiPaidActionCapabilities(env)).toEqual({ regenerate: true, generateNow: true });
  });
});

describe('regenerateDneskaiRevision (owner decision 8)', () => {
  const run = (user: ReturnType<typeof fakeDb>, admin: ReturnType<typeof fakeDb>, patch: Partial<Parameters<typeof regenerateDneskaiRevision>[0]> = {}) =>
    regenerateDneskaiRevision({ user: user as never, admin: admin as never, owner, id: revisionId, expectedHash: hash, note: 'Kratší titulek, bez otázky.', env, ...patch });

  it('checks the ceiling, enqueues the brief job again with the note, returns the post, then drafts it under the generation lease', async () => {
    const user = fakeDb({ marketing_revisions: [{ revision, content_hash: hash, status: 'review' }] });
    const admin = fakeDb({ marketing_jobs: [originalJob()] }, { marketing_dneskai_generation_spent: { data: 0.5, error: null } });
    const result = await run(user, admin);
    const key = dneskaiRegenerateJobKey(owner, revisionId, hash, 'Kratší titulek, bez otázky.');
    expect(mocks.enqueue).toHaveBeenCalledWith(admin, owner, expect.objectContaining({ idempotencyKey: key, calendarEntryId: '77777777-7777-4777-8777-777777777777',
      generation: expect.objectContaining({ revisionId: key, ownerNote: 'Kratší titulek, bez otázky.', replacesRevisionId: revisionId, consent: true }) }), { env });
    expect(user.calls).toContainEqual(['marketing_decide_revision', { p_revision_id: revisionId, p_action: 'returned', p_feedback: 'Kratší titulek, bez otázky.' }]);
    expect(mocks.acquire).toHaveBeenCalledWith('generation', expect.any(String), 90);
    expect(mocks.execute).toHaveBeenCalledWith(admin, owner, jobId, expect.objectContaining({ deferRetry: true, env }));
    expect(mocks.release).toHaveBeenCalledWith('generation', expect.any(String), { nextAllowedAt: null });
    expect(result).toMatchObject({ jobId, status: 'review', revisionId: '88888888-8888-4888-8888-888888888888' });
    // The same note on the same version is the same job; another note is another one.
    expect(dneskaiRegenerateJobKey(owner, revisionId, hash, 'Jiná poznámka.')).not.toBe(key);
  });

  it('refuses before any job when switched off, changed, decided, unsupported, too late or past the ceiling', async () => {
    const admin = fakeDb({ marketing_jobs: [originalJob()] }, { marketing_dneskai_generation_spent: { data: 0.8, error: null } });
    const user = (status = 'returned') => fakeDb({ marketing_revisions: [{ revision, content_hash: hash, status }] });
    const code = (promise: Promise<unknown>) => promise.then(() => null, (error: DneskaiPaidActionError) => error.code);
    expect(await code(run(user(), admin, { env: { MARKETING_AI_CONSENT: 'true' } }))).toBe('regenerate-unavailable');
    expect(await code(run(user(), admin, { expectedHash: '0'.repeat(64) }))).toBe('revision-changed');
    expect(await code(run(user('approved'), admin))).toBe('regenerate-not-reviewable');
    expect(await code(run(user(), fakeDb({ marketing_jobs: [] })))).toBe('regenerate-unsupported');
    const late = originalJob(); late.request.generation.scheduledAt = new Date(Date.now() + 5 * 60_000).toISOString();
    expect(await code(run(user(), fakeDb({ marketing_jobs: [late] })))).toBe('regenerate-slot-passed');
    // 0.80 spent + the 0.25 reservation passes the 1.00 ceiling.
    expect(await code(run(user(), admin))).toBe('dneskai-daily-generation-budget-exhausted');
    expect(await code(run(user(), fakeDb({ marketing_jobs: [originalJob()] }, { marketing_dneskai_generation_spent: { data: null, error: { message: 'x' } } })))).toBe('dneskai-daily-generation-budget-unavailable');
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('passes on the queue’s refusal and never returns the post when nothing was queued', async () => {
    mocks.enqueue.mockRejectedValueOnce(new MarketingWorkerRuntimeError('job-enqueue-failed'));
    const user = fakeDb({ marketing_revisions: [{ revision, content_hash: hash, status: 'review' }] });
    await expect(run(user, fakeDb({ marketing_jobs: [originalJob()] }, { marketing_dneskai_generation_spent: { data: 0, error: null } }))).rejects.toMatchObject({ code: 'job-enqueue-failed' });
    expect(user.calls).toEqual([]);
  });
});

describe('runDneskaiJobNow', () => {
  it('leaves the job to the tick when the lease is held or the request has too little time left', async () => {
    mocks.acquire.mockResolvedValueOnce({ acquired: false, reason: 'busy', until: future() });
    expect(await runDneskaiJobNow({} as never, owner, jobId, env, Date.now())).toEqual({ status: 'queued', scheduling: 'tick' });
    expect(await runDneskaiJobNow({} as never, owner, jobId, env, Date.now() - 20_000)).toEqual({ status: 'queued', scheduling: 'tick' });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('reports a failed draft by its code and a deferred retry as queued, releasing the lease', async () => {
    mocks.execute.mockResolvedValueOnce({ claimed: true, status: 'failed', errorCode: 'dneskai-daily-generation-budget-exhausted' });
    expect(await runDneskaiJobNow({} as never, owner, jobId, env, Date.now())).toEqual({ status: 'failed', errorCode: 'dneskai-daily-generation-budget-exhausted' });
    mocks.execute.mockResolvedValueOnce({ claimed: true, status: 'queued' });
    expect(await runDneskaiJobNow({} as never, owner, jobId, env, Date.now())).toEqual({ status: 'queued', scheduling: 'tick' });
    expect(mocks.release).toHaveBeenCalledTimes(2);
  });
});

describe('generateDneskaiBriefNow (owner decision 9)', () => {
  const brief = (patch: Record<string, unknown> = {}) => ({ id: briefId, project_id: '99999999-9999-4999-8999-999999999999', run_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'ready', code: null, job_id: null, scheduled_at: future(), ...patch });
  function admin(rows: Array<Record<string, unknown>>, spent = 0.2, run: Record<string, unknown> = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', collection_pilot_owner: null }) {
    let read = 0;
    const db = fakeDb({ marketing_dneskai_runs: [run] }, { marketing_dneskai_generation_spent: { data: spent, error: null } });
    const from = db.from;
    return { ...db, from: (table: string) => table === 'marketing_dneskai_briefs' ? { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: rows[Math.min(read++, rows.length - 1)], error: null }) }) }) }) } : from(table) };
  }
  const go = (db: ReturnType<typeof admin>, patch: Record<string, string> = {}) => generateDneskaiBriefNow({ admin: db as never, owner, briefId, env: { ...env, ...patch } });

  it('admits the waiting brief through the scheduler’s brief step under the briefs lease, then drafts its job', async () => {
    const db = admin([brief(), brief({ status: 'queued', job_id: jobId })]);
    expect(await go(db)).toMatchObject({ briefId, jobId, status: 'review' });
    expect(mocks.acquire.mock.calls.map((call) => call[0])).toEqual(['briefs', 'generation']);
    expect(mocks.createBriefs).toHaveBeenCalledWith(expect.objectContaining({ owner, project: '99999999-9999-4999-8999-999999999999', runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }));
    expect(mocks.release).toHaveBeenCalledWith('briefs', expect.any(String), { nextAllowedAt: null });
  });

  it('refuses without consent, a brief that has a job or does not wait, a passed slot, a pilot run, the ceiling and a busy scheduler', async () => {
    const code = (promise: Promise<unknown>) => promise.then(() => null, (error: DneskaiPaidActionError) => error.code);
    expect(await code(go(admin([brief()]), { MARKETING_AI_CONSENT: 'false' }))).toBe('marketing-consent-required');
    expect(await code(go(admin([brief({ job_id: jobId })])))).toBe('brief-already-queued');
    expect(await code(go(admin([brief({ status: 'skipped' })])))).toBe('brief-not-waiting');
    expect(await code(go(admin([brief({ scheduled_at: new Date(Date.now() + 10 * 60_000).toISOString() })])))).toBe('brief-slot-passed');
    expect(await code(go(admin([brief()], 0.2, { id: 'x', collection_pilot_owner: owner })))).toBe('brief-not-waiting');
    expect(await code(go(admin([brief()], 0.9)))).toBe('dneskai-daily-generation-budget-exhausted');
    expect(mocks.createBriefs).not.toHaveBeenCalled();
    mocks.acquire.mockResolvedValueOnce({ acquired: false, reason: 'busy', until: future() });
    expect(await code(go(admin([brief()])))).toBe('generate-now-busy');
    expect(mocks.createBriefs).not.toHaveBeenCalled();
  });

  it('says why a brief still waits after admission: pictures still owed, or no verified account', async () => {
    const code = (promise: Promise<unknown>) => promise.then(() => null, (error: DneskaiPaidActionError) => error.code);
    expect(await code(go(admin([brief({ status: 'pending' }), brief({ status: 'pending' })])))).toBe('brief-still-waiting');
    expect(await code(go(admin([brief({ status: 'pending' }), brief({ status: 'pending', code: 'account-unavailable' })])))).toBe('marketing-account-unavailable');
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
