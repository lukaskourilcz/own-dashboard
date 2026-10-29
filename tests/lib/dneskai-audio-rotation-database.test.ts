import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import { nextDneskaiAudioTrackId } from '@/lib/marketing/dneskai-audio';
import { findDneskaiReelForRevision,lastDneskaiReelAudio } from '@/lib/marketing/dneskai-reel';
vi.mock('server-only', () => ({}));
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222', revision = '33333333-3333-4333-8333-333333333333', previous = '44444444-4444-4444-8444-444444444444', foreign = '55555555-5555-4555-8555-555555555555';
const id = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
let database: Awaited<ReturnType<typeof createMigratedDatabase>>, client: SupabaseClient, historyBytes: number, requests: URL[];
beforeAll(async () => {
    database = await createMigratedDatabase({ owner, instant: '2026-10-27T12:00:00Z' });
    await database.query('insert into auth.users(id,email) values($1,$2)', [other, 'other@example.test']);
    for (const [value, actor] of [[revision, owner], [previous, owner], [foreign, other]])
        await database.query("insert into public.marketing_revisions(id,user_id,brand,revision,content_hash) values($1,$2,'dneskai','{}',$3)", [value, actor, 'a'.repeat(64)]);
    const origin = 'https://rotation-database.supabase.co', emulator = new SupabaseEmulator(database, origin, { service: 'TEST-ONLY-service', users: {} });
    client = createClient(origin, 'TEST-ONLY-service', {
        global: {
            fetch: async (url, init) => {
                requests.push(new URL(String(url)));
                const response = await emulator.fetch(url, init);
                if (new URL(String(url)).pathname === '/rest/v1/marketing_events')
                    historyBytes = new TextEncoder().encode(await response.clone().text()).byteLength;
                return response;
            }
        }, auth: { persistSession: false, autoRefreshToken: false }
    });
}, 120000);
afterAll(async () => database?.close());
beforeEach(async () => {
    historyBytes = 0;
    requests = [];
    await database.exec('delete from public.marketing_events;delete from public.marketing_audio_tracks;');
});
async function track(n: number, stamp: string, enabled = true, actor = owner) {
    await database.query("insert into public.marketing_audio_tracks(id,user_id,title,artist,source,licence_note,source_url,storage_path,duration_ms,enabled,created_at) values($1,$2,'Fixture','Fixture','original','Own recording','https://example.test/audio',$3,60000,$4,$5)", [id(n), actor, 'marketing-audio/' + actor + '/' + id(n) + '.mp3', enabled, stamp]);
}
const record = (audioId: string | null) => ({ reelKey: 'a'.repeat(64), revisionHash: 'b'.repeat(64), audioId, sha256: 'c'.repeat(64), bytes: 1000 });
async function event(n: number, actor: string, rev: string, payload: unknown, stamp: string) {
    await database.query("insert into public.marketing_events(id,user_id,revision_id,kind,payload,created_at,delivered_at) values($1,$2,$3,'dneskai-reel-rendered',$4,$5,$5)", [id(n), actor, rev, JSON.stringify(payload), stamp]);
}
it('preserves microseconds, disabled predecessors and tied UUID order without prefix scans', async () => {
    await track(3, '2026-10-27T10:00:00.000001Z', false);
    await track(1, '2026-10-27T10:00:00.000002Z');
    await track(2, '2026-10-27T10:00:00.000002Z');
    await track(4, '2026-10-27T10:00:00.000000Z', true, other);
    expect(await nextDneskaiAudioTrackId(client, owner, id(3))).toBe(id(1));
    expect(await nextDneskaiAudioTrackId(client, owner, id(1))).toBe(id(2));
    expect(await nextDneskaiAudioTrackId(client, owner, id(2))).toBe(id(1));
    expect(requests.every(url => url.searchParams.get('limit') === '1' || url.searchParams.get('id')?.startsWith('eq.'))).toBe(true);
});
it('reads a complete latest own record with exact current-revision exclusion and a small positive projection', async () => {
    await event(10, owner, previous, { ...record(id(1)), TEST_ONLY_FUTURE_PRIVATE_FIELD: 'x'.repeat(500000) }, '2026-10-27T10:00:00.000001Z');
    await event(11, owner, revision, record(id(2)), '2026-10-27T11:00:00Z');
    await event(12, other, foreign, record(id(3)), '2026-10-27T12:00:00Z');
    expect(await lastDneskaiReelAudio(client, owner, revision)).toBe(id(1));
    expect(historyBytes).toBeLessThan(1000);
    expect(requests).toHaveLength(1);
});
it('uses the higher event UUID at an exact timestamp tie and preserves a proven silent choice', async () => {
    await event(10, owner, previous, record(id(1)), '2026-10-27T10:00:00.000001Z');
    await event(11, owner, previous, record(null), '2026-10-27T10:00:00.000001Z');
    expect(await lastDneskaiReelAudio(client, owner, revision)).toBeNull();
});
it('does not reset history when the latest stored payload is invalid', async () => {
    await event(10, owner, previous, record(id(1)), '2026-10-27T10:00:00.000001Z');
    await event(11, owner, previous, {}, '2026-10-27T10:00:00.000002Z');
    await expect(lastDneskaiReelAudio(client, owner, revision)).rejects.toHaveProperty('code', 'reel-storage-failed');
});

it('finds an approved hash beyond five newer unrelated hashes without transferring future payload fields',async()=>{
 await event(10,owner,revision,{...record(id(1)),TEST_ONLY_FUTURE_PRIVATE_FIELD:'x'.repeat(500000)},'2026-10-27T10:00:00Z');for(let n=11;n<19;n++)await event(n,owner,revision,{...record(id(2)),revisionHash:'d'.repeat(64)},'2026-10-27T11:00:00Z');await event(19,other,foreign,record(id(3)),'2026-10-27T12:00:00Z');
 const storage={find:vi.fn(async()=>({reelKey:'a'.repeat(64),url:'https://test-only.supabase.co/reel.mp4',sha256:'c'.repeat(64),bytes:1000})),put:vi.fn()};expect(await findDneskaiReelForRevision(client,owner,revision,'b'.repeat(64),storage)).toMatchObject({audioId:id(1)});expect(requests).toHaveLength(1);expect(historyBytes).toBeLessThan(1000);expect(storage.find).toHaveBeenCalledOnce();expect(await findDneskaiReelForRevision(client,owner,revision,'e'.repeat(64),storage)).toBeNull();expect(storage.find).toHaveBeenCalledOnce();
});
