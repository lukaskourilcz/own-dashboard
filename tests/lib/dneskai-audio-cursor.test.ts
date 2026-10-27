import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import { listDneskaiAudioPage } from '@/lib/marketing/dneskai-audio';
vi.mock('server-only', () => ({}));
const owner = '11111111-1111-4111-8111-111111111111';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let database: Awaited<ReturnType<typeof createMigratedDatabase>>;
let client: ReturnType<typeof createClient>;
beforeAll(async () => {
    database = await createMigratedDatabase({ owner, instant: '2026-10-23T12:00:00Z' });
    const origin = 'https://audio-pagination.supabase.co';
    const emulator = new SupabaseEmulator(database, origin, { service: 'TEST-ONLY-service-role', users: {} });
    client = createClient(origin, 'TEST-ONLY-service-role', { global: { fetch: emulator.fetch.bind(emulator) }, auth: { persistSession: false, autoRefreshToken: false } });
}, 120000);
beforeEach(async () => {
    await database.query('delete from public.marketing_audio_tracks where user_id=$1::uuid', [owner]);
    await database.query(`insert into public.marketing_audio_tracks(id,user_id,title,artist,source,licence_note,source_url,storage_path,duration_ms,enabled,created_at)
    select ('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,$1::uuid,'Track '||n,'Artist','original','Own recording','https://example.test/audio',
      'marketing-audio/'||$1::text||'/'||('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))||'.mp3',60000,n>200,'2026-10-23T08:00:00Z'::timestamptz from generate_series(1,401) n`, [owner]);
});
afterAll(async () => database?.close());
it.each([1, 200])('keeps the next track when the earlier/cursor row %s disappears', async (removed) => {
    const first = await listDneskaiAudioPage(client, owner);
    expect(first.nextCursor).toEqual({ id: id(200), createdAt: first.tracks[199]!.createdAt });
    await database.query('delete from public.marketing_audio_tracks where id=$1::uuid', [id(removed)]);
    const next = await listDneskaiAudioPage(client, owner, first.nextOffset!, undefined, first.nextCursor);
    expect(next.tracks[0]?.id).toBe(id(201));
    expect(next.tracks).toHaveLength(200);
    const last = await listDneskaiAudioPage(client, owner, next.nextOffset!, undefined, next.nextCursor);
    expect(last.tracks.map(row => row.id)).toEqual([id(401)]);
    expect(last.nextOffset).toBeNull();
    expect(last.nextCursor).toBeUndefined();
});
async function add(number: number, created = '2026-10-23T08:00:00Z') {
    await database.query(`insert into public.marketing_audio_tracks(id,user_id,title,artist,source,licence_note,source_url,storage_path,duration_ms,enabled,created_at) values($1::uuid,$2::uuid,'Inserted track','Fixture artist','original','Own recording','https://example.test/audio',$3,60000,true,$4::timestamptz)`, [id(number), owner, 'marketing-audio/' + owner + '/' + id(number) + '.mp3', created]);
}
it('does not repeat the boundary when a historical row is inserted before it; refresh includes the new row', async () => {
    const first = await listDneskaiAudioPage(client, owner);
    await add(0);
    const next = await listDneskaiAudioPage(client, owner, first.nextOffset!, undefined, first.nextCursor);
    expect(next.tracks[0]?.id).toBe(id(201));
    expect(new Set([...first.tracks, ...next.tracks].map(row => row.id)).size).toBe(400);
    expect((await listDneskaiAudioPage(client, owner)).tracks[0]?.id).toBe(id(0));
});
it('reaches a new row after the cursor without changing an earlier page', async () => {
    const first = await listDneskaiAudioPage(client, owner);
    await add(500, '2026-10-23T08:00:01Z');
    const next = await listDneskaiAudioPage(client, owner, first.nextOffset!, undefined, first.nextCursor), last = await listDneskaiAudioPage(client, owner, next.nextOffset!, undefined, next.nextCursor);
    expect(last.tracks.map(row => row.id)).toEqual([id(401), id(500)]);
    expect(new Set([...first.tracks, ...next.tracks, ...last.tracks].map(row => row.id)).size).toBe(402);
});
it('preserves six-digit time order when ids reverse inside one JavaScript millisecond', async () => {
    await database.query('delete from public.marketing_audio_tracks where user_id=$1::uuid', [owner]);
    await add(2, '2026-10-23T08:00:00.000001Z');
    await add(1, '2026-10-23T08:00:00.000002Z');
    await add(3, '2026-10-23T08:00:00.000003Z');
    const next = await listDneskaiAudioPage(client, owner, 1, undefined, { id: id(2), createdAt: '2026-10-23T08:00:00.000001Z' });
    expect(next.tracks.map(row => row.id)).toEqual([id(1), id(3)]);
    expect(next.tracks.map(row => row.createdAt)).toEqual(['2026-10-23T08:00:00.000002+00:00', '2026-10-23T08:00:00.000003+00:00']);
});
it('retains the owner filter when a cursor from another library is supplied', async () => {
    const first = await listDneskaiAudioPage(client, owner);
    expect((await listDneskaiAudioPage(client, '22222222-2222-4222-8222-222222222222', first.nextOffset!, undefined, first.nextCursor)).tracks).toEqual([]);
});
