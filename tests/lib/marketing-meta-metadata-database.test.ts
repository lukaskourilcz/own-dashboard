import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import { listMetaTokenMetadata } from '@/lib/marketing/meta-credentials';
vi.mock('server-only',()=>({}));
const owner='11111111-1111-4111-8111-111111111111',foreign='99999999-9999-4999-8999-999999999999',instant='2026-10-28T10:00:00Z';
const tuples=[['devshark','instagram','facebook'],['devshark','threads','threads'],['dneskai','instagram','instagram'],['dneskai','threads','threads']];
const key=(index:number)=>`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
const file='supabase/migrations/20261028132841_complete_marketing_token_metadata.sql',signature='public.read_owned_marketing_token_metadata(uuid)',origin='https://metadata-test.supabase.co';
let database:Awaited<ReturnType<typeof createMigratedDatabase>>,emulator:SupabaseEmulator,service:SupabaseClient,authenticated:SupabaseClient,anonymous:SupabaseClient;
const client=(fetcher:typeof fetch,token='TEST-ONLY-service')=>createClient(origin,token,{global:{fetch:fetcher},auth:{persistSession:false,autoRefreshToken:false}});
beforeAll(async()=>{database=await createMigratedDatabase({owner,instant});await database.query('insert into auth.users(id,email) values($1,$2)',[foreign,'foreign@example.test']);emulator=new SupabaseEmulator(database,origin,{service:'TEST-ONLY-service',users:{[owner]:'TEST-ONLY-owner'}},()=>new Date(instant));const fetcher=emulator.fetch.bind(emulator);service=client(fetcher);anonymous=client(fetcher,'TEST-ONLY-anon');authenticated=createClient(origin,'TEST-ONLY-anon',{global:{fetch:fetcher,headers:{Authorization:'Bearer TEST-ONLY-owner'}},auth:{persistSession:false,autoRefreshToken:false}});},120000);
afterAll(async()=>database?.close());
beforeEach(async()=>{
 await database.query('delete from public.marketing_accounts where user_id in($1,$2)',[owner,foreign]);
 for(const [index,[brand,platform,mode]] of tuples.entries()){
  await database.query('insert into public.marketing_accounts(id,user_id,brand,platform,remote_account_id,handle) values($1,$2,$3,$4,$5,$6)',[key(index+1),owner,brand,platform,'1784140000000000'+index,'fixture_'+index]);
  await database.query("insert into public.marketing_account_tokens(account_id,user_id,access_token,expires_at,refreshed_at,scopes,login_mode) values($1,$2,'TEST_ONLY_PRIVATE_METADATA_FIXTURE','2099-01-01T00:00:00Z',$3,array['basic'],$4)",[key(index+1),owner,instant,mode]);
 }
 await database.query("insert into public.marketing_accounts(id,user_id,brand,platform,remote_account_id,handle) values($1,$2,'dneskai','instagram','17841400000000009','foreign')",[key(5),foreign]);
 await database.query("insert into public.marketing_account_tokens(account_id,user_id,access_token,expires_at,refreshed_at,scopes,login_mode) values($1,$2,'TEST_ONLY_FOREIGN_PRIVATE_FIXTURE','2099-01-01T00:00:00Z',$3,array['basic'],'instagram')",[key(5),foreign,instant]);
});
it('reads all four exact owner tuples through one actual SDK call without credential fields',async()=>{
 const reads:string[]=[],fetcher:typeof fetch=async(input,init)=>{reads.push(new URL(String(input)).pathname);return emulator.fetch(input,init);};
 const rows=await listMetaTokenMetadata(client(fetcher),owner);expect(rows.map(row=>[row.accountId,row.brand,row.platform,row.loginMode])).toEqual(tuples.map(([brand,platform,mode],index)=>[key(index+1),brand,platform,mode]));expect(reads).toEqual(['/rest/v1/rpc/read_owned_marketing_token_metadata']);expect(JSON.stringify(rows)).not.toContain('TEST_ONLY');
 const raw=await service.rpc('read_owned_marketing_token_metadata',{p_owner:owner});expect(raw.error).toBeNull();expect(raw.data.count).toBe(4);expect(raw.data.ownerId).toBe(owner);expect(JSON.stringify(raw.data)).not.toContain('access_token');expect(JSON.stringify(raw.data)).not.toContain('TEST_ONLY');expect(JSON.stringify(raw.data)).not.toContain(key(5));
});
it('keeps the complete aggregate when a local REST stand-in caps set results at one row',async()=>{
 const cap:typeof fetch=async(input,init)=>{const response=await emulator.fetch(input,init),data:unknown=await response.clone().json();return Array.isArray(data)?Response.json(data.slice(0,1),{status:response.status}):response;};
 const capped=client(cap),old=await capped.rpc('marketing_account_token_metadata',{p_owner:owner});expect(old.data).toHaveLength(1);expect(await listMetaTokenMetadata(capped,owner)).toHaveLength(4);
});
it('distinguishes a complete tokenless/empty owner from an unreadable metadata list',async()=>{
 await database.query('delete from public.marketing_account_tokens where account_id=$1',[key(1)]);expect(await listMetaTokenMetadata(service,owner)).toHaveLength(3);
 await database.query('delete from public.marketing_account_tokens where user_id=$1',[owner]);expect(await listMetaTokenMetadata(service,owner)).toEqual([]);
});
it.each(['anonymous','authenticated'] as const)('denies %s execution while retaining private table restrictions',async role=>{
 const db=role==='anonymous'?anonymous:authenticated,result=await db.rpc('read_owned_marketing_token_metadata',{p_owner:owner});expect(result.error?.code).toBe('42501');expect((await db.from('marketing_account_tokens').select('account_id')).error?.code).toBe('42501');
});
it('does not grant service direct token-table reads',async()=>{expect((await service.from('marketing_account_tokens').select('account_id')).error?.code).toBe('42501');});
it('does not retry an unavailable actual SDK read or echo database diagnostics',async()=>{
 const fetcher=vi.fn(async()=>Response.json({message:'TEST_ONLY_PRIVATE_METADATA_DETAIL'},{status:503,headers:{'Retry-After':'0'}}));await expect(listMetaTokenMetadata(client(fetcher),owner)).rejects.toMatchObject({code:'credential-store-unavailable',message:'credential-store-unavailable'});expect(fetcher).toHaveBeenCalledOnce();
});
it('refuses a valid-looking metadata prefix with the original full count',async()=>{
 const fetcher:typeof fetch=async(input,init)=>{const response=await emulator.fetch(input,init),data=await response.json();return Response.json({...data,tokens:data.tokens.slice(0,1)});};await expect(listMetaTokenMetadata(client(fetcher),owner)).rejects.toMatchObject({code:'credential-store-unavailable'});
});
it('excludes future private token columns from the exact non-secret projection',async()=>{
 await database.exec("alter table public.marketing_account_tokens add column audit_future_secret text default 'TEST_ONLY_FUTURE_PRIVATE_FIELD';");try{const result=await service.rpc('read_owned_marketing_token_metadata',{p_owner:owner});expect(result.error).toBeNull();expect(JSON.stringify(result.data)).not.toContain('audit_future_secret');expect(JSON.stringify(result.data)).not.toContain('TEST_ONLY');}finally{await database.exec('alter table public.marketing_account_tokens drop column audit_future_secret;');}
});
it('preserves populated data and table privileges through canonical upgrade and rollback',async()=>{
 const state=()=>database.query("select (select jsonb_agg(to_jsonb(a) order by id) from public.marketing_accounts a) accounts,(select jsonb_agg((to_jsonb(t)-'access_token')||jsonb_build_object('hash',md5(access_token)) order by account_id) from public.marketing_account_tokens t) tokens"),before=await state();
 const grants=()=>database.query("select relname,relacl::text from pg_class where oid in('public.marketing_accounts'::regclass,'public.marketing_account_tokens'::regclass) order by relname"),acl=await grants(),migration=readFileSync(file,'utf8');
 await database.exec('begin;drop function '+signature+';');try{await database.exec(migration);expect(await state()).toEqual(before);expect(await grants()).toEqual(acl);}finally{await database.exec('rollback');}
 await database.exec('begin;drop function '+signature+';');try{await expect(database.exec(migration+';select 1/0;')).rejects.toThrow();}finally{await database.exec('rollback');}expect(await state()).toEqual(before);expect(await grants()).toEqual(acl);
 const info=(await database.query<{prosecdef:boolean;provolatile:string}>("select prosecdef,provolatile from pg_proc where oid=$1::regprocedure",[signature])).rows[0];expect(info).toEqual({prosecdef:false,provolatile:'s'});
});

it.each(['rows','bytes'] as const)('refuses an unsupported %s result before it leaves the database aggregate',async kind=>{
 const prior=(await database.query<{definition:string}>("select pg_get_functiondef('public.marketing_account_token_metadata(uuid)'::regprocedure) definition")).rows[0].definition;
 const scopes=kind==='bytes'?"array[repeat('a',20000)]":"array['basic']",count=kind==='rows'?5:1;
 await database.exec(`create or replace function public.marketing_account_token_metadata(p_owner uuid) returns table(account_id uuid,brand text,platform text,expires_at timestamptz,refreshed_at timestamptz,scopes text[],login_mode text) language sql stable security definer set search_path='' as $$select '${key(1)}'::uuid,'dneskai'::text,'instagram'::text,'2099-01-01T00:00:00Z'::timestamptz,'2026-10-28T10:00:00Z'::timestamptz,${scopes},'instagram'::text from generate_series(1,${count})$$;`);
 try{const result=await service.rpc('read_owned_marketing_token_metadata',{p_owner:owner});expect(result.error?.code).toBe('54000');expect(result.error?.message).toBe('Credential metadata unavailable');await expect(listMetaTokenMetadata(service,owner)).rejects.toMatchObject({code:'credential-store-unavailable'});}finally{await database.exec(prior);}
});
it('refuses a missing explicit owner with a fixed database diagnostic',async()=>{const result=await service.rpc('read_owned_marketing_token_metadata',{p_owner:null});expect(result.error?.code).toBe('22023');expect(result.error?.message).toBe('Credential metadata invalid');});
