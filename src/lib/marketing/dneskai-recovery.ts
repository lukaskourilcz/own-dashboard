import 'server-only';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DneskaiBriefSchema } from './dneskai-brief';
import { DneskaiCandidateSchema } from './dneskai-contracts';
import { dneskaiOfferableMediaAssets } from './dneskai-media-contracts';
import { buildDneskaiBrief, createDneskaiBriefStore, dneskaiBriefRepeat, dneskaiFreeSlots, dneskaiSitewidePictures, DNESKAI_REPEAT_WINDOW_DAYS, type DneskaiBriefRow, type DneskaiBriefStore } from './dneskai-briefs';
import { requireDneskaiProject, type DneskaiDatabase } from './dneskai-store';
import { dneskaiBriefActions, dneskaiHeldReleaseBlock, type DneskaiBriefAction, type DneskaiRecoveryCapabilities } from './dneskai-recovery-rules';
import { pragueMarketingDate } from './weekly-planning';

/**
 * Owner recovery actions (audit C3, briefs-07) behind POST /api/marketing/dneskai/briefs and /candidates.
 * `user` is the owner's session client (RLS, auth.uid() in the security-definer SQL); `admin` the service-role
 * client, used only with the owner's id. Admission rules, the account requirement and every ceiling are unchanged:
 * retry and reslot reopen a brief as pending and the scheduler admits it through the ordinary path.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the generated database types do not cover marketing tables
type Database = SupabaseClient<any>;

export { dneskaiRecoveryCapabilities } from './dneskai-evidence-rollout';

export class DneskaiRecoveryError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); this.name = 'DneskaiRecoveryError'; }
}
const SQL_CODES: ReadonlyArray<readonly [string, string]> = [
  ['brief unavailable', 'recovery-brief-unavailable'], ['brief not reslottable', 'recovery-not-reslottable'], ['brief not releasable', 'recovery-not-releasable'],
  ['brief admitted', 'recovery-brief-admitted'], ['brief slot invalid', 'recovery-slot-invalid'], ['brief members changed', 'recovery-members-changed'],
  ['brief outside window', 'recovery-outside-window'], ['brief nothing to release', 'recovery-nothing-to-release'], ['brief invalid', 'recovery-brief-invalid'],
  ['brief closed', 'recovery-brief-closed'], ['marketing_dneskai_brief_slot', 'recovery-slot-taken'], ['event_id_target_date', 'recovery-day-taken'],
  ['candidate unavailable', 'recovery-candidate-unavailable'], ['candidate not held', 'recovery-not-held'], ['candidate not releasable', 'recovery-held-empty'],
  ['candidate outside window', 'recovery-held-outside-window'],
];
/** A SQL refusal as a code the Sources tab can explain; anything else stays generic. */
export function dneskaiRecoverySqlCode(message: string): string {
  return SQL_CODES.find(([needle]) => message.includes(needle))?.[1] ?? 'recovery-unavailable';
}
const rpcFailure = (error: { message?: unknown }) => new DneskaiRecoveryError(dneskaiRecoverySqlCode(String(error.message ?? '')));
const unavailable = () => new DneskaiRecoveryError('recovery-unavailable', 503);

type Context = { user: Database; admin: Database; owner: string; capabilities: DneskaiRecoveryCapabilities; now: Date; store?: DneskaiBriefStore };
const BriefRowSchema = z.object({ id: z.uuid(), project_id: z.uuid(), status: z.enum(['pending', 'ready', 'queued', 'skipped']), code: z.string().nullable(), scheduled_at: z.string().nullable(), job_id: z.uuid().nullable() }).passthrough();

async function ownBrief(db: Database, owner: string, briefId: string) {
  z.uuid().parse(owner); z.uuid().parse(briefId);
  const { data, error } = await db.from('marketing_dneskai_briefs').select('*').eq('user_id', owner).eq('id', briefId).maybeSingle();
  if (error) throw unavailable();
  const parsed = BriefRowSchema.safeParse(data);
  if (!parsed.success) throw new DneskaiRecoveryError('recovery-brief-unavailable', 404);
  return parsed.data as z.infer<typeof BriefRowSchema> & DneskaiBriefRow;
}
function requireAction(row: z.infer<typeof BriefRowSchema>, action: DneskaiBriefAction, context: Context) {
  const state = dneskaiBriefActions({ status: row.status, code: row.code, scheduledAt: row.scheduled_at ? new Date(row.scheduled_at).toISOString() : null, jobId: row.job_id }, context.capabilities, context.now)
    .find((item) => item.action === action);
  if (!state) throw new DneskaiRecoveryError(`recovery-not-${action === 'retry' ? 'retryable' : action === 'reslot' ? 'reslottable' : 'releasable'}`);
  if (!state.available) throw new DneskaiRecoveryError(state.reason ?? 'recovery-unavailable');
}

/**
 * `retry`: a ready (or pending) brief whose admission failed goes back to pending as `owner-retry`; the next
 * scheduler tick admits it through marketing_dneskai_admit_brief and marketing_enqueue_job as before. Without a
 * verified @dneskai account there is nothing to retry.
 */
export async function retryDneskaiBrief(context: Context, briefId: string) {
  const row = await ownBrief(context.user, context.owner, briefId);
  requireAction(row, 'retry', context);
  const { data: account, error } = await context.admin.from('marketing_accounts').select('id').eq('user_id', context.owner).eq('brand', 'dneskai').eq('platform', 'instagram').not('verified_at', 'is', null).maybeSingle();
  if (error) throw unavailable();
  if (!account) throw new DneskaiRecoveryError('account-unavailable');
  const result = await context.admin.rpc('marketing_dneskai_prepare_brief', { p_owner: context.owner, p_brief: row.id, p_value: null, p_scheduled_at: null, p_status: 'pending', p_code: 'owner-retry' });
  if (result.error) throw rpcFailure(result.error);
  return { id: row.id, status: 'pending' as const, code: 'owner-retry' };
}

/**
 * `reslot`: a brief that lapsed before admission is rebuilt for the next free slot today or tomorrow, with the same
 * members and member hash. A built brief keeps its observation time, so its expiry never moves; a slot after that
 * expiry is never chosen. The same repeat check as a new brief applies. Behind DNESKAI_OWNER_RECOVERY_ENABLED.
 */
export async function reslotDneskaiBrief(context: Context, briefId: string) {
  const row = await ownBrief(context.user, context.owner, briefId);
  requireAction(row, 'reslot', context);
  const store = context.store ?? createDneskaiBriefStore(context.admin);
  try {
    const members = await store.members(context.owner, row.project_id, row.member_ids);
    if (members.length !== row.member_ids.length) throw new DneskaiRecoveryError('recovery-members-changed');
    const stored = row.brief === null ? null : DneskaiBriefSchema.safeParse(row.brief);
    if (stored && !stored.success) throw new DneskaiRecoveryError('recovery-brief-invalid');
    const original = stored?.success ? stored.data : null;
    const observedAt = original ? new Date(original.observedAt) : context.now;
    const expiresAt = original ? Date.parse(original.expiresAt) : Number.POSITIVE_INFINITY;
    const today = pragueMarketingDate(context.now);
    const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
    let slot: string | null = null;
    for (const date of [today, tomorrow]) {
      // No run is excluded: every open brief of that day, this one's run included, holds its slot.
      const taken = await store.takenSlots(context.owner, row.project_id, date, '00000000-0000-4000-8000-000000000000');
      slot = dneskaiFreeSlots(date, taken, context.now).find((value) => Date.parse(value) < expiresAt) ?? null;
      if (slot) break;
    }
    if (!slot) throw new DneskaiRecoveryError('recovery-no-free-slot');
    const withMedia = await Promise.all(members.map(async (member) => {
      const view = await store.media(context.owner, row.project_id, member.id);
      return { candidate: member.candidate, articleText: view?.articleText, media: view ? dneskaiOfferableMediaAssets(view) : [] };
    }));
    const outcome = buildDneskaiBrief({ eventId: row.event_id, memberHash: row.member_hash, targetDate: pragueMarketingDate(new Date(slot)), category: row.category, scheduledAt: slot, observedAt, members: withMedia, richEvidence: store.richEvidence });
    if ('code' in outcome) throw new DneskaiRecoveryError(outcome.code);
    const recent = await store.coverage(context.owner, row.project_id, new Date(context.now.getTime() - DNESKAI_REPEAT_WINDOW_DAYS * 86400000), row.run_id);
    const phashes = await store.phashes(context.owner, [...new Set([...outcome.brief.media.map((item) => item.assetSha256), ...recent.flatMap((item) => item.assetSha256s)])]);
    let repeat = dneskaiBriefRepeat(outcome.brief, recent, phashes);
    if (repeat?.by === 'media') {
      const sitewide = dneskaiSitewidePictures(await store.pictureArticles(context.owner, row.project_id, outcome.brief.media.map((item) => item.assetSha256), row.member_ids));
      if (sitewide.size) repeat = dneskaiBriefRepeat(outcome.brief, recent, phashes, sitewide);
    }
    if (repeat) throw new DneskaiRecoveryError('collection-already-covered');
    const result = await context.user.rpc('marketing_dneskai_reslot_brief', { p_brief: row.id, p_value: outcome.brief, p_scheduled_at: slot });
    if (result.error) throw rpcFailure(result.error);
    return z.object({ id: z.uuid(), status: z.literal('pending'), code: z.string(), scheduledAt: z.string() }).passthrough().parse(result.data);
  } catch (error) {
    if (error instanceof DneskaiRecoveryError) throw error;
    throw unavailable();
  }
}

/**
 * `release`: the selected reports of a brief that lapsed before admission become open again (status new), the same
 * release 20261022021835 performs for future lapses. Behind DNESKAI_LAPSED_RELEASE_ENABLED.
 */
export async function releaseDneskaiBrief(context: Context, briefId: string) {
  const row = await ownBrief(context.user, context.owner, briefId);
  requireAction(row, 'release', context);
  const result = await context.user.rpc('marketing_dneskai_release_brief', { p_brief: row.id });
  if (result.error) throw rpcFailure(result.error);
  return z.object({ id: z.uuid(), released: z.number().int().nonnegative() }).parse(result.data);
}

/**
 * C3: one held report goes back to the queue of the next nightly Jev review (open, unclassified). Not approval:
 * Jev decides again, under the existing batch and budget limits. Behind DNESKAI_OWNER_RECOVERY_ENABLED.
 */
export async function releaseHeldDneskaiCandidate(context: Omit<Context, 'admin' | 'store'>, projectId: string, candidateId: string) {
  if (!context.capabilities.heldRelease) throw new DneskaiRecoveryError('recovery-held-release-unavailable');
  z.uuid().parse(projectId); z.string().min(1).max(200).parse(candidateId);
  try { await requireDneskaiProject(context.user as DneskaiDatabase, context.owner, projectId); } catch { throw new DneskaiRecoveryError('recovery-candidate-unavailable', 404); }
  const { data, error } = await context.user.from('marketing_dneskai_candidates').select('candidate').eq('user_id', context.owner).eq('project_id', projectId).eq('id', candidateId).maybeSingle();
  if (error) throw unavailable();
  const candidate = DneskaiCandidateSchema.safeParse(data?.candidate);
  if (!candidate.success) throw new DneskaiRecoveryError('recovery-candidate-unavailable', 404);
  const block = dneskaiHeldReleaseBlock(candidate.data, context.now);
  if (block) throw new DneskaiRecoveryError(block);
  const result = await context.user.rpc('marketing_dneskai_release_candidate', { p_project: projectId, p_candidate: candidateId });
  if (result.error) throw rpcFailure(result.error);
  return z.object({ id: z.string(), status: z.literal('new') }).parse(result.data);
}
