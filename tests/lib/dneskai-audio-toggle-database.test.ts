import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { readFileSync } from 'node:fs';
import { databaseVersion } from '@/lib/database-version';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
vi.mock('server-only', () => ({}));
const owner = '11111111-1111-4111-8111-111111111111', id = '33333333-3333-4333-8333-333333333333', version = '2026-10-27T10:00:00.000001Z';
let database: Awaited<ReturnType<typeof createMigratedDatabase>>, client: SupabaseClient, authenticated: SupabaseClient, anonymous: SupabaseClient;
beforeAll(async () => {
    database = await createMigratedDatabase({ owner, instant: '2026-10-27T10:00:00Z' });
    const origin = 'https://audio-toggle.supabase.co', emulator = new SupabaseEmulator(database, origin, { service: 'TEST-ONLY-service-role', users: { [owner]: 'TEST-ONLY-owner' } });
    const options = { global: { fetch: emulator.fetch.bind(emulator) }, auth: { persistSession: false, autoRefreshToken: false } };
    authenticated = createClient(origin, 'TEST-ONLY-anon', { ...options, global: { ...options.global, headers: { Authorization: 'Bearer TEST-ONLY-owner' } } });
    anonymous = createClient(origin, 'TEST-ONLY-anon', options);
    client = createClient(origin, 'TEST-ONLY-service-role', { global: { fetch: emulator.fetch.bind(emulator) }, auth: { persistSession: false, autoRefreshToken: false } });
}, 120000);
afterAll(async () => database?.close());
beforeEach(async () => {
    await database.query('drop trigger if exists zz_test_audio_clobber on public.marketing_audio_tracks');
    await database.query('delete from public.marketing_audio_tracks where user_id=$1::uuid', [owner]);
    await database.query(`insert into public.marketing_audio_tracks(id,user_id,title,artist,source,licence_note,source_url,storage_path,duration_ms,enabled,created_at,updated_at) values($1::uuid,$2::uuid,'Captured track','Fixture artist','original','Own recording','https://example.test/audio',$3,60000,true,$4::timestamptz,$4::timestamptz)`, [id, owner, 'marketing-audio/' + owner + '/' + id + '.mp3', version]);
});
it('refuses a toggle captured before a later track change', async () => {
    await database.query('update public.marketing_audio_tracks set title=$1,updated_at=$2::timestamptz where id=$3::uuid', ['Later metadata', '2026-10-27T10:00:00.000002Z', id]);
    const result = await client.rpc('toggle_owned_dneskai_audio_track', { p_owner: owner, p_id: id, p_expected_at: version, p_enabled: false });
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ kind: 'changed', ownerId: owner, id, requestedEnabled: false });
    const stored = await database.query('select enabled,title from public.marketing_audio_tracks where id=$1::uuid', [id]);
    expect(stored.rows[0]).toEqual({ enabled: true, title: 'Later metadata' });
});
it('does not acknowledge a persisted state that differs from the captured toggle', async () => {
    await database.query(`create or replace function public.test_audio_clobber() returns trigger language plpgsql as $$begin new.enabled:=true;return new;end$$`);
    await database.query(`create trigger zz_test_audio_clobber before update on public.marketing_audio_tracks for each row execute function public.test_audio_clobber()`);
    const result = await client.rpc('toggle_owned_dneskai_audio_track', { p_owner: owner, p_id: id, p_expected_at: version, p_enabled: false });
    expect(result.error?.message).toBe('Audio toggle unconfirmed');
});
it('maintains a strictly newer version when metadata changes without a caller timestamp', async () => {
    await database.query('update public.marketing_audio_tracks set title=$1 where id=$2::uuid', ['Changed title', id]);
    const result = await database.query<{advanced:boolean}>('select updated_at>$1::timestamptz as advanced from public.marketing_audio_tracks where id=$2::uuid', [version, id]);
    expect(result.rows[0]?.advanced).toBe(true);
});
const command = (patch: Record<string, unknown> = {}) => ({ p_owner: owner, p_id: id, p_expected_at: version, p_enabled: false, ...patch });
const stored = () => database.query<{row:Record<string,unknown>}>('select to_jsonb(t) as row from public.marketing_audio_tracks t where id=$1::uuid', [id]);
it('confirms the exact owned intent with a strictly newer persisted version', async () => {
    const reply = await client.rpc('toggle_owned_dneskai_audio_track', command());
    expect(reply.error).toBeNull();
    expect(Object.keys(reply.data).sort()).toEqual(['expectedVersion', 'id', 'kind', 'ownerId', 'requestedEnabled', 'updatedAt'].sort());
    expect(reply.data).toMatchObject({ ownerId: owner, id, kind: 'saved', requestedEnabled: false });
    expect(databaseVersion(reply.data.expectedVersion)).toBe(databaseVersion(version));
    expect(databaseVersion(reply.data.updatedAt)! > databaseVersion(version)!).toBe(true);
    const row = (await stored()).rows[0]?.row as Record<string, unknown>;
    expect(row.enabled).toBe(false);
    expect(databaseVersion(row.updated_at as string)).toBe(databaseVersion(reply.data.updatedAt));
    const retry = await client.rpc('toggle_owned_dneskai_audio_track', command());
    expect(retry.data.kind).toBe('changed');
    expect((await stored()).rows[0]?.row).toEqual(row);
});
it('confirms an already matching value only at its exact captured version', async () => {
    const reply = await client.rpc('toggle_owned_dneskai_audio_track', command({ p_enabled: true }));
    expect(reply.error).toBeNull();
    expect(reply.data.kind).toBe('saved');
    expect(databaseVersion(reply.data.updatedAt)! > databaseVersion(version)!).toBe(true);
});
it.each([{ p_owner: '22222222-2222-4222-8222-222222222222' }, { p_id: '44444444-4444-4444-8444-444444444444' }])('returns a positive absence without changing or exposing the other row: %#', async (patch) => {
    const before = await stored(), reply = await client.rpc('toggle_owned_dneskai_audio_track', command(patch));
    expect(reply.error).toBeNull();
    expect(reply.data).toMatchObject({ kind: 'absent', updatedAt: null, requestedEnabled: false });
    expect(await stored()).toEqual(before);
});
it('keeps execution and raw writes unavailable to anonymous and authenticated callers while retaining own reads', async () => {
    for (const actor of [anonymous, authenticated]) {
        const reply = await actor.rpc('toggle_owned_dneskai_audio_track', command());
        expect(reply.error?.code).toBe('42501');
    }
    const change = await authenticated.from('marketing_audio_tracks').update({ enabled: false }).eq('id', id);
    expect(change.error?.code).toBe('42501');
    const read = await authenticated.from('marketing_audio_tracks').select('id,enabled').eq('id', id).single();
    expect(read.error).toBeNull();
    expect(read.data).toEqual({ id, enabled: true });
});
it.each([{ p_owner: null }, { p_id: null }, { p_expected_at: null }, { p_expected_at: 'infinity' }, { p_expected_at: '-infinity' }, { p_enabled: null }])('refuses malformed service input without mutation: %#', async (patch) => {
    const before = await stored(), reply = await client.rpc('toggle_owned_dneskai_audio_track', command(patch));
    expect(reply.error?.code).toBe('22023');
    expect(await stored()).toEqual(before);
});
it('maintains versions under equal clocks and caller backdating', async () => {
    await database.query('update public.marketing_audio_tracks set updated_at=$1::timestamptz where id=$2::uuid', ['2000-01-01T00:00:00Z', id]);
    const one = (await stored()).rows[0]?.row as Record<string, unknown>;
    await database.query('update public.marketing_audio_tracks set enabled=enabled where id=$1::uuid', [id]);
    const two = (await stored()).rows[0]?.row as Record<string, unknown>;
    expect(databaseVersion(one.updated_at as string)! > databaseVersion(version)!).toBe(true);
    expect(databaseVersion(two.updated_at as string)! > databaseVersion(one.updated_at as string)!).toBe(true);
});
it.each([
    ['suppressed', 'before', 'return null;'],
    ['metadata', 'before', "new.artist:='Changed by trigger';return new;"],
    ['version', 'before', 'new.updated_at:=old.updated_at;return new;'],
    ['identity', 'before', "new.id:='44444444-4444-4444-8444-444444444444'::uuid;new.storage_path:='marketing-audio/11111111-1111-4111-8111-111111111111/44444444-4444-4444-8444-444444444444.mp3';return new;"],
    ['later write', 'after', "if pg_trigger_depth()=1 then update public.marketing_audio_tracks set artist='Changed by after trigger' where id=new.id;end if;return new;"],
    ['later removal', 'after', 'delete from public.marketing_audio_tracks where id=new.id;return new;'],
] as const)('rolls back the whole transaction after %s persistence', async (_name, timing, body) => {
    const before = await stored();
    await database.query(`create or replace function public.test_audio_clobber() returns trigger language plpgsql as $$begin ${body}end$$`);
    await database.query(`create trigger zz_test_audio_clobber ${timing} update on public.marketing_audio_tracks for each row execute function public.test_audio_clobber()`);
    const reply = await client.rpc('toggle_owned_dneskai_audio_track', command());
    expect(reply.error?.message).toBe('Audio toggle unconfirmed');
    expect(await stored()).toEqual(before);
});
it('adds the canonical migration to populated history without rewriting a row and rolls back the upgrade', async () => {
    const file = '20261027111657_captured_dneskai_audio_toggles.sql', legacy = await createMigratedDatabase({ owner, instant: '2026-10-27T10:00:00Z', beforeMigration: file });
    try {
        await legacy.query(`insert into public.marketing_audio_tracks(id,user_id,title,artist,source,licence_note,source_url,storage_path,duration_ms,enabled,created_at,updated_at) values($1::uuid,$2::uuid,'Historical track','Fixture','original','Own recording','https://example.test/audio',$3,60000,false,$4::timestamptz,$4::timestamptz)`, [id, owner, 'marketing-audio/' + owner + '/' + id + '.mp3', version]);
        const before = await legacy.query('select to_jsonb(t) as row from public.marketing_audio_tracks t');
        await legacy.exec('begin');
        await legacy.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
        expect(await legacy.query('select to_jsonb(t) as row from public.marketing_audio_tracks t')).toEqual(before);
        await legacy.exec('rollback');
        const functions = await legacy.query<{value:string|null}>("select to_regprocedure('public.toggle_owned_dneskai_audio_track(uuid,uuid,timestamptz,boolean)') as value");
        expect(functions.rows[0]?.value).toBeNull();
        expect(await legacy.query('select to_jsonb(t) as row from public.marketing_audio_tracks t')).toEqual(before);
    }
    finally {
        await legacy.close();
    }
});

it.each(['infinity','-infinity','10000-01-01T00:00:00Z'])('refuses a new unsupported version without changing history: %s',async value=>{
 const before=await stored();
 await expect(database.query(`insert into public.marketing_audio_tracks(id,user_id,title,artist,source,licence_note,source_url,storage_path,duration_ms,updated_at) values('44444444-4444-4444-8444-444444444444',$1::uuid,'Invalid fixture','Fixture','original','Own recording','https://example.test/audio',$2,60000,$3::timestamptz)`,[owner,'marketing-audio/'+owner+'/44444444-4444-4444-8444-444444444444.mp3',value])).rejects.toThrow('marketing_audio_tracks_finite_version');
 expect(await stored()).toEqual(before);
});
it('refuses and rolls back an upgrade over an unsupported historical version',async()=>{
 const file='20261027111657_captured_dneskai_audio_toggles.sql',legacy=await createMigratedDatabase({owner,instant:'2026-10-27T10:00:00Z',beforeMigration:file});
 try{
  await legacy.query(`insert into public.marketing_audio_tracks(id,user_id,title,artist,source,licence_note,source_url,storage_path,duration_ms,updated_at) values($1::uuid,$2::uuid,'Historical fixture','Fixture','original','Own recording','https://example.test/audio',$3,60000,'infinity'::timestamptz)`,[id,owner,'marketing-audio/'+owner+'/'+id+'.mp3']);
  const before=await legacy.query('select to_jsonb(t) as row from public.marketing_audio_tracks t');await legacy.exec('begin');await expect(legacy.exec(readFileSync('supabase/migrations/'+file,'utf8'))).rejects.toThrow('marketing_audio_tracks_finite_version');await legacy.exec('rollback');
  expect(await legacy.query('select to_jsonb(t) as row from public.marketing_audio_tracks t')).toEqual(before);expect((await legacy.query<{value:string|null}>("select to_regprocedure('public.toggle_owned_dneskai_audio_track(uuid,uuid,timestamptz,boolean)') as value")).rows[0]?.value).toBeNull();
 }finally{await legacy.close();}
});

it('adopts the strict server helper receipt and rejects its stale retry',async()=>{
 const {setDneskaiAudioTrackEnabled}=await import('@/lib/marketing/dneskai-audio');
 const reply=await setDneskaiAudioTrackEnabled(client as never,owner,id,false,version);
 expect(reply).toMatchObject({kind:'saved',ownerId:owner,id,requestedEnabled:false});
 await expect(setDneskaiAudioTrackEnabled(client as never,owner,id,false,version)).rejects.toHaveProperty('code','audio-track-changed');
 await expect(setDneskaiAudioTrackEnabled(client as never,'22222222-2222-4222-8222-222222222222',id,false,version)).rejects.toHaveProperty('code','audio-track-unavailable');
});
