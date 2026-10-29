import { z } from 'zod';
import { SourcePacketSchema } from './contracts';

/** Attribution and eligibility evidence used by the workspace, without authored
 * body/code/answers/briefs that the workspace never displays or edits. */
const withoutCredentials = (value: string) => {
 try { const url = new URL(value); return !url.username && !url.password; }
 catch { return false; }
};
export const MarketingSourceSummarySchema = SourcePacketSchema.pick({
 brand: true, sourceId: true, sourceRevision: true, contentHash: true, canonicalUrl: true, expiresAt: true,
}).extend({
 canonicalUrl: SourcePacketSchema.shape.canonicalUrl.refine(withoutCredentials),
 content: SourcePacketSchema.shape.content.pick({ title: true, evidence: true }).refine(value => value.evidence.every(item => withoutCredentials(item.url))),
});
export type MarketingSourceSummary = z.infer<typeof MarketingSourceSummarySchema>;

export const MARKETING_SOURCE_SUMMARY_COLUMNS = [
 'summary_brand:packet->>brand', 'summary_source_id:packet->>sourceId', 'summary_revision:packet->>sourceRevision',
 'summary_hash:packet->>contentHash', 'summary_url:packet->>canonicalUrl', 'summary_expires:packet->>expiresAt',
 'summary_title:packet->content->>title', 'summary_evidence:packet->content->evidence',
].join(',');

export function marketingSourceSummary(row: Record<string, unknown>): MarketingSourceSummary {
 return MarketingSourceSummarySchema.parse({
  brand: row.summary_brand, sourceId: row.summary_source_id, sourceRevision: row.summary_revision,
  contentHash: row.summary_hash, canonicalUrl: row.summary_url, expiresAt: row.summary_expires,
  content: { title: row.summary_title, evidence: row.summary_evidence },
 });
}
