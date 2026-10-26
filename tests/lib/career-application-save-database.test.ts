import {readFileSync} from 'node:fs';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {createMigratedDatabase} from '../helpers/supabase-pglite';
import {SupabaseEmulator} from '../helpers/supabase-emulator';
import {createCareerSavedRecord} from '@/lib/career-saved-records';
import {recordCareerApplication,type CareerApplicationFields} from '@/lib/career-application-save';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',instant='2026-10-26T12:00:00Z',migration='20261026182155_captured_career_application.sql';
let db:PGlite,client:SupabaseClient;
const scope=()=>({ownerId:owner,signal:new AbortController().signal});
const fields=(title='Synthetic application role'):CareerApplicationFields=>({title,company:null,url:'https://thehub.io/jobs/synthetic-application',cover_letter:'Synthetic original letter',cover_letter_url:null,notes:'Synthetic original note',applied_on:'2026-10-26'});
const saved=()=>createCareerSavedRecord(client,scope(),crypto.randomUUID(),{title:'Synthetic application role',url:`https://thehub.io/jobs/synthetic-${crypto.randomUUID()}`,source:'manual',location:'Oslo',remote:false,cover_letter:'Synthetic original letter',notes:'Synthetic original note'});
const raw=(id:string,version:string,payload:unknown,expectedOwner:string|null=owner)=>client.rpc('record_captured_job_application',{p_expected_owner:expectedOwner,p_saved_id:id,p_saved_updated_at:version,p_payload:payload}).retry(false);
beforeAll(async()=>{db=await createMigratedDatabase({owner,instant});await db.query('insert into auth.users(id) values($1)',[other]);const emulator=new SupabaseEmulator(db,'https://example.supabase.co',{service:'TEST-ONLY-service',users:{[owner]:'TEST-ONLY-owner'}},()=>new Date(instant));client=createClient('https://example.supabase.co','TEST-ONLY-owner',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>emulator.fetch(input,init)}});},60_000);
afterAll(async()=>{await db?.close();});
it('retains a newer private note when an older Saved form records the application',async()=>{
 const source=await saved();await client.from('saved_job_positions').update({notes:'Synthetic newer note'}).eq('id',source.id);
 await expect(recordCareerApplication(client,scope(),source,fields())).rejects.toMatchObject({reason:'changed'});
 expect((await db.query<{notes:string}>('select notes from saved_job_positions where id=$1',[source.id])).rows[0].notes).toBe('Synthetic newer note');expect((await db.query('select id from job_applications where request_id=$1',[source.id])).rows).toHaveLength(0);
});
it('creates one owned application and event, preserves snapshot metadata and recovers only the same intent',async()=>{
 const source=await saved(),intent=fields('R'.repeat(300)),first=await recordCareerApplication(client,scope(),source,intent);
 expect(first.created).toBe(true);expect(first.row).toMatchObject({user_id:owner,request_id:source.id,title:intent.title,source:'manual',location:'Oslo',remote:false,notes:intent.notes,cover_letter:intent.cover_letter});expect(first.event).toMatchObject({user_id:owner,application_id:first.row.id,kind:'applied',detail:'2026-10-26'});expect(first.row).not.toHaveProperty('request_fingerprint');
 const retry=await recordCareerApplication(client,scope(),{...source,updated_at:source.updated_at.replace('+00:00','Z')},intent);expect(retry).toEqual({...first,created:false});
 await expect(recordCareerApplication(client,scope(),source,{...intent,notes:'Different intent'})).rejects.toMatchObject({reason:'changed'});expect((await db.query('select id from saved_job_positions where id=$1',[source.id])).rows).toHaveLength(0);expect((await db.query('select id from job_application_events where application_id=$1',[first.row.id])).rows).toHaveLength(1);
});
it('recovers a recorded conversion without replacing newer application progress',async()=>{
 const source=await saved(),first=await recordCareerApplication(client,scope(),source,fields());await client.from('job_applications').update({status:'interviewing',notes:'Synthetic later application note'}).eq('id',first.row.id);
 const retry=await recordCareerApplication(client,scope(),source,fields());expect(retry.created).toBe(false);expect(retry.row.status).toBe('interviewing');expect(retry.row.notes).toBe('Synthetic later application note');
});
it('matches independent client/SQL fingerprints for Unicode, separators, nulls and microsecond versions',async()=>{
 const source=await saved();await db.query("update saved_job_positions set updated_at='2090-01-01T00:00:00.000001Z' where id=$1",[source.id]);const row=(await client.from('saved_job_positions').select('*').eq('id',source.id).single()).data;
 const result=await recordCareerApplication(client,scope(),row,{...fields(),title:'Příliš žluťoučký 🐬',company:'Firma: 12: null',cover_letter:'První řádek\nDruhý: -1: 🌍',notes:'Poznámka 🐬\nDalší řádek'});expect(result.created).toBe(true);expect(result.row.title).toBe('Příliš žluťoučký 🐬');expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
});
it.each([null,other])('refuses expected owner %s before changing private records',async expectedOwner=>{
 const source=await saved(),result=await raw(source.id,source.updated_at,fields(),expectedOwner);expect(result.error?.code).toBe('42501');expect((await db.query('select id from saved_job_positions where id=$1',[source.id])).rows).toHaveLength(1);
});
it('cannot convert another owner’s private source',async()=>{
 const source=await saved();await db.query('update saved_job_positions set user_id=$2 where id=$1',[source.id,other]);const result=await raw(source.id,source.updated_at,fields());expect(result.error?.code).toBe('P0002');expect((await db.query('select id from job_applications where request_id=$1',[source.id])).rows).toHaveLength(0);
});
it.each([null,[],{}, {...fields(),extra:'TEST'}, {...fields(),notes:42},{...fields(),title:'R'.repeat(301)},{...fields(),cover_letter:'X'.repeat(64001)},{...fields(),url:'https://user:password@example.test/job'},{...fields(),cover_letter_url:'https://example.test/document/d/test'},{...fields(),applied_on:'2026-02-30'},{...fields(),applied_on:'2026-10-27'}])('refuses malformed fields without consuming the draft (%j)',async payload=>{
 const source=await saved(),result=await raw(source.id,source.updated_at,payload);expect(result.error?.code).toBe('22023');expect((await db.query('select id from saved_job_positions where id=$1',[source.id])).rows).toHaveLength(1);expect((await db.query('select id from job_applications where request_id=$1',[source.id])).rows).toHaveLength(0);
});
it('bounds UTF-8 submission bytes before consuming a valid private source',async()=>{
 const source=await saved(),result=await raw(source.id,source.updated_at,{...fields(),cover_letter:'界'.repeat(64000),notes:'界'.repeat(30000)});expect(result.error?.code).toBe('22023');expect((await db.query('select id from saved_job_positions where id=$1',[source.id])).rows).toHaveLength(1);
});
it('does not mislabel a legacy request without original-intent evidence as a captured recovery',async()=>{
 const source=await saved(),legacy=await client.rpc('record_job_application',{p_request_id:source.id,p_saved_id:source.id,p_payload:fields()}).retry(false);expect(legacy.error).toBeNull();await expect(recordCareerApplication(client,scope(),source,fields())).rejects.toMatchObject({reason:'changed'});
});
it('retains already-removed or ambiguous action history rather than manufacturing another event',async()=>{
 const source=await saved(),first=await recordCareerApplication(client,scope(),source,fields());await db.query('delete from job_application_events where application_id=$1',[first.row.id]);const retry=await recordCareerApplication(client,scope(),source,fields());expect(retry.created).toBe(false);expect(retry.event).toBeNull();expect((await db.query('select id from job_application_events where application_id=$1',[first.row.id])).rows).toHaveLength(0);
});
it('keeps an absent/deleted source absent instead of creating a new application',async()=>{
 const source=await saved();await client.from('saved_job_positions').delete().eq('id',source.id);await expect(recordCareerApplication(client,scope(),source,fields())).rejects.toMatchObject({reason:'changed'});
});
it('keeps the new RPC invoker, empty-path, lock-bounded and unavailable to anon/service roles',async()=>{
 expect((await db.query("select prosecdef,proconfig,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') authenticated,has_function_privilege('service_role',oid,'execute') service from pg_proc where oid='public.record_captured_job_application(uuid,uuid,timestamptz,jsonb)'::regprocedure")).rows).toEqual([{prosecdef:false,proconfig:['search_path=""','lock_timeout=5s'],anon:false,authenticated:true,service:false}]);
});
it('excludes future private columns from application/event receipts',async()=>{
 await db.exec("alter table job_applications add column future_private text default 'Synthetic unreviewed';alter table job_application_events add column future_private text default 'Synthetic unreviewed';");const source=await saved(),receipt=await recordCareerApplication(client,scope(),source,fields());expect(receipt.row).not.toHaveProperty('future_private');expect(receipt.event).not.toHaveProperty('future_private');
});
it.each(['upgrade','rollback'] as const)('preserves private history during %s',async mode=>{
 const before=await createMigratedDatabase({owner,instant,beforeMigration:migration});try{
  const historical=(await before.query<{id:string}>("insert into job_applications(user_id,title,cover_letter,notes,applied_on) values($1,'Synthetic historical role','Synthetic retained letter','Synthetic retained note','2026-10-01') returning id",[owner])).rows[0];
  await before.query("insert into job_application_events(user_id,application_id,kind,detail) values($1,$2,'applied','2026-10-01')",[owner,historical.id]);

  const snapshot=async()=>(await before.query("select jsonb_build_object('saved',(select jsonb_agg(to_jsonb(s) order by id) from saved_job_positions s),'apps',(select jsonb_agg(to_jsonb(a)-'request_fingerprint' order by id) from job_applications a),'events',(select jsonb_agg(to_jsonb(e) order by id) from job_application_events e)) data")).rows,original=await snapshot();const sql=readFileSync(`supabase/migrations/${migration}`,'utf8');
  if(mode==='upgrade')await before.exec(sql);else await expect(before.transaction(async tx=>{await tx.exec(sql);throw Error('Synthetic rollback');})).rejects.toThrow('Synthetic rollback');expect(await snapshot()).toEqual(original);
  if(mode==='upgrade')expect((await before.query('select id from job_applications where request_fingerprint is not null')).rows).toHaveLength(0);
  else expect((await before.query("select to_regprocedure('public.record_captured_job_application(uuid,uuid,timestamptz,jsonb)') function")).rows).toEqual([{function:null}]);
 }finally{await before.close();}
},60_000);
