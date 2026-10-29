import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Competitor } from '@/lib/types';
import { databaseTimestamp, databaseVersion } from '@/lib/database-version';
import { awaitWithSignal } from '@/lib/abortable';
import { safeWebUrl } from '@/lib/web-url';
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
  constructor(readonly reason: 'unavailable' | 'changed' = 'unavailable') { super('Competition unavailable'); }
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

const columns = Object.keys(competitorRecord.shape).join(',');
const webUrl = z.string().refine(value => !!safeWebUrl(value));
const mutableSchema = competitorRecord.omit({ id: true, user_id: true, created_at: true, updated_at: true }).extend({
 name: z.string().min(1).max(120).refine(value => value === value.trim()),
 url: webUrl.nullable(), social_links: z.array(webUrl), source_urls: z.array(webUrl),
});
const patchSchema = mutableSchema.partial().strict().refine(value => Object.keys(value).length > 0 && Object.values(value).every(field => field !== undefined));
export type CompetitorFields = z.infer<typeof mutableSchema>;
export type CompetitorPatch = Partial<CompetitorFields>;

function sameField(key: string, left: unknown, right: unknown) {
 if ((key === 'created_at' || key === 'updated_at') && typeof left === 'string' && typeof right === 'string') {
  return databaseVersion(left) === databaseVersion(right);
 }
 if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => value === right[index]);
 return left === right;
}
function matches(record: Competitor, expected: Partial<Competitor>) {
 return Object.entries(expected).every(([key, value]) => sameField(key, record[key as keyof Competitor], value));
}
function ownedCompetitor(value: unknown, ownerId: string): Competitor {
 const record = competitorRecord.parse(value);
 if (record.user_id !== ownerId) throw new CompetitorRecordError();
 return record;
}
function oneReceipt(data: unknown, ownerId: string): Competitor {
 if (!Array.isArray(data) || data.length !== 1) throw new CompetitorRecordError(Array.isArray(data) && data.length === 0 ? 'changed' : 'unavailable');
 return ownedCompetitor(data[0], ownerId);
}
function boundedIntent(value: unknown) {
 // Validate only the submitted payload here. The SDK response is checked after
 // parsing; this does not claim a streaming response-byte limit.
 if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 64 * 1024) throw new CompetitorRecordError();
}
async function writeWithin<T>(scope: CompetitorScope, action: (signal: AbortSignal, ownerId: string) => Promise<T>): Promise<T> {
 const { ownerId, signal: parent } = scope;
 const signal = AbortSignal.any([parent, AbortSignal.timeout(15_000)]);
 try {
  z.uuid().parse(ownerId); signal.throwIfAborted();
  const result = await action(signal, ownerId); signal.throwIfAborted(); return result;
 } catch (error) {
  if (parent.aborted) throw new DOMException('Request aborted', 'AbortError');
  throw error instanceof CompetitorRecordError ? error : new CompetitorRecordError();
 }
}

/** Keep this id and these exact fields across an uncertain create and its
 * explicit retry. A duplicate id is recovered only by reading the same owned
 * row and matching every submitted/default field; it is never an upsert. */
export function createCompetitorRecord(db: SupabaseClient, scope: CompetitorScope, id: string, fields: CompetitorFields): Promise<Competitor> {
 return writeWithin(scope, async (signal, ownerId) => {
  z.uuid().parse(id); const intent = mutableSchema.parse(fields); boundedIntent(intent);
  const result = await awaitWithSignal(db.from('competitors').insert({ ...intent, id, user_id: ownerId }).select(columns).retry(false).abortSignal(signal), signal);
  signal.throwIfAborted();
  let data: unknown = result.data;
  if (result.error?.code === '23505') {
   const recovery = await awaitWithSignal(db.from('competitors').select(columns).eq('id', id).eq('user_id', ownerId).retry(false).abortSignal(signal), signal);
   if (recovery.error) throw new CompetitorRecordError(); data = recovery.data;
  } else if (result.error) throw new CompetitorRecordError();
  signal.throwIfAborted(); const receipt = oneReceipt(data, ownerId);
  if (receipt.id !== id || !matches(receipt, intent)) throw new CompetitorRecordError('changed');
  return receipt;
 });
}

/** A stale source cannot overwrite a newer row. Require a complete receipt
 * with a newer database version and unchanged fields outside this patch. */
export function updateCompetitorRecord(db: SupabaseClient, scope: CompetitorScope, source: Competitor, fields: CompetitorPatch): Promise<Competitor> {
 return writeWithin(scope, async (signal, ownerId) => {
  const captured = ownedCompetitor(source, ownerId), patch = patchSchema.parse(fields); boundedIntent(patch);
  const { data, error } = await awaitWithSignal(db.from('competitors').update(patch).eq('id', captured.id).eq('user_id', ownerId).eq('updated_at', captured.updated_at).select(columns).retry(false).abortSignal(signal), signal);
  if (error) throw new CompetitorRecordError(); signal.throwIfAborted();
  const receipt = oneReceipt(data, ownerId), expected = { ...captured, ...patch };
  const { updated_at: previousVersion, ...unchangedAndIntent } = expected;
  if (!matches(receipt, unchangedAndIntent) || databaseVersion(receipt.updated_at)! <= databaseVersion(previousVersion)!) throw new CompetitorRecordError();
  return receipt;
 });
}

/** A zero-row deletion is a conflict, never a confirmed removal. Returning
 * the full old row also verifies that the deleted version was the captured one. */
export function removeCompetitorRecord(db: SupabaseClient, scope: CompetitorScope, source: Competitor): Promise<Competitor> {
 return writeWithin(scope, async (signal, ownerId) => {
  const captured = ownedCompetitor(source, ownerId);
  const { data, error } = await awaitWithSignal(db.from('competitors').delete().eq('id', captured.id).eq('user_id', ownerId).eq('updated_at', captured.updated_at).select(columns).retry(false).abortSignal(signal), signal);
  if (error) throw new CompetitorRecordError(); signal.throwIfAborted(); const receipt = oneReceipt(data, ownerId);
  if (!matches(receipt, captured)) throw new CompetitorRecordError(); return receipt;
 });
}

/** Apply a confirmed update only while the cache still represents its source.
 * A newer refresh or intervening edit must win over a late callback. */
export function applyCompetitorReceipt(rows: Competitor[], source: Competitor, receipt: Competitor | null): Competitor[] {
 if (receipt && (receipt.id !== source.id || receipt.user_id !== source.user_id)) return rows;
 return rows.flatMap(row => row.id !== source.id || !matches(row, source) ? [row] : receipt ? [receipt] : []);
}
