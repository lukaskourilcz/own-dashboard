import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
const migration='20261025234711_career_private_record_versions.sql',sql=readFileSync(`supabase/migrations/${migration}`,'utf8');
const owner='11111111-1111-4111-8111-111111111111',instant='2026-10-26T12:00:00Z';
let db:PGlite;
beforeAll(async()=>{db=await createMigratedDatabase({owner,instant});},60_000);
afterAll(async()=>{await db?.close();});
const tables=['saved_job_positions','job_applications','cover_letter_templates'] as const;
it.each(tables)('rejects a second stale %s write even within one database clock tick',async table=>{
 const title=table==='cover_letter_templates'?'name':'title',fields=table==='cover_letter_templates'?"name,body":"title,url";
 const row=(await db.query<{id:string,version:string}>(`insert into ${table}(user_id,${fields}) values($1,'Synthetic original','https://thehub.io/jobs/version-${table}') returning id,to_jsonb(updated_at)#>>'{}' version`,[owner])).rows[0];
 await db.transaction(async tx=>{
  await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
  const first=await tx.query(`update ${table} set ${title}='Synthetic newer',updated_at=$2 where id=$1 and updated_at=$2 returning id`,[row.id,row.version]);expect(first.rows).toHaveLength(1);
  const stale=await tx.query(`update ${table} set ${title}='Synthetic stale',updated_at=$2 where id=$1 and updated_at=$2 returning id`,[row.id,row.version]);expect(stale.rows).toHaveLength(0);
 });
 expect((await db.query<{title:string}>(`select ${title} title from ${table} where id=$1`,[row.id])).rows[0].title).toBe('Synthetic newer');
});

it.each(tables)('ignores requested future/backdated versions and advances an existing future %s version',async table=>{
 const field=table==='cover_letter_templates'?'name':'title',extra=table==='saved_job_positions'?",url":"",value=table==='saved_job_positions'?",'https://thehub.io/jobs/future-version'":"";
 const id=(await db.query<{id:string}>(`insert into ${table}(user_id,${field}${extra},updated_at) values($1,'Synthetic future'${value},'2026-10-27T12:00:00Z') returning id`,[owner])).rows[0].id;
 const first=(await db.query<{version:string}>(`update ${table} set updated_at='2050-01-01' where id=$1 returning to_jsonb(updated_at)#>>'{}' version`,[id])).rows[0].version;
 expect(first).toBe('2026-10-27T12:00:00.000001+00:00');
 const second=(await db.query<{version:string}>(`update ${table} set updated_at='2000-01-01' where id=$1 returning to_jsonb(updated_at)#>>'{}' version`,[id])).rows[0].version;
 expect(second).toBe('2026-10-27T12:00:00.000002+00:00');
 await expect(db.query(`insert into ${table}(user_id,${field}${extra},updated_at) values($1,'Synthetic infinity'${value},'infinity')`,[owner])).rejects.toThrow();
});
it('keeps the shared trigger invoker, empty-path and unavailable for direct role execution',async()=>{
 expect((await db.query("select prosecdef,proconfig,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') authenticated,has_function_privilege('service_role',oid,'execute') service from pg_proc where oid='public.career_private_version_touch()'::regprocedure")).rows).toEqual([{prosecdef:false,proconfig:['search_path=\"\"'],anon:false,authenticated:false,service:false}]);
});
it.each(['upgrade','rollback','invalid-existing'] as const)('preserves private records during %s',async mode=>{
 const before=await createMigratedDatabase({owner,instant,beforeMigration:migration});
 try{
  if(mode==='invalid-existing')await before.query("insert into saved_job_positions(user_id,title,url,updated_at) values($1,'Synthetic legacy infinity','https://thehub.io/jobs/legacy-infinity','infinity')",[owner]);
  const snapshot=async()=>(await before.query("select jsonb_build_object('saved',(select jsonb_agg(to_jsonb(s) order by id) from saved_job_positions s),'applications',(select jsonb_agg(to_jsonb(a) order by id) from job_applications a),'templates',(select jsonb_agg(to_jsonb(t) order by id) from cover_letter_templates t)) data")).rows;
  const original=await snapshot();
  if(mode==='upgrade')await before.exec(sql);
  else await expect(before.transaction(async tx=>{await tx.exec(sql);if(mode==='rollback')throw Error('synthetic rollback');})).rejects.toThrow();
  expect(await snapshot()).toEqual(original);
  expect((await before.query<{found:boolean}>("select to_regprocedure('public.career_private_version_touch()') is not null found")).rows[0].found).toBe(mode==='upgrade');
 }finally{await before.close();}
},60_000);

it.each(tables)('enforces stale %s predicates through the actual SDK with no recovery request',async table=>{
 const emulator=new SupabaseEmulator(db,'https://example.supabase.co',{service:'TEST-ONLY-service',users:{[owner]:'TEST-ONLY-owner'}},()=>new Date(instant));let calls=0;
 const client=createClient('https://example.supabase.co','TEST-ONLY-owner',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>{calls++;return emulator.fetch(input,init);}}});
 const fields=table==='cover_letter_templates'?{name:'Synthetic SDK version',body:'Synthetic body'}:{title:'Synthetic SDK version',...(table==='saved_job_positions'?{url:'https://thehub.io/jobs/sdk-version'}:{})};
 const inserted=await client.from(table).insert({user_id:owner,...fields}).select('id,updated_at').single();expect(inserted.error).toBeNull();
 const row=inserted.data!,patch=table==='cover_letter_templates'?{body:'Synthetic SDK newer'}:{notes:'Synthetic SDK newer'};
 const first=await client.from(table).update(patch).eq('user_id',owner).eq('id',row.id).eq('updated_at',row.updated_at).select('id,updated_at');expect(first.error).toBeNull();expect(first.data).toHaveLength(1);expect(first.data![0].updated_at).not.toBe(row.updated_at);
 const second=await client.from(table).update(patch).eq('user_id',owner).eq('id',row.id).eq('updated_at',row.updated_at).select('id,updated_at');expect(second.error).toBeNull();expect(second.data).toEqual([]);expect(calls).toBe(3);
});
