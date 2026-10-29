import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import { verifyInstagramAccount } from '@/lib/marketing/meta-account';
vi.mock('server-only', () => ({}));
const owner = '11111111-1111-4111-8111-111111111111', remote = '17841400000000001';
const env = { MARKETING_OWNER_ID: owner, MARKETING_DNESKAI_INSTAGRAM_ACCESS_TOKEN: 'TEST-ONLY-BOOTSTRAP-TOKEN-000001', MARKETING_DNESKAI_INSTAGRAM_TOKEN_EXPIRES_AT: '2099-01-01T00:00:00Z', MARKETING_DNESKAI_INSTAGRAM_VERIFIED_SCOPES: 'instagram_business_basic,instagram_business_content_publish', MARKETING_DNESKAI_INSTAGRAM_LOGIN_MODE: 'instagram', MARKETING_DNESKAI_INSTAGRAM_API_VERSION: 'v24.0' };
let database: Awaited<ReturnType<typeof createMigratedDatabase>>, emulator: SupabaseEmulator;
beforeAll(async () => { database = await createMigratedDatabase({ owner, instant: '2026-10-27T10:00:00Z' }); emulator = new SupabaseEmulator(database, 'https://verify-account.supabase.co', { service: 'TEST-ONLY-service', users: {} }); }, 120000);
afterAll(async () => database?.close());
beforeEach(async () => database.query('delete from public.marketing_accounts where user_id=$1', [owner]));
const client = (fetcher: typeof fetch) => createClient('https://verify-account.supabase.co', 'TEST-ONLY-service', { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } });
const profile = () => Response.json({ user_id: remote, username: 'dneskai', account_type: 'BUSINESS' });
it('verifies once through actual SDK and canonical transaction, starting a new account disabled', async () => {
 const calls: string[] = [], fetcher: typeof fetch = async (input, init) => { calls.push(new URL(String(input)).pathname); return emulator.fetch(input, init); };
 const provider = vi.fn(async () => profile()), result = await verifyInstagramAccount(client(fetcher), owner, 'dneskai', { env, fetcher: provider });
 expect(result).toMatchObject({ brand: 'dneskai', platform: 'instagram', handle: 'dneskai', enabled: false, tokenStored: true }); expect(JSON.stringify(result)).not.toContain('TEST-ONLY'); expect(provider).toHaveBeenCalledOnce();
 expect(calls).toEqual(['/rest/v1/marketing_accounts', '/rest/v1/rpc/verify_owned_marketing_account']);
 expect((await database.query<{ enabled: boolean; remote_account_id: string }>('select enabled,remote_account_id from public.marketing_accounts where id=$1', [result.accountId])).rows[0]).toEqual({ enabled: false, remote_account_id: remote });
});
it('does not replay an unavailable SDK account read or reach the provider', async () => {
 const fetcher = vi.fn(async () => Response.json({ message: 'TEST_ONLY_PRIVATE_DATABASE_DETAIL' }, { status: 503, headers: { 'Retry-After': '0' } })), provider = vi.fn(async () => profile());
 await expect(verifyInstagramAccount(client(fetcher), owner, 'dneskai', { env, fetcher: provider })).rejects.toMatchObject({ code: 'credential-store-unavailable' }); expect(fetcher).toHaveBeenCalledOnce(); expect(provider).not.toHaveBeenCalled();
});
it('keeps a lost write acknowledgement unconfirmed and never automatically repeats the committed transaction', async () => {
 let writes = 0; const fetcher: typeof fetch = async (input, init) => { const reply = await emulator.fetch(input, init); if (new URL(String(input)).pathname.endsWith('/verify_owned_marketing_account')) { writes++; throw new Error('TEST_ONLY_PRIVATE_LOST_ACK'); } return reply; };
 await expect(verifyInstagramAccount(client(fetcher), owner, 'dneskai', { env, fetcher: async () => profile() })).rejects.toMatchObject({ code: 'account-store-failed' }); expect(writes).toBe(1);
 expect((await database.query('select id,enabled from public.marketing_accounts where user_id=$1', [owner])).rows).toHaveLength(1);
});
