import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import { databaseVersion } from '@/lib/database-version';
vi.mock('server-only', () => ({}));
const owner = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222', version = '2026-10-27T10:00:00.000001Z';
let database: Awaited<ReturnType<typeof createMigratedDatabase>>, service: SupabaseClient, authenticated: SupabaseClient, anonymous: SupabaseClient;
beforeAll(async () => {
    database = await createMigratedDatabase({ owner, instant: version });
    const origin = 'https://account-toggle.supabase.co', emulator = new SupabaseEmulator(database, origin, { service: 'TEST-ONLY-service', users: { [owner]: 'TEST-ONLY-owner' } }), options = { global: { fetch: emulator.fetch.bind(emulator) }, auth: { persistSession: false, autoRefreshToken: false } };
    service = createClient(origin, 'TEST-ONLY-service', options);
    anonymous = createClient(origin, 'TEST-ONLY-anon', options);
    authenticated = createClient(origin, 'TEST-ONLY-anon', { ...options, global: { ...options.global, headers: { Authorization: 'Bearer TEST-ONLY-owner' } } });
}, 120000);
afterAll(async () => database?.close());
beforeEach(async () => {
    await database.exec('drop trigger if exists zz_test_account_clobber on public.marketing_accounts');
    await database.query('delete from public.marketing_accounts where user_id=$1', [owner]);
    await database.query("insert into public.marketing_accounts(id,user_id,brand,platform,remote_account_id,handle,verified_at,enabled,engagement_enabled,engagement_blocked_code,engagement_blocked_at,updated_at) values($1,$2,'dneskai','instagram','17841400000000001','dneskai',$3,false,false,'engagement-messaging-disabled',$3,$3)", [id, owner, version]);
    await database.query("insert into public.marketing_account_tokens(account_id,user_id,access_token,expires_at,refreshed_at,scopes,login_mode) values($1,$2,'TEST_ONLY_DATABASE_FIXTURE_TOKEN','2099-01-01T00:00:00Z',$3,array['instagram_business_basic','instagram_business_manage_comments'],'instagram')", [id, owner, version]);
});
const command = (patch: Record<string, unknown> = {}) => ({ p_owner: owner, p_id: id, p_expected_at: version, p_switch: 'publishing', p_enabled: true, ...patch });
const stored = () => database.query<{
    row: Record<string, unknown>;
}>('select to_jsonb(a) as row from public.marketing_accounts a where id=$1', [id]);
it.each(['publishing', 'engagement'])('confirms the exact captured %s transition without exposing metadata or credentials', async (p_switch) => {
    const reply = await service.rpc('toggle_owned_marketing_account', command({ p_switch }));
    expect(reply.error).toBeNull();
    expect(reply.data).toMatchObject({ kind: 'saved', ownerId: owner, id, switch: p_switch, requestedEnabled: true });
    expect(databaseVersion(reply.data.updatedAt)! > databaseVersion(version)!).toBe(true);
    expect(Object.keys(reply.data).sort()).toEqual(['expectedVersion', 'id', 'kind', 'ownerId', 'requestedEnabled', 'switch', 'updatedAt']);
    const row = (await stored()).rows[0].row;
    expect(row[p_switch === 'publishing' ? 'enabled' : 'engagement_enabled']).toBe(true);
    if (p_switch === 'engagement') {
        expect(row.engagement_blocked_code).toBeNull();
        expect(row.engagement_blocked_at).toBeNull();
    }
    expect(JSON.stringify(reply.data)).not.toContain('TEST_ONLY');
});
it.each(['publishing', 'engagement'])('refuses stale %s intent without changing newer owner work', async (p_switch) => {
    await database.query("update public.marketing_accounts set handle='newer' where id=$1", [id]);
    const before = await stored(), reply = await service.rpc('toggle_owned_marketing_account', command({ p_switch }));
    expect(reply.error).toBeNull();
    expect(reply.data.kind).toBe('changed');
    expect(await stored()).toEqual(before);
});
it.each(['publishing', 'engagement'])('allows captured %s disabling without reading unavailable token metadata', async (p_switch) => {
    await database.query('delete from public.marketing_account_tokens where account_id=$1', [id]);
    const reply = await service.rpc('toggle_owned_marketing_account', command({ p_switch, p_enabled: false }));
    expect(reply.error).toBeNull();
    expect(reply.data).toMatchObject({ kind: 'saved', switch: p_switch, requestedEnabled: false });
});
it.each([{ patch: 'verified_at=null', tokenPatch: null, code: 'account-not-verified' }, { patch: null, tokenPatch: 'delete', code: 'access-token-missing' }, { patch: null, tokenPatch: "expires_at='2000-01-01T00:00:00Z'", code: 'access-token-expired' }])('blocks current publishing ineligibility: $code', async ({ patch, tokenPatch, code }) => {
    if (patch)
        await database.query('update public.marketing_accounts set ' + patch + ' where id=$1', [id]);
    if (tokenPatch === 'delete')
        await database.query('delete from public.marketing_account_tokens where account_id=$1', [id]);
    else if (tokenPatch)
        await database.query('update public.marketing_account_tokens set ' + tokenPatch + ' where account_id=$1', [id]);
    const row = (await stored()).rows[0].row, before = await stored(), reply = await service.rpc('toggle_owned_marketing_account', command({ p_expected_at: row.updated_at }));
    expect(reply.error).toBeNull();
    expect(reply.data).toMatchObject({ kind: 'blocked', code });
    expect(await stored()).toEqual(before);
});
it('checks the current engagement scopes inside the write boundary', async () => {
    await database.query("update public.marketing_account_tokens set scopes=array['instagram_business_basic'] where account_id=$1", [id]);
    const before = await stored(), reply = await service.rpc('toggle_owned_marketing_account', command({ p_switch: 'engagement' }));
    expect(reply.error).toBeNull();
    expect(reply.data).toMatchObject({ kind: 'blocked', code: 'engagement-scopes-unverified' });
    expect(await stored()).toEqual(before);
});
it('uses the established Facebook engagement permissions for a Facebook token', async () => {
    await database.query("update public.marketing_account_tokens set login_mode='facebook',scopes=array['instagram_basic','instagram_manage_comments','pages_messaging'] where account_id=$1", [id]);
    const reply = await service.rpc('toggle_owned_marketing_account', command({ p_switch: 'engagement' }));
    expect(reply.error).toBeNull();
    expect(reply.data.kind).toBe('saved');
});
it.each([{ p_owner: null }, { p_id: null }, { p_expected_at: null }, { p_expected_at: 'infinity' }, { p_expected_at: '-infinity' }, { p_switch: null }, { p_switch: 'unknown' }, { p_enabled: null }])('refuses malformed captured intent: %#', async (patch) => {
    const before = await stored(), reply = await service.rpc('toggle_owned_marketing_account', command(patch));
    expect(reply.error?.code).toBe('22023');
    expect(await stored()).toEqual(before);
});
it('keeps execution service-only and foreign/absent account identity unavailable', async () => {
    for (const actor of [authenticated, anonymous])
        expect((await actor.rpc('toggle_owned_marketing_account', command())).error?.code).toBe('42501');
    for (const patch of [{ p_owner: '33333333-3333-4333-8333-333333333333' }, { p_id: '33333333-3333-4333-8333-333333333333' }])
        expect((await service.rpc('toggle_owned_marketing_account', command(patch))).data).toMatchObject({ kind: 'absent', updatedAt: null });
});
it('advances the version through no-op and caller-backdated updates', async () => {
    const one = (await stored()).rows[0].row.updated_at as string;
    await database.query("update public.marketing_accounts set updated_at='2000-01-01T00:00:00Z' where id=$1", [id]);
    const two = (await stored()).rows[0].row.updated_at as string;
    await database.query('update public.marketing_accounts set enabled=enabled where id=$1', [id]);
    const three = (await stored()).rows[0].row.updated_at as string;
    expect(databaseVersion(two)! > databaseVersion(one)!).toBe(true);
    expect(databaseVersion(three)! > databaseVersion(two)!).toBe(true);
});
it.each(['before', 'after'])('rolls back a %s trigger that changes the requested state', async (timing) => {
    await database.exec(`create or replace function public.test_account_clobber() returns trigger language plpgsql as $$begin ${timing === 'before' ? 'new.enabled:=false;return new;' : "if new.enabled then update public.marketing_accounts set enabled=false where id=new.id;end if;return new;"}end$$;create trigger zz_test_account_clobber ${timing} update on public.marketing_accounts for each row execute function public.test_account_clobber();`);
    const before = await stored(), reply = await service.rpc('toggle_owned_marketing_account', command());
    expect(reply.error).toMatchObject({ code: '40001', message: 'Account control unconfirmed' });
    expect(await stored()).toEqual(before);
});
it('returns changed for an uncertain original retry instead of silently writing again', async () => {
    const first = await service.rpc('toggle_owned_marketing_account', command());
    expect(first.data.kind).toBe('saved');
    const before = await stored(), second = await service.rpc('toggle_owned_marketing_account', command());
    expect(second.data.kind).toBe('changed');
    expect(await stored()).toEqual(before);
});
it('retains a blocked account reason on disable and scopes engagement to DNESKAi Instagram', async () => {
    const disabled = await service.rpc('toggle_owned_marketing_account', command({ p_switch: 'engagement', p_enabled: false }));
    expect(disabled.data.kind).toBe('saved');
    expect((await stored()).rows[0].row.engagement_blocked_code).toBe('engagement-messaging-disabled');
    await database.query("update public.marketing_accounts set brand='devshark' where id=$1", [id]);
    const before = await stored(), reply = await service.rpc('toggle_owned_marketing_account', command({ p_switch: 'engagement', p_expected_at: before.rows[0].row.updated_at }));
    expect(reply.data.kind).toBe('absent');
    expect(await stored()).toEqual(before);
});
it.each(["expires_at='infinity'", "scopes=array['instagram_business_basic','instagram_business_basic']"])('refuses unavailable current metadata rather than inventing eligibility: %s', async (patch) => {
    await database.query('update public.marketing_account_tokens set ' + patch + ' where account_id=$1', [id]);
    const before = await stored(), reply = await service.rpc('toggle_owned_marketing_account', command());
    expect(reply.error).toMatchObject({ code: '40001', message: 'Account control unconfirmed' });
    expect(await stored()).toEqual(before);
});
it('rolls back a suppressed update and an unrelated trigger change', async () => {
    for (const implementation of ['return null;', "new.handle:='TEST_ONLY_UNREQUESTED_CHANGE';return new;"]) {
        await database.exec('drop trigger if exists zz_test_account_clobber on public.marketing_accounts');
        await database.exec(`create or replace function public.test_account_clobber() returns trigger language plpgsql as $$begin ${implementation}end$$;create trigger zz_test_account_clobber before update on public.marketing_accounts for each row execute function public.test_account_clobber();`);
        const before = await stored(), reply = await service.rpc('toggle_owned_marketing_account', command());
        expect(reply.error?.code).toBe('40001');
        expect(await stored()).toEqual(before);
    }
});
it('refuses a changed future private field and excludes it from receipts', async () => {
    await database.exec("alter table public.marketing_accounts add column audit_private_note text default 'TEST_ONLY_PRIVATE_ACCOUNT_NOTE';");
    try {
        const saved = await service.rpc('toggle_owned_marketing_account', command());
        expect(saved.data.kind).toBe('saved');
        expect(JSON.stringify(saved.data)).not.toContain('TEST_ONLY_PRIVATE_ACCOUNT_NOTE');
        await database.exec("create or replace function public.test_account_clobber() returns trigger language plpgsql as $$begin new.audit_private_note:='TEST_ONLY_UNREQUESTED_CHANGE';return new;end$$;create trigger zz_test_account_clobber before update on public.marketing_accounts for each row execute function public.test_account_clobber();");
        const before = await stored(), reply = await service.rpc('toggle_owned_marketing_account', command({ p_expected_at: saved.data.updatedAt, p_enabled: false }));
        expect(reply.error?.code).toBe('40001');
        expect(await stored()).toEqual(before);
    }
    finally {
        await database.exec('drop trigger if exists zz_test_account_clobber on public.marketing_accounts;alter table public.marketing_accounts drop column audit_private_note;');
    }
});
it.each(['infinity', '-infinity', '10000-01-01T00:00:00Z'])('rejects an unsupported initial account version: %s', async (value) => {
    await expect(database.query("insert into public.marketing_accounts(id,user_id,brand,platform,remote_account_id,handle,updated_at) values('33333333-3333-4333-8333-333333333333',$1,'devshark','instagram','17841400000000002','invalid',$2)", [owner, value])).rejects.toThrow();
});
it('preserves populated account/token data and table grants through successful and failed upgrade rollback', async () => {
    const preserved = () => database.query("select (select jsonb_agg(to_jsonb(a)-'updated_at' order by id) from public.marketing_accounts a) as accounts,(select jsonb_agg(jsonb_build_object('id',account_id,'hash',md5(access_token),'expires',expires_at) order by account_id) from public.marketing_account_tokens) as tokens,(select relacl::text from pg_class where oid='public.marketing_account_tokens'::regclass) as acl"), before = await preserved(), migration = readFileSync('supabase/migrations/20261027195903_captured_marketing_account_switches.sql', 'utf8'), drop = 'drop function public.toggle_owned_marketing_account(uuid,uuid,timestamptz,text,boolean);drop trigger marketing_account_version_touch on public.marketing_accounts;drop function public.marketing_account_version_touch();alter table public.marketing_accounts drop column updated_at;';
    for (const fail of [false, true]) {
        await database.exec('begin;' + drop);
        try {
            if (fail)
                await expect(database.exec(migration + ';select 1/0;')).rejects.toThrow();
            else {
                await database.exec(migration);
                expect(await preserved()).toEqual(before);
            }
        }
        finally {
            await database.exec('rollback');
        }
        expect(await preserved()).toEqual(before);
    }
    expect((await service.rpc('toggle_owned_marketing_account', command())).data.kind).toBe('saved');
});
