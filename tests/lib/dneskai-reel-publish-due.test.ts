import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseContentRevision } from '@/lib/marketing/contracts';
import { revisionHash } from '@/lib/marketing/hashes';
import type { MetaPublisherConfig } from '@/lib/marketing/publisher';
import type { createAdminClient } from '@/lib/supabase/admin';
import { deckRevision } from './marketing-dneskai-revision-fixture';

// #165 orchestration: a deck Reel is never claimed before its MP4 is stored. Supabase, the render request and the
// publisher are mocks; no Meta request and no render happen here.
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), publish: vi.fn(), refresh: vi.fn(), find: vi.fn(), request: vi.fn(), last: vi.fn(), next: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/marketing/worker-runtime', () => ({ enqueueMarketingJob: vi.fn(), executeMarketingJob: vi.fn(), MARKETING_ASSET_BUCKET: 'marketing-assets', MARKETING_ASSET_URL_SECONDS: 604800, dneskaiSlideObjectKey: vi.fn() }));
vi.mock('@/lib/marketing/store', () => ({ sourceReferences: vi.fn(async () => []), ingestSource: vi.fn() }));
vi.mock('@/lib/marketing/source-refresh', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/marketing/source-refresh')>(), refreshMarketingSources: mocks.refresh }));
vi.mock('@/lib/marketing/meta-credentials', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/marketing/meta-credentials')>(), resolveMetaPublisherConfig: mocks.resolve }));
vi.mock('@/lib/marketing/publisher', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/marketing/publisher')>(), publishMarketingRevision: mocks.publish }));
vi.mock('@/lib/marketing/dneskai-reel', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/marketing/dneskai-reel')>(),
  findDneskaiReelForRevision: mocks.find, requestDneskaiReelRender: mocks.request, lastDneskaiReelAudio: mocks.last }));
vi.mock('@/lib/marketing/dneskai-audio', () => ({ nextDneskaiAudioTrackId: mocks.next }));
import { publishDueMarketing } from '@/lib/marketing/orchestrator';

const owner = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';
const publicationId = '33333333-3333-4333-8333-333333333333';
const track = '55555555-5555-4555-8555-555555555555';
const revision = parseContentRevision({ ...deckRevision(), format: 'reel', scheduledAt: '2026-10-23T15:00:00Z' });
const account = { id: '44444444-4444-4444-8444-444444444444', user_id: owner, brand: 'dneskai', platform: 'instagram', remote_account_id: revision.account.id, handle: 'dneskai', verified_at: '2026-10-20T06:00:00Z', enabled: true };
const queued = { id: publicationId, user_id: owner, revision_id: revisionId, platform: 'instagram', status: 'queued', lease_until: null, remote_container_id: null, remote_media_id: null, remote_url: null, error_code: null };
const config = (): MetaPublisherConfig => ({ enabled: true, apiVersion: 'v99.0', apiVersionVerifiedAt: '2026-10-20T06:00:00Z', loginMode: 'instagram',
  accessToken: 'TEST-ONLY-INSTAGRAM-TOKEN-0001', tokenExpiresAt: '2026-12-01T00:00:00Z', scopes: ['instagram_business_basic', 'instagram_business_content_publish'], approvedAssetHosts: [], credentialSource: 'database' });

function database() {
  const hash = revisionHash(revision);
  const rows: Record<string, unknown> = { marketing_revisions: { id: revisionId, user_id: owner, campaign_id: null, revision, content_hash: hash, status: 'approved', ready: true, approved_hash: hash }, marketing_accounts: account };
  const rpc = vi.fn(async (name: string) => name === 'marketing_claim_due' ? { data: [{ ...queued, status: 'claimed', lease_until: '2026-10-23T15:10:00Z' }], error: null } : { data: 'ok', error: null });
  const db = { rpc, from(table: string) {
    const filters: Array<[string, unknown]> = [];
    const list = () => table === 'marketing_publications' && !filters.some(([key, value]) => key === 'status' && value === 'claimed') ? [{ ...queued }] : [];
    const query = { select: () => query, order: () => query, limit: () => query, in: () => query, lte: () => query, gte: () => query, gt: () => query,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      single: async () => ({ data: rows[table] ?? null, error: rows[table] ? null : { message: 'missing' } }),
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve({ data: list(), error: null }).then(resolve, reject) };
    return query;
  } } as unknown as ReturnType<typeof createAdminClient>;
  return { db, rpc, hash };
}
const names = (rpc: ReturnType<typeof database>['rpc']) => rpc.mock.calls.map(([name]) => name);
const held = (code: string) => ({ outcomes: [{ publicationId, status: 'held', errorCode: code, remoteContainerId: null, remoteMediaId: null, remoteUrl: null }] });

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.refresh.mockResolvedValue({ packets: [], held: [], observedAt: '2026-10-23T15:00:00Z', noEditionDates: [], nextCursor: null, dropped: 0 });
  mocks.resolve.mockResolvedValue(config());
  vi.stubEnv('MARKETING_PUBLISH_ENABLED', 'true'); vi.stubEnv('MARKETING_DNESKAI_PUBLISH_ENABLED', 'true');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('publishDueMarketing with a deck Reel (#165)', () => {
  it('holds a Reel unclaimed while Reels are switched off', async () => {
    const { db, rpc } = database();
    expect(await publishDueMarketing(db, owner, 'dneskai', false, undefined, undefined, { origin: 'https://own.example' })).toEqual(held('reels-disabled'));
    expect(names(rpc)).toEqual([]);
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('asks for the render with the rotation track and keeps the publication queued', async () => {
    vi.stubEnv('MARKETING_DNESKAI_REELS_ENABLED', 'true');
    mocks.find.mockResolvedValue(null); mocks.last.mockResolvedValue('66666666-6666-4666-8666-666666666666'); mocks.next.mockResolvedValue(track); mocks.request.mockResolvedValue(true);
    const { db, rpc } = database();
    expect(await publishDueMarketing(db, owner, 'dneskai', false, undefined, undefined, { origin: 'https://own.example' })).toEqual(held('reel-render-pending'));
    expect(mocks.next).toHaveBeenCalledWith(db, owner, '66666666-6666-4666-8666-666666666666',expect.any(AbortSignal));
    expect(mocks.last.mock.calls[0][3]).toBe(mocks.next.mock.calls[0][3]);
    expect(mocks.request).toHaveBeenCalledWith({ origin: 'https://own.example', revisionId, revisionHash:revisionHash(revision), audioTrackId: track,signal:expect.any(AbortSignal) });
    expect(names(rpc)).toEqual([]);
  });

  it('keeps the owner\'s own track instead of the rotation', async () => {
    vi.stubEnv('MARKETING_DNESKAI_REELS_ENABLED', 'true');
    const chosen = parseContentRevision({ ...revision, audio: { trackId: track } });
    mocks.find.mockResolvedValue(null); mocks.request.mockResolvedValue(true);
    const { db } = database();
    const hash = revisionHash(chosen);
    const original = db.from.bind(db);
    (db as unknown as { from: typeof db.from }).from = ((table: string) => {
      const query = original(table) as unknown as { single: () => Promise<unknown> };
      if (table === 'marketing_revisions') query.single = async () => ({ data: { id: revisionId, user_id: owner, campaign_id: null, revision: chosen, content_hash: hash, status: 'approved', ready: true, approved_hash: hash }, error: null });
      return query;
    }) as unknown as typeof db.from;
    await publishDueMarketing(db, owner, 'dneskai', false, undefined, undefined, { origin: 'https://own.example' });
    expect(mocks.next).not.toHaveBeenCalled();
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ audioTrackId: null }));
  });

  it('claims and hands the stored Reel to the publisher once it exists', async () => {
    vi.stubEnv('MARKETING_DNESKAI_REELS_ENABLED', 'true');
    const reel = { reelKey: '7'.repeat(64), url: 'https://test-only.supabase.co/reel.mp4', sha256: '8'.repeat(64), bytes: 1000, audioId: track };
    mocks.find.mockResolvedValue(reel);
    mocks.publish.mockResolvedValue({ status: 'published', remoteContainerId: '300', remoteMediaId: '90001', remoteUrl: 'https://www.instagram.com/reel/x/', errorCode: null });
    const { db, rpc } = database();
    const result = await publishDueMarketing(db, owner, 'dneskai', false, undefined, undefined, { origin: 'https://own.example' });
    expect(result.outcomes[0]).toMatchObject({ status: 'published' });
    expect(names(rpc)).toContain('marketing_claim_due');
    expect(mocks.publish.mock.calls[0]![0].reel).toEqual(reel);
    expect(mocks.request).not.toHaveBeenCalled();
  });
});

it.each(['last','next'] as const)('holds the unclaimed Reel instead of requesting silence after %s audio read failure',async phase=>{
 vi.stubEnv('MARKETING_DNESKAI_REELS_ENABLED','true');mocks.find.mockResolvedValue(null);mocks.last.mockResolvedValue(track);mocks.next.mockResolvedValue(track);mocks[phase].mockRejectedValue(new Error('TEST_ONLY_PRIVATE_READ_DETAIL'));mocks.request.mockResolvedValue(true);
 const {db,rpc}=database();expect(await publishDueMarketing(db,owner,'dneskai',false,undefined,undefined,{origin:'https://own.example'})).toEqual(held('reel-audio-unavailable'));expect(mocks.request).not.toHaveBeenCalled();expect(mocks.publish).not.toHaveBeenCalled();expect(names(rpc)).toEqual([]);
});

it('keeps a positively empty rotation eligible for a silent render without claiming publication',async()=>{
 vi.stubEnv('MARKETING_DNESKAI_REELS_ENABLED','true');mocks.find.mockResolvedValue(null);mocks.last.mockResolvedValue(null);mocks.next.mockResolvedValue(null);mocks.request.mockResolvedValue(true);const {db,rpc}=database();expect(await publishDueMarketing(db,owner,'dneskai',false,undefined,undefined,{origin:'https://own.example'})).toEqual(held('reel-render-pending'));expect(mocks.request).toHaveBeenCalledWith({origin:'https://own.example',revisionId,revisionHash:revisionHash(revision),audioTrackId:null,signal:expect.any(AbortSignal)});expect(mocks.publish).not.toHaveBeenCalled();expect(names(rpc)).toEqual([]);
});

it.each(['last','next'] as const)('starts no later render phase after cancellation during %s audio selection',async phase=>{
 vi.stubEnv('MARKETING_DNESKAI_REELS_ENABLED','true');const controller=new AbortController();mocks.find.mockResolvedValue(null);mocks.last.mockResolvedValue(track);mocks.next.mockResolvedValue(track);mocks[phase].mockImplementation(async()=>{controller.abort('TEST_ONLY_PRIVATE_REASON');return track;});mocks.request.mockResolvedValue(true);const {db,rpc}=database();expect(await publishDueMarketing(db,owner,'dneskai',false,controller.signal,undefined,{origin:'https://own.example'})).toEqual(held('reel-audio-unavailable'));expect(mocks.request).not.toHaveBeenCalled();if(phase==='last')expect(mocks.next).not.toHaveBeenCalled();expect(names(rpc)).toEqual([]);
});

it('does not request an explicitly chosen-track render after the original publisher scope retires',async()=>{
 vi.stubEnv('MARKETING_DNESKAI_REELS_ENABLED','true');const controller=new AbortController(),chosen=parseContentRevision({...revision,audio:{trackId:track}});mocks.find.mockImplementation(async()=>{controller.abort('TEST_ONLY_PRIVATE_REASON');return null;});mocks.request.mockResolvedValue(true);const {db,rpc}=database(),hash=revisionHash(chosen),original=db.from.bind(db);db.from=((table:string)=>{const query=original(table) as unknown as {single:()=>Promise<unknown>};if(table==='marketing_revisions')query.single=async()=>({data:{id:revisionId,user_id:owner,campaign_id:null,revision:chosen,content_hash:hash,status:'approved',ready:true,approved_hash:hash},error:null});return query;}) as unknown as typeof db.from;
 expect(await publishDueMarketing(db,owner,'dneskai',false,controller.signal,undefined,{origin:'https://own.example'})).toEqual(held('reel-render-unavailable'));expect(mocks.last).not.toHaveBeenCalled();expect(mocks.next).not.toHaveBeenCalled();expect(mocks.request).not.toHaveBeenCalled();expect(names(rpc)).toEqual([]);
});

it('holds an unavailable stored-Reel lookup without rotating, rendering or claiming',async()=>{
 vi.stubEnv('MARKETING_DNESKAI_REELS_ENABLED','true');mocks.find.mockRejectedValue(new Error('TEST_ONLY_PRIVATE_LOOKUP'));mocks.last.mockResolvedValue(null);mocks.next.mockResolvedValue(track);mocks.request.mockResolvedValue(true);
 const {db,rpc}=database();expect(await publishDueMarketing(db,owner,'dneskai',false,undefined,undefined,{origin:'https://own.example'})).toEqual(held('reel-storage-failed'));expect(mocks.last).not.toHaveBeenCalled();expect(mocks.next).not.toHaveBeenCalled();expect(mocks.request).not.toHaveBeenCalled();expect(mocks.publish).not.toHaveBeenCalled();expect(names(rpc)).toEqual([]);
});

it('does not send or overwrite a claimed receipt after its second Reel lookup becomes unavailable',async()=>{
 vi.stubEnv('MARKETING_DNESKAI_REELS_ENABLED','true');mocks.find.mockResolvedValueOnce({reelKey:'7'.repeat(64),url:'https://test-only.supabase.co/reel.mp4',sha256:'8'.repeat(64),bytes:1000,audioId:track}).mockRejectedValueOnce(new Error('TEST_ONLY_PRIVATE_DETAIL'));const {db,rpc}=database();expect(await publishDueMarketing(db,owner,'dneskai',false,undefined,undefined,{origin:'https://own.example'})).toEqual(held('reel-storage-failed'));expect(mocks.publish).not.toHaveBeenCalled();expect(names(rpc)).toEqual(['marketing_claim_due']);
});
