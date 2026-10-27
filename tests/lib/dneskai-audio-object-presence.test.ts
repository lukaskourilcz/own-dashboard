import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import { readDneskaiAudioObjectPresence } from '@/lib/marketing/dneskai-audio';
import { DNESKAI_AUDIO_TYPES } from '@/lib/marketing/dneskai-audio-contracts';
vi.mock('server-only', () => ({}));
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222', id = '33333333-3333-4333-8333-333333333333';
let database: Awaited<ReturnType<typeof createMigratedDatabase>>, service: SupabaseClient, authenticated: SupabaseClient, anonymous: SupabaseClient;
beforeAll(async () => {
    database = await createMigratedDatabase({ owner, instant: '2026-10-27T12:00:00Z' });
    const origin = 'https://audio-object.supabase.co', emulator = new SupabaseEmulator(database, origin, { service: 'TEST-ONLY-service', users: { [owner]: 'TEST-ONLY-owner' } }), options = { global: { fetch: emulator.fetch.bind(emulator) }, auth: { persistSession: false, autoRefreshToken: false } };
    service = createClient(origin, 'TEST-ONLY-service', options);
    authenticated = createClient(origin, 'TEST-ONLY-anon', { ...options, global: { ...options.global, headers: { Authorization: 'Bearer TEST-ONLY-owner' } } });
    anonymous = createClient(origin, 'TEST-ONLY-anon', options);
}, 120000);
afterAll(async () => database?.close());
beforeEach(async () => {
    await database.exec("delete from storage.objects;insert into storage.buckets(id,name,public) values('marketing-audio','marketing-audio',false) on conflict(id) do update set public=false;");
});
const args = (patch: Record<string, unknown> = {}) => ({ p_owner: owner, p_id: id, p_content_type: 'audio/mpeg', ...patch });
it.each(Object.entries(DNESKAI_AUDIO_TYPES))('proves exact presence and absence for %s without reading file bytes', async (contentType, extension) => {
    expect(await readDneskaiAudioObjectPresence(service, owner, id, contentType as keyof typeof DNESKAI_AUDIO_TYPES)).toBe('absent');
    await database.query("insert into storage.objects(bucket_id,name,bytes) values('marketing-audio',$1,$2)", [owner + '/' + id + '.' + extension, new Uint8Array([1, 2, 3])]);
    const reply = await service.rpc('read_owned_dneskai_audio_object', args({ p_content_type: contentType }));
    expect(reply.error).toBeNull();
    expect(reply.data).toEqual({ ownerId: owner, id, contentType, state: 'present' });
    expect(await readDneskaiAudioObjectPresence(service, owner, id, contentType as keyof typeof DNESKAI_AUDIO_TYPES)).toBe('present');
});
it('does not use a foreign owner, another id or another extension as evidence for this path', async () => {
    for (const path of [other + '/' + id + '.mp3', owner + '/44444444-4444-4444-8444-444444444444.mp3', owner + '/' + id + '.wav'])
        await database.query("insert into storage.objects(bucket_id,name) values('marketing-audio',$1)", [path]);
    expect(await readDneskaiAudioObjectPresence(service, owner, id, 'audio/mpeg')).toBe('absent');
});
it('keeps the read RPC unavailable to authenticated and anonymous callers', async () => {
    for (const actor of [authenticated, anonymous]) {
        const reply = await actor.rpc('read_owned_dneskai_audio_object', args());
        expect(reply.error?.code).toBe('42501');
    }
});
it.each([{ p_owner: null }, { p_id: null }, { p_content_type: null }, { p_content_type: 'audio/unknown' }, { p_content_type: '../mp3' }])('refuses invalid typed selectors: %#', async (patch) => {
    const reply = await service.rpc('read_owned_dneskai_audio_object', args(patch));
    expect(reply.error?.code).toBe('22023');
});
it.each(['missing', 'public'] as const)('cannot prove absence when the private bucket is %s', async (kind) => {
    await database.exec(kind === 'missing' ? "delete from storage.buckets where id='marketing-audio'" : "update storage.buckets set public=true where id='marketing-audio'");
    await expect(readDneskaiAudioObjectPresence(service, owner, id, 'audio/mpeg')).rejects.toHaveProperty('code', 'audio-library-unavailable');
});
it('preserves populated audio and object history through canonical upgrade and rollback', async () => {
    const file = '20261027141619_confirmed_dneskai_audio_object_presence.sql', legacy = await createMigratedDatabase({ owner, instant: '2026-10-27T12:00:00Z', beforeMigration: file });
    try {
        await legacy.query("insert into storage.objects(bucket_id,name,bytes) values('marketing-audio',$1,$2)", [owner + '/' + id + '.mp3', new Uint8Array([1, 2, 3])]);
        await legacy.query("insert into public.marketing_audio_tracks(id,user_id,title,artist,source,licence_note,source_url,storage_path,duration_ms,enabled) values($1,$2,'Historical fixture','Fixture','original','Own recording','https://example.test/audio',$3,60000,false)", [id, owner, 'marketing-audio/' + owner + '/' + id + '.mp3']);
        const snapshot = async () => ({
            objects: await legacy.query('select to_jsonb(t) as row from storage.objects t'), tracks: await legacy.query('select to_jsonb(t) as row from public.marketing_audio_tracks t'), buckets: await legacy.query('select to_jsonb(t) as row from storage.buckets t')
        });
        const before = await snapshot();
        await legacy.exec('begin');
        await legacy.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
        expect(await snapshot()).toEqual(before);
        await legacy.exec('rollback');
        expect(await snapshot()).toEqual(before);
        expect((await legacy.query<{
            value: string | null;
        }>("select to_regprocedure('public.read_owned_dneskai_audio_object(uuid,uuid,text)') as value")).rows[0]?.value).toBeNull();
    }
    finally {
        await legacy.close();
    }
});
