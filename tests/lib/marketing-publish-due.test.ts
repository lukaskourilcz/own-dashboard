import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentRevision } from '@/lib/marketing/contracts';
import { revisionHash } from '@/lib/marketing/hashes';
import type { MetaPublisherConfig } from '@/lib/marketing/publisher';
import type { createAdminClient } from '@/lib/supabase/admin';

// Offline orchestration: Supabase, the credential resolver and the publisher
// are mocks. No Meta request, no source fetch and no real claim happen here.
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), publish: vi.fn(), refresh: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/marketing/worker-runtime', () => ({ enqueueMarketingJob: vi.fn(), executeMarketingJob: vi.fn() }));
vi.mock('@/lib/marketing/store', () => ({ sourceReferences: vi.fn(async () => []), ingestSource: vi.fn() }));
vi.mock('@/lib/marketing/source-refresh', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/marketing/source-refresh')>(), refreshMarketingSources: mocks.refresh }));
vi.mock('@/lib/marketing/meta-credentials', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/marketing/meta-credentials')>(), resolveMetaPublisherConfig: mocks.resolve }));
vi.mock('@/lib/marketing/publisher', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/marketing/publisher')>(), publishMarketingRevision: mocks.publish }));
import { publishDueMarketing } from '@/lib/marketing/orchestrator';

const owner = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';
const publicationId = '33333333-3333-4333-8333-333333333333';
const revision: ContentRevision = { schemaVersion: 'marketing-content/1', brand: 'dneskai', title: 'OFFLINE QA carousel', caption: 'OFFLINE QA only', format: 'carousel',
  account: { id: '17841400000000001', platform: 'instagram', handle: 'dneskai' }, sources: [{ sourceId: 'article:offline-qa', sourceRevision: 'qa/1', contentHash: 'a'.repeat(64) }], knowledgeIds: [],
  assets: [1, 2].map(index => ({ url: `https://assets.example.invalid/slide-${index}.jpg`, sha256: 'b'.repeat(64), mimeType: 'image/jpeg' as const, width: 1080, height: 1350, alt: `QA slide ${index}` })),
  scheduledAt: '2026-10-20T07:00:00Z', timeZone: 'Europe/Prague', templateVersion: 'qa/1', promptVersion: 'qa/1', model: 'none-offline', traceId: null };
const account = { id: '44444444-4444-4444-8444-444444444444', user_id: owner, brand: 'dneskai', platform: 'instagram', remote_account_id: '17841400000000001', handle: 'dneskai', verified_at: '2026-10-20T06:00:00Z', enabled: false };
const queued = { id: publicationId, user_id: owner, revision_id: revisionId, platform: 'instagram', status: 'queued', lease_until: null, remote_container_id: null, remote_media_id: null, remote_url: null, error_code: null };
const config = (patch: Partial<MetaPublisherConfig> = {}): MetaPublisherConfig => ({ enabled: false, apiVersion: 'v99.0', apiVersionVerifiedAt: '2026-10-20T06:00:00Z', loginMode: 'instagram',
  accessToken: 'TEST-ONLY-INSTAGRAM-TOKEN-0001', tokenExpiresAt: '2026-12-01T00:00:00Z', scopes: ['instagram_business_basic', 'instagram_business_content_publish'], approvedAssetHosts: [], credentialSource: 'database', ...patch });

function database() {
  const hash = revisionHash(revision);
  const rows: Record<string, unknown> = { marketing_revisions: { id: revisionId, user_id: owner, campaign_id: null, revision, content_hash: hash, status: 'approved', ready: true, approved_hash: hash }, marketing_accounts: account };
  const rpc = vi.fn(async (name: string) => name === 'marketing_claim_due' ? { data: [{ ...queued, status: 'claimed', lease_until: '2026-10-20T07:10:00Z' }], error: null } : { data: 'ok', error: null });
  const db = { rpc, from(table: string) {
    const filters: Array<[string, unknown]> = [];
    const list = () => table === 'marketing_publications' && !filters.some(([key, value]) => key === 'status' && value === 'claimed') ? [{ ...queued }] : [];
    const query = { select: () => query, order: () => query, limit: () => query, in: () => query, lte: () => query, gte: () => query, gt: () => query,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      single: async () => ({ data: rows[table] ?? null, error: rows[table] ? null : { message: 'missing' } }),
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve({ data: list(), error: null }).then(resolve, reject) };
    return query;
  } } as unknown as ReturnType<typeof createAdminClient>;
  return { db, rpc };
}
const names = (rpc: ReturnType<typeof database>['rpc']) => rpc.mock.calls.map(([name]) => name);

beforeEach(() => {
  mocks.resolve.mockReset(); mocks.publish.mockReset(); mocks.refresh.mockReset();
  mocks.refresh.mockResolvedValue({ packets: [], held: [], observedAt: '2026-10-20T07:00:00Z', noEditionDates: [], nextCursor: null, dropped: 0 });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('publishDueMarketing and Meta credentials', () => {
  it('leaves a queued publication unclaimed when its credential is held, instead of failing it after a claim', async () => {
    vi.stubEnv('MARKETING_PUBLISH_ENABLED', 'true'); vi.stubEnv('MARKETING_DNESKAI_PUBLISH_ENABLED', 'true');
    mocks.resolve.mockResolvedValue(config({ enabled: true, accessToken: '', tokenExpiresAt: '', scopes: [], credentialHold: 'credential-store-unavailable' }));
    const { db, rpc } = database();
    expect(await publishDueMarketing(db, owner, 'dneskai', false)).toEqual({ outcomes: [{ publicationId, status: 'held', errorCode: 'credential-store-unavailable', remoteContainerId: null, remoteMediaId: null, remoteUrl: null }] });
    expect(names(rpc)).toEqual([]);
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it('still claims with a usable credential and records a post-claim hold as failed', async () => {
    vi.stubEnv('MARKETING_PUBLISH_ENABLED', 'true'); vi.stubEnv('MARKETING_DNESKAI_PUBLISH_ENABLED', 'true');
    mocks.resolve.mockResolvedValue(config({ enabled: true }));
    mocks.publish.mockResolvedValue({ status: 'held', errorCode: 'publishing-quota-exhausted', remoteContainerId: null, remoteMediaId: null, remoteUrl: null });
    const { db, rpc } = database();
    expect((await publishDueMarketing(db, owner, 'dneskai', false)).outcomes).toEqual([expect.objectContaining({ publicationId, status: 'held', errorCode: 'publishing-quota-exhausted' })]);
    expect(names(rpc)).toEqual(['marketing_claim_due', 'marketing_finish_publication']);
    expect(rpc).toHaveBeenLastCalledWith('marketing_finish_publication', expect.objectContaining({ p_status: 'failed', p_error: 'publishing-quota-exhausted' }));
  });
  it('stores a container retry as a claimed checkpoint, never as a failed or reconciliation receipt', async () => {
    vi.stubEnv('MARKETING_PUBLISH_ENABLED', 'true'); vi.stubEnv('MARKETING_DNESKAI_PUBLISH_ENABLED', 'true');
    mocks.resolve.mockResolvedValue(config({ enabled: true }));
    const retry = { status: 'pending', errorCode: 'container-retry', remoteContainerId: null, remoteMediaId: null, remoteUrl: null } as const;
    mocks.publish.mockImplementation(async (input: { checkpoint: (value: unknown) => Promise<void> }) => { await input.checkpoint({ stage: 'container-retry', ...retry }); return { ...retry, retryCause: 'meta-http-500' }; });
    const { db, rpc } = database();
    expect((await publishDueMarketing(db, owner, 'dneskai', false)).outcomes).toEqual([{ publicationId, ...retry, retryCause: 'meta-http-500' }]);
    expect(names(rpc)).toEqual(['marketing_claim_due', 'marketing_checkpoint_publication']);
    expect(rpc).toHaveBeenLastCalledWith('marketing_checkpoint_publication', { p_owner: owner, p_publication: publicationId, p_expected_container: null, p_expected_error: null, p_container: null, p_error: 'container-retry' });
  });
  it('runs a preflight dry run with both publish flags off and the account disabled, without a claim or a write', async () => {
    vi.stubEnv('MARKETING_PUBLISH_ENABLED', 'false'); vi.stubEnv('MARKETING_DNESKAI_PUBLISH_ENABLED', 'false');
    mocks.resolve.mockResolvedValue(config());
    mocks.publish.mockResolvedValue({ status: 'dry-run', errorCode: null, remoteContainerId: null, remoteMediaId: null, remoteUrl: null, advisories: ['account-disabled', 'publishing-disabled'] });
    const { db, rpc } = database();
    expect(await publishDueMarketing(db, owner, 'dneskai', true, AbortSignal.timeout(5000), publicationId, { preflight: true })).toEqual({ outcomes: [{ publicationId, status: 'dry-run', errorCode: null,
      remoteContainerId: null, remoteMediaId: null, remoteUrl: null, advisories: ['account-disabled', 'publishing-disabled'] }] });
    expect(mocks.publish).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ dryRun: true, preflight: true, account: expect.objectContaining({ enabled: false }), config: expect.objectContaining({ enabled: false }) }));
    expect(names(rpc)).toEqual([]);
  });
});
