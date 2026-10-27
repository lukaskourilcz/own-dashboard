import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import { listDneskaiAudioPage, listDneskaiAudioTracks, nextDneskaiAudioTrackId } from '@/lib/marketing/dneskai-audio';
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
  await database.query(`insert into public.marketing_audio_tracks(id,user_id,title,artist,source,licence_note,source_url,storage_path,duration_ms,enabled,created_at)
    select ('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,$1::uuid,'Track '||n,'Artist','original','Own recording','https://example.test/audio',
      'marketing-audio/'||$1::text||'/'||('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))||'.mp3',60000,n>200,'2026-10-23T08:00:00Z'::timestamptz from generate_series(1,401) n`, [owner]);
}, 120_000);
afterAll(async () => database?.close());

describe('Audio pages and rotation beyond 200 tracks', () => {
  it('pages in stable id order and returns a chosen disabled track directly', async () => {
    const first = await listDneskaiAudioPage(client, owner);
    const second = await listDneskaiAudioPage(client, owner, first.nextOffset!, undefined, first.nextCursor);
    const third = await listDneskaiAudioPage(client, owner, second.nextOffset!, undefined, second.nextCursor);
    expect([first.tracks.length, second.tracks.length, third.tracks.length]).toEqual([200, 200, 1]);
    expect(new Set([...first.tracks, ...second.tracks, ...third.tracks].map(track => track.id)).size).toBe(401);
    expect(third.nextOffset).toBeNull();
    expect((await listDneskaiAudioTracks(client, owner, id(1)))[0]).toMatchObject({ id: id(1), enabled: false });
    expect((await listDneskaiAudioTracks(client, owner, id(401)))[0]?.id).toBe(id(401));
  });
  it('skips 200 older disabled tracks and rotates past 200 eligible tracks with tied timestamps', async () => {
    expect(await nextDneskaiAudioTrackId(client, owner, null)).toBe(id(201));
    expect(await nextDneskaiAudioTrackId(client, owner, id(400))).toBe(id(401));
    expect(await nextDneskaiAudioTrackId(client, owner, id(401))).toBe(id(201));
    expect(await nextDneskaiAudioTrackId(client, '22222222-2222-4222-8222-222222222222', id(400))).toBeNull();
  });
});
