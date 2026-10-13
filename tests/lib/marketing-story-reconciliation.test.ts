import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileStoredMarketingPublication } from '@/lib/marketing/orchestrator';
import { parsePublicationReceipt, type ContentRevision } from '@/lib/marketing/contracts';
import { revisionHash } from '@/lib/marketing/hashes';
import type { createAdminClient } from '@/lib/supabase/admin';

const mocks = vi.hoisted(() => ({ reconcile: vi.fn(), sources: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/marketing/worker-runtime', () => ({ enqueueMarketingJob: vi.fn(), executeMarketingJob: vi.fn() }));
vi.mock('@/lib/marketing/store', () => ({ sourceReferences: mocks.sources, ingestSource: vi.fn() }));
vi.mock('@/lib/marketing/publisher', () => ({ reconcileMarketingPublication: mocks.reconcile, publishMarketingRevision: vi.fn() }));
const owner = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';
const publicationId = '33333333-3333-4333-8333-333333333333';
function fixture(format: ContentRevision['format'] = 'story') {
  // Offline orchestration fixture, never a live Meta or source approval.
  const revision: ContentRevision = { schemaVersion: 'marketing-content/1', brand: 'devshark', title: 'QA only', caption: 'Internal review note', format,
    account: { id: '101', platform: 'instagram', handle: 'offline_qa' }, sources: [{ sourceId: 'question:qa', sourceRevision: 'qa/1', contentHash: 'a'.repeat(64) }], knowledgeIds: [],
    assets: [{ url: 'https://assets.example.invalid/qa.jpg', sha256: 'b'.repeat(64), mimeType: 'image/jpeg', width: 1080, height: 1920, alt: 'QA only' }],
    scheduledAt: '2026-10-13T12:00:00Z', timeZone: 'Europe/Prague', templateVersion: 'qa/1', promptVersion: 'qa/1', model: 'none-offline', traceId: null };
  const hash = revisionHash(revision);
  const publication = { id: publicationId, user_id: owner, revision_id: revisionId, platform: 'instagram', status: 'reconciliation', remote_container_id: '201', remote_media_id: '301', remote_url: null, error_code: 'checkpoint-fence-lost' };
  const rows: Record<string, Record<string, unknown>> = { marketing_publications: publication,
    marketing_revisions: { id: revisionId, user_id: owner, revision, content_hash: hash },
    marketing_accounts: { user_id: owner, brand: 'devshark', platform: 'instagram', remote_account_id: '101' } };
  const reads: Array<{ table: string; filters: [string, unknown][] }> = [];
  const rpc = vi.fn().mockResolvedValue({ data: 'published', error: null });
  const db = { rpc, from(table: string) {
    const filters: [string, unknown][] = []; reads.push({ table, filters });
    const query = { select: () => query, in: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      single: async () => ({ data: rows[table] && filters.every(([key, value]) => rows[table][key] === value) ? rows[table] : null, error: null }) };
    return query;
  } } as unknown as ReturnType<typeof createAdminClient>;
  return { db, rpc, reads, revision, hash, publication };
}
beforeEach(() => { mocks.reconcile.mockReset(); mocks.sources.mockReset(); mocks.sources.mockResolvedValue([]); vi.stubEnv('MARKETING_DEVSHARK_INSTAGRAM_LOGIN_MODE', 'instagram'); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('internal Story acknowledgement persistence does not widen the external receipt contract', () => {
  it('persists the exact owner-scoped Story acknowledgement with its current container/error CAS fence', async () => {
    const state = fixture(); const outcome = { status: 'published', remoteContainerId: '201', remoteMediaId: '301', remoteUrl: null, errorCode: null };
    mocks.reconcile.mockResolvedValue(outcome);
    expect(await reconcileStoredMarketingPublication(state.db, owner, publicationId)).toEqual(outcome);
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith('marketing_finish_publication', { p_owner: owner, p_publication: publicationId, p_expected_container: '201', p_expected_error: 'checkpoint-fence-lost', p_status: 'published', p_container: '201', p_media: '301', p_url: null, p_error: null });
    expect(state.reads.every(read => read.filters.some(([key, value]) => key === 'user_id' && value === owner))).toBe(true);
    expect(mocks.reconcile.mock.calls[0][0].revisionRow.content_hash).toBe(state.hash);
  });
  it.each([['post', '301'], ['story', 'not-numeric'], ['story', '0']] as const)('does not store URL-less %s outcome with media ID %s', async (format, media) => {
    const state = fixture(format); mocks.reconcile.mockResolvedValue({ status: 'published', remoteContainerId: '201', remoteMediaId: media, remoteUrl: null, errorCode: null });
    await reconcileStoredMarketingPublication(state.db, owner, publicationId); expect(state.rpc).not.toHaveBeenCalled();
  });
  it('holds lost receipt fences without retrying publication or inventing a permalink', async () => {
    const state = fixture(); state.rpc.mockResolvedValue({ data: null, error: { message: 'publication fence lost' } });
    mocks.reconcile.mockResolvedValue({ status: 'published', remoteContainerId: '201', remoteMediaId: '301', remoteUrl: null, errorCode: null });
    await expect(reconcileStoredMarketingPublication(state.db, owner, publicationId)).rejects.toThrow('receipt-reconciliation-required');
    expect(state.rpc).toHaveBeenCalledTimes(1); expect(mocks.reconcile).toHaveBeenCalledTimes(1);
  });
  it('rejects a URL-less published external receipt and an invented format discriminator', () => {
    const state = fixture(); const receipt = { schemaVersion: 'marketing-publication/1', publicationId, revisionId, revisionHash: state.hash, platform: 'instagram', observedAt: '2026-10-13T12:00:00Z', status: 'published', remoteContainerId: '201', remoteMediaId: '301', remoteUrl: null, errorCode: null };
    const expected = { publicationId, revisionId, revisionHash: state.hash, platform: 'instagram' as const };
    expect(() => parsePublicationReceipt(receipt, expected)).toThrow();
    expect(() => parsePublicationReceipt({ ...receipt, format: 'story' }, expected)).toThrow();
    expect(() => parsePublicationReceipt({ ...receipt, remoteUrl: 'https://www.instagram.com/p/qa/', revisionHash: 'c'.repeat(64) }, expected)).toThrow('receipt-publication-mismatch');
  });
});
