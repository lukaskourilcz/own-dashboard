import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
const m = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: (...args: unknown[]) => m.session(...args) }));
import { GET } from '@/app/api/marketing/accounts/route';
const owner = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222', instant = '2026-10-27T10:00:00Z', beforeExpiry = '2026-12-01T10:00:00Z', afterExpiry = '2026-12-02T10:00:00Z';
let database: Awaited<ReturnType<typeof createMigratedDatabase>>, emulator: SupabaseEmulator, authenticated: SupabaseClient, anonymous: SupabaseClient, service: SupabaseClient;
beforeAll(async () => {
    database = await createMigratedDatabase({ owner, instant });
    const origin = 'https://account-snapshot.supabase.co';
    emulator = new SupabaseEmulator(database, origin, { service: 'TEST-ONLY-service', users: { [owner]: 'TEST-ONLY-owner' } });
    const options = { global: { fetch: emulator.fetch.bind(emulator) }, auth: { persistSession: false, autoRefreshToken: false } };
    authenticated = createClient(origin, 'TEST-ONLY-anon', { ...options, global: { ...options.global, headers: { Authorization: 'Bearer TEST-ONLY-owner' } } });
    anonymous = createClient(origin, 'TEST-ONLY-anon', options);
    service = createClient(origin, 'TEST-ONLY-service', options);
}, 120000);
afterAll(async () => database?.close());
beforeEach(async () => {
    await database.query('delete from public.marketing_accounts where user_id=$1', [owner]);
    await database.query("insert into public.marketing_accounts(id,user_id,brand,platform,remote_account_id,handle,verified_at,enabled) values($1,$2,'dneskai','instagram','17841400000000001','before',$3,false)", [id, owner, instant]);
    await database.query("insert into public.marketing_account_tokens(account_id,user_id,access_token,expires_at,refreshed_at,scopes,login_mode) values($1,$2,'TEST_ONLY_DATABASE_FIXTURE_TOKEN',$3,$4,array['instagram_business_basic'],'instagram')", [id, owner, beforeExpiry, instant]);
});
const change = () => database.query("with a as(update public.marketing_accounts set handle='after' where id=$1 returning id) update public.marketing_account_tokens set expires_at=$2 where account_id in(select id from a)", [id, afterExpiry]);
it('returns one consistent account/metadata snapshot across a concurrent completed identity refresh', async () => {
    let finish!: () => void;
    const changed = new Promise<void>(done => {
        finish = done;
    }), fetcher = vi.fn(async (input: unknown, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (path === '/rest/v1/marketing_accounts') {
            const old = await emulator.fetch(input as RequestInfo, init);
            await change();
            finish();
            return old;
        }
        if (path === '/rest/v1/rpc/marketing_account_token_status')
            await changed;
        if (path === '/rest/v1/rpc/read_owned_marketing_accounts')
            await change();
        return emulator.fetch(input as RequestInfo, init);
    }), db = createClient('https://account-snapshot.supabase.co', 'TEST-ONLY-anon', { global: { fetch: fetcher, headers: { Authorization: 'Bearer TEST-ONLY-owner' } }, auth: { persistSession: false, autoRefreshToken: false } });
    vi.spyOn(db.auth, 'getUser').mockResolvedValue({ data: { user: { id: owner } }, error: null } as never);
    m.session.mockResolvedValue(db);
    const response = await GET(new Request('https://own.example/api/marketing/accounts'));
    expect(response.status).toBe(200);
    const account = (await response.json()).accounts[0];
    expect([['before', Date.parse(beforeExpiry)], ['after', Date.parse(afterExpiry)]]).toContainEqual([account.handle, Date.parse(account.token.expiresAt)]);
    expect(fetcher).toHaveBeenCalledOnce();
});
it('returns exact owner metadata without credential fields through the authenticated role', async () => {
    const reply = await authenticated.rpc('read_owned_marketing_accounts', { p_owner: owner });
    expect(reply.error).toBeNull();
    expect(reply.data).toMatchObject({ ownerId: owner, accounts: [{ id, user_id: owner, handle: 'before' }], tokens: [{ account_id: id, brand: 'dneskai', platform: 'instagram', login_mode: 'instagram' }] });
    expect(Object.keys(reply.data).sort()).toEqual(['accounts', 'ownerId', 'tokens']);
    expect(JSON.stringify(reply.data)).not.toContain('access_token');
    expect(JSON.stringify(reply.data)).not.toContain('TEST_ONLY_DATABASE_FIXTURE_TOKEN');
    expect(JSON.stringify(reply.data).length).toBeLessThan(2000);
});
it('denies anonymous/service execution and keeps the credential table unavailable to authenticated callers', async () => {
    for (const actor of [anonymous, service])
        expect((await actor.rpc('read_owned_marketing_accounts', { p_owner: owner })).error?.code).toBe('42501');
    expect((await authenticated.from('marketing_account_tokens').select('account_id')).error?.code).toBe('42501');
});
it('refuses null and foreign captured owner selectors', async () => {
    expect((await authenticated.rpc('read_owned_marketing_accounts', { p_owner: null })).error?.code).toBe('22023');
    expect((await authenticated.rpc('read_owned_marketing_accounts', { p_owner: '33333333-3333-4333-8333-333333333333' })).error?.code).toBe('42501');
});
it('keeps confirmed empty and tokenless snapshots explicit', async () => {
    await database.query('delete from public.marketing_account_tokens where account_id=$1', [id]);
    expect((await authenticated.rpc('read_owned_marketing_accounts', { p_owner: owner })).data).toMatchObject({ accounts: [{ id }], tokens: [] });
    await database.query('delete from public.marketing_accounts where id=$1', [id]);
    expect((await authenticated.rpc('read_owned_marketing_accounts', { p_owner: owner })).data).toEqual({ ownerId: owner, accounts: [], tokens: [] });
});
it('returns the complete four supported account tuples without a prefix', async () => {
    for (const [index, brand, platform] of [[1, 'dneskai', 'threads'], [2, 'devshark', 'instagram'], [3, 'devshark', 'threads']] as const)
        await database.query("insert into public.marketing_accounts(id,user_id,brand,platform,remote_account_id,handle) values($1,$2,$3,$4,'17841400000000001',$3)", [`44444444-4444-4444-8444-44444444444${index}`, owner, brand, platform]);
    const reply = await authenticated.rpc('read_owned_marketing_accounts', { p_owner: owner });
    expect(reply.error).toBeNull();
    expect(reply.data.accounts).toHaveLength(4);
    expect(reply.data.accounts.map((row: {
        brand: string;
        platform: string;
    }) => `${row.brand}/${row.platform}`)).toEqual(['devshark/instagram', 'devshark/threads', 'dneskai/instagram', 'dneskai/threads']);
});
it('refuses an excessive snapshot before returning a partial large row', async () => {
    await database.query('update public.marketing_accounts set handle=$1 where id=$2', ['A'.repeat(21000), id]);
    const reply = await authenticated.rpc('read_owned_marketing_accounts', { p_owner: owner });
    expect(reply.data).toBeNull();
    expect(reply.error).toMatchObject({ code: '40001', message: 'Account snapshot unavailable' });
});
it('retains stable invoker/empty-search-path and existing own-only policies', async () => {
    const result = await database.query<{
        provolatile: string;
        prosecdef: boolean;
        proconfig: string[];
        relrowsecurity: boolean;
    }>("select p.provolatile,p.prosecdef,p.proconfig,c.relrowsecurity from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join pg_class c where n.nspname='public' and p.proname='read_owned_marketing_accounts' and c.oid='public.marketing_accounts'::regclass");
    expect(result.rows[0]).toEqual({ provolatile: 's', prosecdef: false, proconfig: ['search_path=""'], relrowsecurity: true });
});
it('keeps another authenticated owner isolated by existing RLS and captured identity', async () => {
    const other = '33333333-3333-4333-8333-333333333333', foreign = '55555555-5555-4555-8555-555555555555';
    await database.query('insert into auth.users(id) values($1) on conflict do nothing', [other]);
    await database.query("insert into public.marketing_accounts(id,user_id,brand,platform,remote_account_id,handle) values($1,$2,'dneskai','instagram','17841400000000002','foreign') on conflict(id) do nothing", [foreign, other]);
    const reply = await authenticated.rpc('read_owned_marketing_accounts', { p_owner: owner });
    expect(reply.error).toBeNull();
    expect(reply.data.accounts.map((row: {
        id: string;
    }) => row.id)).toEqual([id]);
    expect(JSON.stringify(reply.data)).not.toContain(foreign);
});
it('preserves populated accounts, token metadata and table privileges through canonical upgrade/rollback', async () => {
    const preserved = () => database.query<{
        accounts: unknown;
        tokens: unknown;
        acl: unknown;
    }>("select (select jsonb_agg(jsonb_build_object('id',id,'handle',handle,'enabled',enabled) order by id) from public.marketing_accounts) as accounts,(select jsonb_agg(jsonb_build_object('id',account_id,'expires',expires_at,'hash',md5(access_token)) order by account_id) from public.marketing_account_tokens) as tokens,(select relacl::text from pg_class where oid='public.marketing_account_tokens'::regclass) as acl"), before = await preserved(), migration = readFileSync('supabase/migrations/20261027194255_confirmed_marketing_account_snapshot.sql', 'utf8');
    await database.exec('begin;drop function public.read_owned_marketing_accounts(uuid);');
    try {
        await database.exec(migration);
        expect(await preserved()).toEqual(before);
    }
    finally {
        await database.exec('rollback');
    }
    expect(await preserved()).toEqual(before);
    expect((await authenticated.rpc('read_owned_marketing_accounts', { p_owner: owner })).error).toBeNull();
    await database.exec('begin;drop function public.read_owned_marketing_accounts(uuid);');
    try {
        await expect(database.exec(migration + ';select 1/0;')).rejects.toThrow();
    }
    finally {
        await database.exec('rollback');
    }
    expect(await preserved()).toEqual(before);
    expect((await authenticated.rpc('read_owned_marketing_accounts', { p_owner: owner })).error).toBeNull();
});
it('projects the exact current microsecond account version through the private snapshot', async () => {
    const version = '2026-10-27T10:00:00.123456Z';
    await database.query('update public.marketing_accounts set updated_at=$1 where id=$2', [version, id]);
    const expected = (await database.query<{ version: string }>("select to_jsonb(a)->>'updated_at' as version from public.marketing_accounts a where id=$1", [id])).rows[0].version;
    const reply = await authenticated.rpc('read_owned_marketing_accounts', { p_owner: owner });
    expect(reply.error).toBeNull(); expect(reply.data.accounts[0].updated_at).toBe(expected);
});
it('upgrades the existing snapshot with versions without changing rows, credentials or table privileges', async () => {
    const prior = readFileSync('supabase/migrations/20261027194255_confirmed_marketing_account_snapshot.sql', 'utf8');
    const migration = readFileSync('supabase/migrations/20261027202033_versioned_marketing_account_snapshot.sql', 'utf8');
    const preserved = () => database.query("select (select jsonb_agg(to_jsonb(a) order by id) from public.marketing_accounts a) accounts,(select jsonb_agg(jsonb_build_object('id',account_id,'expiry',expires_at,'hash',md5(access_token)) order by account_id) from public.marketing_account_tokens) tokens,(select jsonb_agg(jsonb_build_object('name',relname,'acl',relacl::text) order by relname) from pg_class where oid in('public.marketing_accounts'::regclass,'public.marketing_account_tokens'::regclass)) acl");
    const before = await preserved();
    await database.exec('begin;drop function public.read_owned_marketing_accounts(uuid);');
    try {
        await database.exec(prior);
        expect((await authenticated.rpc('read_owned_marketing_accounts', { p_owner: owner })).data.accounts[0]).not.toHaveProperty('updated_at');
        await database.exec(migration);
        expect((await authenticated.rpc('read_owned_marketing_accounts', { p_owner: owner })).data.accounts[0].updated_at).toEqual(expect.any(String));
        expect(await preserved()).toEqual(before);
    } finally { await database.exec('rollback'); }
    await database.exec('begin;drop function public.read_owned_marketing_accounts(uuid);');
    try { await database.exec(prior); await expect(database.exec(migration + ';select 1/0;')).rejects.toThrow(); }
    finally { await database.exec('rollback'); }
    expect(await preserved()).toEqual(before);
    expect((await authenticated.rpc('read_owned_marketing_accounts', { p_owner: owner })).error).toBeNull();
});
