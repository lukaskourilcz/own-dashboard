import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
const owner='11111111-1111-4111-8111-111111111111',other='99999999-9999-4999-8999-999999999999',migration='20261029155500_marketing_workspace_snapshot.sql';
let db:PGlite,emulator:SupabaseEmulator;
beforeAll(async()=>{db=await createMigratedDatabase({owner,instant:'2026-10-29T00:00:00Z'});await db.query('insert into auth.users(id) values($1)',[other]);emulator=new SupabaseEmulator(db,'https://snapshot.supabase.test',{service:'TEST-ONLY-SERVICE',users:{[owner]:'TEST-ONLY-OWNER',[other]:'TEST-ONLY-OTHER'}});},120_000);
afterAll(async()=>{await db?.close();});
const client=(token='TEST-ONLY-OWNER')=>createClient('https://snapshot.supabase.test','TEST-ONLY-PUBLISHABLE',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:emulator.fetch.bind(emulator),headers:{Authorization:`Bearer ${token}`}}});
async function campaign(name:string,status='draft',brand='devshark',user=owner,start='2026-10-29'){
 return(await db.query<{id:string}>(`insert into marketing_campaigns(user_id,brand,name,starts_on,ends_on,source_snapshot,source_hash,status) values($1,$2,$3,$4,$4::date+6,'{}',$5,$6) returning id`,[user,brand,name,start,createHash('sha256').update(name).digest('hex'),status])).rows[0].id;
}
async function entries(id:string,count:number,user=owner){await db.query(`insert into marketing_calendar_entries(user_id,campaign_id,source_id,date,local_time,kind,platform,title,original) select $1,$2,'entry-'||item,'2026-10-29','09:00','task','web','Current '||item,jsonb_build_object('private_body','TEST_ONLY_AUTHORED') from generate_series(1,$3::integer) item`,[user,id,count]);}
async function reset(){await db.query('delete from marketing_campaigns');emulator.requests.length=0;}
it('keeps both active brands ahead of newer drafts, with deterministic selected-head entries and original owner RLS',async()=>{
 await reset();const active=await campaign('Old active','active','devshark',owner,'2025-01-01'),activeOtherBrand=await campaign('Other active','active','dneskai',owner,'2025-01-01');
 for(let index=0;index<12;index++)await campaign(`Draft ${index}`,'draft','devshark',owner,`2026-11-${String(index+1).padStart(2,'0')}`);
 const foreign=await campaign('Foreign active','active','devshark',other);await entries(active,3);await entries(activeOtherBrand,1);await entries(foreign,5,other);
 const result=await client().rpc('marketing_workspace_snapshot');expect(result.error).toBeNull();expect(result.data.ownerId).toBe(owner);expect(result.data.entriesComplete).toBe(true);expect(result.data.campaigns).toHaveLength(10);
 expect(result.data.campaigns.slice(0,2).map((row:{id:string})=>row.id).sort()).toEqual([active,activeOtherBrand].sort());expect(result.data.entries).toHaveLength(4);expect(JSON.stringify(result.data)).not.toContain('Foreign active');
 const next=await client('TEST-ONLY-OTHER').rpc('marketing_workspace_snapshot');expect(next.error).toBeNull();expect(next.data.campaigns.map((row:{id:string})=>row.id)).toEqual([foreign]);expect(next.data.entries).toHaveLength(5);expect(next.data.ownerId).toBe(other);
 expect(emulator.requests).toHaveLength(2);
},120_000);
it('confirms exactly 10000 selected entries and explicitly refuses completeness above the cap without deleting history',async()=>{
 await reset();const id=await campaign('Large selected','active');await entries(id,10000);const exact=await client().rpc('marketing_workspace_snapshot');expect(exact.error).toBeNull();expect(exact.data.entriesComplete).toBe(true);expect(exact.data.entries).toHaveLength(10000);
 await db.query(`insert into marketing_calendar_entries(user_id,campaign_id,source_id,date,kind,platform,title,original) values($1,$2,'entry-extra','2026-10-29','task','web','Extra','{}')`,[owner,id]);
 const extra=await client().rpc('marketing_workspace_snapshot');expect(extra.error).toBeNull();expect(extra.data.entriesComplete).toBe(false);expect(extra.data.entries).toHaveLength(10000);expect((await db.query<{count:number}>('select count(*)::int count from marketing_calendar_entries')).rows[0].count).toBe(10001);
},120_000);
it('projects neither stored authored copies nor future private columns',async()=>{
 await reset();const id=await campaign('Projection','active');await entries(id,1);
 for(const table of ['marketing_campaigns','marketing_calendar_entries','marketing_revisions','marketing_publications','marketing_accounts','marketing_jobs','marketing_events','marketing_sources','marketing_source_history'])await db.exec(`alter table ${table} add column future_private_snapshot_test text default 'TEST_ONLY_FUTURE'`);
 const result=await client().rpc('marketing_workspace_snapshot');expect(result.error).toBeNull();expect(JSON.stringify(result.data)).not.toContain('TEST_ONLY_');expect(result.data.entries[0]).not.toHaveProperty('original');expect(result.data.campaigns[0]).not.toHaveProperty('source_snapshot');
});
it('grants only authenticated execution and keeps an invoker stable empty-search-path function',async()=>{
 const metadata=(await db.query<{prosecdef:boolean;provolatile:string;proconfig:string[]}>('select prosecdef,provolatile,proconfig from pg_proc where oid=\'public.marketing_workspace_snapshot()\'::regprocedure')).rows[0];expect(metadata.prosecdef).toBe(false);expect(metadata.provolatile).toBe('s');expect(metadata.proconfig).toContain('search_path=""');
 for(const role of ['anon','service_role','authenticated'])expect((await db.query<{allowed:boolean}>('select has_function_privilege($1,\'public.marketing_workspace_snapshot()\',\'execute\') allowed',[role])).rows[0].allowed).toBe(role==='authenticated');
 const service=await client('TEST-ONLY-SERVICE').rpc('marketing_workspace_snapshot');expect(service.error?.code).toBe('42501');
});
it('preserves existing owner records through upgrade and transaction rollback',async()=>{
 const before=await createMigratedDatabase({owner,instant:'2026-10-29T00:00:00Z',beforeMigration:migration});
 try{await before.query(`insert into marketing_campaigns(user_id,brand,name,starts_on,ends_on,source_snapshot,source_hash) values($1,'devshark','Existing','2026-10-29','2026-11-04','{}',$2)`,[owner,'a'.repeat(64)]);
 const original=(await before.query('select to_jsonb(c) data from marketing_campaigns c')).rows,sql=readFileSync(`supabase/migrations/${migration}`,'utf8');
 await before.exec('begin');await before.exec(sql);expect((await before.query('select to_jsonb(c) data from marketing_campaigns c')).rows).toEqual(original);await before.exec('rollback');expect((await before.query("select to_regprocedure('public.marketing_workspace_snapshot()') result")).rows[0]).toEqual({result:null});
 await before.exec(sql);expect((await before.query('select to_jsonb(c) data from marketing_campaigns c')).rows).toEqual(original);
 }finally{await before.close();}
},120_000);
