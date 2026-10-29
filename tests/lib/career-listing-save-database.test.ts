import { readFileSync } from 'node:fs';
import { beforeAll,beforeEach,afterAll,expect,it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createClient,type SupabaseClient } from '@supabase/supabase-js';
import { captureCareerListing,CareerSaveError } from '@/lib/career-listing-save';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',instant='2026-10-26T12:00:00Z';
const migration='20261025235237_captured_career_listing_save.sql';
let db:PGlite,client:SupabaseClient,calls:number;
const scope=()=>({ownerId:owner,signal:new AbortController().signal});
const url='https://jobs.ashbyhq.com/sanity/synthetic-stale-save';
const proof={source:'ashby-sanity',title:'Synthetic public feed title',company:null,location:'Europe',description:null,remote:true};
beforeAll(async()=>{
 db=await createMigratedDatabase({owner,instant});await db.query('insert into auth.users(id) values($1)',[other]);
 const emulator=new SupabaseEmulator(db,'https://example.supabase.co',{service:'TEST-ONLY-service',users:{[owner]:'TEST-ONLY-owner'}},()=>new Date(instant));
 client=createClient('https://example.supabase.co','TEST-ONLY-owner',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>{calls++;return emulator.fetch(input,init);}}});
},60_000);
beforeEach(async()=>{calls=0;await db.exec('truncate job_listings,saved_job_positions,job_user_state cascade');});
afterAll(async()=>{await db?.close();});
async function listing(remote=true,verified=true){
 return (await db.query<{id:string,url:string,last_seen_at:string}&typeof proof>("insert into job_listings(source,external_id,title,url,location,role,remote,native_remote_verified,last_seen_at) values('ashby-sanity','synthetic','Synthetic public feed title',$1,'Europe','frontend',$2,$3,$4) returning id,url,title,source,company,location,description,(remote and native_remote_verified) remote,to_jsonb(last_seen_at)#>>'{}' last_seen_at",[url,remote,verified,instant])).rows[0];
}
it('keeps a private title and draft created in another window when discovery saves the same URL',async()=>{
 await client.from('saved_job_positions').insert({user_id:owner,title:'Synthetic owner-edited title',url,cover_letter:'Synthetic private letter',notes:'Synthetic private note'});
 const before=(await db.query('select to_jsonb(s) row from saved_job_positions s')).rows;
 const result=await captureCareerListing(client,scope(),crypto.randomUUID(),{...proof,id:crypto.randomUUID(),url,last_seen_at:instant});
 expect(result.created).toBe(false);expect(result.row.title).toBe('Synthetic owner-edited title');expect(result.row.cover_letter).toBe('Synthetic private letter');expect(result.row.notes).toBe('Synthetic private note');
 expect((await db.query('select to_jsonb(s) row from saved_job_positions s')).rows).toEqual(before);expect(calls).toBe(2);
});
it.each([[true,true,true],[false,true,false],[true,false,false]])('captures native remote=%s verified=%s as %s in one SDK request',async(remote,verified,expected)=>{
 const source=await listing(remote,verified),requestId=crypto.randomUUID();const result=await captureCareerListing(client,scope(),requestId,source);
 expect(result).toMatchObject({ownerId:owner,requestId,created:true,row:{id:requestId,user_id:owner,listing_id:source.id,title:'Synthetic public feed title',url,remote:expected,cover_letter:'',notes:null,readiness:'draft'}});expect(calls).toBe(1);
});
it('recovers an uncertain stable-id save after source removal without changing private history',async()=>{
 const source=await listing(),requestId=crypto.randomUUID(),first=await captureCareerListing(client,scope(),requestId,source);
 await db.query("update saved_job_positions set title='Synthetic private revision',cover_letter='Synthetic draft' where id=$1",[first.row.id]);
 await db.query('delete from job_listings where id=$1',[source.id]);
 const before=(await db.query('select to_jsonb(s) row from saved_job_positions s')).rows;
 const retry=await captureCareerListing(client,scope(),requestId,source);expect(retry.created).toBe(false);expect(retry.row).toMatchObject({id:requestId,title:'Synthetic private revision',cover_letter:'Synthetic draft',listing_id:null,remote:true});expect((await db.query('select to_jsonb(s) row from saved_job_positions s')).rows).toEqual(before);
});
it.each(['version','url','deleted'] as const)('refuses a changed %s source without creating a private record',async kind=>{
 const source=await listing();
 if(kind==='version')await db.query("update job_listings set last_seen_at=last_seen_at+interval '1 microsecond' where id=$1",[source.id]);
 else if(kind==='url')await db.query("update job_listings set url='https://jobs.ashbyhq.com/sanity/changed' where id=$1",[source.id]);
 else await db.query("insert into job_user_state(user_id,listing_id,state) values($1,$2,'deleted')",[owner,source.id]);
 await expect(captureCareerListing(client,scope(),crypto.randomUUID(),source)).rejects.toMatchObject({reason:'changed'});expect((await db.query('select id from saved_job_positions')).rows).toHaveLength(0);expect(calls).toBe(1);
});
it('does not treat another account deletion marker as this owner intent',async()=>{
 const source=await listing();await db.query("insert into job_user_state(user_id,listing_id,state) values($1,$2,'deleted')",[other,source.id]);
 expect((await captureCareerListing(client,scope(),crypto.randomUUID(),source)).created).toBe(true);
});
it('refuses a reused stable id for another URL without overwriting the earlier capture',async()=>{
 const source=await listing(),requestId=crypto.randomUUID();await captureCareerListing(client,scope(),requestId,source);
 await expect(captureCareerListing(client,scope(),requestId,{...source,url:'https://jobs.ashbyhq.com/sanity/different'})).rejects.toMatchObject({reason:'changed'});
 expect((await db.query<{url:string}>('select url from saved_job_positions')).rows).toEqual([{url}]);
});
it('admits the captured owner before empty data and keeps other private records inaccessible',async()=>{
 const source=await listing();await db.query("insert into saved_job_positions(user_id,title,url) values($1,'Foreign synthetic role',$2)",[other,url]);
 await expect(captureCareerListing(client,{...scope(),ownerId:other},crypto.randomUUID(),source)).rejects.toBeInstanceOf(CareerSaveError);
 const own=await captureCareerListing(client,scope(),crypto.randomUUID(),source);expect(own.row.user_id).toBe(owner);expect(own.row.title).toBe('Synthetic public feed title');
});
it('needs only global listing SELECT and excludes future private columns from its receipt',async()=>{
 await db.exec("revoke insert,update,delete on job_listings from authenticated;alter table saved_job_positions add column future_private_field text default 'TEST-ONLY future field'");
 try{const result=await captureCareerListing(client,scope(),crypto.randomUUID(),await listing());expect(result.row).not.toHaveProperty('future_private_field');expect(result.created).toBe(true);}
 finally{await db.exec('alter table saved_job_positions drop column future_private_field');}
});
it('preserves invoker ownership and authenticated-only execution with a five-second lock budget',async()=>{
 expect((await db.query("select prosecdef,proconfig,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') authenticated,has_function_privilege('service_role',oid,'execute') service from pg_proc where oid='public.capture_career_listing(uuid,uuid,uuid,timestamptz,text)'::regprocedure")).rows).toEqual([{prosecdef:false,proconfig:['search_path=""','lock_timeout=5s'],anon:false,authenticated:true,service:false}]);
});
it('refuses oversized existing private receipts without altering their history',async()=>{
 await db.query("insert into saved_job_positions(user_id,title,url,cover_letter) values($1,'Synthetic large draft',$2,repeat('x',10485761))",[owner,url]);
 await expect(captureCareerListing(client,scope(),crypto.randomUUID(),{...proof,id:crypto.randomUUID(),url,last_seen_at:instant})).rejects.toBeInstanceOf(CareerSaveError);
 expect((await db.query<{size:number}>('select length(cover_letter) size from saved_job_positions')).rows[0].size).toBe(10485761);
});
it.each(['upgrade','rollback'] as const)('preserves private history through %s',async mode=>{
 const before=await createMigratedDatabase({owner,instant,beforeMigration:migration});try{
  const snapshot=async()=>(await before.query('select to_jsonb(s) row from saved_job_positions s order by id')).rows;const original=await snapshot();const sql=readFileSync(`supabase/migrations/${migration}`,'utf8');
  if(mode==='upgrade')await before.exec(sql);else await expect(before.transaction(async tx=>{await tx.exec(sql);throw Error('synthetic rollback');})).rejects.toThrow('synthetic rollback');
  expect(await snapshot()).toEqual(original);expect((await before.query<{found:boolean}>("select to_regprocedure('public.capture_career_listing(uuid,uuid,uuid,timestamptz,text)') is not null found")).rows[0].found).toBe(mode==='upgrade');
 }finally{await before.close();}
},60_000);
