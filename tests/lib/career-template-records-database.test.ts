import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {createMigratedDatabase} from '../helpers/supabase-pglite';
import {SupabaseEmulator} from '../helpers/supabase-emulator';
import {careerTemplateRecordSchema} from '@/lib/career-records';
import {createCareerTemplate,updateCareerTemplate,removeCareerTemplate} from '@/lib/career-template-records';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',instant='2026-10-26T12:00:00Z';
let db:PGlite,client:SupabaseClient;
const scope=()=>({ownerId:owner,signal:new AbortController().signal}),columns=Object.keys(careerTemplateRecordSchema.shape).join(','),fields=()=>({name:'Synthetic original template',body:'Synthetic original letter\n{{position}}'});
const create=()=>createCareerTemplate(client,scope(),crypto.randomUUID(),fields());
beforeAll(async()=>{db=await createMigratedDatabase({owner,instant});await db.query('insert into auth.users(id) values($1)',[other]);const emulator=new SupabaseEmulator(db,'https://example.supabase.co',{service:'TEST-ONLY-service',users:{[owner]:'TEST-ONLY-owner'}},()=>new Date(instant));client=createClient('https://example.supabase.co','TEST-ONLY-owner',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>emulator.fetch(input,init)}});},60_000);
afterAll(async()=>{await db?.close();});
it('recovers the same owned id/intent after uncertainty without another template',async()=>{
 const id=crypto.randomUUID(),first=await createCareerTemplate(client,scope(),id,fields()),retry=await createCareerTemplate(client,scope(),id,fields());expect(retry).toEqual(first);expect((await db.query('select id from cover_letter_templates where id=$1',[id])).rows).toHaveLength(1);
});
it('does not overwrite changed private work while recovering an existing id',async()=>{
 const before=await create();await db.query('update cover_letter_templates set body=$1 where id=$2',['Synthetic newer letter',before.id]);await expect(createCareerTemplate(client,scope(),before.id,fields())).rejects.toMatchObject({reason:'changed'});expect((await db.query('select body from cover_letter_templates where id=$1',[before.id])).rows).toEqual([{body:'Synthetic newer letter'}]);
});
it('preserves distinct intentional ids even when template names match',async()=>{
 const first=await create(),second=await create();expect(second.id).not.toBe(first.id);expect(second.name).toBe(first.name);expect((await db.query('select id from cover_letter_templates where id=any($1::uuid[])',[[first.id,second.id]])).rows).toHaveLength(2);
});
it.each(['update','delete'] as const)('refuses a stale %s without losing newer text',async operation=>{
 const before=await create();await db.query('update cover_letter_templates set body=$1 where id=$2',['Synthetic newer letter',before.id]);await expect(operation==='update'?updateCareerTemplate(client,scope(),before,{name:'Synthetic next name'}):removeCareerTemplate(client,scope(),before)).rejects.toMatchObject({reason:'changed'});expect((await db.query('select body from cover_letter_templates where id=$1',[before.id])).rows).toEqual([{body:'Synthetic newer letter'}]);
});
it('updates only the changed field and retains oversized untouched legacy body text',async()=>{
 const before=await create();await db.query('update cover_letter_templates set body=$1 where id=$2',['界'.repeat(70000),before.id]);const fresh=careerTemplateRecordSchema.parse((await client.from('cover_letter_templates').select(columns).eq('id',before.id).single()).data),updated=await updateCareerTemplate(client,scope(),fresh,{name:'Synthetic reviewed name'});expect(updated.body).toBe(fresh.body);expect(updated.name).toBe('Synthetic reviewed name');expect(updated.created_at).toBe(fresh.created_at);expect(updated.updated_at).not.toBe(fresh.updated_at);expect(Date.parse(updated.updated_at)).toBe(Date.parse(fresh.updated_at));
});
it('confirms deletion of exactly the captured template and refuses an absent row',async()=>{
 const before=await create(),removed=await removeCareerTemplate(client,scope(),before);expect(removed).toEqual(before);expect((await db.query('select id from cover_letter_templates where id=$1',[before.id])).rows).toHaveLength(0);await expect(removeCareerTemplate(client,scope(),before)).rejects.toMatchObject({reason:'changed'});
});
it('keeps existing legacy timestamp order removable instead of rewriting its history',async()=>{
 const original=await create();await db.query("update cover_letter_templates set created_at='2090-01-01T00:00:00Z' where id=$1",[original.id]);const fresh=careerTemplateRecordSchema.parse((await client.from('cover_letter_templates').select(columns).eq('id',original.id).single()).data);expect((await removeCareerTemplate(client,scope(),fresh)).created_at).toBe(fresh.created_at);
});
it('enforces RLS and original-owner admission for another private template',async()=>{
 const foreign=careerTemplateRecordSchema.parse((await db.query<{data:unknown}>(`with inserted as (insert into cover_letter_templates(user_id,name,body) values($1,'Synthetic foreign template','Synthetic foreign letter') returning ${columns}) select to_jsonb(inserted) data from inserted`,[other])).rows[0].data);
 await expect(updateCareerTemplate(client,scope(),foreign,{body:'Synthetic replacement'})).rejects.toMatchObject({reason:'unavailable'});await expect(removeCareerTemplate(client,scope(),foreign)).rejects.toMatchObject({reason:'unavailable'});await expect(createCareerTemplate(client,scope(),foreign.id,fields())).rejects.toMatchObject({reason:'changed'});expect((await client.from('cover_letter_templates').delete().eq('id',foreign.id).eq('user_id',owner).select(columns)).data).toEqual([]);expect((await db.query('select body from cover_letter_templates where id=$1',[foreign.id])).rows).toEqual([{body:'Synthetic foreign letter'}]);
});
it.each([{label:'long name',value:{name:'x'.repeat(151),body:'Synthetic letter'}},{label:'blank name',value:{name:' ',body:'Synthetic letter'}},{label:'long body',value:{name:'Synthetic name',body:'x'.repeat(64001)}},{label:'blank body',value:{name:'Synthetic name',body:'\n '}}])('refuses $label before creating a record',async({value})=>{
 const id=crypto.randomUUID();await expect(createCareerTemplate(client,scope(),id,value)).rejects.toMatchObject({reason:'invalid'});expect((await db.query('select id from cover_letter_templates where id=$1',[id])).rows).toHaveLength(0);
});
it('accepts the exact new name/body bounds without changing the template body',async()=>{
 const id=crypto.randomUUID(),value={name:'N'.repeat(150),body:'界'.repeat(64000)},row=await createCareerTemplate(client,scope(),id,value);expect(row.name).toBe(value.name);expect(row.body).toBe(value.body);
});
it('excludes future private columns from create, recovery, update and delete projections',async()=>{
 await db.exec("alter table cover_letter_templates add column future_private text default 'Synthetic private future';");const before=await create(),retry=await createCareerTemplate(client,scope(),before.id,fields()),updated=await updateCareerTemplate(client,scope(),before,{body:'Synthetic reviewed body'});expect(before).not.toHaveProperty('future_private');expect(retry).toEqual(before);expect(updated).not.toHaveProperty('future_private');expect(await removeCareerTemplate(client,scope(),updated)).toEqual(updated);
});
