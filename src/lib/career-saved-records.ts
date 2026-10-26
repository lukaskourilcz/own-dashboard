import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SavedJobPosition } from '@/lib/types';
import { savedCareerRecordSchema, type CareerScope } from '@/lib/career-records';
import { awaitWithSignal } from '@/lib/abortable';
import { databaseVersion } from '@/lib/database-version';
import { normalizeJobUrl } from '@/lib/jobs/enrich';
import { isGoogleLetterUrl } from '@/lib/jobs/pipeline';

export class CareerSavedError extends Error {
  constructor(readonly reason: 'unavailable' | 'changed' | 'invalid' = 'unavailable') {
    super('Saved position unconfirmed');
  }
}
const fieldsSchema = z.strictObject({
  listing_id: z.uuid().nullable(), title: z.string().trim().min(1).max(300),
  company: z.string().max(500).nullable(),
  url: z.string().transform((value, context) => {
    const url = normalizeJobUrl(value);
    if (url && url.length <= 2048) return url;
    context.addIssue({ code: 'custom', message: 'Invalid URL' }); return z.NEVER;
  }),
  source: z.string().max(500).nullable(), location: z.string().max(500).nullable(),
  remote: z.boolean().nullable(), description: z.string().max(30_000).nullable(),
  cover_letter: z.string().max(64_000), notes: z.string().max(30_000).nullable(),
  cover_letter_url: z.string().max(2048).refine(isGoogleLetterUrl).nullable(),
  readiness: z.enum(['draft', 'ready', 'needs_review']),
});
const createSchema = fieldsSchema.extend({
  listing_id: fieldsSchema.shape.listing_id.default(null),
  company: fieldsSchema.shape.company.default(null), source: fieldsSchema.shape.source.default(null),
  location: fieldsSchema.shape.location.default(null), remote: fieldsSchema.shape.remote.default(null),
  description: fieldsSchema.shape.description.default(null), cover_letter: fieldsSchema.shape.cover_letter.default(''),
  notes: fieldsSchema.shape.notes.default(null), cover_letter_url: fieldsSchema.shape.cover_letter_url.default(null),
  readiness: fieldsSchema.shape.readiness.default('draft'),
});
const patchSchema = fieldsSchema.partial().refine(value => Object.keys(value).length > 0 && Object.values(value).every(field => field !== undefined));
export type CareerSavedFields = z.input<typeof createSchema>;
export type CareerSavedPatch = z.input<typeof patchSchema>;
const columns = Object.keys(savedCareerRecordSchema.shape).join(',');

function intent<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success || new TextEncoder().encode(JSON.stringify(parsed.data)).byteLength > 256 * 1024) throw new CareerSavedError('invalid');
  return parsed.data;
}
function owned(value: unknown, ownerId: string) {
  // Reads keep legacy text intact; new-write limits apply only to submitted fields.
  const row = savedCareerRecordSchema.parse(value);
  if (row.user_id !== ownerId) throw new CareerSavedError();
  return row;
}
function matches(row: SavedJobPosition, expected: Partial<SavedJobPosition>) {
  return Object.entries(expected).every(([key, value]) => {
    const actual = row[key as keyof SavedJobPosition];
    return (key === 'saved_at' || key === 'updated_at') && typeof actual === 'string' && typeof value === 'string'
      ? databaseVersion(actual) === databaseVersion(value) : actual === value;
  });
}
function one(data: unknown, ownerId: string) {
  if (!Array.isArray(data) || data.length !== 1) throw new CareerSavedError(Array.isArray(data) && data.length === 0 ? 'changed' : 'unavailable');
  return owned(data[0], ownerId);
}
async function within<T>(scope: CareerScope, action: (ownerId: string, signal: AbortSignal) => Promise<T>): Promise<T> {
  const { ownerId, signal: parent } = scope, lifetime = new AbortController();
  const signal = AbortSignal.any([parent, lifetime.signal, AbortSignal.timeout(15_000)]);
  try {
    signal.throwIfAborted(); z.uuid().parse(ownerId);
    const result = await action(ownerId, signal); signal.throwIfAborted(); return result;
  } catch (error) {
    if (parent.aborted) throw new DOMException('Request aborted', 'AbortError');
    throw error instanceof CareerSavedError ? error : new CareerSavedError();
  } finally { lifetime.abort(); }
}

/** Keep this id and intent for an explicit retry after an uncertain insert.
 * A URL collision is never permission to replace an existing private draft. */
export function createCareerSavedRecord(db: SupabaseClient, scope: CareerScope, id: string, fields: CareerSavedFields) {
  return within(scope, async (ownerId, signal) => {
    z.uuid().parse(id); const captured = intent(createSchema, fields);
    const result = await awaitWithSignal(db.from('saved_job_positions').insert({ ...captured, id, user_id: ownerId }).select(columns).retry(false).abortSignal(signal), signal);
    signal.throwIfAborted(); let data: unknown = result.data;
    if (result.error?.code === '23505') {
      const recovery = await awaitWithSignal(db.from('saved_job_positions').select(columns).eq('id', id).eq('user_id', ownerId).retry(false).abortSignal(signal), signal);
      signal.throwIfAborted(); if (recovery.error) throw new CareerSavedError(); data = recovery.data;
    } else if (result.error) throw new CareerSavedError();
    const row = one(data, ownerId);
    if (row.id !== id || !matches(row, captured)) throw new CareerSavedError('changed');
    return row;
  });
}

export function updateCareerSavedRecord(db: SupabaseClient, scope: CareerScope, source: SavedJobPosition, fields: CareerSavedPatch) {
  return within(scope, async (ownerId, signal) => {
    const captured = owned(source, ownerId), patch = intent(patchSchema, fields);
    const { data, error } = await awaitWithSignal(db.from('saved_job_positions').update(patch).eq('id', captured.id).eq('user_id', ownerId).eq('updated_at', captured.updated_at).select(columns).retry(false).abortSignal(signal), signal);
    signal.throwIfAborted(); if (error) throw new CareerSavedError(); const row = one(data, ownerId);
    const { updated_at: previous, ...expected } = { ...captured, ...patch };
    if (!matches(row, expected) || databaseVersion(row.updated_at)! <= databaseVersion(previous)!) throw new CareerSavedError();
    return row;
  });
}

export function removeCareerSavedRecord(db: SupabaseClient, scope: CareerScope, source: SavedJobPosition) {
  return within(scope, async (ownerId, signal) => {
    const captured = owned(source, ownerId);
    const { data, error } = await awaitWithSignal(db.from('saved_job_positions').delete().eq('id', captured.id).eq('user_id', ownerId).eq('updated_at', captured.updated_at).select(columns).retry(false).abortSignal(signal), signal);
    signal.throwIfAborted(); if (error) throw new CareerSavedError(); const row = one(data, ownerId);
    if (!matches(row, captured)) throw new CareerSavedError(); return row;
  });
}

/** A late result cannot replace a newer refresh, a missing row or another owner. */
export function applyCareerSavedReceipt(rows: SavedJobPosition[], source: SavedJobPosition, receipt: SavedJobPosition | null): SavedJobPosition[] {
  if (receipt && (receipt.id !== source.id || receipt.user_id !== source.user_id)) return rows;
  return rows.flatMap(row => row.id !== source.id || !matches(row, source) ? [row] : receipt ? [receipt] : []);
}
