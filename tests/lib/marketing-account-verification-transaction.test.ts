import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
const owner = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222', other = '33333333-3333-4333-8333-333333333333';
const token = 'TEST_ONLY_CAPTURED_DATABASE_TOKEN', incoming = 'TEST_ONLY_NEW_BOOTSTRAP_TOKEN', instant = '2026-10-27T10:00:00Z', expiry = '2099-01-01T00:00:00Z', scopes = ['instagram_business_basic', 'instagram_business_content_publish'];
let database: Awaited<ReturnType<typeof createMigratedDatabase>>, service: SupabaseClient, authenticated: SupabaseClient, anonymous: SupabaseClient;
beforeAll(async () => {
 database = await createMigratedDatabase({ owner, instant }); const origin = 'https://captured-verification.supabase.co', emulator = new SupabaseEmulator(database, origin, { service: 'TEST-ONLY-service', users: { [owner]: 'TEST-ONLY-owner' } });
 const options = { global: { fetch: emulator.fetch.bind(emulator) }, auth: { persistSession: false, autoRefreshToken: false } };
 service = createClient(origin, 'TEST-ONLY-service', options); anonymous = createClient(origin, 'TEST-ONLY-anon', options); authenticated = createClient(origin, 'TEST-ONLY-anon', { ...options, global: { ...options.global, headers: { Authorization: 'Bearer TEST-ONLY-owner' } } });
}, 120000);
afterAll(async () => database?.close());
beforeEach(async () => {
 await database.query('delete from public.marketing_accounts where user_id=$1', [owner]);
 await database.query("insert into public.marketing_accounts(id,user_id,brand,platform,remote_account_id,handle,verified_at,enabled,engagement_enabled) values($1,$2,'dneskai','instagram','17841400000000001','dneskai',$3,true,true)", [id, owner, instant]);
 await database.query("insert into public.marketing_account_tokens(account_id,user_id,access_token,expires_at,refreshed_at,scopes,login_mode) values($1,$2,$3,$4,$5,$6,'instagram')", [id, owner, token, expiry, instant, scopes]);
});
async function input() {
 const version = (await database.query<{ version: string }>("select to_jsonb(a)->>'updated_at' version from public.marketing_accounts a where id=$1", [id])).rows[0]?.version;
 const stored = await service.rpc('marketing_read_account_token', { p_owner: owner, p_account: id }); if (stored.error) throw new Error('Fixture credential unavailable'); const t = stored.data[0];
 return { p_owner: owner, p_expected_id: version ? id : null, p_expected_at: version ?? null, p_expected_token: t ? { tokenHash: createHash('sha256').update(t.access_token).digest('hex'), expiresAt: t.expires_at, refreshedAt: t.refreshed_at, scopes: t.scopes, loginMode: t.login_mode } : null,
 p_brand: 'dneskai', p_platform: 'instagram', p_remote_account_id: '17841400000000001', p_handle: 'dneskai', p_token: incoming, p_expires_at: expiry, p_scopes: scopes, p_login_mode: 'instagram' };
}
const call = (value: Awaited<ReturnType<typeof input>>, db = service) => db.rpc('verify_owned_marketing_account', value);
const state = () => database.query<{accounts:unknown;tokens:unknown}>("select (select jsonb_agg(to_jsonb(a) order by id) from public.marketing_accounts a where user_id=$1) accounts,(select jsonb_agg(jsonb_build_object('id',account_id,'hash',md5(access_token),'expires',expires_at,'refreshed',refreshed_at,'scopes',scopes,'mode',login_mode) order by account_id) from public.marketing_account_tokens where user_id=$1) tokens", [owner]);
it('verifies the exact current account and token, preserves both switches and emits no credential or fingerprint', async () => {
 const captured = await input(), result = await call(captured); expect(result.error).toBeNull(); expect(result.data).toMatchObject({ kind: 'verified', ownerId: owner, expectedId: id, expectedVersion: captured.p_expected_at, id, result: { accountId: id, remoteAccountId: captured.p_remote_account_id, handle: 'dneskai', enabled: true, tokenStored: true } });
 expect(JSON.stringify(result.data)).not.toContain('TEST_ONLY'); expect(JSON.stringify(result.data)).not.toContain('tokenHash'); expect((await database.query('select enabled,engagement_enabled from public.marketing_accounts where id=$1', [id])).rows[0]).toEqual({ enabled: true, engagement_enabled: true });
});
it('creates a captured absent account disabled for publishing and replies', async () => {
 await database.query('delete from public.marketing_accounts where id=$1', [id]); const result = await call(await input()); expect(result.error).toBeNull(); expect(result.data).toMatchObject({ kind: 'verified', expectedId: null, expectedVersion: null, result: { enabled: false } }); expect((await database.query('select enabled,engagement_enabled from public.marketing_accounts where user_id=$1', [owner])).rows[0]).toEqual({ enabled: false, engagement_enabled: false });
});
it('disables both old switches only when the remote identity changes', async () => {
 const captured = { ...await input(), p_remote_account_id: '17841400000000002' }, result = await call(captured); expect(result.error).toBeNull(); expect(result.data.result.enabled).toBe(false); expect((await database.query('select enabled,engagement_enabled from public.marketing_accounts where id=$1', [id])).rows[0]).toEqual({ enabled: false, engagement_enabled: false });
});
it.each(['account', 'deleted', 'recreated', 'credential', 'metadata'] as const)('refuses captured intent after %s changes without rewriting current state', async kind => {
 const captured = await input();
 if (kind === 'account') await database.query("update public.marketing_accounts set handle='newer' where id=$1", [id]);
 if (kind === 'deleted' || kind === 'recreated') await database.query('delete from public.marketing_accounts where id=$1', [id]);
 if (kind === 'recreated') await database.query("insert into public.marketing_accounts(id,user_id,brand,platform,remote_account_id,handle) values($1,$2,'dneskai','instagram','17841400000000009','newer')", [other, owner]);
 if (kind === 'credential') await database.query("update public.marketing_account_tokens set access_token='TEST_ONLY_ROTATED_DATABASE_TOKEN' where account_id=$1", [id]);
 if (kind === 'metadata') await database.query("update public.marketing_account_tokens set scopes=array['instagram_business_basic'] where account_id=$1", [id]);
 const before = await state(), result = await call(captured); expect(result.error).toBeNull(); expect(result.data.kind).toBe('changed'); expect(await state()).toEqual(before);
});
it('refuses a formerly absent account that now exists', async () => {
 await database.query('delete from public.marketing_accounts where id=$1', [id]); const captured = await input(); await database.query("insert into public.marketing_accounts(id,user_id,brand,platform,remote_account_id,handle) values($1,$2,'dneskai','instagram','17841400000000009','newer')", [other, owner]); const before = await state(), result = await call(captured); expect(result.error).toBeNull(); expect(result.data.kind).toBe('changed'); expect(await state()).toEqual(before);
});
it('retains a newer credential when the captured current credential expires later than the supplied bootstrap', async () => {
 const captured = { ...await input(), p_expires_at: '2098-01-01T00:00:00Z' }, before = await state(), result = await call(captured); expect(result.error).toBeNull(); expect(result.data.result.tokenStored).toBe(false); expect((await state()).rows[0].tokens).toEqual(before.rows[0].tokens);
});
it.each(['anonymous', 'authenticated'] as const)('denies %s execution without changing rows', async kind => {
 const before = await state(), result = await call(await input(), kind === 'anonymous' ? anonymous : authenticated); expect(result.error?.code).toBe('42501'); expect(await state()).toEqual(before);
});
it('preserves populated rows, credential history and table privileges through canonical upgrade/rollback', async () => {
 const migration = readFileSync('supabase/migrations/20261027212131_captured_marketing_account_verification.sql', 'utf8'), before = await state(), signature = 'public.verify_owned_marketing_account(uuid,uuid,timestamptz,jsonb,text,text,text,text,text,timestamptz,text[],text)';
 const grants = () => database.query("select relname,relacl::text from pg_class where oid in('public.marketing_accounts'::regclass,'public.marketing_account_tokens'::regclass) order by relname"), previous = await grants();
 await database.exec('begin;drop function ' + signature + ';'); try { await database.exec(migration); expect(await state()).toEqual(before); expect(await grants()).toEqual(previous); } finally { await database.exec('rollback'); }
 await database.exec('begin;drop function ' + signature + ';'); try { await expect(database.exec(migration + ';select 1/0;')).rejects.toThrow(); } finally { await database.exec('rollback'); }
 expect(await state()).toEqual(before); expect(await grants()).toEqual(previous);
});
it('detects a credential added after a captured tokenless account read', async () => {
 await database.query('delete from public.marketing_account_tokens where account_id=$1', [id]); const captured = await input(); await database.query("insert into public.marketing_account_tokens(account_id,user_id,access_token,expires_at,refreshed_at,scopes,login_mode) values($1,$2,$3,$4,$5,$6,'instagram')", [id, owner, token, expiry, instant, scopes]); const before = await state(), result = await call(captured); expect(result.error).toBeNull(); expect(result.data.kind).toBe('changed'); expect(await state()).toEqual(before);
});
it('accepts equivalent full timestamp spellings in the private capture', async () => {
 const captured = await input(); captured.p_expected_token!.refreshedAt = '2026-10-27T12:00:00.000000+02:00'; captured.p_expected_token!.expiresAt = '2099-01-01T02:00:00+02:00'; expect((await call(captured)).error).toBeNull();
});
it.each([
 { p_owner: null }, { p_brand: 'devshark' }, { p_platform: 'threads' }, { p_expected_at: null },
 { p_expires_at: 'infinity' }, { p_expires_at: '2000-01-01T00:00:00Z' }, { p_scopes: [...scopes, scopes[0]] }, { p_scopes: ['instagram_business_basic'] },
 { p_scopes: [scopes] }, { p_token: 'short' }, { p_login_mode: 'threads' },
 { p_expected_token: {} }, { p_expected_token: { tokenHash: 'bad', expiresAt: expiry, refreshedAt: instant, scopes, loginMode: 'instagram' } },
])('refuses malformed captured/input state without a write: %#', async patch => {
 const captured = { ...await input(), ...patch }, before = await state(), result = await call(captured as Awaited<ReturnType<typeof input>>); expect(result.error?.code).toBe('22023'); expect(JSON.stringify(result.error)).not.toContain('TEST_ONLY'); expect(await state()).toEqual(before);
});
it.each([
 { label: 'suppressed account update', sql: "create function public.synthetic_verification_fault() returns trigger language plpgsql as $$begin return null;end$$;create trigger synthetic_verification_fault before update on public.marketing_accounts for each row execute function public.synthetic_verification_fault();", table: 'marketing_accounts' },
 { label: 'rewritten account handle', sql: "create function public.synthetic_verification_fault() returns trigger language plpgsql as $$begin if pg_trigger_depth()=1 then update public.marketing_accounts set handle='trigger_rewrite' where id=new.id;end if;return new;end$$;create trigger synthetic_verification_fault after update on public.marketing_accounts for each row execute function public.synthetic_verification_fault();", table: 'marketing_accounts' },
 { label: 'suppressed credential write', sql: "create function public.synthetic_verification_fault() returns trigger language plpgsql as $$begin return null;end$$;create trigger synthetic_verification_fault before update on public.marketing_account_tokens for each row execute function public.synthetic_verification_fault();", table: 'marketing_account_tokens' },
 { label: 'rewritten credential with matching public metadata', sql: "create function public.synthetic_verification_fault() returns trigger language plpgsql as $$begin if pg_trigger_depth()=1 then update public.marketing_account_tokens set access_token='TEST_ONLY_AFTER_TRIGGER_DIFFERENT_TOKEN' where account_id=new.account_id;end if;return new;end$$;create trigger synthetic_verification_fault after update on public.marketing_account_tokens for each row execute function public.synthetic_verification_fault();", table: 'marketing_account_tokens' },
 { label: 'private trigger diagnostics', sql: "create function public.synthetic_verification_fault() returns trigger language plpgsql as $$begin raise exception 'TEST_ONLY_PRIVATE_TRIGGER_DETAIL';end$$;create trigger synthetic_verification_fault before update on public.marketing_account_tokens for each row execute function public.synthetic_verification_fault();", table: 'marketing_account_tokens' },
])('rolls the entire verification back after $label', async ({ sql, table }) => {
 const captured = await input(), before = await state(); await database.exec(sql);
 try { const result = await call(captured); expect(result.error).toMatchObject({ code: '40001', message: 'Account verification unconfirmed' }); expect(JSON.stringify(result.error)).not.toContain('TEST_ONLY'); expect(await state()).toEqual(before); }
 finally { await database.exec(`drop trigger synthetic_verification_fault on public.${table};drop function public.synthetic_verification_fault();`); }
});
it('preserves future and unrelated account fields after an altered write', async () => {
 await database.exec("alter table public.marketing_accounts add column synthetic_future text not null default 'retained';create function public.synthetic_verification_fault() returns trigger language plpgsql as $$begin new.synthetic_future:='changed';return new;end$$;create trigger synthetic_verification_fault before update on public.marketing_accounts for each row execute function public.synthetic_verification_fault();");
 try { const before = await state(), result = await call(await input()); expect(result.error?.code).toBe('40001'); expect(await state()).toEqual(before); }
 finally { await database.exec('drop trigger synthetic_verification_fault on public.marketing_accounts;drop function public.synthetic_verification_fault();alter table public.marketing_accounts drop column synthetic_future;'); }
});
