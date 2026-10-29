import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import { parseContentRevision } from '@/lib/marketing/contracts';
import { revisionHash } from '@/lib/marketing/hashes';
import { deckRevision } from './marketing-dneskai-revision-fixture';
const m = vi.hoisted(() => ({ find: vi.fn(), request: vi.fn(), last: vi.fn(), next: vi.fn(), refresh: vi.fn(), publish: vi.fn(), config: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/marketing/dneskai-reel', async (original) => ({
    ...await original<typeof import('@/lib/marketing/dneskai-reel')>(), findDneskaiReelForRevision: m.find, requestDneskaiReelRender: m.request, lastDneskaiReelAudio: m.last
}));
vi.mock('@/lib/marketing/dneskai-audio', () => ({ nextDneskaiAudioTrackId: m.next }));
vi.mock('@/lib/marketing/store', () => ({ sourceReferences: vi.fn(async () => []), ingestSource: vi.fn() }));
vi.mock('@/lib/marketing/source-refresh', async (original) => ({ ...await original<typeof import('@/lib/marketing/source-refresh')>(), refreshMarketingSources: m.refresh }));
vi.mock('@/lib/marketing/publisher', async (original) => ({ ...await original<typeof import('@/lib/marketing/publisher')>(), publishMarketingRevision: m.publish }));
vi.mock('@/lib/marketing/meta-credentials', async (original) => ({ ...await original<typeof import('@/lib/marketing/meta-credentials')>(), resolveMetaPublisherConfig: m.config }));
import { prepareUpcomingDneskaiReels, publishDueMarketing } from '@/lib/marketing/orchestrator';
import { createMarketingSchedulerPorts } from '@/lib/marketing/scheduler-ports';
import { dneskaiReelForRevision } from '@/lib/marketing/dneskai-reel';
const owner = '11111111-1111-4111-8111-111111111111', revisionId = '22222222-2222-4222-8222-222222222222', publication = '33333333-3333-4333-8333-333333333333', account = '44444444-4444-4444-8444-444444444444', instant = '2026-10-27T12:00:00Z';
let database: Awaited<ReturnType<typeof createMigratedDatabase>>, service: SupabaseClient, queueBodies: string[] = [];
beforeAll(async () => {
    database = await createMigratedDatabase({ owner, instant });
    const revision = parseContentRevision({ ...deckRevision(), format: 'reel', scheduledAt: instant }), hash = revisionHash(revision);
    await database.query("insert into public.marketing_revisions(id,user_id,brand,revision,content_hash,status,ready,approved_hash) values($1,$2,'dneskai',$3,$4,'approved',true,$4)", [revisionId, owner, JSON.stringify(revision), hash]);
    await database.query("insert into public.marketing_accounts(id,user_id,brand,platform,remote_account_id,handle,verified_at,enabled) values($1,$2,'dneskai','instagram',$3,'dneskai',$4,true)", [account, owner, revision.account.id, instant]);
    const origin = 'https://reel-prefetch.supabase.co', emulator = new SupabaseEmulator(database, origin, { service: 'TEST-ONLY-service', users: {} });
    service = createClient(origin, 'TEST-ONLY-service', {
        global: {
            fetch: async (input, init) => {
                const response = await emulator.fetch(input, init), url = new URL(String(input));
                if (url.pathname === '/rest/v1/marketing_publications' && url.searchParams.get('select')?.startsWith('id,user_id,revision_id'))
                    queueBodies.push(await response.clone().text());
                return response;
            }
        }, auth: { persistSession: false, autoRefreshToken: false }
    });
}, 120000);
afterAll(async () => database?.close());
beforeEach(async () => {
    vi.clearAllMocks();
    queueBodies = [];
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(instant));
    vi.stubEnv('MARKETING_DNESKAI_REELS_ENABLED', 'true');
    vi.stubEnv('MARKETING_PUBLISH_ENABLED', 'true');
    vi.stubEnv('MARKETING_DNESKAI_PUBLISH_ENABLED', 'true');
    m.find.mockResolvedValue(null);
    m.last.mockResolvedValue(null);
    m.next.mockResolvedValue(null);
    m.request.mockResolvedValue(true);
    m.refresh.mockResolvedValue({ packets: [], held: [], observedAt: instant, noEditionDates: [], nextCursor: null, dropped: 0 });
    m.config.mockResolvedValue({ enabled: true, credentialHold: null });
    await database.exec("delete from public.marketing_publications;update public.marketing_revisions set status='approved',ready=true,approved_hash=content_hash;");
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
});
const queue = (stamp: string) => database.query("insert into public.marketing_publications(id,user_id,revision_id,platform,status,scheduled_at) values($1,$2,$3,'instagram','queued',$4)", [publication, owner, revisionId, stamp]);
it('requests a due Reel only once across upcoming preparation and the same tick publisher', async () => {
    await queue('2026-10-27T11:59:00Z');
    await prepareUpcomingDneskaiReels(service, owner, 'https://own.example');
    const result = await publishDueMarketing(service, owner, 'dneskai', false, undefined, undefined, { origin: 'https://own.example' });
    expect(result.outcomes[0]).toMatchObject({ publicationId: publication, status: 'held', errorCode: 'reel-render-pending' });
    expect(m.request).toHaveBeenCalledOnce();
    expect(m.publish).not.toHaveBeenCalled();
    expect((await database.query<{
        status: string;
    }>('select status from public.marketing_publications')).rows[0].status).toBe('queued');
});
it('still prepares a strictly future Reel before its slot', async () => {
    await queue('2026-10-27T12:20:00Z');
    expect(await prepareUpcomingDneskaiReels(service, owner, 'https://own.example')).toBe('reel-render-pending');
    expect(m.request).toHaveBeenCalledOnce();
    expect(m.publish).not.toHaveBeenCalled();
});
it('leaves an exactly due slot to the publisher', async () => {
    await queue(instant);
    expect(await prepareUpcomingDneskaiReels(service, owner, 'https://own.example')).toBeNull();
    expect(m.request).not.toHaveBeenCalled();
});
it.each(["status='review',ready=false", "approved_hash=repeat('f',64)"])('does not pre-render a revision that is no longer approved: %s', async (patch) => {
    await queue('2026-10-27T12:20:00Z');
    await database.exec('update public.marketing_revisions set ' + patch);
    expect(await prepareUpcomingDneskaiReels(service, owner, 'https://own.example')).toBeNull();
    expect(m.request).not.toHaveBeenCalled();
});
it('starts no prefetch request after original retirement', async () => {
    await queue('2026-10-27T12:20:00Z');
    const caller = new AbortController();
    caller.abort('TEST_ONLY_PRIVATE_REASON');
    expect(await prepareUpcomingDneskaiReels(service, owner, 'https://own.example', 45 * 60000, caller.signal)).toBeNull();
    expect(m.find).not.toHaveBeenCalled();
    expect(m.request).not.toHaveBeenCalled();
});
it('starts no audio selection or render after retirement during stored-Reel lookup', async () => {
    await queue('2026-10-27T12:20:00Z');
    const caller = new AbortController();
    m.find.mockImplementationOnce(async () => {
        caller.abort('TEST_ONLY_PRIVATE_REASON');
        return null;
    });
    expect(await prepareUpcomingDneskaiReels(service, owner, 'https://own.example', 45 * 60000, caller.signal)).toBeNull();
    expect(m.last).not.toHaveBeenCalled();
    expect(m.next).not.toHaveBeenCalled();
    expect(m.request).not.toHaveBeenCalled();
});
it('bounds uncooperative optional queue metadata without a native request', async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const fetcher = vi.fn(() => new Promise<Response>(() => {
    })), client = createClient('https://reel-prefetch.supabase.co', 'TEST-ONLY-service', { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } }), pending = prepareUpcomingDneskaiReels(client, owner, 'https://own.example');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    deadline.abort('TEST_ONLY_PRIVATE_REASON');
    expect(await pending).toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(m.request).not.toHaveBeenCalled();
});
it('preserves a strictly future microsecond slot without flattening it into the due interval', async () => {
    await queue('2026-10-27T12:00:00.000001Z');
    expect(await prepareUpcomingDneskaiReels(service, owner, 'https://own.example')).toBe('reel-render-pending');
    expect(m.request).toHaveBeenCalledOnce();
});
it('reads bounded queue identity without transferring the complete private revision twice', async () => {
    await queue('2026-10-27T12:20:00Z');
    await prepareUpcomingDneskaiReels(service, owner, 'https://own.example');
    expect(queueBodies).toHaveLength(1);
    expect(new TextEncoder().encode(queueBodies[0]).length).toBeLessThan(1024);
    expect(queueBodies[0]).not.toContain('"caption"');
    expect(m.request).toHaveBeenCalledOnce();
});

const futureRevision='55555555-5555-4555-8555-555555555555',futurePublication='66666666-6666-4666-8666-666666666666';
async function queueFuture(){
 await database.query("insert into public.marketing_revisions(id,user_id,brand,revision,content_hash,status,ready,approved_hash) select $1,user_id,brand,revision,content_hash,status,ready,approved_hash from public.marketing_revisions where id=$2 on conflict(id) do nothing",[futureRevision,revisionId]);
 await database.query("insert into public.marketing_publications(id,user_id,revision_id,platform,status,scheduled_at) values($1,$2,$3,'instagram','queued','2026-10-27T12:20:00Z')",[futurePublication,owner,futureRevision]);
}
it('spends one scheduler publication step on the due Reel before optional future preparation',async()=>{
 await queue('2026-10-27T11:59:00Z');await queueFuture();
 const result=await createMarketingSchedulerPorts(service,owner,{}, {origin:'https://own.example'}).publishDue(false,new AbortController().signal);
 expect(result.outcomes).toEqual([{publicationId:publication,status:'held',errorCode:'reel-render-pending'}]);
 expect(m.request).toHaveBeenCalledOnce();expect(m.request).toHaveBeenCalledWith(expect.objectContaining({revisionId}));expect(m.publish).not.toHaveBeenCalled();
 expect(queueBodies).toEqual([]);
 expect((await database.query<{status:string}>('select status from public.marketing_publications order by id')).rows.map(row=>row.status)).toEqual(['queued','queued']);
});
it('prepares one future Reel after a quiet due step without claiming or sending it',async()=>{
 await queueFuture();
 expect(await createMarketingSchedulerPorts(service,owner,{}, {origin:'https://own.example'}).publishDue(false,new AbortController().signal)).toEqual({outcomes:[]});
 expect(m.request).toHaveBeenCalledOnce();expect(m.request).toHaveBeenCalledWith(expect.objectContaining({revisionId:futureRevision}));expect(m.publish).not.toHaveBeenCalled();expect(queueBodies).toHaveLength(1);
 expect((await database.query<{status:string}>('select status from public.marketing_publications')).rows[0].status).toBe('queued');
});
it('retains an unavailable due Reel and starts no optional future preparation',async()=>{
 await queue('2026-10-27T11:59:00Z');await queueFuture();m.find.mockRejectedValue(new Error('TEST_ONLY_PRIVATE_STORAGE_DETAIL'));
 expect(await createMarketingSchedulerPorts(service,owner,{}, {origin:'https://own.example'}).publishDue(false,new AbortController().signal)).toEqual({outcomes:[{publicationId:publication,status:'held',errorCode:'reel-storage-failed'}]});
 expect(m.request).not.toHaveBeenCalled();expect(m.publish).not.toHaveBeenCalled();expect(queueBodies).toEqual([]);
});

it('carries one approved hash from the database queue through signed intent and refuses later withdrawal',async()=>{
 await queue('2026-10-27T12:20:00Z');expect(await prepareUpcomingDneskaiReels(service,owner,'https://own.example')).toBe('reel-render-pending');
 const captured=m.request.mock.calls[0][0],current=(await database.query<{content_hash:string}>('select content_hash from public.marketing_revisions where id=$1',[revisionId])).rows[0];expect(captured.revisionHash).toBe(current.content_hash);
 await database.query("update public.marketing_revisions set status='review',ready=false,approved_hash=null where id=$1",[revisionId]);
 const loadAudio=vi.fn(),loadSlide=vi.fn(),render=vi.fn(),storage={find:vi.fn(),put:vi.fn()};
 await expect(dneskaiReelForRevision(service,owner,revisionId,{approvedRevisionHash:captured.revisionHash,loadAudio,loadSlide,render,storage})).rejects.toHaveProperty('code','reel-revision-unavailable');expect(loadAudio).not.toHaveBeenCalled();expect(storage.find).not.toHaveBeenCalled();expect(render).not.toHaveBeenCalled();
});
