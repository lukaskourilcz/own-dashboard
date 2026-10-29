import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import { refreshInstagramToken } from '@/lib/marketing/meta-credentials';
vi.mock('server-only',()=>({}));
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const now=new Date('2026-10-28T10:00:00Z'),account={id,user_id:owner,brand:'dneskai' as const,platform:'instagram' as const};
const scopes=['instagram_business_basic','instagram_business_content_publish'],renewed='TEST_ONLY_RENEWED_DATABASE_CREDENTIAL';
let database:Awaited<ReturnType<typeof createMigratedDatabase>>,emulator:SupabaseEmulator;
beforeAll(async()=>{database=await createMigratedDatabase({owner,instant:now});emulator=new SupabaseEmulator(database,'https://refresh-test.supabase.co',{service:'TEST-ONLY-service',users:{}},()=>now);},120000);
afterAll(async()=>database?.close());
beforeEach(async()=>{
 await database.query('delete from public.marketing_accounts where user_id=$1',[owner]);
 await database.query("insert into public.marketing_accounts(id,user_id,brand,platform,remote_account_id,handle,verified_at,enabled) values($1,$2,'dneskai','instagram','17841400000000001','dneskai','2026-10-20T10:00:00Z',false)",[id,owner]);
 await database.query("insert into public.marketing_account_tokens(account_id,user_id,access_token,expires_at,refreshed_at,scopes,login_mode) values($1,$2,'TEST_ONLY_OLD_DATABASE_CREDENTIAL','2026-11-01T10:00:00Z','2026-09-01T10:00:00Z',$3,'instagram')",[id,owner,scopes]);
});
const client=(fetcher:typeof fetch)=>createClient('https://refresh-test.supabase.co','TEST-ONLY-service',{global:{fetch:fetcher},auth:{persistSession:false,autoRefreshToken:false}});
const provider=()=>Response.json({access_token:renewed,expires_in:5184000});
it('retains a changed remote account while an earlier renewal waits for its provider',async()=>{
 const fetcher=vi.fn(async()=>{await database.query("update public.marketing_accounts set remote_account_id='17841400000000009',handle='newer_handle' where id=$1",[id]);return provider();});
 expect(await refreshInstagramToken(client(emulator.fetch.bind(emulator)),owner,account,{now,env:{},fetcher})).toMatchObject({status:'held',code:'refresh-account-changed'});
 expect((await database.query<{same:boolean}>("select access_token='TEST_ONLY_OLD_DATABASE_CREDENTIAL' same from public.marketing_account_tokens where account_id=$1",[id])).rows[0]?.same).toBe(true);
});
it('retains a rotated credential even when its public refresh metadata did not change',async()=>{
 const fetcher=vi.fn(async()=>{await database.query("update public.marketing_account_tokens set access_token='TEST_ONLY_ROTATED_DATABASE_CREDENTIAL' where account_id=$1",[id]);return provider();});
 const result=await refreshInstagramToken(client(emulator.fetch.bind(emulator)),owner,account,{now,env:{},fetcher});
 expect((await database.query<{same:boolean}>("select access_token='TEST_ONLY_ROTATED_DATABASE_CREDENTIAL' same from public.marketing_account_tokens where account_id=$1",[id])).rows[0]?.same).toBe(true);
 expect(result).toMatchObject({status:'held',code:'refresh-account-changed'});
});
