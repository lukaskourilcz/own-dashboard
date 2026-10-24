import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import { createDneskaiAudioTrack } from '@/lib/marketing/dneskai-audio';
import { DneskaiAudioCreateSchema } from '@/lib/marketing/dneskai-audio-contracts';
vi.mock('server-only', () => ({}));
const owner = '11111111-1111-4111-8111-111111111111', uploadId = '33333333-3333-4333-8333-333333333333';
const name = `${owner}/${uploadId}.mp3`;
const intent = () => DneskaiAudioCreateSchema.parse({ action: 'create', uploadId, contentType: 'audio/mpeg', title: 'Fixture track', artist: 'Fixture artist', source: 'original', licenceNote: 'Own fixture recording', sourceUrl: 'https://example.test/recording', mood: ['calm', 'calm'] });
let loseInsertAck = false, insertRequests = 0, downloadRequests = 0;
let database: Awaited<ReturnType<typeof createMigratedDatabase>>, client: ReturnType<typeof createClient>;
beforeAll(async () => {
  database = await createMigratedDatabase({ owner, instant: '2026-10-24T19:00:00Z' });
  const origin = 'https://audio-confirmation.supabase.co', emulator = new SupabaseEmulator(database, origin, { service: 'TEST-ONLY-service-role', users: {} });
  client = createClient(origin, 'TEST-ONLY-service-role', { global: { fetch: async (url, init) => {
    if (/^\/storage\/v1\/object\/(?:authenticated\/)?marketing-audio\//.test(new URL(String(url)).pathname) && (init?.method ?? 'GET') === 'GET') downloadRequests++;
    const response = await emulator.fetch(url, init);
    if (new URL(String(url)).pathname === '/rest/v1/marketing_audio_tracks' && init?.method === 'POST') { insertRequests++; if (loseInsertAck) return Response.json({ message: 'Synthetic lost acknowledgement' }, { status: 503 }); }
    return response;
  } }, auth: { persistSession: false, autoRefreshToken: false } });
}, 120_000);
afterAll(async () => database?.close());
beforeEach(async () => {
  loseInsertAck = false; insertRequests = 0; downloadRequests = 0;
  await database.exec('drop trigger if exists audio_create_test on public.marketing_audio_tracks; delete from public.marketing_audio_tracks; delete from storage.objects;');
  const result = await client.storage.from('marketing-audio').upload(name, new Uint8Array([1, 2, 3]), { contentType: 'audio/mpeg', upsert: false }); expect(result.error).toBeNull();
});
async function objectExists() { return (await database.query('select 1 from storage.objects where bucket_id=$1 and name=$2', ['marketing-audio', name])).rows.length === 1; }

describe('audio creation preserves its uploaded object and confirms captured metadata', () => {
  it('returns the same stored track on retry without downloading or probing again, preserving a later disable', async () => {
    const probe = vi.fn(async () => 60_000); const first = await createDneskaiAudioTrack(client, owner, intent(), { probe });
    await database.query('update public.marketing_audio_tracks set enabled=false where id=$1', [uploadId]);
    const second = await createDneskaiAudioTrack(client, owner, intent(), { probe });
    expect(second).toMatchObject({ id: first.id, enabled: false, title: 'Fixture track' }); expect(probe).toHaveBeenCalledTimes(1); expect(downloadRequests).toBe(1); expect(await objectExists()).toBe(true);
  });
  it('never deletes a previously stored object when a reused upload identity has different metadata', async () => {
    await createDneskaiAudioTrack(client, owner, intent(), { probe: async () => 60_000 });
    await expect(createDneskaiAudioTrack(client, owner, { ...intent(), title: 'Different request' }, { probe: async () => 60_000 })).rejects.toMatchObject({ code: 'audio-track-write-failed' });
    expect(await objectExists()).toBe(true); expect((await database.query<{title:string}>('select title from public.marketing_audio_tracks where id=$1', [uploadId])).rows[0]!.title).toBe('Fixture track');
  });
  it('confirms simultaneous identical creates without deleting the winning object', async () => {
    let started = 0, release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
    const probe = async () => { if (++started === 2) release(); await barrier; return 60_000; };
    const tracks = await Promise.all([createDneskaiAudioTrack(client, owner, intent(), { probe }), createDneskaiAudioTrack(client, owner, intent(), { probe })]);
    expect(tracks.map(track => track.id)).toEqual([uploadId, uploadId]); expect(await objectExists()).toBe(true);
    expect((await database.query<{n:number}>('select count(*)::int n from public.marketing_audio_tracks')).rows[0]!.n).toBe(1);
  });
  it('does not delete an upload when the database suppresses the write', async () => {
    await database.exec('create or replace function public.audio_create_test_fn() returns trigger language plpgsql as $$begin return null;end$$; create trigger audio_create_test before insert on public.marketing_audio_tracks for each row execute function public.audio_create_test_fn();');
    const outcome = await createDneskaiAudioTrack(client, owner, intent(), { probe: async () => 60_000 }).then(() => 'unexpected-success', error => error.code);
    expect(outcome).toBe('audio-track-write-failed'); expect(await objectExists()).toBe(true);
  });
  it('rejects altered persisted metadata instead of reporting the submitted fields as saved', async () => {
    await database.exec("create or replace function public.audio_create_test_fn() returns trigger language plpgsql as $$begin new.title:='Altered title'; return new;end$$; create trigger audio_create_test before insert on public.marketing_audio_tracks for each row execute function public.audio_create_test_fn();");
    const outcome = await createDneskaiAudioTrack(client, owner, intent(), { probe: async () => 60_000 }).then(() => 'unexpected-success', error => error.code);
    expect(outcome).toBe('audio-track-write-failed'); expect(await objectExists()).toBe(true);
  });
  it('reconciles a committed insert whose acknowledgement was lost without another insert or file deletion', async () => {
    loseInsertAck = true; const probe = vi.fn(async () => 60_000);
    const track = await createDneskaiAudioTrack(client, owner, intent(), { probe });
    expect(track.id).toBe(uploadId); expect(insertRequests).toBe(1); expect(probe).toHaveBeenCalledTimes(1); expect(downloadRequests).toBe(1); expect(await objectExists()).toBe(true);
  });
  it('captures mutable input before the first await', async () => {
    const value = intent(); let release!: () => void, ready!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; }), barrier = new Promise<void>(resolve => { release = resolve; });
    const pending = createDneskaiAudioTrack(client, owner, value, { probe: async () => { ready(); await barrier; return 60_000; } });
    await started; value.title = 'Changed during probe'; value.mood.push('bright'); release();
    const track = await pending; expect(track.title).toBe('Fixture track'); expect(track.mood).toEqual(['calm']); expect(await objectExists()).toBe(true);
  });
  it('refuses a changed file identity before another download or probe', async () => {
    await createDneskaiAudioTrack(client, owner, intent(), { probe: async () => 60_000 });
    await database.query("update public.marketing_audio_tracks set storage_path=replace(storage_path,'.mp3','.wav') where id=$1", [uploadId]);
    const probe = vi.fn(async () => 60_000);
    const outcome = await createDneskaiAudioTrack(client, owner, intent(), { probe }).then(() => 'unexpected-success', error => error.code);
    expect(outcome).toBe('audio-track-write-failed'); expect(probe).not.toHaveBeenCalled(); expect(await objectExists()).toBe(true);
  });
  it('does not acknowledge a stored duration that differs from the measured new upload', async () => {
    await database.exec('create or replace function public.audio_create_test_fn() returns trigger language plpgsql as $$begin new.duration_ms:=30000; return new;end$$; create trigger audio_create_test before insert on public.marketing_audio_tracks for each row execute function public.audio_create_test_fn();');
    const outcome = await createDneskaiAudioTrack(client, owner, intent(), { probe: async () => 60_000 }).then(() => 'unexpected-success', error => error.code);
    expect(outcome).toBe('audio-track-write-failed'); expect(await objectExists()).toBe(true);
  });
  it('cannot reuse a foreign owner upload or remove its object', async () => {
    await createDneskaiAudioTrack(client, owner, intent(), { probe: async () => 60_000 });
    const outcome = await createDneskaiAudioTrack(client, '22222222-2222-4222-8222-222222222222', intent(), { probe: async () => 60_000 }).then(() => 'unexpected-success', error => error.code);
    expect(outcome).toBe('audio-upload-missing'); expect(await objectExists()).toBe(true);
  });

});
