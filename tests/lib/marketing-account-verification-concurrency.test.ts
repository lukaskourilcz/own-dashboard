import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import { verifyInstagramAccount } from '@/lib/marketing/meta-account';
vi.mock('server-only', () => ({}));
const owner = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222', replacement = '33333333-3333-4333-8333-333333333333', remote = '17841400000000001';
const env = { MARKETING_OWNER_ID: owner, MARKETING_DNESKAI_INSTAGRAM_ACCESS_TOKEN: 'TEST-ONLY-BOOTSTRAP-TOKEN-000001', MARKETING_DNESKAI_INSTAGRAM_TOKEN_EXPIRES_AT: '2099-01-01T00:00:00Z', MARKETING_DNESKAI_INSTAGRAM_VERIFIED_SCOPES: 'instagram_business_basic,instagram_business_content_publish', MARKETING_DNESKAI_INSTAGRAM_LOGIN_MODE: 'instagram', MARKETING_DNESKAI_INSTAGRAM_API_VERSION: 'v24.0' };
let database: Awaited<ReturnType<typeof createMigratedDatabase>>, emulator: SupabaseEmulator;
beforeAll(async () => { database = await createMigratedDatabase({ owner, instant: '2026-10-27T10:00:00Z' }); emulator = new SupabaseEmulator(database, 'https://verification-race.supabase.co', { service: 'TEST-ONLY-service', users: {} }); }, 120000);
afterAll(async () => database?.close());
beforeEach(async () => { await database.query('delete from public.marketing_accounts where user_id=$1', [owner]); });
const insert = (key: string, handle: string, enabled = true) => database.query("insert into public.marketing_accounts(id,user_id,brand,platform,remote_account_id,handle,verified_at,enabled) values($1,$2,'dneskai','instagram','17841400000000009',$3,'2026-10-27T09:00:00Z',$4)", [key, owner, handle, enabled]);
const db = () => createClient('https://verification-race.supabase.co', 'TEST-ONLY-service', { global: { fetch: emulator.fetch.bind(emulator) }, auth: { persistSession: false, autoRefreshToken: false } });
const profile = () => Response.json({ user_id: remote, username: 'dneskai', account_type: 'BUSINESS' });
it.each(['changed', 'recreated', 'created'] as const)('does not overwrite an account %s while verification waits for the provider', async kind => {
 if (kind !== 'created') await insert(id, 'dneskai');
 const fetcher = vi.fn(async () => {
  if (kind === 'changed') await database.query("update public.marketing_accounts set handle='newer_reviewed_handle',enabled=true where id=$1", [id]);
  else { if (kind === 'recreated') await database.query('delete from public.marketing_accounts where id=$1', [id]); await insert(replacement, 'newer_reviewed_handle'); }
  return profile();
 });
 const outcome = await verifyInstagramAccount(db(), owner, 'dneskai', { env, fetcher }).catch(error => error);
 const rows = (await database.query('select id,handle,enabled from public.marketing_accounts where user_id=$1', [owner])).rows;
 expect(rows).toEqual([{ id: kind === 'changed' ? id : replacement, handle: 'newer_reviewed_handle', enabled: true }]);
 expect(outcome).toMatchObject({ code: 'account-changed' }); expect(fetcher).toHaveBeenCalledOnce();
});
it('does not replace a rotated credential whose public metadata happens to match the earlier read', async () => {
 await insert(id, 'dneskai');
 await database.query("insert into public.marketing_account_tokens(account_id,user_id,access_token,expires_at,refreshed_at,scopes,login_mode) values($1,$2,'TEST_ONLY_ORIGINAL_DATABASE_TOKEN','2099-01-01T00:00:00Z','2026-10-27T10:00:00Z',array['instagram_business_basic','instagram_business_content_publish'],'instagram')", [id, owner]);
 const fetcher = vi.fn(async () => { await database.query("select public.marketing_store_account_token($1,$2,'2026-10-27T10:00:00Z','TEST_ONLY_ROTATED_DATABASE_TOKEN','2099-01-01T00:00:00Z',array['instagram_business_basic','instagram_business_content_publish'],'instagram')", [owner, id]); return profile(); });
 const outcome = await verifyInstagramAccount(db(), owner, 'dneskai', { env, fetcher }).catch(error => error);
 expect((await database.query<{ retained: boolean }>("select access_token='TEST_ONLY_ROTATED_DATABASE_TOKEN' retained from public.marketing_account_tokens where account_id=$1", [id])).rows[0].retained).toBe(true);
 expect(outcome).toMatchObject({ code: 'account-changed' });
});
