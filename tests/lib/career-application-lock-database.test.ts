import {readFileSync} from 'node:fs';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {createMigratedDatabase} from '../helpers/supabase-pglite';
import {SupabaseEmulator} from '../helpers/supabase-emulator';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',instant='2026-10-26T12:00:00Z',migration='20261026163911_career_application_lock_order.sql';
const sql=readFileSync(`supabase/migrations/${migration}`,'utf8');
let db:PGlite,client:SupabaseClient;
const payload=(title='Synthetic application role')=>({title,url:'https://thehub.io/jobs/synthetic-long-application',applied_on:'2026-10-26',cover_letter:'Synthetic private letter',notes:'Synthetic private note'});
beforeAll(async()=>{
 db=await createMigratedDatabase({owner,instant});await db.query('insert into auth.users(id) values($1)',[other]);
 const emulator=new SupabaseEmulator(db,'https://example.supabase.co',{service:'TEST-ONLY-service',users:{[owner]:'TEST-ONLY-owner'}},()=>new Date(instant));
 client=createClient('https://example.supabase.co','TEST-ONLY-owner',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>emulator.fetch(input,init)}});
},60_000);
afterAll(async()=>{await db?.close();});
it.each([1,200,201,300])('records the existing provider-title contract at %s characters',async length=>{
 const result=await client.rpc('record_job_application',{p_request_id:crypto.randomUUID(),p_saved_id:null,p_payload:payload('R'.repeat(length))}).retry(false);
 expect(result.error).toBeNull();expect(result.data.title).toBe('R'.repeat(length));expect(result.data.user_id).toBe(owner);
});
it.each(['','R'.repeat(301),' '.repeat(300)])('refuses invalid title length without partial history',async title=>{
 const id=crypto.randomUUID(),result=await client.rpc('record_job_application',{p_request_id:id,p_saved_id:null,p_payload:payload(title)}).retry(false);expect(result.error).not.toBeNull();expect(result.data).toBeNull();expect((await db.query('select id from job_applications where request_id=$1',[id])).rows).toHaveLength(0);
});
it('retains saved private fields, request identity and one event across conversion and retry',async()=>{
 const saved=await client.from('saved_job_positions').insert({user_id:owner,title:'R'.repeat(300),url:'https://thehub.io/jobs/synthetic-conversion',cover_letter:'Synthetic private letter',notes:'Synthetic private note',remote:false}).select().single();expect(saved.error).toBeNull();
 const args={p_request_id:saved.data.id,p_saved_id:saved.data.id,p_payload:{...payload(saved.data.title),url:saved.data.url,remote:true}},first=await client.rpc('record_job_application',args).retry(false);expect(first.error).toBeNull();expect(first.data).toMatchObject({user_id:owner,title:saved.data.title,cover_letter:saved.data.cover_letter,notes:saved.data.notes,remote:false,request_id:saved.data.id});
 const retry=await client.rpc('record_job_application',args).retry(false);expect(retry.error).toBeNull();expect(retry.data).toEqual(first.data);expect((await db.query('select id from saved_job_positions where id=$1',[saved.data.id])).rows).toHaveLength(0);expect((await db.query('select id from job_application_events where application_id=$1',[first.data.id])).rows).toHaveLength(1);
});
it('records private history after its public listing has been pruned',async()=>{
 const listing=(await db.query<{id:string}>("insert into job_listings(source,external_id,title,url,role) values('curated','synthetic-pruned-application','Synthetic old offer','https://thehub.io/jobs/pruned-application','frontend') returning id")).rows[0];
 const saved=await client.from('saved_job_positions').insert({user_id:owner,listing_id:listing.id,title:'Synthetic old offer',url:'https://thehub.io/jobs/pruned-application',cover_letter:'Synthetic private letter',notes:'Synthetic private note'}).select().single();expect(saved.error).toBeNull();await db.query('delete from job_listings where id=$1',[listing.id]);
 const result=await client.rpc('record_job_application',{p_request_id:saved.data.id,p_saved_id:saved.data.id,p_payload:payload(saved.data.title)}).retry(false);expect(result.error).toBeNull();expect(result.data.listing_id).toBeNull();expect(result.data.notes).toBe('Synthetic private note');
});
it('cannot convert a foreign private Saved row through the actual SDK/RLS',async()=>{
 const saved=(await db.query<{id:string}>("insert into saved_job_positions(user_id,title,url,notes) values($1,'Synthetic foreign role','https://thehub.io/jobs/synthetic-foreign-conversion','Synthetic foreign note') returning id",[other])).rows[0];
 const result=await client.rpc('record_job_application',{p_request_id:saved.id,p_saved_id:saved.id,p_payload:payload()}).retry(false);expect(result.error?.code).toBe('P0002');expect(result.data).toBeNull();expect((await db.query('select id from saved_job_positions where id=$1',[saved.id])).rows).toHaveLength(1);expect((await db.query('select id from job_applications where request_id=$1',[saved.id])).rows).toHaveLength(0);
});
it('keeps the RPC invoker, empty-path, auth-only and bounded per lock wait',async()=>{
 expect((await db.query("select prosecdef,proconfig,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') authenticated from pg_proc where oid='public.record_job_application(uuid,uuid,jsonb)'::regprocedure")).rows).toEqual([{prosecdef:false,proconfig:['search_path=""','lock_timeout=5s'],anon:false,authenticated:true}]);
});
it.each(['upgrade','rollback'] as const)('preserves old private data and ACLs during %s',async mode=>{
 const before=await createMigratedDatabase({owner,instant,beforeMigration:migration});try{
  const snapshot=async()=>(await before.query("select jsonb_build_object('saved',(select jsonb_agg(to_jsonb(s) order by id) from saved_job_positions s),'applications',(select jsonb_agg(to_jsonb(a) order by id) from job_applications a),'events',(select jsonb_agg(to_jsonb(e) order by id) from job_application_events e),'acl',(select to_jsonb(proacl) from pg_proc where oid='public.record_job_application(uuid,uuid,jsonb)'::regprocedure)) data")).rows;
  const original=await snapshot(),definition=(await before.query<{definition:string}>("select pg_get_functiondef('public.record_job_application(uuid,uuid,jsonb)'::regprocedure) definition")).rows[0].definition;
  if(mode==='upgrade')await before.exec(sql);else await expect(before.transaction(async tx=>{await tx.exec(sql);throw Error('Synthetic rollback');})).rejects.toThrow('Synthetic rollback');
  expect(await snapshot()).toEqual(original);if(mode==='rollback')expect((await before.query<{definition:string}>("select pg_get_functiondef('public.record_job_application(uuid,uuid,jsonb)'::regprocedure) definition")).rows[0].definition).toBe(definition);
 }finally{await before.close();}
},60_000);
