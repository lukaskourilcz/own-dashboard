import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { readCareerRecords } from '@/lib/career-records';
import { isOsloSnapshot } from '@/lib/jobs/filter';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const migration='20261025233522_career_snapshot_remote_evidence.sql';
const instant='2026-10-26T12:00:00Z',scope=()=>({ownerId:owner,signal:new AbortController().signal});
let db:PGlite,client:SupabaseClient;
beforeAll(async()=>{
 db=await createMigratedDatabase({owner,instant});
 await db.query('insert into auth.users(id) values($1)',[other]);
 const emulator=new SupabaseEmulator(db,'https://example.supabase.co',{service:'TEST-ONLY-service',users:{[owner]:'TEST-ONLY-owner',[other]:'TEST-ONLY-other'}},()=>new Date(instant));
 client=createClient('https://example.supabase.co','TEST-ONLY-owner',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>emulator.fetch(input,init)}});
},60_000);
afterAll(async()=>{await db?.close();});
it.each([true,false,null])('preserves %s evidence through saved read, application transaction, retry and listing removal',async remote=>{
 const source='ashby-sanity',url=`https://jobs.ashbyhq.com/sanity/synthetic-${remote}`;
 const listing=(await db.query<{id:string}>("insert into job_listings(source,external_id,title,url,location,role,remote,native_remote_verified) values($1,$2,'Synthetic React role',$3,'Europe','frontend',true,true) returning id",[source,String(remote),url])).rows[0];
 const saved=await client.from('saved_job_positions').insert({user_id:owner,listing_id:listing.id,title:'Synthetic React role',url,source,location:'Europe',remote,cover_letter:'Synthetic private draft',notes:'Synthetic note'}).select().single();
 expect(saved.error).toBeNull();
 const snapshot=(await readCareerRecords(client,'saved_job_positions',scope())).data.find(row=>row.id===saved.data.id)!;
 expect(snapshot.remote).toBe(remote);expect(isOsloSnapshot(snapshot)).toBe(remote===true);
 const args={p_request_id:saved.data.id,p_saved_id:saved.data.id,p_payload:{title:snapshot.title,url,applied_on:'2026-10-26',remote:remote===true?false:true}};
 const first=await client.rpc('record_job_application',args);expect(first.error).toBeNull();expect(first.data.remote).toBe(remote);
 const retry=await client.rpc('record_job_application',args);expect(retry.error).toBeNull();expect(retry.data.id).toBe(first.data.id);expect(retry.data.remote).toBe(remote);
 await db.query('delete from job_listings where id=$1',[listing.id]);
 const app=(await readCareerRecords(client,'job_applications',scope())).data.find(row=>row.id===first.data.id)!;
 expect(app.remote).toBe(remote);expect(app.listing_id).toBeNull();expect(isOsloSnapshot(app)).toBe(remote===true);
 expect((await readCareerRecords(client,'saved_job_positions',scope())).data.some(row=>row.id===saved.data.id)).toBe(false);
 expect((await db.query<{count:number}>("select count(*)::int count from job_application_events where application_id=$1 and kind='applied'",[app.id])).rows[0].count).toBe(1);
});
it.each([true,false,null,undefined])('accepts only boolean or unknown direct application evidence: %s',async remote=>{
 const id=crypto.randomUUID(),result=await client.rpc('record_job_application',{p_request_id:id,p_saved_id:null,p_payload:{title:'Synthetic manual role',applied_on:'2026-10-26',remote}});
 expect(result.error).toBeNull();expect(result.data.remote).toBe(remote??null);
});
it.each(['true',1,{},[]])('rejects malformed evidence without creating history: %j',async remote=>{
 const id=crypto.randomUUID(),result=await client.rpc('record_job_application',{p_request_id:id,p_saved_id:null,p_payload:{title:'Synthetic malformed evidence',applied_on:'2026-10-26',remote}});
 expect(result.error).not.toBeNull();expect(result.data).toBeNull();
 expect((await db.query('select id from job_applications where request_id=$1',[id])).rows).toHaveLength(0);
});
it('keeps private remote evidence inside own-only RLS and explicit reader grants',async()=>{
 await db.query("insert into saved_job_positions(user_id,title,url,remote) values($1,'Foreign synthetic role','https://thehub.io/jobs/foreign-remote',true)",[other]);
 const result=await readCareerRecords(client,'saved_job_positions',scope());expect(result.data.some(row=>row.user_id!==owner)).toBe(false);
 await expect(readCareerRecords(client,'saved_job_positions',{...scope(),ownerId:other})).rejects.toThrow('Career unavailable');
 expect((await db.query("select prosecdef,proconfig,has_function_privilege('anon',oid,'execute') anon from pg_proc where oid='public.record_job_application(uuid,uuid,jsonb)'::regprocedure")).rows).toEqual([{prosecdef:false,proconfig:['search_path=""','lock_timeout=5s'],anon:false}]);
});
it.each(['missing','invalid'] as const)('refuses %s remote fields in a purported complete snapshot',async mode=>{
 const row={id:crypto.randomUUID(),user_id:owner,listing_id:null,title:'Synthetic malformed read',company:null,url:'https://thehub.io/jobs/malformed-read',source:'manual',location:'Europe',description:null,cover_letter:'',notes:null,saved_at:instant,updated_at:instant,cover_letter_url:null,readiness:'draft',...(mode==='invalid'?{remote:'true'}:{})};
 const malformed=createClient('https://example.supabase.co','TEST-ONLY-owner',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async()=>Response.json({ownerId:owner,collection:'saved_job_positions',rows:[row]})}});
 await expect(readCareerRecords(malformed,'saved_job_positions',scope())).rejects.toThrow('Career unavailable');
});
it.each(['upgrade','rollback'] as const)('does not infer or rewrite old private history during %s',async mode=>{
 const before=await createMigratedDatabase({owner,instant,beforeMigration:migration});
 try{
  await before.query("insert into saved_job_positions(user_id,title,url,source,location,cover_letter,notes) values($1,'Legacy synthetic role','https://thehub.io/jobs/legacy-remote','ashby-sanity','Europe','Synthetic historical draft','Synthetic note')",[owner]);
  await before.query("insert into job_applications(user_id,title,source,location,status,applied_on,cover_letter) values($1,'Legacy synthetic application','ashby-sanity','Europe','applied','2026-10-25','Synthetic historical letter')",[owner]);
  const snapshot=async()=> (await before.query("select jsonb_build_object('saved',(select jsonb_agg(to_jsonb(s)-'remote') from saved_job_positions s),'apps',(select jsonb_agg(to_jsonb(a)-'remote') from job_applications a)) data")).rows;
  const original=await snapshot(),sql=readFileSync(`supabase/migrations/${migration}`,'utf8');
  if(mode==='upgrade')await before.exec(sql);else await expect(before.transaction(async tx=>{await tx.exec(sql);throw Error('synthetic rollback');})).rejects.toThrow('synthetic rollback');
  expect(await snapshot()).toEqual(original);
  if(mode==='upgrade')expect((await before.query<{remote:boolean|null}>('select remote from saved_job_positions union all select remote from job_applications')).rows.every(row=>row.remote===null)).toBe(true);
  else expect((await before.query("select attname from pg_attribute where attrelid in ('saved_job_positions'::regclass,'job_applications'::regclass) and attname='remote' and not attisdropped")).rows).toHaveLength(0);
 }finally{await before.close();}
},60_000);
