import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Plan } from '@/lib/types';
import { databaseTimestamp, databaseVersion } from '@/lib/database-version';
import { awaitWithSignal } from '@/lib/abortable';
import { readOwnedCollection } from '@/lib/owned-records';

const planRecord = z.object({
 id: z.uuid(), user_id: z.uuid(), title: z.string(), target_date: z.iso.date().nullable(),
 status: z.enum(['idea', 'active', 'done', 'dropped']), recurrence: z.enum(['none', 'weekly', 'biweekly', 'monthly']),
 notes: z.string().nullable(), last_completed_at: databaseTimestamp.nullable(), linked_calendar_event_id: z.string().nullable(),
 created_at: databaseTimestamp, updated_at: databaseTimestamp,
}).strict();
export type PlanScope = { ownerId: string; signal: AbortSignal };
export class PlanRecordError extends Error {
  constructor(readonly reason: 'unavailable' | 'changed' = 'unavailable') { super('Plans unavailable'); }
}

/** One complete invoker/RLS snapshot. SQL owns its 10MiB JSON bound; the
 * SDK parses before these record/owner checks. No streaming byte-cap claim. */
export async function readPlanRecords(db: SupabaseClient, scope: PlanScope): Promise<{ data: Plan[]; error: null }> {
  const { ownerId, signal: parent } = scope;
  const signal = AbortSignal.any([parent, AbortSignal.timeout(15_000)]);
  try {
    z.uuid().parse(ownerId);
    signal.throwIfAborted();
    const { data } = await readOwnedCollection(db, 'plans', ownerId, signal);
    if (data.length > 10_000) throw new PlanRecordError();
    const records = data.map(value => {
      const record = planRecord.parse(value);
      if (record.user_id !== ownerId) throw new PlanRecordError();
      return record;
    });
    signal.throwIfAborted();
    return { data: records, error: null };
  } catch {
    if (parent.aborted) throw new DOMException('Request aborted', 'AbortError');
    throw new PlanRecordError();
  }
}

const columns = Object.keys(planRecord.shape).join(',');
const mutableSchema = planRecord.pick({ title: true, target_date: true, status: true, recurrence: true, notes: true }).extend({
 title: z.string().min(1).max(500).refine(value => value === value.trim()),
});
const patchSchema = planRecord.pick({ status: true, last_completed_at: true, linked_calendar_event_id: true }).extend({ linked_calendar_event_id: z.string().min(1).max(1024).refine(value => !/\p{Cc}/u.test(value)).nullable() }).partial().strict()
 .refine(value => Object.keys(value).length > 0 && Object.values(value).every(field => field !== undefined));
export type PlanFields = z.infer<typeof mutableSchema>;
export type PlanPatch = z.infer<typeof patchSchema>;

function sameField(key: string, left: unknown, right: unknown) {
 if ((key === 'created_at' || key === 'updated_at' || key === 'last_completed_at') && typeof left === 'string' && typeof right === 'string') {
  return databaseVersion(left) === databaseVersion(right);
 }
 return left === right;
}
function matches(record: Plan, expected: Partial<Plan>) {
 return Object.entries(expected).every(([key, value]) => sameField(key, record[key as keyof Plan], value));
}
function ownedPlan(value: unknown, ownerId: string): Plan {
 const record = planRecord.parse(value);
 if (record.user_id !== ownerId) throw new PlanRecordError();
 return record;
}
function oneReceipt(data: unknown, ownerId: string): Plan {
 if (!Array.isArray(data) || data.length !== 1) throw new PlanRecordError(Array.isArray(data) && data.length === 0 ? 'changed' : 'unavailable');
 return ownedPlan(data[0], ownerId);
}
function boundedIntent(value: unknown) {
 // Validate only the submitted payload here. The SDK response is checked after
 // parsing; this does not claim a streaming response-byte limit.
 if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 64 * 1024) throw new PlanRecordError();
}
async function writeWithin<T>(scope: PlanScope, action: (signal: AbortSignal, ownerId: string) => Promise<T>): Promise<T> {
 const { ownerId, signal: parent } = scope;
 const signal = AbortSignal.any([parent, AbortSignal.timeout(15_000)]);
 try {
  z.uuid().parse(ownerId); signal.throwIfAborted();
  const result = await action(signal, ownerId); signal.throwIfAborted(); return result;
 } catch (error) {
  if (parent.aborted) throw new DOMException('Request aborted', 'AbortError');
  throw error instanceof PlanRecordError ? error : new PlanRecordError();
 }
}

/** Keep this id and these exact fields across an uncertain create and its
 * explicit retry. A duplicate id is recovered only by reading the same owned
 * row and matching every submitted/default field; it is never an upsert. */
export function createPlanRecord(db: SupabaseClient, scope: PlanScope, id: string, fields: PlanFields): Promise<Plan> {
 return writeWithin(scope, async (signal, ownerId) => {
  z.uuid().parse(id); const intent = { ...mutableSchema.parse(fields), last_completed_at: null, linked_calendar_event_id: null }; boundedIntent(intent);
  const result = await awaitWithSignal(db.from('plans').insert({ ...intent, id, user_id: ownerId }).select(columns).retry(false).abortSignal(signal), signal);
  signal.throwIfAborted();
  let data: unknown = result.data;
  if (result.error?.code === '23505') {
   const recovery = await awaitWithSignal(db.from('plans').select(columns).eq('id', id).eq('user_id', ownerId).retry(false).abortSignal(signal), signal);
   if (recovery.error) throw new PlanRecordError(); data = recovery.data;
  } else if (result.error) throw new PlanRecordError();
  signal.throwIfAborted(); const receipt = oneReceipt(data, ownerId);
  if (receipt.id !== id || !matches(receipt, intent)) throw new PlanRecordError('changed');
  return receipt;
 });
}

/** A stale source cannot overwrite a newer row. Require a complete receipt
 * with a newer database version and unchanged fields outside this patch. */
export function updatePlanRecord(db: SupabaseClient, scope: PlanScope, source: Plan, fields: PlanPatch): Promise<Plan> {
 return writeWithin(scope, async (signal, ownerId) => {
  const captured = ownedPlan(source, ownerId), patch = patchSchema.parse(fields); boundedIntent(patch);
  const { data, error } = await awaitWithSignal(db.from('plans').update(patch).eq('id', captured.id).eq('user_id', ownerId).eq('updated_at', captured.updated_at).select(columns).retry(false).abortSignal(signal), signal);
  if (error) throw new PlanRecordError(); signal.throwIfAborted();
  const receipt = oneReceipt(data, ownerId), expected = { ...captured, ...patch };
  const { updated_at: previousVersion, ...unchangedAndIntent } = expected;
  if (!matches(receipt, unchangedAndIntent) || databaseVersion(receipt.updated_at)! <= databaseVersion(previousVersion)!) throw new PlanRecordError();
  return receipt;
 });
}

/** A zero-row deletion is a conflict, never a confirmed removal. Returning
 * the full old row also verifies that the deleted version was the captured one. */
export function removePlanRecord(db: SupabaseClient, scope: PlanScope, source: Plan): Promise<Plan> {
 return writeWithin(scope, async (signal, ownerId) => {
  const captured = ownedPlan(source, ownerId);
  const { data, error } = await awaitWithSignal(db.from('plans').delete().eq('id', captured.id).eq('user_id', ownerId).eq('updated_at', captured.updated_at).select(columns).retry(false).abortSignal(signal), signal);
  if (error) throw new PlanRecordError(); signal.throwIfAborted(); const receipt = oneReceipt(data, ownerId);
  if (!matches(receipt, captured)) throw new PlanRecordError(); return receipt;
 });
}

/** Apply a confirmed update only while the cache still represents its source.
 * A newer refresh or intervening edit must win over a late callback. */
export function applyPlanReceipt(rows: Plan[], source: Plan, receipt: Plan | null): Plan[] {
 if (receipt && (receipt.id !== source.id || receipt.user_id !== source.user_id)) return rows;
 return rows.flatMap(row => row.id !== source.id || !matches(row, source) ? [row] : receipt ? [receipt] : []);
}
