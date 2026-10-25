import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Organization } from '@/lib/types';
import { databaseTimestamp, databaseVersion } from '@/lib/database-version';
import { awaitWithSignal } from '@/lib/abortable';
import { readOwnedCollection } from '@/lib/owned-records';

const text = z.string().nullable();
const organizationRecordSchema = z.object({
 id: z.uuid(), user_id: z.uuid(), name: z.string().min(1), type: z.enum(['client','prospective_client','employer','prospective_employer','personal_project','other']),
 website: text, logo_url: text, email: text, phone: text, address: text, city: text, zip: text, country: text, company_id: text, vat_id: text, notes: z.string(),
 status: z.enum(['active','inactive','archived']), ares_verified_at: databaseTimestamp.nullable(),
 vat_verification_status: z.enum(['unchecked','valid','invalid','unavailable']), vat_verified_at: databaseTimestamp.nullable(), vat_verified_id: text, vat_verified_name: text, vat_verified_address: text,
 created_at: databaseTimestamp, updated_at: databaseTimestamp,
}).strict();
export type OrganizationScope = { ownerId: string; signal: AbortSignal };
export class OrganizationRecordError extends Error {
 constructor(readonly reason: 'unavailable' | 'changed' = 'unavailable') { super('Organization unavailable'); }
}
function ownedOrganization(value: unknown, ownerId: string): Organization {
 const record = organizationRecordSchema.parse(value);
 if (record.user_id !== ownerId) throw new OrganizationRecordError();
 return record;
}

const columns = Object.keys(organizationRecordSchema.shape).join(',');
const mutableSchema = organizationRecordSchema.omit({ id: true, user_id: true, created_at: true, updated_at: true });
const patchSchema = mutableSchema.partial().strict().refine(value => Object.keys(value).length > 0 && Object.values(value).every(field => field !== undefined));
export type OrganizationFields = z.infer<typeof mutableSchema>;
export type OrganizationPatch = Partial<OrganizationFields>;

function sameField(key: string, left: unknown, right: unknown) {
 return key.endsWith('_at') && typeof left === 'string' && typeof right === 'string'
  ? databaseVersion(left) === databaseVersion(right) : left === right;
}
function matches(record: Organization, expected: Partial<Organization>) {
 return Object.entries(expected).every(([key, value]) => sameField(key, record[key as keyof Organization], value));
}
function oneReceipt(data: unknown, ownerId: string): Organization {
 if (!Array.isArray(data) || data.length !== 1) throw new OrganizationRecordError(Array.isArray(data) && data.length === 0 ? 'changed' : 'unavailable');
 return ownedOrganization(data[0], ownerId);
}
function boundedIntent(value: unknown) {
 // Validate only the submitted payload here. The SDK response is checked after
 // parsing; this does not claim a streaming response-byte limit.
 if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 64 * 1024) throw new OrganizationRecordError();
}
async function writeWithin<T>(scope: OrganizationScope, action: (signal: AbortSignal, ownerId: string) => Promise<T>): Promise<T> {
 const { ownerId, signal: parent } = scope;
 const signal = AbortSignal.any([parent, AbortSignal.timeout(15_000)]);
 try {
  z.uuid().parse(ownerId); signal.throwIfAborted();
  const result = await action(signal, ownerId); signal.throwIfAborted(); return result;
 } catch (error) {
  if (parent.aborted) throw new DOMException('Request aborted', 'AbortError');
  throw error instanceof OrganizationRecordError ? error : new OrganizationRecordError();
 }
}

/** Keep this id and these exact fields across an uncertain create and its
 * explicit retry. A duplicate id is recovered only by reading the same owned
 * row and matching every submitted/default field; it is never an upsert. */
export function createOrganizationRecord(db: SupabaseClient, scope: OrganizationScope, id: string, fields: OrganizationFields): Promise<Organization> {
 return writeWithin(scope, async (signal, ownerId) => {
  z.uuid().parse(id); const intent = mutableSchema.parse(fields); boundedIntent(intent);
  const result = await awaitWithSignal(db.from('organizations').insert({ ...intent, id, user_id: ownerId }).select(columns).retry(false).abortSignal(signal), signal);
  signal.throwIfAborted();
  let data: unknown = result.data;
  if (result.error?.code === '23505') {
   const recovery = await awaitWithSignal(db.from('organizations').select(columns).eq('id', id).eq('user_id', ownerId).retry(false).abortSignal(signal), signal);
   if (recovery.error) throw new OrganizationRecordError(); data = recovery.data;
  } else if (result.error) throw new OrganizationRecordError();
  signal.throwIfAborted(); const receipt = oneReceipt(data, ownerId);
  if (receipt.id !== id || !matches(receipt, intent)) throw new OrganizationRecordError('changed');
  return receipt;
 });
}

/** A stale source cannot overwrite a newer row. Require a complete receipt
 * with a newer database version and unchanged fields outside this patch. */
export function updateOrganizationRecord(db: SupabaseClient, scope: OrganizationScope, source: Organization, fields: OrganizationPatch): Promise<Organization> {
 return writeWithin(scope, async (signal, ownerId) => {
  const captured = ownedOrganization(source, ownerId), patch = patchSchema.parse(fields); boundedIntent(patch);
  const { data, error } = await awaitWithSignal(db.from('organizations').update(patch).eq('id', captured.id).eq('user_id', ownerId).eq('updated_at', captured.updated_at).select(columns).retry(false).abortSignal(signal), signal);
  if (error) throw new OrganizationRecordError(); signal.throwIfAborted();
  const receipt = oneReceipt(data, ownerId), expected = { ...captured, ...patch };
  const { updated_at: previousVersion, ...unchangedAndIntent } = expected;
  if (!matches(receipt, unchangedAndIntent) || databaseVersion(receipt.updated_at)! <= databaseVersion(previousVersion)!) throw new OrganizationRecordError();
  return receipt;
 });
}

/** A zero-row deletion is a conflict, never a confirmed removal. Returning
 * the full old row also verifies that the deleted version was the captured one. */
export function removeOrganizationRecord(db: SupabaseClient, scope: OrganizationScope, source: Organization): Promise<Organization> {
 return writeWithin(scope, async (signal, ownerId) => {
  const captured = ownedOrganization(source, ownerId);
  const { data, error } = await awaitWithSignal(db.from('organizations').delete().eq('id', captured.id).eq('user_id', ownerId).eq('updated_at', captured.updated_at).select(columns).retry(false).abortSignal(signal), signal);
  if (error) throw new OrganizationRecordError(); signal.throwIfAborted(); const receipt = oneReceipt(data, ownerId);
  if (!matches(receipt, captured)) throw new OrganizationRecordError(); return receipt;
 });
}

/** Apply a confirmed update only while the cache still represents its source.
 * A newer refresh or intervening edit must win over a late callback. */
export function applyOrganizationReceipt(rows: Organization[], source: Organization, receipt: Organization | null): Organization[] {
 if (receipt && (receipt.id !== source.id || receipt.user_id !== source.user_id)) return rows;
 return rows.flatMap(row => row.id !== source.id || !matches(row, source) ? [row] : receipt ? [receipt] : []);
}

/** One complete SQL/RLS snapshot, not a REST-capped page. The SQL owns its
 * 10MiB return bound; this reader checks ownership, shape and the 10,000-row
 * contract after the SDK read. It does not claim a streamed client byte cap. */
export async function readOrganizationRecords(db: SupabaseClient, scope: OrganizationScope): Promise<{ data: Organization[]; error: null }> {
 const signal = AbortSignal.any([scope.signal, AbortSignal.timeout(15_000)]);
 try {
  z.uuid().parse(scope.ownerId); signal.throwIfAborted();
  const { data } = await readOwnedCollection(db, 'organizations', scope.ownerId, signal);
  if (data.length > 10_000) throw new OrganizationRecordError();
  const records = data.map(value => ownedOrganization(value, scope.ownerId));
  signal.throwIfAborted(); return { data: records, error: null };
 } catch {
  if (scope.signal.aborted) throw new DOMException('Request aborted', 'AbortError');
  throw new OrganizationRecordError();
 }
}
