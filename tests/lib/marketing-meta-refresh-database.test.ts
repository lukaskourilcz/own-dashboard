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
it('renews once through the actual SDK and canonical credential writer with exact non-secret metadata',async()=>{
 const calls:string[]=[],fetcher:typeof fetch=async(input,init)=>{calls.push(new URL(String(input)).pathname);return emulator.fetch(input,init);};
 const result=await refreshInstagramToken(client(fetcher),owner,account,{now,env:{},fetcher:async()=>provider()});
 expect(result).toEqual({status:'refreshed',accountId:id,expiresAt:'2026-12-27T10:00:00+00:00',refreshedAt:'2026-10-28T10:00:00+00:00'});
 expect(calls).toEqual(['/rest/v1/rpc/marketing_read_account_token','/rest/v1/rpc/marketing_store_account_token']);expect(JSON.stringify(result)).not.toContain('TEST_ONLY');
 expect((await database.query<{same:boolean}>('select access_token=$2 as same from public.marketing_account_tokens where account_id=$1',[id,renewed])).rows[0]?.same).toBe(true);
});
it('does not retry an unavailable actual SDK credential read or call the provider',async()=>{
 const read=vi.fn(async()=>Response.json({message:'TEST_ONLY_PRIVATE_DATABASE_DETAIL'},{status:503,headers:{'Retry-After':'0'}})),graph=vi.fn(async()=>provider());
 expect(await refreshInstagramToken(client(read),owner,account,{now,env:{},fetcher:graph})).toMatchObject({status:'held',code:'credential-store-unavailable'});
 expect(read).toHaveBeenCalledOnce();expect(graph).not.toHaveBeenCalled();
});
it('keeps a committed renewal with a lost acknowledgement uncertain and sends only one write',async()=>{
 let writes=0;const fetcher:typeof fetch=async(input,init)=>{const response=await emulator.fetch(input,init);if(new URL(String(input)).pathname.endsWith('/marketing_store_account_token')){writes++;throw Error('TEST_ONLY_LOST_ACK');}return response;};
 expect(await refreshInstagramToken(client(fetcher),owner,account,{now,env:{},fetcher:async()=>provider()})).toMatchObject({status:'uncertain',code:'refresh-store-failed'});
 expect(writes).toBe(1);expect((await database.query<{same:boolean}>('select access_token=$2 as same from public.marketing_account_tokens where account_id=$1',[id,renewed])).rows[0]?.same).toBe(true);
});
