import 'server-only';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The topic spend ledger of 20261023100100 (#152): reserve before a paid topic call, settle after it. Transcripts
 * have their own daily ceiling; model calls share the $1 DNESKAi generation ceiling. An unreadable answer refuses.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the generated database types do not cover marketing functions
type Database = Pick<SupabaseClient<any>, 'rpc'>;
type Environment = Record<string, string | undefined>;
export type DneskaiTopicSpendKind = 'transcript' | 'classify' | 'title' | 'tiktok';

/** `MARKETING_DNESKAI_TRANSCRIPT_DAILY_USD`, default $0.50. A malformed value refuses every transcript. */
export const DEFAULT_DNESKAI_TRANSCRIPT_DAILY_USD = 0.5;
export function dneskaiTranscriptDailyCeiling(env: Environment = process.env): number {
  const raw = env.MARKETING_DNESKAI_TRANSCRIPT_DAILY_USD;
  if (raw === undefined || raw.trim() === '') return DEFAULT_DNESKAI_TRANSCRIPT_DAILY_USD;
  const value = /^\d+(?:\.\d+)?$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN;
  if (!Number.isFinite(value) || value <= 0 || value > 5) throw new Error('transcript-budget-invalid');
  return value;
}

const DecisionSchema = z.object({ admitted: z.boolean(), id: z.uuid().optional() });
/** Reserves one call; returns the ledger row id, or null when the ceiling would be passed. */
export async function reserveDneskaiTopicSpend(db: Database, owner: string, kind: DneskaiTopicSpendKind, ref: string, reservationUsd: number, ceilingUsd: number): Promise<string | null> {
  let decision: z.infer<typeof DecisionSchema>;
  try {
    const { data, error } = await db.rpc('marketing_reserve_dneskai_topic_spend', { p_owner: owner, p_kind: kind, p_ref: ref.slice(0, 300), p_reservation: reservationUsd, p_ceiling: ceilingUsd });
    if (error) throw error;
    decision = DecisionSchema.parse(data);
  } catch { throw new Error('topic-budget-unavailable'); }
  if (!decision.admitted) return null;
  if (!decision.id) throw new Error('topic-budget-unavailable');
  return decision.id;
}

/** Records the measured cost once. A failure leaves the reservation counting at its full amount. */
export async function settleDneskaiTopicSpend(db: Database, owner: string, id: string, costUsd: number): Promise<boolean> {
  try {
    const { data, error } = await db.rpc('marketing_settle_dneskai_topic_spend', { p_owner: owner, p_id: id, p_cost: Math.max(0, Math.round(costUsd * 10_000) / 10_000) });
    return !error && data === true;
  } catch { return false; }
}
