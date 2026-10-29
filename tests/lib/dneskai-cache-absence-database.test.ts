import { readFileSync } from 'node:fs';
import { readDneskaiCacheObjectPresence } from '@/lib/marketing/dneskai-object-presence';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import { createDneskaiReelStorage, dneskaiReelForRevision, dneskaiReelObjectKey } from '@/lib/marketing/dneskai-reel';
import { createDneskaiSlideStorage, dneskaiSlideObjectKey } from '@/lib/marketing/worker-runtime';
import { dneskaiReelKey } from '@/lib/marketing/dneskai-reel-render';
import { DNESKAI_RENDER_REPORT_VERSION } from '@/lib/marketing/contracts';
import { revisionContentHash } from '@/lib/marketing/hashes';
import { deckRevision } from './marketing-dneskai-revision-fixture';
vi.mock('server-only', () => ({}));
const owner = '11111111-1111-4111-8111-111111111111', revisionId = '22222222-2222-4222-8222-222222222222', key = 'a'.repeat(64);
let database: Awaited<ReturnType<typeof createMigratedDatabase>>, client: SupabaseClient, healthy: SupabaseClient, authenticated: SupabaseClient, anonymous: SupabaseClient;
let requests: URL[] = [];
beforeAll(async () => {
    database = await createMigratedDatabase({ owner, instant: '2026-10-27T12:00:00Z' });
    const origin = 'https://cache-absence.supabase.co', emulator = new SupabaseEmulator(database, origin, { service: 'TEST-ONLY-service', users: { [owner]: 'TEST-ONLY-owner' } });
    const options = {
        global: { fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
                requests.push(new URL(String(url)));
                return emulator.fetch(url, init);
            } }, auth: { persistSession: false, autoRefreshToken: false }
    };
    healthy = createClient(origin, 'TEST-ONLY-service', options);
    authenticated = createClient(origin, 'TEST-ONLY-anon', { ...options, global: { ...options.global, headers: { Authorization: 'Bearer TEST-ONLY-owner' } } });
    anonymous = createClient(origin, 'TEST-ONLY-anon', options);
    client = createClient(origin, 'TEST-ONLY-service', {
        global: {
            fetch: async (url, init) => String(url).includes('/object/info/') ? Response.json({ statusCode: '404', error: 'NoSuchKey', message: 'TEST_ONLY_UNAVAILABLE_METADATA' }, { status: 404 }) : emulator.fetch(url, init)
        }, auth: { persistSession: false, autoRefreshToken: false }
    });
}, 120000);
afterAll(async () => database?.close());
beforeEach(async () => {
    requests = [];
    await database.exec("delete from storage.objects;delete from public.marketing_revisions;insert into storage.buckets(id,name,public) values('marketing-assets','marketing-assets',false),('marketing-reels','marketing-reels',false) on conflict(id) do update set public=false;");
});
async function stored(kind: 'slide' | 'reel', value = key) {
    const bytes = Buffer.from([1, 2]), sha256 = createHash('sha256').update(bytes).digest('hex');
    await database.query("insert into storage.objects(bucket_id,name,owner,bytes,metadata,user_metadata) values($1,$2,$3,$4,$5,$6)", [kind === 'reel' ? 'marketing-reels' : 'marketing-assets', kind === 'reel' ? dneskaiReelObjectKey(owner, value) : dneskaiSlideObjectKey(owner, value), owner, bytes, JSON.stringify({ size: 2, mimetype: kind === 'reel' ? 'video/mp4' : 'image/jpeg' }), JSON.stringify({ ownerId: owner, sha256, ...(kind === 'reel' ? { reelKey: value } : { renderKey: value }) })]);
}
it.each(['slide', 'reel'] as const)('holds an existing %s after a typed NoSuchKey metadata refusal instead of inventing absence', async (kind) => {
    await stored(kind);
    const cache = kind === 'reel' ? createDneskaiReelStorage(client, owner) : createDneskaiSlideStorage(client, owner);
    await expect(cache.find(key)).rejects.toHaveProperty('code', kind === 'reel' ? 'reel-storage-failed' : 'asset-storage-failed');
});
it('does no slide loading or encode when the recorded owned MP4 exists but metadata is unavailable', async () => {
    const revision = { ...deckRevision(), assets: deckRevision().assets.map((asset, index) => ({ ...asset, sha256: createHash('sha256').update('slide-' + (index + 1)).digest('hex') })) }, keys = ['1', '2', '3'].map(value => value.repeat(64)), physical = dneskaiReelKey({ slideSha256s: revision.assets.map(asset => asset.sha256), audio: null });
    await stored('reel', physical);
    await database.query("insert into public.marketing_revisions(id,user_id,brand,revision,content_hash,render_report) values($1,$2,'dneskai',$3,$4,$5)", [revisionId, owner, JSON.stringify(revision), revisionContentHash(revision), JSON.stringify({ schemaVersion: DNESKAI_RENDER_REPORT_VERSION, status: 'rendered', problems: [], renderKeys: keys, renderedAt: '2026-10-27T12:00:00Z' })]);
    const loadSlide = vi.fn(async (value: string) => Buffer.from('slide-' + value[0])), render = vi.fn(async () => ({ bytes: Buffer.from('fixture'), sha256: 'b'.repeat(64), durationSeconds: 9.5, slideCount: 3, silent: true }));
    await expect(dneskaiReelForRevision(client, owner, revisionId, { storage: createDneskaiReelStorage(client, owner), loadAudio: async () => null, loadSlide, render })).rejects.toHaveProperty('code', 'reel-storage-failed');
    expect(loadSlide).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
});
it.each(['slide', 'reel'] as const)('allows a true %s miss only after exact owned private-path absence', async (kind) => {
    expect(await readDneskaiCacheObjectPresence(healthy, owner, kind, key)).toBe('absent');
    const cache = kind === 'reel' ? createDneskaiReelStorage(client, owner) : createDneskaiSlideStorage(client, owner);
    expect(await cache.find(key)).toBeNull();
    await stored(kind);
    expect(await readDneskaiCacheObjectPresence(healthy, owner, kind, key)).toBe('present');
    expect(await readDneskaiCacheObjectPresence(healthy, owner, kind, 'b'.repeat(64))).toBe('absent');
    expect(await readDneskaiCacheObjectPresence(healthy, '33333333-3333-4333-8333-333333333333', kind, key)).toBe('absent');
});
it.each(['slide', 'reel'] as const)('adds no presence RPC to a healthy %s cache hit', async (kind) => {
    await stored(kind);
    const cache = kind === 'reel' ? createDneskaiReelStorage(healthy, owner) : createDneskaiSlideStorage(healthy, owner);
    expect(await cache.find(key)).toHaveProperty('sha256');
    expect(requests.filter(url => url.pathname.includes('/rpc/'))).toHaveLength(0);
});
it.each(['slide', 'reel'] as const)('refuses unknown private-bucket state for %s without changing stored history', async (kind) => {
    await stored(kind);
    const bucket = kind === 'reel' ? 'marketing-reels' : 'marketing-assets';
    await database.query('update storage.buckets set public=true where id=$1', [bucket]);
    const before = (await database.query('select to_jsonb(o)::text as row from storage.objects o')).rows;
    await expect(readDneskaiCacheObjectPresence(healthy, owner, kind, key)).rejects.toThrow('Cache object unavailable');
    expect((await database.query('select to_jsonb(o)::text as row from storage.objects o')).rows).toEqual(before);
    await database.exec('delete from storage.objects');
    await database.query('delete from storage.buckets where id=$1', [bucket]);
    await expect(readDneskaiCacheObjectPresence(healthy, owner, kind, key)).rejects.toThrow('Cache object unavailable');
});
it('grants only service execution and returns no object bytes or metadata', async () => {
    const args = { p_owner: owner, p_kind: 'slide', p_key: key };
    expect((await authenticated.rpc('read_owned_dneskai_cache_object', args)).error?.code).toBe('42501');
    expect((await anonymous.rpc('read_owned_dneskai_cache_object', args)).error?.code).toBe('42501');
    const config = await database.query<{
        prosecdef: boolean;
        provolatile: string;
        proconfig: string[];
    }>("select prosecdef,provolatile,proconfig from pg_proc where oid='public.read_owned_dneskai_cache_object(uuid,text,text)'::regprocedure");
    expect(config.rows[0]).toMatchObject({ prosecdef: false, provolatile: 's' });
    expect(config.rows[0].proconfig).toContain('search_path=""');
    expect((await healthy.rpc('read_owned_dneskai_cache_object', args)).data).toEqual({ ownerId: owner, kind: 'slide', key, state: 'absent' });
});
it.each([{ p_owner: null }, { p_kind: 'other' }, { p_kind: null }, { p_key: 'bad' }, { p_key: null }])('refuses an invalid selector before proving a cache miss: %#', async (patch) => {
    expect((await healthy.rpc('read_owned_dneskai_cache_object', { p_owner: owner, p_kind: 'slide', p_key: key, ...patch })).error?.code).toBe('22023');
});
it('preserves populated objects and bucket metadata through canonical upgrade/rollback', async () => {
    await stored('slide');
    await stored('reel');
    const migration = readFileSync('supabase/migrations/20261027184102_confirmed_dneskai_cache_object_presence.sql', 'utf8'), before = (await database.query('select to_jsonb(o)::text as row from storage.objects o order by name')).rows;
    await database.exec('drop function public.read_owned_dneskai_cache_object(uuid,text,text);');
    try {
        await database.exec('begin;' + migration);
        expect((await database.query('select to_jsonb(o)::text as row from storage.objects o order by name')).rows).toEqual(before);
        await database.exec('rollback');
        expect((await database.query<{
            value: string | null;
        }>("select to_regprocedure('public.read_owned_dneskai_cache_object(uuid,text,text)') as value")).rows[0].value).toBeNull();
        expect((await database.query('select to_jsonb(o)::text as row from storage.objects o order by name')).rows).toEqual(before);
    }
    finally {
        await database.exec(migration);
    }
});
