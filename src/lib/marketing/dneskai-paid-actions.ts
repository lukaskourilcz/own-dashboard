import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { createAdminClient } from '@/lib/supabase/admin';
import { parseContentRevision } from './contracts';
import { getCreateDneskaiBriefs } from './dneskai-wiring';
import { createDneskaiMediaLoader } from './dneskai-media';
import { DEFAULT_GENERATION_BUDGET, MarketingGenerationError } from './generation';
import { recordMarketingOwnerFeedback } from './owner-feedback';
import { createMarketingSchedulerStore } from './scheduler';
import { dneskaiPaidActionCapabilities } from './dneskai-paid-switches';

export { dneskaiPaidActionCapabilities };
import { refreshSource } from './source-refresh';
import { dneskaiDailyGenerationCeiling, enqueueMarketingJob, executeMarketingJob, MarketingWorkerRuntimeError } from './worker-runtime';

/**
 * The two paid owner actions of the DNESKAi review (owner decisions 8 and 9, 22 October 2026): „Regenerate with a
 * note“ and „Generate now“. Neither has a path of its own to the model. Each one admits a job through the existing
 * guarded queue (`marketing_enqueue_job`: calendar entry current, 8 jobs per 24 hours) and runs it through
 * `executeMarketingJob`, which reserves the job's maximum under the daily ceiling (`marketing_reserve_dneskai_generation`)
 * before every paid call, exactly as the scheduler's generation step does. The headroom check below only makes the
 * refusal early and clear; it reserves nothing and decides nothing the reservation would not.
 *
 * Nothing here approves. A regenerated draft is a new revision in review that needs the owner's approval of its hash.
 */
type Admin = ReturnType<typeof createAdminClient>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the generated database types do not cover marketing tables
type UserDb = SupabaseClient<any>;
type Environment = Record<string, string | undefined>;

export class DneskaiPaidActionError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); this.name = 'DneskaiPaidActionError'; }
}

/** The most characters of the owner's note that go to the model (and into the job request). */
export const DNESKAI_REGENERATE_NOTE_MAX = 1000;
/** A regenerated draft for a slot closer than this cannot be reviewed in time: the request is refused. */
export const DNESKAI_REGENERATE_MIN_LEAD_MS = 15 * 60_000;
/** A brief whose slot is closer than this is not drafted any more; the scheduler lets it lapse the same way. */
export const DNESKAI_GENERATE_NOW_MIN_LEAD_MS = 30 * 60_000;
/** The job runs in the request only with this much of the request's minute left; otherwise the next tick runs it. */
export const DNESKAI_RUN_NOW_MINIMUM_MS = 45_000;
const REQUEST_BUDGET_MS = 55_000;

/**
 * Refuses early when one more job's whole reservation would pass the daily ceiling. The binding check stays the
 * reservation made under the job's fence before the call.
 */
export async function assertDneskaiGenerationHeadroom(admin: Pick<Admin, 'rpc'>, owner: string, env: Environment): Promise<void> {
  let ceiling: number;
  try { ceiling = dneskaiDailyGenerationCeiling(env); } catch { throw new DneskaiPaidActionError('dneskai-daily-generation-budget-invalid', 503); }
  const { data, error } = await admin.rpc('marketing_dneskai_generation_spent', { p_owner: owner });
  const spent = typeof data === 'number' ? data : typeof data === 'string' && /^\d+(?:\.\d+)?$/.test(data) ? Number(data) : Number.NaN;
  if (error || !Number.isFinite(spent)) throw new DneskaiPaidActionError('dneskai-daily-generation-budget-unavailable', 503);
  if (spent + DEFAULT_GENERATION_BUDGET.maxCostUsd > ceiling) throw new DneskaiPaidActionError('dneskai-daily-generation-budget-exhausted');
}

export type DneskaiRunNow =
  | { status: 'review'; revisionId: string | null }
  | { status: 'failed'; errorCode: string }
  | { status: 'queued'; scheduling: 'tick' };

/**
 * Runs one queued DNESKAi job now under the scheduler's generation lease, so a tick never drafts at the same time.
 * Busy lease, not enough of the request left, or a deferred retry: the job stays queued and the next tick runs it.
 */
export async function runDneskaiJobNow(admin: Admin, owner: string, jobId: string, env: Environment, startedAt: number, clock: () => number = Date.now): Promise<DneskaiRunNow> {
  const left = REQUEST_BUDGET_MS - (clock() - startedAt);
  if (left < DNESKAI_RUN_NOW_MINIMUM_MS) return { status: 'queued', scheduling: 'tick' };
  const store = createMarketingSchedulerStore(admin, owner);
  const holder = randomUUID();
  let lease;
  try { lease = await store.acquire('generation', holder, 90); } catch { return { status: 'queued', scheduling: 'tick' }; }
  if (!lease.acquired) return { status: 'queued', scheduling: 'tick' };
  const signal = AbortSignal.timeout(left);
  try {
    const result = await executeMarketingJob(admin, owner, jobId, { refreshSource, loadDneskaiMedia: createDneskaiMediaLoader(admin, owner), signal, env, deferRetry: true }) as
      { claimed?: boolean; status?: string; revisionId?: string; errorCode?: string };
    if (result.claimed && result.status === 'review') return { status: 'review', revisionId: typeof result.revisionId === 'string' ? result.revisionId : null };
    if (result.claimed && result.status === 'failed') return { status: 'failed', errorCode: typeof result.errorCode === 'string' ? result.errorCode : 'worker-execution-failed' };
    return { status: 'queued', scheduling: 'tick' };
  } catch (failure) {
    // A lost finish leaves the job to the lease and reconciliation, as in the tick.
    const code = failure instanceof MarketingWorkerRuntimeError || failure instanceof MarketingGenerationError ? failure.code : 'worker-execution-failed';
    return { status: 'failed', errorCode: code };
  } finally {
    if (!signal.aborted) await store.release('generation', holder, { nextAllowedAt: null }).catch(() => false);
  }
}

/** One regeneration per reviewed version and note: a repeated click returns the same job instead of another call. */
export function dneskaiRegenerateJobKey(owner: string, revisionId: string, revisionHash: string, note: string): string {
  const noteHash = createHash('sha256').update(note, 'utf8').digest('hex');
  const value = createHash('sha256').update(['dneskai-regenerate/1', owner, revisionId, revisionHash, noteHash].join('|')).digest('hex').slice(0, 32);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-5${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20)}`;
}

const enqueueCode = (failure: unknown) => failure instanceof MarketingWorkerRuntimeError ? failure.code : 'job-enqueue-failed';

/**
 * „Regenerate with a note“ (owner decision 8): a returned post, or one in review, is drafted again from the same brief
 * with the owner's note as feedback. The request copies the brief's last job (same source, account, calendar entry and
 * slot) under a new key, adds `ownerNote` and `replacesRevisionId`, and is enqueued and run as above. A post still in
 * review is returned with the note first, so the version being replaced cannot be approved meanwhile.
 */
export async function regenerateDneskaiRevision(input: { user: UserDb; admin: Admin; owner: string; id: string; expectedHash: string; note: string; env: Environment; now?: () => number }) {
  const clock = input.now ?? Date.now;
  const startedAt = clock();
  if (!dneskaiPaidActionCapabilities(input.env).regenerate) throw new DneskaiPaidActionError('regenerate-unavailable');
  const note = input.note.trim().slice(0, DNESKAI_REGENERATE_NOTE_MAX);
  if (!note) throw new DneskaiPaidActionError('regenerate-note-missing', 400);
  const { data: row, error } = await input.user.from('marketing_revisions').select('revision,content_hash,status').eq('id', input.id).eq('user_id', input.owner).maybeSingle();
  if (error || !row) throw new DneskaiPaidActionError('revision-unavailable', 404);
  if (row.content_hash !== input.expectedHash) throw new DneskaiPaidActionError('revision-changed');
  if (row.status !== 'review' && row.status !== 'returned') throw new DneskaiPaidActionError('regenerate-not-reviewable');
  const current = parseContentRevision(row.revision);
  const source = current.sources[0];
  if (current.brand !== 'dneskai' || !current.deck || !source) throw new DneskaiPaidActionError('regenerate-unsupported');
  const { data: jobs, error: jobError } = await input.admin.from('marketing_jobs').select('id,request').eq('user_id', input.owner)
    .eq('request->generation->source->>sourceId', source.sourceId).eq('request->generation->source->>kind', 'brief').order('created_at', { ascending: false }).limit(1);
  if (jobError) throw new DneskaiPaidActionError('regenerate-unavailable', 503);
  const original = z.object({ request: z.object({ generation: z.object({ scheduledAt: z.string() }).passthrough() }).passthrough() }).safeParse((jobs ?? [])[0]);
  if (!original.success) throw new DneskaiPaidActionError('regenerate-unsupported');
  if (Date.parse(original.data.request.generation.scheduledAt) <= startedAt + DNESKAI_REGENERATE_MIN_LEAD_MS) throw new DneskaiPaidActionError('regenerate-slot-passed');
  await assertDneskaiGenerationHeadroom(input.admin, input.owner, input.env);
  const key = dneskaiRegenerateJobKey(input.owner, input.id, input.expectedHash, note);
  const request = { ...original.data.request, idempotencyKey: key, generation: { ...original.data.request.generation, revisionId: key, ownerNote: note, replacesRevisionId: input.id } };
  let job: { jobId: string; status: string; duplicate: boolean };
  try { job = await enqueueMarketingJob(input.admin, input.owner, request, { env: input.env }); }
  catch (failure) { throw new DneskaiPaidActionError(enqueueCode(failure)); }
  if (row.status === 'review') {
    // The note is stored as the owner's return feedback on the version it replaces; tracing gets only the decision.
    const decided = await input.user.rpc('marketing_decide_revision', { p_revision_id: input.id, p_action: 'returned', p_feedback: note });
    if (!decided.error) await recordMarketingOwnerFeedback({ traceId: current.traceId, revisionId: input.id, revisionHash: row.content_hash, decision: 'returned' }, input.env, { db: input.admin, ownerId: input.owner });
  }
  if (job.status !== 'queued') return { jobId: job.jobId, status: job.status === 'review' ? 'review' as const : 'queued' as const, duplicate: job.duplicate, ...(job.status === 'review' ? { revisionId: key } : { scheduling: 'tick' as const }) };
  return { jobId: job.jobId, duplicate: job.duplicate, ...await runDneskaiJobNow(input.admin, input.owner, job.jobId, input.env, startedAt, clock) };
}

/**
 * „Generate now“ (owner decision 9): a built brief that waits for the scheduler (pending or ready, no job) is admitted
 * now through the scheduler's own brief step (`createBriefs` for its run, under the briefs lease), and its job is run.
 */
export async function generateDneskaiBriefNow(input: { admin: Admin; owner: string; briefId: string; env: Environment; now?: () => number }) {
  const clock = input.now ?? Date.now;
  const startedAt = clock();
  if (!dneskaiPaidActionCapabilities(input.env).generateNow) throw new DneskaiPaidActionError('marketing-consent-required');
  const read = async () => {
    const { data, error } = await input.admin.from('marketing_dneskai_briefs').select('id,project_id,run_id,status,code,job_id,scheduled_at').eq('id', input.briefId).eq('user_id', input.owner).maybeSingle();
    if (error || !data) throw new DneskaiPaidActionError('brief-unavailable', 404);
    return data as { id: string; project_id: string; run_id: string; status: string; code: string | null; job_id: string | null; scheduled_at: string | null };
  };
  const brief = await read();
  if (brief.job_id) throw new DneskaiPaidActionError('brief-already-queued');
  if (brief.status !== 'pending' && brief.status !== 'ready') throw new DneskaiPaidActionError('brief-not-waiting');
  if (!brief.scheduled_at || Date.parse(brief.scheduled_at) <= startedAt + DNESKAI_GENERATE_NOW_MIN_LEAD_MS) throw new DneskaiPaidActionError('brief-slot-passed');
  const { data: run, error: runError } = await input.admin.from('marketing_dneskai_runs').select('id,collection_pilot_owner').eq('user_id', input.owner).eq('id', brief.run_id).maybeSingle();
  // A retained collection-pilot run never gets jobs from the scheduler, so not from here either.
  if (runError || !run || run.collection_pilot_owner) throw new DneskaiPaidActionError('brief-not-waiting');
  await assertDneskaiGenerationHeadroom(input.admin, input.owner, input.env);
  const store = createMarketingSchedulerStore(input.admin, input.owner);
  const holder = randomUUID();
  let lease;
  try { lease = await store.acquire('briefs', holder, 90); } catch { throw new DneskaiPaidActionError('generate-now-busy', 503); }
  if (!lease.acquired) throw new DneskaiPaidActionError('generate-now-busy');
  try { await getCreateDneskaiBriefs(input.admin)({ owner: input.owner, project: brief.project_id, runId: brief.run_id, signal: AbortSignal.timeout(15_000) }); }
  catch { throw new DneskaiPaidActionError('generate-now-unavailable', 503); }
  finally { await store.release('briefs', holder, { nextAllowedAt: null }).catch(() => false); }
  const admitted = await read();
  // Still waiting: its pictures are still being collected, or no verified account can take it.
  if (!admitted.job_id) throw new DneskaiPaidActionError(admitted.code === 'account-unavailable' ? 'marketing-account-unavailable' : admitted.status === 'skipped' ? (admitted.code ?? 'brief-not-waiting') : 'brief-still-waiting');
  return { briefId: brief.id, jobId: admitted.job_id, ...await runDneskaiJobNow(input.admin, input.owner, admitted.job_id, input.env, startedAt, clock) };
}
