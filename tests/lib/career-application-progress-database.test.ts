import {readFileSync} from 'node:fs';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {createMigratedDatabase} from '../helpers/supabase-pglite';
import {SupabaseEmulator} from '../helpers/supabase-emulator';
import {careerApplicationRecordSchema} from '@/lib/career-records';
import {progressCareerApplication} from '@/lib/career-application-progress';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',instant='2026-10-26T12:00:00Z',migration='20261026195100_captured_career_progress.sql';
let db:PGlite,client:SupabaseClient;
const scope=()=>({ownerId:owner,signal:new AbortController().signal}),columns=Object.keys(careerApplicationRecordSchema.shape).join(',');
async function source(){const result=await client.from('job_applications').insert({user_id:owner,title:'Synthetic role',cover_letter:'Synthetic original letter',notes:'Synthetic original note',applied_on:'2026-10-01',remote:false}).select(columns).single();expect(result.error).toBeNull();return careerApplicationRecordSchema.parse(result.data);}
const raw=(id:string,version:string,patch:unknown,actor:string|null=owner)=>client.rpc('update_captured_job_application',{p_expected_owner:actor,p_id:id,p_updated_at:version,p_patch:patch}).retry(false);
beforeAll(async()=>{db=await createMigratedDatabase({owner,instant});await db.query('insert into auth.users(id) values($1)',[other]);const emulator=new SupabaseEmulator(db,'https://example.supabase.co',{service:'TEST-ONLY-service',users:{[owner]:'TEST-ONLY-owner'}},()=>new Date(instant));client=createClient('https://example.supabase.co','TEST-ONLY-owner',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>emulator.fetch(input,init)}});},60_000);
afterAll(async()=>{await db?.close();});
it('refuses an old status/form snapshot without losing a newer note or creating history',async()=>{
 const before=await source();await db.query('update job_applications set notes=$1 where id=$2',['Synthetic newer note',before.id]);await expect(progressCareerApplication(client,scope(),before,{status:'interviewing'})).rejects.toMatchObject({reason:'changed'});expect((await db.query('select status,notes from job_applications where id=$1',[before.id])).rows).toEqual([{status:'applied',notes:'Synthetic newer note'}]);expect((await db.query('select id from job_application_events where application_id=$1',[before.id])).rows).toHaveLength(0);
});
it('commits response, stage and contacts together with exactly the changed history',async()=>{
 const before=await source(),receipt=await progressCareerApplication(client,scope(),before,{status:'interviewing',responded_on:'2026-10-25',response_kind:'positive',next_follow_up_at:'2026-10-30T09:00:00Z',notes:'Synthetic next step',contact_name:'Synthetic contact',contact_email:'synthetic@example.test'});
 expect(receipt.row).toMatchObject({status:'interviewing',responded_on:'2026-10-25',response_kind:'positive',notes:'Synthetic next step',contact_name:'Synthetic contact',contact_email:'synthetic@example.test',cover_letter:before.cover_letter,remote:false});expect(receipt.events.map(row=>row.kind)).toEqual(['status','note']);expect(receipt.row.updated_at).not.toBe(before.updated_at);expect(receipt.row).not.toHaveProperty('request_fingerprint');
 await expect(progressCareerApplication(client,scope(),before,{status:'interviewing'})).rejects.toMatchObject({reason:'changed'});expect((await db.query('select id from job_application_events where application_id=$1',[before.id])).rows).toHaveLength(2);
});
it('does not rewrite the application or add history for an unchanged patch',async()=>{
 const before=await source();const receipt=await progressCareerApplication(client,scope(),before,{status:before.status,notes:before.notes});expect(receipt.row).toEqual(before);expect(receipt.events).toEqual([]);const empty=await progressCareerApplication(client,scope(),before,{});expect(empty.row).toEqual(before);expect(empty.events).toEqual([]);
});
it('retains large untouched legacy notes when changing only contact details',async()=>{
 const before=await source();await db.query('update job_applications set notes=$1 where id=$2',['界'.repeat(70000),before.id]);const current=careerApplicationRecordSchema.parse((await client.from('job_applications').select(columns).eq('id',before.id).single()).data);const receipt=await progressCareerApplication(client,scope(),current,{contact_name:'Synthetic contact'});expect(receipt.row.notes).toBe(current.notes);expect(receipt.events).toEqual([]);
});
it('rolls back progress and contacts if history persistence fails',async()=>{
 const before=await source();await db.exec("create function public.synthetic_progress_refusal() returns trigger language plpgsql as $$ begin raise exception 'Synthetic event refusal'; end $$; create trigger synthetic_progress_refusal before insert on job_application_events for each row execute function public.synthetic_progress_refusal();");try{
  await expect(progressCareerApplication(client,scope(),before,{status:'interviewing',contact_name:'Synthetic rejected contact'})).rejects.toMatchObject({reason:'unavailable'});expect((await client.from('job_applications').select(columns).eq('id',before.id).single()).data).toEqual(before);expect((await db.query('select id from job_application_events where application_id=$1',[before.id])).rows).toHaveLength(0);
 }finally{await db.exec('drop trigger synthetic_progress_refusal on job_application_events;drop function public.synthetic_progress_refusal();');}
});
it.each([null,other])('refuses expected owner %s before changing data',async actor=>{const before=await source(),result=await raw(before.id,before.updated_at,{status:'offer'},actor);expect(result.error?.code).toBe('42501');});
it('refuses another owner and an absent record without manufacturing data',async()=>{
 const before=await source();await db.query('update job_applications set user_id=$1 where id=$2',[other,before.id]);expect((await raw(before.id,before.updated_at,{status:'offer'})).error?.code).toBe('P0002');expect((await raw(crypto.randomUUID(),before.updated_at,{status:'offer'})).error?.code).toBe('P0002');
});
it.each([null,[],{extra:'TEST'},{notes:42},{status:null},{status:'unknown'},{response_kind:'unknown'},{responded_on:'2026-02-30',response_kind:'positive'},{responded_on:'2026-10-27',response_kind:'positive'},{responded_on:'2026-09-01',response_kind:'positive'},{responded_on:'2026-10-25'},{notes:'x'.repeat(30001)},{contact_name:'x'.repeat(201)},{contact_email:'invalid'},{contact_email:'a@b.c\nprivate'},{next_follow_up_at:'infinity'},{next_follow_up_at:'2026-02-30T09:00:00Z'}])('refuses malformed progress without partial changes (%j)',async patch=>{
 const before=await source(),result=await raw(before.id,before.updated_at,patch);expect(result.error?.code).toBe('22023');expect((await client.from('job_applications').select(columns).eq('id',before.id).single()).data).toEqual(before);expect((await db.query('select id from job_application_events where application_id=$1',[before.id])).rows).toHaveLength(0);
});
it('keeps execution invoker, empty-path, lock-bounded and authenticated-only',async()=>{
 expect((await db.query("select prosecdef,proconfig,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') authenticated,has_function_privilege('service_role',oid,'execute') service from pg_proc where oid='public.update_captured_job_application(uuid,uuid,timestamptz,jsonb)'::regprocedure")).rows).toEqual([{prosecdef:false,proconfig:['search_path=""','lock_timeout=5s'],anon:false,authenticated:true,service:false}]);
});
it('excludes internal and future columns from both explicit receipts',async()=>{
 await db.exec("alter table job_applications add column future_private text default 'Synthetic future';alter table job_application_events add column future_private text default 'Synthetic future';");const before=await source(),receipt=await progressCareerApplication(client,scope(),before,{status:'offer',notes:'Synthetic next step'});expect(receipt.row).not.toHaveProperty('future_private');expect(receipt.row).not.toHaveProperty('request_fingerprint');for(const event of receipt.events)expect(event).not.toHaveProperty('future_private');
});
it.each(['upgrade','rollback'] as const)('preserves private data and the legacy RPC on %s',async mode=>{
 const before=await createMigratedDatabase({owner,instant,beforeMigration:migration});try{
  const historical=(await before.query<{id:string}>("insert into job_applications(user_id,title,cover_letter,notes,applied_on) values($1,'Synthetic historical role','Synthetic retained letter','Synthetic retained note','2026-10-01') returning id",[owner])).rows[0];
  await before.query("insert into job_application_events(user_id,application_id,kind,detail) values($1,$2,'applied','2026-10-01')",[owner,historical.id]);
const snapshot=async()=>(await before.query("select jsonb_build_object('apps',(select jsonb_agg(to_jsonb(a) order by id) from job_applications a),'events',(select jsonb_agg(to_jsonb(e) order by id) from job_application_events e),'legacy',(select pg_get_functiondef('public.update_job_application_progress(uuid,text,date,text,timestamptz,text)'::regprocedure))) data")).rows;const old=await snapshot(),sql=readFileSync(`supabase/migrations/${migration}`,'utf8');if(mode==='upgrade')await before.exec(sql);else await expect(before.transaction(async tx=>{await tx.exec(sql);throw Error('Synthetic rollback');})).rejects.toThrow('Synthetic rollback');expect(await snapshot()).toEqual(old);}finally{await before.close();}
},60_000);
