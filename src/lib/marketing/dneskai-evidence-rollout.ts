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
