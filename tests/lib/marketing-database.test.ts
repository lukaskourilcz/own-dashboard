import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let db: PGlite;
const owner='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const revision='33333333-3333-4333-8333-333333333333';
const sha='a'.repeat(64);
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role;
 alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create table public.projects(id uuid primary key,user_id uuid not null);
 create table public.ai_links(id uuid primary key,user_id uuid not null);
 insert into auth.users values('${owner}'),('${other}');`);
 await db.exec(readFileSync('supabase/migrations/20261012225640_marketing_control_surface.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261012232949_marketing_durable_jobs.sql','utf8'));
},30000);
afterAll(async()=>{await db?.close();});

describe('durable marketing approval',()=>{
 it('revokes Supabase default function privileges before restoring intended caller roles',async()=>{
  const signatures=['marketing_ingest_source(uuid,jsonb)','marketing_claim_due(uuid,integer,text,uuid)','marketing_save_revision(uuid,uuid,jsonb,text,boolean,jsonb,uuid)','marketing_import_campaign(uuid,jsonb,jsonb)','marketing_enqueue_job(uuid,uuid,text,jsonb)','marketing_claim_job(uuid,uuid,uuid)','marketing_finish_job(uuid,uuid,uuid,jsonb,text)','marketing_record_receipt(uuid,uuid,text,text,text,text,text)','marketing_checkpoint_publication(uuid,uuid,text,text,text,text)','marketing_finish_publication(uuid,uuid,text,text,text,text,text,text,text)'];
  for(const signature of signatures){const {rows}=await db.query<{anon:boolean;authenticated:boolean;service:boolean}>("select has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') authenticated,has_function_privilege('service_role',$1,'EXECUTE') service",[signature]);expect(rows[0],signature).toEqual({anon:false,authenticated:false,service:true});}
  for(const signature of ['marketing_approve_revision(uuid,text)','marketing_decide_revision(uuid,text,text)','marketing_activate_campaign(uuid,text)','marketing_release_calendar_entry(uuid,text,uuid,date,text,text)']){const {rows}=await db.query<{anon:boolean;authenticated:boolean}>("select has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') authenticated",[signature]);expect(rows[0],signature).toEqual({anon:false,authenticated:true});}
 });
 it('isolates owner reads and rejects foreign knowledge links',async()=>{
  await db.query('insert into ai_links(id,user_id) values($1,$2)',['55555555-5555-4555-8555-555555555555',other]);
  await expect(db.query(`insert into marketing_revisions(user_id,brand,revision,content_hash) values($1,'devshark',$2,$3)`,[owner,JSON.stringify({knowledgeIds:['55555555-5555-4555-8555-555555555555']}),sha])).rejects.toThrow('foreign knowledge');
  await db.query(`insert into marketing_accounts(user_id,brand,platform,remote_account_id,handle) values($1,'dneskai','threads','hidden','hidden')`,[other]);
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[owner]);
  await db.exec('set role authenticated');
  expect((await db.query('select * from marketing_accounts')).rows).toHaveLength(0);
  await db.exec('reset role');
 });
 it('persists duplicate jobs once, fences execution and holds expired workers',async()=>{
  const key='66666666-6666-4666-8666-666666666666'; const fence='77777777-7777-4777-8777-777777777777';
  const first=await db.query<{j:{jobId:string;duplicate:boolean}}>('select marketing_enqueue_job($1,$2,$3,$4) j',[owner,key,sha,'{}']);
  const id=first.rows[0].j.jobId;
  const duplicate=await db.query<{j:{jobId:string;duplicate:boolean}}>('select marketing_enqueue_job($1,$2,$3,$4) j',[owner,key,sha,'{}']);
  expect(duplicate.rows[0].j).toMatchObject({jobId:id,duplicate:true});
  await expect(db.query('select marketing_enqueue_job($1,$2,$3,$4)',[owner,key,'b'.repeat(64),'{}'])).rejects.toThrow('job identity conflict');
  await expect(db.query('select marketing_claim_job($1,$2,$3)',[other,id,fence])).rejects.toThrow('job unavailable');
  await db.query('select marketing_claim_job($1,$2,$3)',[owner,id,fence]);
  expect((await db.query<{r:null}>('select marketing_claim_job($1,$2,$3) r',[owner,id,fence])).rows[0].r).toBeNull();
  await expect(db.query('select marketing_finish_job($1,$2,$3,$4,$5)',[owner,id,key,null,'failed'])).rejects.toThrow('job fence lost');
  await db.query(`update marketing_jobs set lease_until=now()-interval '1 minute' where id=$1`,[id]);
  await db.query('select marketing_claim_job($1,$2,$3)',[owner,id,fence]);
  expect((await db.query<{status:string}>('select status from marketing_jobs where id=$1',[id])).rows[0].status).toBe('reconciliation');
 });
 it('rejects cross-owner children even with a privileged writer',async()=>{
  await db.exec(`insert into projects values('44444444-4444-4444-8444-444444444444','${other}')`);
  await expect(db.query(`insert into marketing_sources(user_id,project_id,brand,source_id,source_revision,content_hash,packet,observed_at,eligible) values($1,$2,'devshark','foreign','v1',$3,'{}',now(),true)`,[owner,'44444444-4444-4444-8444-444444444444',sha])).rejects.toThrow('foreign project');
 });
 it('approves atomically and idempotently, then invalidates on source edit',async()=>{
  const packet={brand:'devshark',sourceId:'question:q1',sourceRevision:'v1',contentHash:sha,observedAt:new Date().toISOString(),expiresAt:null,eligible:true};
  await db.query('select marketing_ingest_source($1,$2)',[owner,JSON.stringify(packet)]);
  await db.query(`insert into marketing_accounts(user_id,brand,platform,remote_account_id,handle,verified_at) values($1,'devshark','instagram','account1','devshark.app',now())`,[owner]);
  const content={scheduledAt:new Date(Date.now()+3600000).toISOString(),account:{id:'account1',platform:'instagram',handle:'devshark.app'},sources:[{sourceId:'question:q1',sourceRevision:'v1',contentHash:sha}]};
  await db.query(`insert into marketing_revisions(id,user_id,brand,revision,content_hash,ready) values($1,$2,'devshark',$3,$4,true)`,[revision,owner,JSON.stringify(content),sha]);
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[other]);
  await expect(db.query('select marketing_approve_revision($1,$2)',[revision,sha])).rejects.toThrow('revision unavailable');
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[owner]);
  await expect(db.query('select marketing_approve_revision($1,$2)',[revision,'b'.repeat(64)])).rejects.toThrow('revision changed');
  await db.query('select marketing_approve_revision($1,$2)',[revision,sha]);
  await db.query('select marketing_approve_revision($1,$2)',[revision,sha]);
  expect((await db.query<{count:number}>('select count(*)::int as count from marketing_publications')).rows[0].count).toBe(1);
  await db.query('select marketing_ingest_source($1,$2)',[owner,JSON.stringify({...packet,sourceRevision:'v2',observedAt:new Date(Date.now()+1000).toISOString()})]);
  const r=await db.query<{status:string;approved_hash:string|null}>('select status,approved_hash from marketing_revisions where id=$1',[revision]);
  expect(r.rows[0]).toEqual({status:'superseded',approved_hash:null});
  expect((await db.query<{status:string}>('select status from marketing_publications')).rows[0].status).toBe('cancelled');
 });
 it('fences competing publishers, atomically records receipts, and rejects claimed edits',async()=>{
  const id='88888888-8888-4888-8888-888888888888';const content={brand:'devshark',scheduledAt:new Date(Date.now()+300).toISOString(),account:{id:'account1',platform:'instagram',handle:'devshark.app'},sources:[{sourceId:'question:q1',sourceRevision:'v2',contentHash:sha}]};
  await db.query(`insert into marketing_revisions(id,user_id,brand,revision,content_hash,ready) values($1,$2,'devshark',$3,$4,true)`,[id,owner,JSON.stringify(content),sha]);
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[owner]);
  const approved=await db.query<{id:string}>('select marketing_approve_revision($1,$2) id',[id,sha]);const publication=approved.rows[0].id;
  await db.query('update marketing_accounts set enabled=true where user_id=$1',[owner]);
  await new Promise(resolve=>setTimeout(resolve,400));
  expect((await db.query('select * from marketing_claim_due($1,1,$2)',[owner,'dneskai'])).rows).toHaveLength(0);
  expect((await db.query('select * from marketing_claim_due($1,1,$2)',[owner,'devshark'])).rows).toHaveLength(1);
  expect((await db.query('select * from marketing_claim_due($1,1,$2)',[owner,'devshark'])).rows).toHaveLength(0);
  await expect(db.query('select marketing_decide_revision($1,$2,$3)',[id,'returned','changed'])).rejects.toThrow('revision unavailable');
  await expect(db.query('select marketing_save_revision($1,$2,$3,$4,$5,$6,$7)',[owner,'99999999-9999-4999-8999-999999999999',JSON.stringify(content),sha,true,'[]',id])).rejects.toThrow('replacement unavailable');
  await db.query('select marketing_checkpoint_publication($1,$2,$3,$4,$5,$6)',[owner,publication,null,null,'intent:'+sha,'container-create-intent']);
  await expect(db.query('select marketing_checkpoint_publication($1,$2,$3,$4,$5,$6)',[owner,publication,null,null,'other','container-create-intent'])).rejects.toThrow('publication fence lost');
  await expect(db.query('select marketing_finish_publication($1,$2,$3,$4,$5,$6,$7,$8,$9)',[owner,publication,null,null,'failed',null,null,null,'lost'])).rejects.toThrow('publication fence lost');
  await db.query('select marketing_finish_publication($1,$2,$3,$4,$5,$6,$7,$8,$9)',[owner,publication,'intent:'+sha,'container-create-intent','published','123','456','https://www.instagram.com/p/test-only/',null]);
  expect((await db.query<{status:string}>('select status from marketing_revisions where id=$1',[id])).rows[0].status).toBe('published');
  expect((await db.query<{status:string}>('select status from marketing_publications where id=$1',[publication])).rows[0].status).toBe('published');
  await expect(db.query('select marketing_record_receipt($1,$2,$3,$4,$5,$6,$7)',[owner,publication,'published','123','different','https://www.instagram.com/p/test-only/',null])).rejects.toThrow('receipt conflict');
 });
 it('does not grant browser roles direct approval-table writes',async()=>{
  const r=await db.query<{allowed:boolean}>(`select has_table_privilege('authenticated','marketing_revisions','UPDATE') as allowed`);
  expect(r.rows[0].allowed).toBe(false);
 });
});
