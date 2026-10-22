import type { DneskaiRecoveryCapabilities } from './dneskai-recovery-rules';

/** Enable only after the richer-media and brief/2 SQL migrations have been reconciled and applied. */
export function dneskaiRichEvidenceEnabled(): boolean {
  return process.env.DNESKAI_RICH_EVIDENCE_ENABLED === 'true';
}

/**
 * Owner recovery (C3, briefs-07). The deployed code must work before the prepared SQL exists, so its new RPCs are
 * called only behind server-only switches that default off. DNESKAI_OWNER_RECOVERY_ENABLED: only after
 * 20261022141512_dneskai_owner_recovery.sql is applied (held release, reslot). DNESKAI_LAPSED_RELEASE_ENABLED: only
 * after 20261022021835 and 20261022141613 are applied. Retry uses existing SQL only.
 */
export function dneskaiRecoveryCapabilities(env: Record<string, string | undefined> = process.env): DneskaiRecoveryCapabilities {
  const recovery = env.DNESKAI_OWNER_RECOVERY_ENABLED === 'true';
  return { retry: true, reslot: recovery, heldRelease: recovery, lapsedRelease: env.DNESKAI_LAPSED_RELEASE_ENABLED === 'true' };
}

/**
 * Story selection v2 (owner decisions 11-13). Only after 20261022180000_dneskai_relevance_first_selection.sql and
 * 20261022180100_dneskai_held_requeue.sql are applied: the collector then re-queues recent Jev holds once per night
 * (marketing_dneskai_requeue_held) and the Sources tab explains the relevance-first rule. Off: the deployed
 * functions only, and the explanation of the one-per-category rule.
 */
export function dneskaiSelectionV2Enabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DNESKAI_SELECTION_V2_ENABLED === 'true';
}

/**
 * Topics (náměty, #150). Only after 20261023100000_dneskai_topics.sql is applied: GET and POST
 * /api/marketing/dneskai/topics answer 404 and readDneskaiTopics returns null while this is off.
 */
export function dneskaiTopicsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DNESKAI_TOPICS_ENABLED === 'true';
}

/**
 * Scouting (#151). Only with DNESKAI_TOPICS_ENABLED and after 20261023100000_dneskai_topics.sql is applied: the nightly
 * collection then also reads the education sources (their reports never reach Jev), and the scheduler's scouting step
 * turns those reports and highly rated library links into proposed topics. No model call.
 */
export function dneskaiScoutingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DNESKAI_SCOUTING_ENABLED === 'true' && dneskaiTopicsEnabled(env);
}

/**
 * FACT or HYPE (#152). Only with scouting on and after 20261023100100_dneskai_topic_spend.sql is applied: the scouting
 * step then buys transcripts of FACT or HYPE reels (own $0.50 daily ceiling) and classifies them with one Claude
 * call each (inside the $1 daily generation ceiling).
 */
export function dneskaiFactOrHypeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DNESKAI_FACT_OR_HYPE_ENABLED === 'true' && dneskaiScoutingEnabled(env);
}
