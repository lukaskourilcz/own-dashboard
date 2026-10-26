import { createClient } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import { createCareerSavedRecord, removeCareerSavedRecord, updateCareerSavedRecord } from '@/lib/career-saved-records';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',instant='2026-10-26T12:00:00Z';
let db:PGlite,requests:{url:URL,method:string}[];
function clientFor(id=owner){
 const emulator=new SupabaseEmulator(db,'https://example.supabase.co',{service:'TEST-ONLY-service',users:{[id]:'TEST-ONLY-owner'}},()=>new Date(instant));
 return createClient('https://example.supabase.co','TEST-ONLY-owner',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>{requests.push({url:new URL(String(input)),method:init?.method??'GET'});return emulator.fetch(input,init);}}});
}
const scope=(ownerId=owner)=>({ownerId,signal:new AbortController().signal});
const fields=(suffix:string)=>({title:'Synthetic saved role',url:`https://thehub.io/jobs/${suffix}`,cover_letter:'Synthetic old letter',notes:'Synthetic old note'});
beforeAll(async()=>{db=await createMigratedDatabase({owner,instant});await db.query('insert into auth.users(id,email) values($1,$2)',[other,'synthetic-foreign@example.test']);requests=[];},60_000);
afterAll(async()=>{await db?.close();});
it('does not overwrite a newer private note when an older letter draft is saved',async()=>{
 const client=clientFor(),old=await createCareerSavedRecord(client,scope(),crypto.randomUUID(),fields('stale-note'));
 await client.from('saved_job_positions').update({notes:'Synthetic newer note'}).eq('id',old.id);
 await expect(updateCareerSavedRecord(client,scope(),old,{cover_letter:'Synthetic revised letter',notes:old.notes})).rejects.toMatchObject({reason:'changed'});
 expect((await db.query<{notes:string,cover_letter:string}>('select notes,cover_letter from saved_job_positions where id=$1',[old.id])).rows[0]).toEqual({notes:'Synthetic newer note',cover_letter:'Synthetic old letter'});
});
it('preserves an existing URL, private letter, remote evidence and readiness on a manual collision',async()=>{
 const client=clientFor(),old=await createCareerSavedRecord(client,scope(),crypto.randomUUID(),{...fields('url-collision'),remote:false,readiness:'needs_review'});
 await expect(createCareerSavedRecord(client,scope(),crypto.randomUUID(),{...fields('url-collision'),title:'Synthetic replacement',notes:null})).rejects.toMatchObject({reason:'changed'});
 expect((await client.from('saved_job_positions').select('*').eq('id',old.id).single()).data).toEqual(old);
});
it('recovers only the same owned stable id with every submitted/default field unchanged',async()=>{
 const client=clientFor(),id=crypto.randomUUID(),intent=fields('stable-retry');
 const first=await createCareerSavedRecord(client,scope(),id,intent),start=requests.length;
 expect(await createCareerSavedRecord(client,scope(),id,intent)).toEqual(first);expect(requests.slice(start).map(r=>r.method)).toEqual(['POST','GET']);
 await expect(createCareerSavedRecord(client,scope(),id,{...intent,notes:'Different intent'})).rejects.toMatchObject({reason:'changed'});
 await updateCareerSavedRecord(client,scope(),first,{readiness:'ready'});
 await expect(createCareerSavedRecord(client,scope(),id,intent)).rejects.toMatchObject({reason:'changed'});
});
it('updates only submitted fields and confirms a newer six-digit version without a recovery read',async()=>{
 const client=clientFor();
 // A new oversized write is refused; existing legacy values remain editable through a small patch.
 await expect(createCareerSavedRecord(client,scope(),crypto.randomUUID(),{...fields('microseconds'),description:'Legacy '.repeat(6000)})).rejects.toMatchObject({reason:'invalid'});
 const inserted=await client.from('saved_job_positions').insert({user_id:owner,...fields('legacy-description'),description:'Legacy '.repeat(6000),updated_at:'2090-01-01T00:00:00.000001Z'}).select().single();expect(inserted.error).toBeNull();
 const start=requests.length,next=await updateCareerSavedRecord(client,scope(),inserted.data,{notes:'Synthetic revised note'});
 expect(next.updated_at).toBe('2090-01-01T00:00:00.000002+00:00');expect(next.description).toBe(inserted.data.description);expect(next.cover_letter).toBe(inserted.data.cover_letter);
 expect(requests.slice(start).map(r=>r.method)).toEqual(['PATCH']);expect(requests.at(-1)!.url.searchParams.get('updated_at')).toBe('eq.2090-01-01T00:00:00.000001+00:00');
});
it('refuses a stale delete, confirms the captured deletion and refuses a second absence',async()=>{
 const client=clientFor(),old=await createCareerSavedRecord(client,scope(),crypto.randomUUID(),fields('delete-version'));
 const next=await updateCareerSavedRecord(client,scope(),old,{notes:'Synthetic newer delete note'});
 await expect(removeCareerSavedRecord(client,scope(),old)).rejects.toMatchObject({reason:'changed'});
 expect(await removeCareerSavedRecord(client,scope(),next)).toEqual(next);
 await expect(removeCareerSavedRecord(client,scope(),next)).rejects.toMatchObject({reason:'changed'});
});
it('keeps foreign records invisible under the actual SDK/RLS, including stable-id recovery',async()=>{
 const ownClient=clientFor(),foreignClient=clientFor(other),id=crypto.randomUUID();
 const row=await createCareerSavedRecord(ownClient,scope(),id,fields('owned-row'));
 await expect(updateCareerSavedRecord(foreignClient,scope(other),{...row,user_id:other},{notes:'Foreign change'})).rejects.toMatchObject({reason:'changed'});
 await expect(removeCareerSavedRecord(foreignClient,scope(other),{...row,user_id:other})).rejects.toMatchObject({reason:'changed'});
 await expect(createCareerSavedRecord(foreignClient,scope(other),id,fields('owned-row'))).rejects.toMatchObject({reason:'changed'});
 expect((await ownClient.from('saved_job_positions').select('*').eq('id',id).single()).data).toEqual(row);
});
it('projects only reviewed columns even after a future private column is added',async()=>{
 await db.exec("alter table saved_job_positions add column future_private text default 'Synthetic unreviewed'");
 const start=requests.length,row=await createCareerSavedRecord(clientFor(),scope(),crypto.randomUUID(),fields('projection'));
 expect(row).not.toHaveProperty('future_private');expect(requests[start].url.searchParams.get('select')).not.toContain('*');expect(requests[start].url.searchParams.get('select')).not.toContain('future_private');
});

it('accepts the existing 300-character provider title contract and a valid linked letter',async()=>{
 const title='A'.repeat(300),cover_letter_url='https://docs.google.com/document/d/synthetic-letter/edit';
 const row=await createCareerSavedRecord(clientFor(),scope(),crypto.randomUUID(),{...fields('provider-title'),title,cover_letter_url});expect(row.title).toBe(title);expect(row.cover_letter_url).toBe(cover_letter_url);
});
