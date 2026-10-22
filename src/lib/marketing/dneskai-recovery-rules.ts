import type { DneskaiCandidate, DneskaiEventView } from './dneskai-contracts';

/**
 * Owner recovery for DNESKAi (audit C3 and briefs-07): which owner action an event or a held report offers, and why
 * an offered action is disabled. Pure rules shared by the Sources tab and the routes; the SQL functions stay the
 * authority. None of these actions approves a post, admits a job or spends money by itself.
 */
export type DneskaiRecoveryCapabilities = {
  /** Uses the existing prepare function only, so it needs no migration. */
  retry: boolean;
  /** 20261022141512_dneskai_owner_recovery.sql applied and DNESKAI_OWNER_RECOVERY_ENABLED=true. */
  reslot: boolean;
  heldRelease: boolean;
  /** 20261022021835 and 20261022141613 applied and DNESKAI_LAPSED_RELEASE_ENABLED=true. */
  lapsedRelease: boolean;
};
export const DNESKAI_RECOVERY_OFF: DneskaiRecoveryCapabilities = { retry: false, reslot: false, heldRelease: false, lapsedRelease: false };

/** A lapse before any admission attempt: the slot or day passed, or the day had no free slot. */
export const DNESKAI_RESLOT_CODES: ReadonlySet<string> = new Set(['brief-slot-passed', 'brief-target-date-passed', 'brief-slot-unavailable']);
/** The lapse codes of 20261022021835 plus a day without a free slot. */
export const DNESKAI_RELEASE_CODES: ReadonlySet<string> = new Set([...DNESKAI_RESLOT_CODES, 'brief-expired']);
/** Codes the owner's retry or reslot leaves on a pending brief until the scheduler takes it up. */
export const DNESKAI_OWNER_CODES: ReadonlySet<string> = new Set(['owner-retry', 'owner-reslot']);
/** A retry cannot change these: the account requirement, or an owner action already waiting for the scheduler. */
const RETRY_EXCLUDED: ReadonlySet<string> = new Set(['account-unavailable', ...DNESKAI_OWNER_CODES]);
/** DNESKAI_BRIEF_MIN_LEAD_MINUTES: generation and the owner's review need the time before a slot. */
const LEAD_MS = 30 * 60000;

export type DneskaiBriefAction = 'retry' | 'reslot' | 'release';
export type DneskaiBriefActionState = { action: DneskaiBriefAction; available: boolean; reason: string | null };
type BriefView = Pick<NonNullable<DneskaiEventView['brief']>, 'status' | 'code' | 'scheduledAt' | 'jobId'>;

/** The owner actions a brief offers, in display order. An offered action may be disabled with a reason code. */
export function dneskaiBriefActions(brief: BriefView, capabilities: DneskaiRecoveryCapabilities, now: Date): DneskaiBriefActionState[] {
  const actions: DneskaiBriefActionState[] = [];
  if ((brief.status === 'ready' || brief.status === 'pending') && brief.code && !RETRY_EXCLUDED.has(brief.code) && capabilities.retry) {
    const late = brief.scheduledAt !== null && Date.parse(brief.scheduledAt) < now.getTime() + LEAD_MS;
    actions.push({ action: 'retry', available: !late, reason: late ? 'recovery-slot-too-close' : null });
  }
  if (brief.status === 'skipped' && brief.jobId === null && brief.code) {
    if (DNESKAI_RESLOT_CODES.has(brief.code)) actions.push({ action: 'reslot', available: capabilities.reslot, reason: capabilities.reslot ? null : 'recovery-reslot-unavailable' });
    if (DNESKAI_RELEASE_CODES.has(brief.code)) actions.push({ action: 'release', available: capabilities.lapsedRelease, reason: capabilities.lapsedRelease ? null : 'recovery-release-unavailable' });
  }
  return actions;
}

export const DNESKAI_HELD_GROUPS = ['category', 'duplicate', 'relevance', 'stale', 'cost', 'other'] as const;
export type DneskaiHeldGroup = typeof DNESKAI_HELD_GROUPS[number];
/**
 * The group of a held report's reason. A Jev review hold names every failed check in a fixed order
 * (collection-review-category-duplicate-relevance); it is grouped by the first, and the row still names all.
 */
export function dneskaiHeldGroup(reason: string | null): DneskaiHeldGroup {
  if (reason === 'collection-source-date-unavailable-or-stale') return 'stale';
  if (reason?.startsWith('collection-cost-')) return 'cost';
  const review = reason ? /^collection-review-(category|duplicate|relevance)(?:-(?:duplicate|relevance))*$/.exec(reason) : null;
  return review ? review[1] as DneskaiHeldGroup : 'other';
}

/**
 * Why a held report cannot go back to review, or null when it can. Mirrors marketing_dneskai_release_candidate
 * (text present, published within 30 days) and the nightly selection's 48-hour window for AI and tech news,
 * which a released news report outside it could never pass.
 */
export function dneskaiHeldReleaseBlock(candidate: Pick<DneskaiCandidate, 'status' | 'title' | 'text' | 'publishedAt' | 'category'>, now: Date): string | null {
  if (candidate.status !== 'held') return 'recovery-not-held';
  if (!(candidate.title.trim() || candidate.text.trim())) return 'recovery-held-empty';
  const published = candidate.publishedAt ? Date.parse(candidate.publishedAt) : Number.NaN;
  if (!Number.isFinite(published) || published > now.getTime()) return 'recovery-held-undated';
  const window = candidate.category === 'ai-news' || candidate.category === 'tech-news' ? 48 * 3600000 : 30 * 86400000;
  return published < now.getTime() - window ? 'recovery-held-outside-window' : null;
}
