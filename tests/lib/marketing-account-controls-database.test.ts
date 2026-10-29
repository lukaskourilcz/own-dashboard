import { createClient } from '@supabase/supabase-js';
import { afterAll,afterEach,beforeAll,beforeEach,expect,it,vi } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
const m=vi.hoisted(()=>({session:vi.fn(),admin:vi.fn(),limit:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/supabase/server',()=>({createClient:(...args:unknown[])=>m.session(...args)}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:(...args:unknown[])=>m.admin(...args)}));
vi.mock('@/lib/rate-limit',()=>({rateLimit:m.limit}));
import {POST as enable} from '@/app/api/marketing/accounts/enable/route';
import {POST as engagement} from '@/app/api/marketing/accounts/engagement/route';
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',instant='2026-10-27T10:00:00Z';
let database:Awaited<ReturnType<typeof createMigratedDatabase>>,emulator:SupabaseEmulator,capturedVersion:string;
beforeAll(async()=>{
 database=await createMigratedDatabase({owner,instant});emulator=new SupabaseEmulator(database,'https://account-controls.supabase.co',{service:'TEST-ONLY-service',users:{[owner]:'TEST-ONLY-owner'}});
},120000);
afterAll(async()=>database?.close());afterEach(()=>vi.unstubAllEnvs());
beforeEach(async()=>{
 vi.clearAllMocks();m.session.mockResolvedValue({auth:{getUser:async()=>({data:{user:{id:owner}},error:null})}});m.limit.mockResolvedValue({ok:true});vi.stubEnv('MARKETING_OWNER_ID',owner);vi.stubEnv('DNESKAI_ENGAGEMENT_ENABLED','true');
 await database.query('delete from public.marketing_accounts where user_id=$1',[owner]);
 await database.query("insert into public.marketing_accounts(id,user_id,brand,platform,remote_account_id,handle,verified_at,enabled) values($1,$2,'dneskai','instagram','17841400000000001','dneskai',$3,false)",[id,owner,instant]);
 await database.query("insert into public.marketing_account_tokens(account_id,user_id,access_token,expires_at,refreshed_at,scopes,login_mode) values($1,$2,'TEST_ONLY_DATABASE_FIXTURE_TOKEN','2099-01-01T00:00:00Z',$3,array['instagram_business_basic','instagram_business_manage_comments'],'instagram')",[id,owner,instant]);
 capturedVersion=(await database.query<{version:string}>("select to_jsonb(a)->>'updated_at' as version from public.marketing_accounts a where id=$1",[id])).rows[0].version;
});
const request=()=>new Request('https://own.example/api/marketing/accounts/control',{method:'POST',headers:{Origin:'https://own.example'},body:JSON.stringify({ownerId:owner,accountId:id,expectedVersion:capturedVersion,enabled:true})});
it.each([{kind:'publishing',handler:enable,patch:"expires_at='2000-01-01T00:00:00Z'",code:'access-token-expired'},{kind:'engagement',handler:engagement,patch:"scopes=array['instagram_business_basic']",code:'engagement-scopes-unverified'}])('refuses $kind when current token eligibility changed before the write',async({handler,patch,code})=>{
 const expire=()=>database.exec('update public.marketing_account_tokens set '+patch),fetcher=vi.fn(async(input:unknown,init?:RequestInit)=>{
  const path=new URL(String(input)).pathname;
  if(path==='/rest/v1/rpc/marketing_account_token_metadata'){const old=await emulator.fetch(input as RequestInfo,init);await expire();return old;}
  if(path==='/rest/v1/rpc/toggle_owned_marketing_account')await expire();
  return emulator.fetch(input as RequestInfo,init);
 }),db=createClient('https://account-controls.supabase.co','TEST-ONLY-service',{global:{fetch:fetcher},auth:{persistSession:false,autoRefreshToken:false}});m.admin.mockReturnValue(db);
 const response=await handler(request());expect(response.status).toBe(200);expect((await response.json()).receipt).toMatchObject({kind:'blocked',code});expect((await database.query<{enabled:boolean;engagement_enabled:boolean}>('select enabled,engagement_enabled from public.marketing_accounts where id=$1',[id])).rows[0]).toEqual({enabled:false,engagement_enabled:false});
});
it.each([{ kind: 'publishing', handler: enable, column: 'enabled' }, { kind: 'engagement', handler: engagement, column: 'engagement_enabled' }])('persists one exact $kind route intent and refuses its stale opposite without rewriting the row', async ({ kind, handler, column }) => {
 const fetcher=vi.fn(emulator.fetch.bind(emulator));m.admin.mockReturnValue(createClient('https://account-controls.supabase.co','TEST-ONLY-service',{global:{fetch:fetcher},auth:{persistSession:false,autoRefreshToken:false}}));
 const response=await handler(request()),body=await response.json();expect(response.status).toBe(200);expect(body.receipt).toMatchObject({kind:'saved',ownerId:owner,id,expectedVersion:capturedVersion,switch:kind,requestedEnabled:true});
 const before=(await database.query<{row:Record<string,unknown>}>('select to_jsonb(a) as row from public.marketing_accounts a where id=$1',[id])).rows[0].row;
 expect(before[column]).toBe(true);
 const stale=new Request('https://own.example/api/marketing/accounts/control',{method:'POST',headers:{Origin:'https://own.example'},body:JSON.stringify({ownerId:owner,accountId:id,expectedVersion:capturedVersion,enabled:false})});
 const again=await handler(stale);expect(again.status).toBe(200);expect((await again.json()).receipt).toMatchObject({kind:'changed',requestedEnabled:false,updatedAt:body.receipt.updatedAt});
 expect((await database.query<{row:Record<string,unknown>}>('select to_jsonb(a) as row from public.marketing_accounts a where id=$1',[id])).rows[0].row).toEqual(before);
 expect(fetcher.mock.calls.map(([url])=>new URL(String(url)).pathname)).toEqual(['/rest/v1/rpc/toggle_owned_marketing_account','/rest/v1/rpc/toggle_owned_marketing_account']);
});
