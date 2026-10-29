import { EMPTY_MARKETING_STATE, type MarketingState } from '@/lib/marketing/client';
import { parseContentRevision } from '@/lib/marketing/contracts';

export const stateOwner = '11111111-1111-4111-8111-111111111111';
export const stateId = (value: number) => `${String(value).padStart(8, '0')}-0000-4000-8000-000000000000`;
export function marketingStateFixture(): MarketingState & { ownerId: string } {
 const packet = { brand: 'devshark' as const, sourceId: 'source:owned', sourceRevision: 'v1', contentHash: 'a'.repeat(64), canonicalUrl: 'https://example.test/source', expiresAt: null, content: { title: 'Reviewed source', evidence: [] } };
 const job = { id: stateId(4), status: 'failed' as const, errorCode: 'provider-failed', brand: 'devshark' as const, createdAt: '2026-10-29T00:00:00Z' };
 const revision = parseContentRevision({ schemaVersion: 'marketing-content/1', brand: 'devshark', title: 'Reviewed draft', caption: 'Authored draft', format: 'thread', sources: [{ sourceId: packet.sourceId, sourceRevision: packet.sourceRevision, contentHash: packet.contentHash }], knowledgeIds: [], assets: [], account: { id: 'test-only-account', platform: 'threads', handle: 'test_only' }, scheduledAt: '2026-10-30T09:00:00Z', timeZone: 'Europe/Prague', templateVersion: 'test/1', promptVersion: 'test/1', model: 'test-only', traceId: null });
 return { ...structuredClone(EMPTY_MARKETING_STATE), ownerId: stateOwner,
  revisions: [{ id: stateId(1), user_id: stateOwner, project_id: null, campaign_id: stateId(2), revision, content_hash: 'b'.repeat(64), ready: false, status: 'review', approved_at: null, approved_hash: null, feedback: null, created_at: '2026-10-29T00:00:00Z', render_report: null, offline_import_receipt: null }],
  campaigns: [{ id: stateId(2), brand: 'devshark', name: 'Reviewed plan', starts_on: '2026-10-29', ends_on: '2026-11-04', source_hash: 'a'.repeat(64), status: 'draft' }],
  entries: [{ id: stateId(3), campaign_id: stateId(2), date: '2026-10-30', local_time: '09:00', bound_source_id: null, title: 'Reviewed slot', kind: 'thread', platform: 'threads', status: 'planned', needs_review: false, capture_hash: 'd'.repeat(64) }],
  publications: [{ id: stateId(5), revision_id: stateId(1), platform: 'threads', status: 'queued', remote_container_id: null, remote_media_id: null, remote_url: null, error_code: null }],
  accounts: [{ brand: 'devshark', platform: 'threads', remote_account_id: 'test-only-account', handle: 'test_only', enabled: false, verified_at: null }],
  sources: [{ id: stateId(6), brand: 'devshark', source_id: packet.sourceId, eligible: true, packet }], sourceHistory: [packet],
  jobs: [{ ...job, costUsd: null }], jobHealth: [job],
 };
}
