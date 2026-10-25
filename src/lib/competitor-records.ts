import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Competitor } from '@/lib/types';
import { databaseTimestamp } from '@/lib/database-version';
import { readOwnedCollection } from '@/lib/owned-records';

const competitorRecord = z.object({
  id: z.uuid(), user_id: z.uuid(), project_id: z.uuid(), name: z.string().min(1).max(120),
  url: z.string().nullable(), summary: z.string(), category: z.enum(['direct', 'indirect', 'inspiration']),
  useful_features: z.array(z.string()), social_content: z.string(), pricing_model: z.string(), lessons: z.string(),
  relevance_score: z.number().int().min(1).max(5).nullable(), score_rationale: z.string(),
  social_links: z.array(z.string()), source_urls: z.array(z.string()), reviewed_at: z.iso.date().nullable(),
  sort_order: z.number().int(), created_at: databaseTimestamp, updated_at: databaseTimestamp,
}).strict();
export type CompetitorScope = { ownerId: string; signal: AbortSignal };
export class CompetitorRecordError extends Error {
  constructor() { super('Competition unavailable'); }
}

/** One complete invoker/RLS snapshot. SQL owns its 10MiB JSON bound; the
 * SDK parses before these record/owner checks. No streaming byte-cap claim. */
export async function readCompetitorRecords(db: SupabaseClient, scope: CompetitorScope): Promise<{ data: Competitor[]; error: null }> {
  const { ownerId, signal: parent } = scope;
  const signal = AbortSignal.any([parent, AbortSignal.timeout(15_000)]);
  try {
    z.uuid().parse(ownerId);
    signal.throwIfAborted();
    const { data } = await readOwnedCollection(db, 'competitors', ownerId, signal);
    if (data.length > 10_000) throw new CompetitorRecordError();
    const records = data.map(value => {
      const record = competitorRecord.parse(value);
      if (record.user_id !== ownerId) throw new CompetitorRecordError();
      return record;
    });
    signal.throwIfAborted();
    return { data: records, error: null };
  } catch {
    if (parent.aborted) throw new DOMException('Request aborted', 'AbortError');
    throw new CompetitorRecordError();
  }
}
