import { z } from 'zod';
import { safeWebUrl } from '@/lib/web-url';
import { BrandSchema, ContentRevisionSchema, DneskaiRenderReportSchema, PlatformSchema } from './contracts';
import { CalendarImportDateSchema, CalendarImportStartSchema } from './calendar-import-contracts';
import { MarketingJobHealthSchema } from './job-health';
import { MarketingSourceSummarySchema } from './source-summary';

export const MARKETING_STATE_MAX_BYTES = 8 * 1024 * 1024;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.iso.datetime({ offset: true });
const idsUnique = (rows: readonly { id: string }[]) => new Set(rows.map(row => row.id)).size === rows.length;
const revision = z.strictObject({
 id: z.uuid(), user_id: z.uuid(), project_id: z.uuid().nullable(), campaign_id: z.uuid().nullable(),
 revision: ContentRevisionSchema, content_hash: hash, ready: z.boolean(),
 status: z.enum(['review', 'approved', 'publishing', 'published', 'failed', 'reconciliation', 'returned', 'skipped', 'superseded']),
 approved_at: timestamp.nullable(), approved_hash: hash.nullable(), feedback: z.string().max(10_000).nullable(), created_at: timestamp,
 render_report: DneskaiRenderReportSchema.nullable().optional(),
 // The workspace consumes only the hold metadata, not the stored media receipt.
 offline_import_receipt: z.object({ schemaVersion: z.string().max(100).optional(), holdCode: z.string().max(100).optional() }).nullable().optional(),
});
const campaign = z.strictObject({
 id: z.uuid(), brand: BrandSchema, name: z.string().min(1).max(10_000), starts_on: CalendarImportStartSchema,
 ends_on: CalendarImportDateSchema, source_hash: hash, status: z.enum(['draft', 'active', 'archived']),
}).refine(row => row.ends_on >= row.starts_on);
const entry = z.strictObject({
 id: z.uuid(), campaign_id: z.uuid(), date: CalendarImportDateSchema,
 local_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(), bound_source_id: z.uuid().nullable(),
 title: z.string().min(1).max(10_000), kind: z.string().min(1).max(100), platform: z.string().min(1).max(100),
 status: z.string().min(1).max(100), needs_review: z.boolean(),
});
const publication = z.strictObject({
 id: z.uuid(), revision_id: z.uuid(), platform: PlatformSchema,
 status: z.enum(['queued', 'claimed', 'published', 'failed', 'reconciliation', 'cancelled']),
 remote_container_id: z.string().max(200).nullable(), remote_media_id: z.string().max(200).nullable(),
 remote_url: z.string().min(1).max(2048).refine(value => safeWebUrl(value, 2048) !== null).nullable(), error_code: z.string().max(1000).nullable(),
});
const account = z.strictObject({
 brand: BrandSchema, platform: PlatformSchema, remote_account_id: z.string().min(1).max(200),
 handle: z.string().min(1).max(100), enabled: z.boolean(), verified_at: timestamp.nullable(),
});
const source = z.strictObject({ id: z.uuid(), brand: BrandSchema, source_id: z.string().min(1).max(200), eligible: z.boolean(), packet: MarketingSourceSummarySchema })
 .refine(row => row.brand === row.packet.brand && row.source_id === row.packet.sourceId);
const jobs = MarketingJobHealthSchema.extend({ costUsd: z.number().nonnegative().nullable() });

/** Complete transport shape of the existing bounded recent-list projection.
 * Validating this envelope does not turn its list caps into complete history. */
export const MarketingStateEnvelopeSchema = z.strictObject({
 ownerId: z.uuid(), revisions: z.array(revision).max(100).refine(idsUnique),
 campaigns: z.array(campaign).max(10).refine(idsUnique), entries: z.array(entry).max(1000).refine(idsUnique),
 publications: z.array(publication).max(100).refine(idsUnique),
 accounts: z.array(account).max(4).refine(rows => new Set(rows.map(row => `${row.brand}:${row.platform}`)).size === rows.length),
 sources: z.array(source).max(100).refine(idsUnique),
 sourceHistory: z.array(MarketingSourceSummarySchema).max(200).refine(rows => new Set(rows.map(row => JSON.stringify([row.brand, row.sourceId, row.sourceRevision, row.contentHash]))).size === rows.length),
 jobs: z.array(jobs).max(100).refine(idsUnique), jobHealth: z.array(MarketingJobHealthSchema).max(10).refine(idsUnique),
 diagnostics: z.strictObject({ sampleSize: z.number().int().min(0).max(100), firstApprovalRate: z.number().min(0).max(1).nullable() })
  .refine(value => value.sampleSize === 0 ? value.firstApprovalRate === null : value.firstApprovalRate !== null),
}).superRefine((value, context) => {
 if (value.revisions.some(row => row.user_id !== value.ownerId)) context.addIssue({ code: 'custom', message: 'state-owner-mismatch' });
 const fields = ['id', 'status', 'errorCode', 'brand', 'createdAt'] as const;
 if (value.jobHealth.length !== Math.min(value.jobs.length, 10) || value.jobHealth.some((job, index) => fields.some(field => job[field] !== value.jobs[index]?.[field]))) {
  context.addIssue({ code: 'custom', message: 'state-health-mismatch' });
 }
});
