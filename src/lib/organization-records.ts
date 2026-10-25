import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Organization } from '@/lib/types';
import { databaseTimestamp } from '@/lib/database-version';
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
