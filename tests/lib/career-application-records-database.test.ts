import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {createMigratedDatabase} from '../helpers/supabase-pglite';
import {SupabaseEmulator} from '../helpers/supabase-emulator';
import {careerApplicationRecordSchema} from '@/lib/career-records';
import {updateCareerApplicationLetter,removeCareerApplicationRecord} from '@/lib/career-application-records';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',instant='2026-10-26T12:00:00Z';
let db:PGlite,client:SupabaseClient;
const scope=()=>({ownerId:owner,signal:new AbortController().signal}),columns=Object.keys(careerApplicationRecordSchema.shape).join(',');
async function source(){const result=await client.from('job_applications').insert({user_id:owner,title:'Synthetic role',cover_letter:'Synthetic private letter',notes:'Synthetic private note',applied_on:'2026-10-01',remote:false,contact_name:'Synthetic contact'}).select(columns).single();expect(result.error).toBeNull();const row=careerApplicationRecordSchema.parse(result.data);await client.from('job_application_events').insert({user_id:owner,application_id:row.id,kind:'applied',detail:'2026-10-01'});return row;}
beforeAll(async()=>{db=await createMigratedDatabase({owner,instant});await db.query('insert into auth.users(id) values($1)',[other]);const emulator=new SupabaseEmulator(db,'https://example.supabase.co',{service:'TEST-ONLY-service',users:{[owner]:'TEST-ONLY-owner'}},()=>new Date(instant));client=createClient('https://example.supabase.co','TEST-ONLY-owner',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>emulator.fetch(input,init)}});},60_000);
afterAll(async()=>{await db?.close();});
it('refuses stale deletion and retains the newer note, letter and complete history',async()=>{
 const before=await source();await db.query('update job_applications set notes=$1 where id=$2',['Synthetic newer note',before.id]);await expect(removeCareerApplicationRecord(client,scope(),before)).rejects.toMatchObject({reason:'changed'});expect((await db.query('select notes,cover_letter from job_applications where id=$1',[before.id])).rows).toEqual([{notes:'Synthetic newer note',cover_letter:before.cover_letter}]);expect((await db.query('select id from job_application_events where application_id=$1',[before.id])).rows).toHaveLength(1);
});
it('confirms exactly the captured deletion and atomically cascades its history',async()=>{
 const before=await source(),deleted=await removeCareerApplicationRecord(client,scope(),before);expect(deleted).toEqual(before);expect((await db.query('select id from job_applications where id=$1',[before.id])).rows).toHaveLength(0);expect((await db.query('select id from job_application_events where application_id=$1',[before.id])).rows).toHaveLength(0);await expect(removeCareerApplicationRecord(client,scope(),before)).rejects.toMatchObject({reason:'changed'});
});
it('refuses an old letter edit after another writer changes progress',async()=>{
 const before=await source();await db.query("update job_applications set status='interviewing',notes='Synthetic newer note' where id=$1",[before.id]);await expect(updateCareerApplicationLetter(client,scope(),before,'Synthetic replacement letter')).rejects.toMatchObject({reason:'changed'});expect((await db.query('select status,notes,cover_letter from job_applications where id=$1',[before.id])).rows).toEqual([{status:'interviewing',notes:'Synthetic newer note',cover_letter:before.cover_letter}]);
});
it('edits only the letter and advances the full microsecond version without rewriting metadata or history',async()=>{
 const before=await source(),updated=await updateCareerApplicationLetter(client,scope(),before,'Synthetic replacement letter');const{updated_at,...rest}=updated,{updated_at:previous,...expected}=before;expect(rest).toEqual({...expected,cover_letter:'Synthetic replacement letter'});expect(updated_at).not.toBe(previous);
 expect((await db.query('select id from job_application_events where application_id=$1',[before.id])).rows).toHaveLength(1);
});
it('keeps same-clock microsecond edits distinct and preserves large untouched private notes',async()=>{
 const before=await source();await db.query('update job_applications set notes=$1 where id=$2',['界'.repeat(70000),before.id]);const fresh=careerApplicationRecordSchema.parse((await client.from('job_applications').select(columns).eq('id',before.id).single()).data),updated=await updateCareerApplicationLetter(client,scope(),fresh,'Synthetic next letter');expect(updated.notes).toBe(fresh.notes);expect(Date.parse(updated.updated_at)).toBe(Date.parse(fresh.updated_at));expect(updated.updated_at).not.toBe(fresh.updated_at);await expect(updateCareerApplicationLetter(client,scope(),fresh,'Stale subsequent letter')).rejects.toMatchObject({reason:'changed'});
});
it.each(['update','delete'] as const)('refuses another owner through %s and leaves all private data intact',async operation=>{
 const before=careerApplicationRecordSchema.parse((await db.query<{data:unknown}>(`with inserted as (insert into job_applications(user_id,title,cover_letter,applied_on) values($1,'Synthetic foreign role','Synthetic foreign letter','2026-10-01') returning ${columns}) select to_jsonb(inserted) data from inserted`,[other])).rows[0].data),foreign=before;await expect(operation==='update'?updateCareerApplicationLetter(client,scope(),foreign,'Synthetic next letter'):removeCareerApplicationRecord(client,scope(),foreign)).rejects.toMatchObject({reason:'unavailable'});const raw=await client.from('job_applications').delete().eq('id',before.id).eq('user_id',owner).select(columns);expect(raw.error).toBeNull();expect(raw.data).toEqual([]);expect((await db.query('select id from job_applications where id=$1',[before.id])).rows).toHaveLength(1);
});
it('refuses an oversized letter without changing the application or its history',async()=>{
 const before=await source();await expect(updateCareerApplicationLetter(client,scope(),before,'x'.repeat(64001))).rejects.toMatchObject({reason:'invalid'});expect((await client.from('job_applications').select(columns).eq('id',before.id).single()).data).toEqual(before);
});
it('excludes internal and future fields from update and deletion receipts',async()=>{
 await db.exec("alter table job_applications add column future_private text default 'Synthetic future';");const before=await source(),updated=await updateCareerApplicationLetter(client,scope(),before,'Synthetic next letter');expect(updated).not.toHaveProperty('request_fingerprint');expect(updated).not.toHaveProperty('future_private');const removed=await removeCareerApplicationRecord(client,scope(),updated);expect(removed).toEqual(updated);
});
