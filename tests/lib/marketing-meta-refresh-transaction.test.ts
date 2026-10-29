import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
const instant='2026-10-28T10:00:00Z',previous='2026-10-27T10:00:00Z',expiry='2099-01-01T00:00:00Z',token='TEST_ONLY_CAPTURED_DATABASE_CREDENTIAL',incoming='TEST_ONLY_RENEWED_DATABASE_CREDENTIAL',scopes=['instagram_business_basic','instagram_business_content_publish'];
const migrationFile='supabase/migrations/20261028123118_captured_marketing_credential_renewal.sql',signature='public.renew_owned_marketing_credential(uuid,uuid,timestamptz,jsonb,text,text,text,timestamptz,text[],text)';
let database:Awaited<ReturnType<typeof createMigratedDatabase>>,service:SupabaseClient,authenticated:SupabaseClient,anonymous:SupabaseClient;
beforeAll(async()=>{database=await createMigratedDatabase({owner,instant});const origin='https://renewal-transaction.supabase.co',emulator=new SupabaseEmulator(database,origin,{service:'TEST-ONLY-service',users:{[owner]:'TEST-ONLY-owner'}},()=>new Date(instant));
 const options={global:{fetch:emulator.fetch.bind(emulator)},auth:{persistSession:false,autoRefreshToken:false}};
 service=createClient(origin,'TEST-ONLY-service',options);anonymous=createClient(origin,'TEST-ONLY-anon',options);authenticated=createClient(origin,'TEST-ONLY-anon',{...options,global:{...options.global,headers:{Authorization:'Bearer TEST-ONLY-owner'}}});
},120000);
afterAll(async()=>database?.close());
beforeEach(async()=>{await database.query('delete from public.marketing_accounts where user_id=$1',[owner]);await database.query("insert into public.marketing_accounts(id,user_id,brand,platform,remote_account_id,handle,verified_at,enabled,engagement_enabled) values($1,$2,'dneskai','instagram','17841400000000001','dneskai',$3,true,true)",[id,owner,previous]);await database.query("insert into public.marketing_account_tokens(account_id,user_id,access_token,expires_at,refreshed_at,scopes,login_mode) values($1,$2,$3,$4,$5,$6,'instagram')",[id,owner,token,expiry,previous,scopes]);});
async function input(){
 const version=(await database.query<{version:string}>("select to_jsonb(a)->>'updated_at' version from public.marketing_accounts a where id=$1",[id])).rows[0].version;
 const read=await service.rpc('marketing_read_account_token',{p_owner:owner,p_account:id});if(read.error)throw Error('Fixture private read unavailable');const current=read.data[0];
 return {p_owner:owner,p_expected_id:id,p_expected_at:version,p_expected_token:current?{tokenHash:createHash('sha256').update(current.access_token).digest('hex'),expiresAt:current.expires_at,refreshedAt:current.refreshed_at,scopes:current.scopes,loginMode:current.login_mode}:null,
 p_brand:'dneskai',p_platform:'instagram',p_token:incoming,p_expires_at:expiry,p_scopes:scopes,p_login_mode:'instagram'};
}
const call=(value:Awaited<ReturnType<typeof input>>,db=service)=>db.rpc('renew_owned_marketing_credential',value);
const state=()=>database.query<{accounts:unknown;tokens:unknown}>("select (select jsonb_agg(to_jsonb(a) order by id) from public.marketing_accounts a where user_id=$1) accounts,(select jsonb_agg((to_jsonb(t)-'access_token')||jsonb_build_object('hash',md5(access_token)) order by account_id) from public.marketing_account_tokens t where user_id=$1) tokens",[owner]);
it('renews exactly the captured credential, retains the entire account and emits no credential/fingerprint',async()=>{
 const captured=await input(),before=await state(),result=await call(captured);expect(result.error).toBeNull();expect(result.data).toMatchObject({kind:'refreshed',ownerId:owner,expectedId:id,expectedVersion:captured.p_expected_at,id,updatedAt:captured.p_expected_at,result:{accountId:id,token:{loginMode:'instagram',scopes}}});
 expect((await state()).rows[0].accounts).toEqual(before.rows[0].accounts);expect(JSON.stringify(result.data)).not.toContain('TEST_ONLY');expect(JSON.stringify(result.data)).not.toContain('tokenHash');
 expect((await database.query<{same:boolean}>('select access_token=$2 same from public.marketing_account_tokens where account_id=$1',[id,incoming])).rows[0].same).toBe(true);
});
it.each(['account','deleted','recreated','credential','metadata'] as const)('retains newer %s state without a credential write',async kind=>{
 const captured=await input();
 if(kind==='account')await database.query("update public.marketing_accounts set handle='newer_handle' where id=$1",[id]);
 if(kind==='deleted'||kind==='recreated')await database.query('delete from public.marketing_accounts where id=$1',[id]);
 if(kind==='recreated')await database.query("insert into public.marketing_accounts(id,user_id,brand,platform,remote_account_id,handle) values($1,$2,'dneskai','instagram','17841400000000002','newer_handle')",[other,owner]);
 if(kind==='credential')await database.query("update public.marketing_account_tokens set access_token='TEST_ONLY_ROTATED_DATABASE_CREDENTIAL' where account_id=$1",[id]);
 if(kind==='metadata')await database.query("update public.marketing_account_tokens set scopes=array['instagram_business_basic'] where account_id=$1",[id]);
 const before=await state(),result=await call(captured);expect(result.error).toBeNull();expect(result.data.kind).toBe('changed');expect(await state()).toEqual(before);
});
it('allows a captured tokenless account to store its renewed bootstrap without enabling switches',async()=>{
 await database.query('delete from public.marketing_account_tokens where account_id=$1',[id]);const captured=await input(),before=await state();expect(captured.p_expected_token).toBeNull();expect((await call(captured)).error).toBeNull();expect((await state()).rows[0].accounts).toEqual(before.rows[0].accounts);
});
it('accepts equivalent microsecond timestamp spelling in private capture and expected account version',async()=>{
 const captured=await input();captured.p_expected_at='2026-10-28T12:00:00.000000+02:00';captured.p_expected_token!.refreshedAt='2026-10-27T12:00:00.000000+02:00';captured.p_expected_token!.expiresAt='2099-01-01T02:00:00+02:00';expect((await call(captured)).error).toBeNull();
});
it.each(['anonymous','authenticated'] as const)('denies %s execution without changing rows',async role=>{const before=await state(),result=await call(await input(),role==='anonymous'?anonymous:authenticated);expect(result.error?.code).toBe('42501');expect(await state()).toEqual(before);});
it.each([{p_owner:null},{p_expected_id:null},{p_expected_at:null},{p_expected_at:'infinity'},{p_brand:'foreign'},{p_platform:'threads'},{p_expires_at:'infinity'},{p_expires_at:'2000-01-01T00:00:00Z'},{p_scopes:[...scopes,scopes[0]]},{p_scopes:[scopes]},{p_scopes:[null]},{p_token:'short'},{p_login_mode:'threads'},{p_expected_token:{}},{p_expected_token:{tokenHash:'bad',expiresAt:expiry,refreshedAt:previous,scopes,loginMode:'instagram'}}])('refuses malformed captured renewal without a write: %#',async patch=>{const captured={...await input(),...patch},before=await state(),result=await call(captured as never);expect(result.error).not.toBeNull();expect(await state()).toEqual(before);});
it.each(['suppress','token','expiry','refresh','scopes','mode','account','private-error'] as const)('rolls back a %s trigger effect with fixed diagnostics',async kind=>{
 const captured=await input(),before=await state();
 const effect=kind==='suppress'?'return null;':kind==='token'?"new.access_token:='TEST_ONLY_REWRITTEN_DATABASE_CREDENTIAL';return new;":kind==='expiry'?"new.expires_at:=new.expires_at+interval '1 day';return new;":kind==='refresh'?"new.refreshed_at:='-infinity';return new;":kind==='scopes'?"new.scopes:=array['instagram_business_basic'];return new;":kind==='mode'?"new.login_mode:='facebook';return new;":kind==='account'?"update public.marketing_accounts set enabled=false where id=new.account_id;return new;":"raise exception 'TEST_ONLY_PRIVATE_TRIGGER_DETAIL';";
 await database.exec(`create function public.audit_renewal_trigger() returns trigger language plpgsql as $$begin ${effect}end$$;create trigger zz_audit_renewal before update on public.marketing_account_tokens for each row execute function public.audit_renewal_trigger();`);
 try{const result=await call(captured);expect(result.error?.code).toBe('40001');expect(result.error?.message).toBe('Credential renewal unconfirmed');expect(JSON.stringify(result)).not.toContain('TEST_ONLY_PRIVATE_TRIGGER_DETAIL');expect(await state()).toEqual(before);}finally{await database.exec('drop trigger zz_audit_renewal on public.marketing_account_tokens;drop function public.audit_renewal_trigger();');}
});
it('preserves populated data and table privileges through canonical upgrade and rollback',async()=>{
 const migration=readFileSync(migrationFile,'utf8'),before=await state(),grants=()=>database.query("select relname,relacl::text from pg_class where oid in('public.marketing_accounts'::regclass,'public.marketing_account_tokens'::regclass) order by relname"),acl=await grants();
 await database.exec('begin;drop function '+signature+';');try{await database.exec(migration);expect(await state()).toEqual(before);expect(await grants()).toEqual(acl);}finally{await database.exec('rollback');}
 await database.exec('begin;drop function '+signature+';');try{await expect(database.exec(migration+';select 1/0;')).rejects.toThrow();}finally{await database.exec('rollback');}expect(await state()).toEqual(before);expect(await grants()).toEqual(acl);
});
it('preserves future account fields and declares a service-only invoker with a five-second lock bound',async()=>{
 await database.exec("alter table public.marketing_accounts add column audit_future_field text not null default 'retained';");try{const before=await state();expect((await call(await input())).error).toBeNull();expect((await state()).rows[0].accounts).toEqual(before.rows[0].accounts);}finally{await database.exec('alter table public.marketing_accounts drop column audit_future_field;');}
 const info=(await database.query<{prosecdef:boolean;proconfig:string[]}>("select prosecdef,proconfig from pg_proc where oid=$1::regprocedure",[signature])).rows[0];expect(info.prosecdef).toBe(false);expect(info.proconfig).toContain('lock_timeout=5s');
});

it('retains a captured credential when a renewal would shorten its expiry',async()=>{
 const captured={...await input(),p_expires_at:'2098-01-01T00:00:00Z'},before=await state(),result=await call(captured);expect(result.error?.code).toBe('40001');expect(await state()).toEqual(before);
});
it('refuses a credential introduced after a captured tokenless read',async()=>{
 await database.query('delete from public.marketing_account_tokens where account_id=$1',[id]);const captured=await input();await database.query("insert into public.marketing_account_tokens(account_id,user_id,access_token,expires_at,refreshed_at,scopes,login_mode) values($1,$2,$3,$4,$5,$6,'instagram')",[id,owner,token,expiry,previous,scopes]);const before=await state();expect((await call(captured)).data.kind).toBe('changed');expect(await state()).toEqual(before);
});
it('retains compatibility for explicitly empty scope metadata and the other supported Instagram brand',async()=>{
 await database.query("update public.marketing_accounts set brand='devshark' where id=$1",[id]);const captured={...await input(),p_brand:'devshark',p_scopes:[]};const result=await call(captured);expect(result.error).toBeNull();expect(result.data.result.token.scopes).toEqual([]);
});
