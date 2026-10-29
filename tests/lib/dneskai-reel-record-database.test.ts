import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import { recordDneskaiReel } from '@/lib/marketing/dneskai-reel';
vi.mock('server-only', () => ({}));
const owner = '11111111-1111-4111-8111-111111111111', revision = '22222222-2222-4222-8222-222222222222';
let database: Awaited<ReturnType<typeof createMigratedDatabase>>, service: SupabaseClient, authenticated: SupabaseClient, anonymous: SupabaseClient, emulator: SupabaseEmulator;
beforeAll(async () => {
    database = await createMigratedDatabase({ owner, instant: '2026-10-27T12:00:00Z' });
    await database.query("insert into public.marketing_revisions(id,user_id,brand,revision,content_hash) values($1,$2,'dneskai','{}',$3)", [revision, owner, 'a'.repeat(64)]);
    const origin = 'https://reel-record.supabase.co';
    emulator = new SupabaseEmulator(database, origin, { service: 'TEST-ONLY-service', users: { [owner]: 'TEST-ONLY-owner' } });
    service = createClient(origin, 'TEST-ONLY-service', { global: { fetch: emulator.fetch.bind(emulator) }, auth: { persistSession: false, autoRefreshToken: false } });
    authenticated = createClient(origin, 'TEST-ONLY-anon', { global: { fetch: emulator.fetch.bind(emulator), headers: { Authorization: 'Bearer TEST-ONLY-owner' } }, auth: { persistSession: false, autoRefreshToken: false } });
    anonymous = createClient(origin, 'TEST-ONLY-anon', { global: { fetch: emulator.fetch.bind(emulator) }, auth: { persistSession: false, autoRefreshToken: false } });
}, 120000);
afterAll(async () => database?.close());
beforeEach(async () => {
    await database.exec('delete from public.marketing_events');
    await database.query('update public.marketing_revisions set content_hash=$1 where id=$2', ['a'.repeat(64), revision]);
});
const record = (hash: string) => ({ reelKey: 'c'.repeat(64), revisionHash: hash, audioId: null, sha256: 'd'.repeat(64), bytes: 1000 });
it('records a new approved hash while reusing the unchanged physical MP4', async () => {
    await recordDneskaiReel(service, owner, revision, record('a'.repeat(64)));
    await database.query('update public.marketing_revisions set content_hash=$1 where id=$2', ['b'.repeat(64), revision]);
    await recordDneskaiReel(service, owner, revision, record('b'.repeat(64)));
    const result = await database.query<{
        hash: string;
    }>("select payload->>'revisionHash' as hash from public.marketing_events where user_id=$1 and revision_id=$2 and kind='dneskai-reel-rendered' order by payload->>'revisionHash'", [owner, revision]);
    expect(result.rows.map(row => row.hash)).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
});
const args = (patch: Record<string, unknown> = {}) => ({ p_owner: owner, p_revision: revision, p_revision_hash: 'a'.repeat(64), p_reel_key: 'c'.repeat(64), p_audio_id: null, p_sha256: 'd'.repeat(64), p_bytes: 1000, ...patch });
it('returns one exact event for repeated and queued emulator retries without rewriting it', async () => {
    const first = await service.rpc('record_owned_dneskai_reel', args());
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ ownerId: owner, revisionId: revision, revisionHash: 'a'.repeat(64), reelKey: 'c'.repeat(64), audioId: null, sha256: 'd'.repeat(64), bytes: 1000, created: true });
    const before = await database.query('select to_jsonb(e)::text as row from public.marketing_events e');
    const repeated = await Promise.all(Array.from({ length: 8 }, () => service.rpc('record_owned_dneskai_reel', args())));
    expect(repeated.every(value => !value.error && value.data.eventId === first.data.eventId && value.data.created === false)).toBe(true);
    expect((await database.query('select to_jsonb(e)::text as row from public.marketing_events e')).rows).toEqual(before.rows);
});
it.each([{ p_revision_hash: 'b'.repeat(64) }, { p_owner: '33333333-3333-4333-8333-333333333333' }, { p_revision: '33333333-3333-4333-8333-333333333333' }])('refuses a stale, foreign or missing owned revision: %#', async (patch) => {
    const result = await service.rpc('record_owned_dneskai_reel', args(patch));
    expect(result.error?.code).toBe('P0002');
    expect((await database.query<{n:number}>('select count(*)::int as n from public.marketing_events')).rows[0].n).toBe(0);
});
it.each([{ p_bytes: 0 }, { p_bytes: 67108865 }, { p_revision_hash: 'bad' }, { p_reel_key: 'bad' }, { p_sha256: 'bad' }, { p_owner: null }])('refuses invalid bounded arguments without a record: %#', async (patch) => {
    expect((await service.rpc('record_owned_dneskai_reel', args(patch))).error?.code).toBe('22023');
    expect((await database.query<{n:number}>('select count(*)::int as n from public.marketing_events')).rows[0].n).toBe(0);
});
it.each([{ p_sha256: 'e'.repeat(64) }, { p_bytes: 1001 }, { p_audio_id: '33333333-3333-4333-8333-333333333333' }])('preserves an existing contradictory record and refuses success: %#', async (patch) => {
    expect((await service.rpc('record_owned_dneskai_reel', args())).error).toBeNull();
    const before = (await database.query('select to_jsonb(e)::text as row from public.marketing_events e')).rows;
    expect((await service.rpc('record_owned_dneskai_reel', args(patch))).error?.code).toBe('40001');
    expect((await database.query('select to_jsonb(e)::text as row from public.marketing_events e')).rows).toEqual(before);
});
it('allows only the service role, with invoker ownership checks and no data/permission broadening', async () => {
    expect((await authenticated.rpc('record_owned_dneskai_reel', args())).error?.code).toBe('42501');
    expect((await anonymous.rpc('record_owned_dneskai_reel', args())).error?.code).toBe('42501');
    const result = await database.query<{
        prosecdef: boolean;
        proconfig: string[];
    }>("select prosecdef,proconfig from pg_proc where oid='public.record_owned_dneskai_reel(uuid,uuid,text,text,uuid,text,bigint)'::regprocedure");
    expect(result.rows[0].prosecdef).toBe(false);
    expect(result.rows[0].proconfig).toContain('search_path=""');
    expect(result.rows[0].proconfig).toContain('lock_timeout=5s');
});
it('preserves unknown historical fields and excludes them from the small positive receipt', async () => {
    const payload = { ...record('a'.repeat(64)), TEST_ONLY_FUTURE_PRIVATE_FIELD: 'x'.repeat(500000) };
    await database.query("insert into public.marketing_events(user_id,revision_id,kind,payload,delivered_at) values($1,$2,'dneskai-reel-rendered',$3,now())", [owner, revision, JSON.stringify(payload)]);
    const before = (await database.query('select payload::text as payload from public.marketing_events')).rows;
    const result = await service.rpc('record_owned_dneskai_reel', args());
    expect(result.error).toBeNull();
    expect(result.data.created).toBe(false);
    expect(JSON.stringify(result.data).length).toBeLessThan(1000);
    expect((await database.query('select payload::text as payload from public.marketing_events')).rows).toEqual(before);
});
it.each(['suppressed', 'before-changed', 'after-changed'] as const)('rolls back a record whose persisted tuple is %s by a future trigger', async (kind) => {
    const action = kind === 'suppressed' ? 'return null;' : kind === 'before-changed' ? "new.payload:=jsonb_set(new.payload,'{bytes}','1001'::jsonb);" : "update public.marketing_events set delivered_at=null where id=new.id;";
    await database.exec(`create function public.test_only_reel_guard() returns trigger language plpgsql as $$begin ${action} return new;end;$$;create trigger test_only_reel_guard ${kind === 'after-changed' ? 'after' : 'before'} insert on public.marketing_events for each row execute function public.test_only_reel_guard();`);
    try {
        expect((await service.rpc('record_owned_dneskai_reel', args())).error?.code).toBe('40001');
        expect((await database.query<{n:number}>('select count(*)::int as n from public.marketing_events')).rows[0].n).toBe(0);
    }
    finally {
        await database.exec('drop trigger test_only_reel_guard on public.marketing_events;drop function public.test_only_reel_guard();');
    }
});
it('preserves populated history and permissions through canonical upgrade and transaction rollback', async () => {
    const migration = readFileSync('supabase/migrations/20261027175307_confirmed_dneskai_reel_records.sql', 'utf8'), drop = 'drop function public.record_owned_dneskai_reel(uuid,uuid,text,text,uuid,text,bigint);';
    await recordDneskaiReel(service, owner, revision, record('a'.repeat(64)));
    const before = (await database.query('select to_jsonb(e)::text as row from public.marketing_events e')).rows;
    await database.exec(drop);
    try {
        await database.exec('begin;' + migration);
        expect((await database.query('select to_jsonb(e)::text as row from public.marketing_events e')).rows).toEqual(before);
        await database.exec('rollback');
        expect((await database.query<{value:string|null}>("select to_regprocedure('public.record_owned_dneskai_reel(uuid,uuid,text,text,uuid,text,bigint)') as value")).rows[0].value).toBeNull();
        expect((await database.query('select to_jsonb(e)::text as row from public.marketing_events e')).rows).toEqual(before);
    }
    finally {
        await database.exec(migration);
    }
});
it('recovers an explicitly retried lost acknowledgement without adding or rewriting an event', async () => {
    let requests = 0;
    const client = createClient('https://reel-record.supabase.co', 'TEST-ONLY-service', {
        global: {
            fetch: async (input, init) => {
                requests++;
                const response = await emulator.fetch(input, init);
                if (requests === 1 && response.ok)
                    throw new TypeError('TEST_ONLY_LOST_ACKNOWLEDGEMENT');
                return response;
            }
        }, auth: { persistSession: false, autoRefreshToken: false }
    });
    await expect(recordDneskaiReel(client, owner, revision, record('a'.repeat(64)))).rejects.toMatchObject({ code: 'reel-storage-failed', message: 'reel-storage-failed' });
    expect(requests).toBe(1);
    const before = (await database.query('select to_jsonb(e)::text as row from public.marketing_events e')).rows;
    expect(before).toHaveLength(1);
    await recordDneskaiReel(client, owner, revision, record('a'.repeat(64)));
    expect(requests).toBe(2);
    expect((await database.query('select to_jsonb(e)::text as row from public.marketing_events e')).rows).toEqual(before);
});
