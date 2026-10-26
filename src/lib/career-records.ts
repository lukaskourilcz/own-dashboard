import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { awaitWithSignal } from '@/lib/abortable';
import { databaseTimestamp } from '@/lib/database-version';
import type {
  JobListing, JobUserState, SavedJobPosition, JobApplication, JobApplicationEvent,
  CoverLetterTemplate, JobScrapeRun,
} from '@/lib/types';

export type CareerScope = { ownerId: string; signal: AbortSignal };
export type CareerRecords = {
  job_listings: JobListing[];
  job_user_state: JobUserState[];
  saved_job_positions: SavedJobPosition[];
  job_applications: JobApplication[];
  job_application_events: JobApplicationEvent[];
  cover_letter_templates: CoverLetterTemplate[];
  job_scrape_runs: JobScrapeRun[];
};
export type CareerCollection = keyof CareerRecords;

const nullableText = z.string().nullable();
const uuid = z.uuid();
const stamp = databaseTimestamp;
const own = { id: uuid, user_id: uuid };
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const schemas = {
  job_listings: z.strictObject({
    id: uuid, source: z.string(), external_id: z.string(), title: z.string(),
    company: nullableText, url: z.string(), location: nullableText,
    role: z.enum(['frontend', 'fullstack', 'software']), remote: z.boolean(),
    salary: nullableText, tags: z.array(z.string()), seniority: nullableText,
    description: nullableText, posted_at: stamp.nullable(), first_seen_at: stamp, last_seen_at: stamp,
  }),
  job_user_state: z.strictObject({
    ...own, listing_id: uuid, state: z.enum(['shortlisted', 'deleted']), created_at: stamp, updated_at: stamp.nullable(),
  }),
  saved_job_positions: z.strictObject({
    ...own, listing_id: uuid.nullable(), title: z.string(), company: nullableText,
    url: z.string(), source: nullableText, location: nullableText, remote: z.boolean().nullable(), description: nullableText,
    cover_letter: z.string(), notes: nullableText, saved_at: stamp, updated_at: stamp,
    cover_letter_url: nullableText, readiness: z.enum(['draft', 'ready', 'needs_review']),
  }),
  job_applications: z.strictObject({
    ...own, listing_id: uuid.nullable(), title: z.string(), company: nullableText,
    url: nullableText, source: nullableText, location: nullableText, remote: z.boolean().nullable(), cover_letter: z.string(),
    status: z.enum(['applied', 'interviewing', 'offer', 'rejected', 'withdrawn']),
    applied_on: z.iso.date(), notes: nullableText, created_at: stamp, updated_at: stamp,
    organization_id: uuid.nullable(), next_follow_up_at: stamp.nullable(), cover_letter_url: nullableText,
    request_id: uuid.nullable(), responded_on: z.iso.date().nullable(),
    response_kind: z.enum(['positive', 'negative', 'neutral']).nullable(),
    contact_name: nullableText, contact_email: nullableText,
  }),
  job_application_events: z.strictObject({
    ...own, application_id: uuid, kind: z.enum(['applied', 'status', 'note']),
    detail: nullableText, created_at: stamp,
  }),
  cover_letter_templates: z.strictObject({
    ...own, name: z.string(), body: z.string(), created_at: stamp, updated_at: stamp,
  }),
  job_scrape_runs: z.strictObject({
    id: uuid, started_at: stamp, finished_at: stamp.nullable(), ok: z.boolean(),
    inserted: count, refreshed: count, pruned: count,
    sources: z.record(z.string(), z.strictObject({ count, pruned: count.optional(), error: z.string().optional() })),
  }),
};
/** Shared positive contract for complete reads and confirmed private writes. */
export const savedCareerRecordSchema = schemas.saved_job_positions;
export const careerTriageRecordSchema = schemas.job_user_state;
export const careerApplicationRecordSchema = schemas.job_applications;
export const careerApplicationEventSchema = schemas.job_application_events;

const limits: Record<CareerCollection, number> = {
  job_listings: 10_000, job_user_state: 20_000, saved_job_positions: 10_000,
  job_applications: 10_000, job_application_events: 50_000,
  cover_letter_templates: 10_000, job_scrape_runs: 1,
};

export class CareerReadError extends Error {
  constructor() { super('Career unavailable'); }
}

/** SQL owns the complete 10MiB JSON bound; this is not a streaming byte cap. */
export async function readCareerRecords<K extends CareerCollection>(
  db: SupabaseClient,
  entity: K,
  scope: CareerScope,
): Promise<{ data: CareerRecords[K]; error: null }> {
  const { ownerId, signal: parent } = scope;
  const lifetime = new AbortController();
  const signal = AbortSignal.any([parent, lifetime.signal, AbortSignal.timeout(15_000)]);
  try {
    signal.throwIfAborted();
    uuid.parse(ownerId);
    if (!Object.hasOwn(schemas, entity)) throw new CareerReadError();
    const result = await awaitWithSignal(
      db.rpc('read_career_records', { p_entity: entity, p_expected_owner: ownerId })
        .retry(false).abortSignal(signal),
      signal,
    );
    signal.throwIfAborted();
    if (result.error) throw new CareerReadError();
    const receipt = z.strictObject({
      ownerId: uuid, collection: z.literal(entity), rows: z.array(schemas[entity]).max(limits[entity]),
    }).parse(result.data);
    if (receipt.ownerId !== ownerId || new Set(receipt.rows.map(row => row.id)).size !== receipt.rows.length) {
      throw new CareerReadError();
    }
    if (receipt.rows.some(row => 'user_id' in row && row.user_id !== ownerId)) throw new CareerReadError();
    signal.throwIfAborted();
    return { data: receipt.rows as CareerRecords[K], error: null };
  } catch {
    if (parent.aborted) throw new DOMException('Request aborted', 'AbortError');
    throw new CareerReadError();
  } finally {
    lifetime.abort();
  }
}
