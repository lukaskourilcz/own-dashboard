import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Real migration SQL in an isolated WASM database. Token values are synthetic
// fixtures and never reach Meta.
let db: PGlite;
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const bootstrap = 'TEST-ONLY-BOOTSTRAP-TOKEN-0001';
const refreshed = 'TEST-ONLY-REFRESHED-TOKEN-0002';
const scopes = '{instagram_business_basic,instagram_business_content_publish}';
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
let accountId: string;
async function as(role: 'authenticated' | 'anon' | 'service_role', sub: string | null, run: () => Promise<unknown>) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [sub ?? '']);
  await db.exec(`set role ${role}`);
  try { return await run(); } finally { await db.exec('reset role'); }
}
async function verify(token: string, expiresAt: string, remoteId = '17841400000000001', handle = 'dneskai', user = owner) {
  return as('service_role', null, async () => (await db.query<{ v: Record<string, unknown> }>(
    "select marketing_verify_account($1,'dneskai','instagram',$2,$3,$4,$5,$6,'instagram') v", [user, remoteId, handle, token, expiresAt, scopes])).rows[0].v) as Promise<Record<string, unknown>>;
}
async function readToken(user = owner, account = accountId) {
  return as('service_role', null, async () => (await db.query<{ access_token: string; expires_at: Date; refreshed_at: Date }>(
    'select * from marketing_read_account_token($1,$2)', [user, account])).rows) as Promise<Array<{ access_token: string; expires_at: Date; refreshed_at: Date }>>;
}
beforeAll(async () => {
  db = new PGlite();
  // Mirrors Supabase defaults: new tables and functions are granted to API roles unless revoked.
  await db.exec(`create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role;
  alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
  alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  create table public.projects(id uuid primary key,user_id uuid not null);
  create table public.ai_links(id uuid primary key,user_id uuid not null);
  insert into auth.users values('${owner}'),('${other}');`);
  await db.exec(readFileSync('supabase/migrations/20261012225640_marketing_control_surface.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/20261020110000_marketing_account_tokens.sql', 'utf8'));
}, 30000);
afterAll(async () => { await db?.close(); });

describe('marketing account tokens: no direct reads, service-role functions only', () => {
  it('revokes every table privilege and Supabase default function grants', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const { rows } = await db.query<{ s: boolean; i: boolean; u: boolean; c: boolean }>(
        "select has_table_privilege($1,'public.marketing_account_tokens','select') s,has_table_privilege($1,'public.marketing_account_tokens','insert') i,has_table_privilege($1,'public.marketing_account_tokens','update') u,has_column_privilege($1,'public.marketing_account_tokens','access_token','select') c", [role]);
      expect(rows[0], role).toEqual({ s: false, i: false, u: false, c: false });
    }
    expect((await db.query<{ rls: boolean }>("select relrowsecurity rls from pg_class where relname='marketing_account_tokens'")).rows[0].rls).toBe(true);
    expect((await db.query("select * from pg_policies where tablename='marketing_account_tokens'")).rows).toEqual([]);
    for (const signature of ['marketing_verify_account(uuid,text,text,text,text,text,timestamptz,text[],text)', 'marketing_store_account_token(uuid,uuid,timestamptz,text,timestamptz,text[],text)', 'marketing_read_account_token(uuid,uuid)', 'marketing_account_token_metadata(uuid)']) {
      const { rows } = await db.query<{ anon: boolean; authenticated: boolean; service: boolean }>("select has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') authenticated,has_function_privilege('service_role',$1,'EXECUTE') service", [signature]);
      expect(rows[0], signature).toEqual({ anon: false, authenticated: false, service: true });
    }
    const { rows } = await db.query<{ anon: boolean; authenticated: boolean }>("select has_function_privilege('anon','marketing_account_token_status()','EXECUTE') anon,has_function_privilege('authenticated','marketing_account_token_status()','EXECUTE') authenticated");
    expect(rows[0]).toEqual({ anon: false, authenticated: true });
    const check = await db.query<Record<string, boolean>>("select has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') authenticated,has_function_privilege('service_role',$1,'EXECUTE') service", ['marketing_account_token_input_check(text,timestamptz,text[],text)']);
    expect(check.rows[0]).toEqual({ anon: false, authenticated: false, service: false });
  });
  it('round-trips a verified account and its token through service-role functions only', async () => {
    const result = await verify(bootstrap, inDays(50));
    expect(result).toMatchObject({ handle: 'dneskai', remoteAccountId: '17841400000000001', enabled: false, tokenStored: true, token: { loginMode: 'instagram', scopes: ['instagram_business_basic', 'instagram_business_content_publish'] } });
    expect(JSON.stringify(result)).not.toContain(bootstrap);
    accountId = String(result.accountId);
    expect((await db.query<{ verified_at: Date | null; enabled: boolean }>('select verified_at,enabled from marketing_accounts where id=$1', [accountId])).rows[0]).toMatchObject({ enabled: false, verified_at: expect.any(Date) });
    expect((await readToken()).map(row => row.access_token)).toEqual([bootstrap]);
    await expect(as('service_role', null, () => db.query('select access_token from marketing_account_tokens'))).rejects.toThrow(/permission denied/);
    expect(await readToken(other)).toEqual([]);
  });
  it('lets the owner read only non-secret metadata and never the token', async () => {
    await expect(as('authenticated', owner, () => db.query('select * from marketing_account_tokens'))).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', owner, () => db.query('select access_token from marketing_account_tokens'))).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', owner, () => db.query('select * from marketing_read_account_token($1,$2)', [owner, accountId]))).rejects.toThrow(/permission denied/);
    await expect(as('anon', null, () => db.query('select * from marketing_account_token_status()'))).rejects.toThrow(/permission denied/);
    const status = await as('authenticated', owner, async () => (await db.query<Record<string, unknown>>('select * from marketing_account_token_status()')).rows) as Array<Record<string, unknown>>;
    expect(status).toHaveLength(1);
    expect(Object.keys(status[0]).sort()).toEqual(['account_id', 'brand', 'expires_at', 'login_mode', 'platform', 'refreshed_at', 'scopes']);
    expect(JSON.stringify(status)).not.toContain('TEST-ONLY');
  });
  it('shows a foreign principal nothing and rejects foreign writes', async () => {
    expect(await as('authenticated', other, async () => (await db.query('select * from marketing_account_token_status()')).rows)).toEqual([]);
    expect(await as('authenticated', other, async () => (await db.query('select * from marketing_accounts')).rows)).toEqual([]);
    await expect(as('service_role', null, () => db.query('select marketing_store_account_token($1,$2,null,$3,$4,null,$5)', [other, accountId, 'TEST-ONLY-FOREIGN-TOKEN-0003', inDays(30), 'instagram']))).rejects.toThrow('account unavailable');
    await expect(db.query("insert into marketing_account_tokens(account_id,user_id,access_token,expires_at,refreshed_at,login_mode) values($1,$2,'TEST-ONLY-FOREIGN-TOKEN-0004',now()+interval '1 day',now(),'instagram') on conflict(account_id) do update set user_id=excluded.user_id", [accountId, other])).rejects.toThrow('foreign account');
    expect((await readToken()).map(row => row.access_token)).toEqual([bootstrap]);
  });
  it('stores a refresh only with the refreshed_at it read and keeps it over an older bootstrap re-verify', async () => {
    const metadata = await as('service_role', null, async () => (await db.query<{ refreshed_at: string }>('select refreshed_at::text from marketing_account_token_metadata($1)', [owner])).rows) as Array<{ refreshed_at: string }>;
    expect(metadata).toHaveLength(1);
    await expect(as('service_role', null, () => db.query("select marketing_store_account_token($1,$2,'2000-01-01T00:00:00Z',$3,$4,null,'instagram')", [owner, accountId, refreshed, inDays(60)]))).rejects.toThrow('token changed');
    await expect(as('service_role', null, () => db.query("select marketing_store_account_token($1,$2,null,$3,$4,null,'instagram')", [owner, accountId, refreshed, inDays(60)]))).rejects.toThrow('token changed');
    await expect(as('service_role', null, () => db.query("select marketing_store_account_token($1,$2,$3,$4,$5,null,'instagram')", [owner, accountId, metadata[0].refreshed_at, refreshed, inDays(-1)]))).rejects.toThrow('token expired');
    const stored = await as('service_role', null, async () => (await db.query<{ v: Record<string, unknown> }>("select marketing_store_account_token($1,$2,$3,$4,$5,null,'instagram') v", [owner, accountId, metadata[0].refreshed_at, refreshed, inDays(60)])).rows[0].v) as Record<string, unknown>;
    expect(stored).toMatchObject({ accountId, token: { scopes: ['instagram_business_basic', 'instagram_business_content_publish'] } });
    expect((await readToken()).map(row => row.access_token)).toEqual([refreshed]);
    const again = await verify(bootstrap, inDays(50));
    expect(again).toMatchObject({ tokenStored: false, enabled: false });
    expect((await readToken()).map(row => row.access_token)).toEqual([refreshed]);
  });
  it('keeps an enabled account enabled on re-verify and disables it when the remote identity changes', async () => {
    await db.query('update marketing_accounts set enabled=true where id=$1', [accountId]);
    expect(await verify(refreshed, inDays(60))).toMatchObject({ enabled: true });
    const moved = await verify('TEST-ONLY-OTHER-ACCOUNT-0005', inDays(10), '17841400000000002', 'dneskai.cz');
    expect(moved).toMatchObject({ accountId, enabled: false, tokenStored: true, remoteAccountId: '17841400000000002', handle: 'dneskai.cz' });
    expect((await readToken()).map(row => row.access_token)).toEqual(['TEST-ONLY-OTHER-ACCOUNT-0005']);
  });
  it('rejects expired tokens, malformed identities and a Threads login on an Instagram account', async () => {
    await expect(verify('TEST-ONLY-EXPIRED-TOKEN-0006', inDays(-1))).rejects.toThrow('token expired');
    await expect(verify('TEST-ONLY-MALFORMED-TOKEN-07', inDays(5), 'not-numeric')).rejects.toThrow('invalid account');
    await expect(verify('TEST-ONLY-MALFORMED-TOKEN-08', inDays(5), '1', '@dneskai')).rejects.toThrow('invalid account');
    await expect(verify('short', inDays(5))).rejects.toThrow('invalid token');
    await expect(as('service_role', null, () => db.query("select marketing_verify_account($1,'dneskai','instagram','17841400000000002','dneskai.cz','TEST-ONLY-THREADS-TOKEN-0009',$2,'{threads_basic}','threads')", [owner, inDays(5)]))).rejects.toThrow('login mode mismatch');
  });
  it('refuses bad token input with a message and detail that never carry the token', async () => {
    const secret = 'TEST-ONLY-SECRET-TOKEN-VALUE-1';
    const failure = async (run: () => Promise<unknown>) => {
      try { await run(); } catch (error) { const { message, detail, hint, where } = error as { message: string; detail?: string; hint?: string; where?: string }; return { message, text: JSON.stringify({ message, detail, hint, where }) }; }
      throw new Error('expected a refusal');
    };
    const tooMany = `{${Array.from({ length: 21 }, (_, index) => `scope_${String.fromCharCode(97 + index)}`).join(',')}}`;
    const cases: Array<[string, () => Promise<unknown>]> = [
      ['invalid scopes', () => as('service_role', null, () => db.query("select marketing_verify_account($1,'dneskai','instagram','17841400000000002','dneskai.cz',$2,$3,$4,'instagram')", [owner, secret, inDays(5), tooMany]))],
      ['invalid scopes', () => as('service_role', null, () => db.query("select marketing_verify_account($1,'dneskai','instagram','17841400000000002','dneskai.cz',$2,$3,'{Bad-Scope}','instagram')", [owner, secret, inDays(5)]))],
      ['invalid login mode', () => as('service_role', null, () => db.query("select marketing_verify_account($1,'dneskai','instagram','17841400000000002','dneskai.cz',$2,$3,null,'oauth')", [owner, secret, inDays(5)]))],
      ['invalid token', () => as('service_role', null, () => db.query("select marketing_verify_account($1,'dneskai','instagram','17841400000000002','dneskai.cz',$2,$3,null,'instagram')", [owner, `${secret} with space`, inDays(5)]))],
      ['invalid scopes', () => as('service_role', null, () => db.query("select marketing_store_account_token($1,$2,null,$3,$4,$5,'instagram')", [owner, accountId, secret, inDays(5), tooMany]))],
    ];
    for (const [code, run] of cases) {
      const refused = await failure(run);
      expect(refused.message).toBe(code);
      expect(refused.text).not.toContain('TEST-ONLY');
    }
    expect((await readToken()).map(row => row.access_token)).toEqual(['TEST-ONLY-OTHER-ACCOUNT-0005']);
  });
});
