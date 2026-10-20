import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll,afterAll,describe,it,expect,vi } from 'vitest';
import { candidate } from '@/lib/marketing/dneskai-providers';
import { contentHash } from '@/lib/marketing/hashes';
import { dneskaiCheapIdentity } from '@/lib/marketing/dneskai-registry';
vi.mock('server-only',()=>({}));

// Replays the three applied-or-new collection migrations, unchanged, in isolated WASM Postgres.
const MIGRATIONS=['20261013165236_marketing_dneskai_collection.sql','20261013181506_dneskai_collection_pilot.sql','20261020100000_dneskai_collection_cursor_limits.sql'];
const owner='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222',fence='55555555-5555-4555-8555-555555555555';
const json=JSON.stringify;
let db:PGlite;

/** An OFFLINE feed: one item every two hours, newest first, like a publisher's RSS. */
const feedItems=Array.from({length:60},(_,i)=>{const at=new Date(Date.parse('2026-10-14T19:00:00Z')-i*7_200_000).toISOString();return{externalId:`OFFLINE-${at}`,at};});
/** What a provider returns for a window: items newer than `since` and not after `now`, newest first, capped. */
function read(since:string,now:string,cap:number){return feedItems.filter(row=>row.at>since&&row.at<=now).slice(0,cap);}
function payload(row:{externalId:string;at:string},fetchedAt:string){const item=candidate('openai-blog',row.externalId,`OFFLINE title ${row.at}`,`OFFLINE source claim ${row.at}`,`https://example.test/${row.at}`,row.at,fetchedAt);const identity=dneskaiCheapIdentity(item);return{...item,canonicalUrlHash:contentHash(identity.canonicalUrl),normalizedTextHash:contentHash(identity.normalizedText)};}
const at=(instant:string)=>db.query("select set_config('marketing.test_time',$1,false)",[instant]);
async function admit(date:string,sources:unknown[]){return(await db.query<{r:{id:string}}>('select marketing_dneskai_admit($1,$2,$3,$4) r',[owner,project,date,json(sources)])).rows[0].r.id;}
const claim=(run:string)=>db.query('select marketing_dneskai_claim($1,$2,$3)',[owner,run,fence]);
const claimStage=(run:string,source:string,paid=false)=>db.query('select marketing_dneskai_claim_stage($1,$2,$3,$4,$5)',[owner,run,fence,source,paid]);
const save=(run:string,source:string,result:Record<string,unknown>)=>db.query('select marketing_dneskai_save_stage($1,$2,$3,$4,$5)',[owner,run,fence,source,json(result)]);
const plan=(run:string,count:number)=>db.query<{n:number}>('select marketing_dneskai_plan_jev($1,$2,$3,$4) n',[owner,run,fence,count]);
const sinceOf=async(run:string,source:string)=>new Date((await db.query<{since_at:string}>('select since_at from marketing_dneskai_stages where run_id=$1 and source_id=$2',[run,source])).rows[0].since_at).toISOString();
const cursorOf=async(source:string)=>{const value=(await db.query<{last_success_at:string|null}>('select last_success_at from marketing_dneskai_source_states where source_id=$1',[source])).rows[0]?.last_success_at;return value?new Date(value).toISOString():null;};
const candidateCount=async()=>Number((await db.query<{n:string}>('select count(*) n from marketing_dneskai_candidates')).rows[0].n);

beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table public.projects(id uuid primary key,user_id uuid,portfolio_key text,repo_full_name text,parent_id uuid,previous_repo_full_names text[] default '{}');create table public.user_preferences(hidden_project_tabs text[] default '{}');create schema marketing_private;grant usage on schema marketing_private to service_role;create table marketing_private.generation_pilots(user_id uuid primary key,starts_at timestamptz,expires_at timestamptz);`);
 // OFFLINE clock simulation in this isolated database only. Migration sources execute unchanged.
 await db.exec(`create or replace function pg_catalog.clock_timestamp() returns timestamptz language sql volatile as $$select current_setting('marketing.test_time')::timestamptz$$;`);
 await at('2026-10-13T20:30:00Z');
 await db.query('insert into auth.users values($1)',[owner]);await db.query("insert into projects(id,user_id,portfolio_key) values($1,$2,'aifirst')",[project,owner]);
 for(const file of MIGRATIONS)await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
},30000);
afterAll(async()=>await db.close());

describe('collection cursor and limits: real migration SQL, OFFLINE clock and feed',()=>{
 it('continues the next run from the newest item of a capped read and inserts no duplicate',async()=>{
  const first=await admit('2026-10-13',[{id:'openai-blog',kind:'rss',maxItems:20}]);await claim(first);
  expect(await sinceOf(first,'openai-blog')).toBe('2026-10-06T20:30:00.000Z');
  expect((await db.query("select * from marketing_dneskai_stages where run_id=$1 and kind='jev'",[first])).rows).toHaveLength(0);
  // Run 1 reads the newest 20 items of the opening window and stops at the cap.
  const run1=read('2026-10-06T20:30:00.000Z','2026-10-13T20:30:00.000Z',20);expect(run1).toHaveLength(20);
  await claimStage(first,'openai-blog');
  await save(first,'openai-blog',{status:'partial',items:run1.map(row=>payload(row,'2026-10-13T20:30:00Z')),complete:false,costUsd:0,errorCode:'collection-source-item-cap'});
  expect(await cursorOf('openai-blog')).toBe(run1[0].at);
  expect(await candidateCount()).toBe(20);
  expect((await db.query<{status:string;error_code:string}>('select status,error_code from marketing_dneskai_source_states')).rows[0]).toMatchObject({status:'partial',error_code:'collection-source-item-cap'});
  await db.query('select marketing_dneskai_finish($1,$2,$3,$4,null)',[owner,first,fence,'partial']);

  // Run 2, next evening: the stage window starts at the cursor (minus the 5-minute overlap), not seven days back.
  await at('2026-10-14T20:30:00Z');
  const second=await admit('2026-10-14',[{id:'openai-blog',kind:'rss',maxItems:20}]);await claim(second);
  const since=await sinceOf(second,'openai-blog');
  expect(since).toBe(new Date(Date.parse(run1[0].at)-5*60_000).toISOString());
  const run2=read(since,'2026-10-14T20:30:00.000Z',20);
  expect(run2.length).toBeLessThan(20);
  expect(run2.every(row=>row.at>=run1[0].at)).toBe(true);
  expect(run2.some(row=>row.at===run1[0].at)).toBe(true); // the overlap re-reads exactly one known item
  await claimStage(second,'openai-blog');
  await save(second,'openai-blog',{status:'ok',items:run2.map(row=>payload(row,'2026-10-14T20:30:00Z')),complete:true,costUsd:0,errorCode:null});
  expect(await candidateCount()).toBe(20+run2.length-1);
  expect(Number((await db.query<{n:string}>('select count(distinct canonical_url_hash) n from marketing_dneskai_candidates')).rows[0].n)).toBe(await candidateCount());
  expect(await cursorOf('openai-blog')).toBe(new Date((await db.query<{created_at:string}>('select created_at from marketing_dneskai_runs where id=$1',[second])).rows[0].created_at).toISOString());
 });
 it('never moves the cursor back, past now, or on error, invalid URLs, other partials or empty results',async()=>{
  const run=(await db.query<{id:string}>("select id from marketing_dneskai_runs where date='2026-10-14'")).rows[0].id;
  const before=await cursorOf('openai-blog');
  await db.exec(`insert into marketing_dneskai_stages(user_id,run_id,source_id,kind,since_at,max_items) select user_id,id,s,'feed',created_at,20 from marketing_dneskai_runs, unnest(array['t-error','t-url','t-partial','t-empty','t-future','t-old','t-undated']) s where date='2026-10-14'`);
  const items=(source:string,instant:string)=>[{...payload({externalId:`${source}-x`,at:instant},'2026-10-14T20:30:00Z'),sourceId:source}];
  for(const [source,result] of [['t-error',{status:'partial',errorCode:'collection-source-error'}],['t-url',{status:'partial',errorCode:'collection-source-invalid-url'}],['t-partial',{status:'partial',errorCode:'collection-source-partial'}]] as const){
   await claimStage(run,source);await save(run,source,{...result,items:items(source,'2026-10-14T20:00:00Z'),complete:false,costUsd:0});expect(await cursorOf(source)).toBeNull();
  }
  await claimStage(run,'t-empty');await save(run,'t-empty',{status:'partial',errorCode:'collection-source-item-cap',items:[],complete:false,costUsd:0});expect(await cursorOf('t-empty')).toBeNull();
  // A capped read whose newest item claims a future time cannot push the cursor beyond the database clock.
  await claimStage(run,'t-future');await save(run,'t-future',{status:'partial',errorCode:'collection-source-item-cap',items:items('t-future','2026-10-14T20:31:00Z'),complete:false,costUsd:0});expect(await cursorOf('t-future')).toBe('2026-10-14T20:30:00.000Z');
  // An undated item counts at its fetch time (the SQL fallback; the provider normally dates it already).
  const undated={...payload({externalId:'t-undated-x',at:'2026-10-12T01:00:00Z'},'2026-10-14T20:10:00Z'),sourceId:'t-undated',publishedAt:null};
  await claimStage(run,'t-undated');await save(run,'t-undated',{status:'partial',errorCode:'collection-source-item-cap',items:[undated,...items('t-undated','2026-10-14T19:00:00Z')],complete:false,costUsd:0});expect(await cursorOf('t-undated')).toBe('2026-10-14T20:10:00.000Z');
  // An older capped read never rewinds a later cursor.
  await claimStage(run,'t-old');await save(run,'t-old',{status:'ok',errorCode:null,items:[],complete:true,costUsd:0});const later=await cursorOf('t-old');
  await db.query("update marketing_dneskai_stages set status='queued' where run_id=$1 and source_id='t-old'",[run]);
  await claimStage(run,'t-old');await save(run,'t-old',{status:'partial',errorCode:'collection-source-item-cap',items:items('t-old','2026-10-10T00:00:00Z'),complete:false,costUsd:0});expect(await cursorOf('t-old')).toBe(later);
  expect(await cursorOf('openai-blog')).toBe(before);
 });
 it('plans Jev stages once, only after the sources, within 0..16',async()=>{
  await at('2026-10-15T20:30:00Z');
  const run=await admit('2026-10-15',[{id:'openai-blog',kind:'rss',maxItems:20}]);await claim(run);
  await expect(plan(run,1)).rejects.toThrow('sources pending');
  await claimStage(run,'openai-blog');await save(run,'openai-blog',{status:'ok',items:[],complete:true,costUsd:0,errorCode:null});
  await expect(plan(run,17)).rejects.toThrow('plan invalid');
  expect((await plan(run,3)).rows[0].n).toBe(3);
  expect((await plan(run,9)).rows[0].n).toBe(3);
  expect((await db.query<{source_id:string}>("select source_id from marketing_dneskai_stages where run_id=$1 and kind='jev' order by source_id",[run])).rows.map(row=>row.source_id)).toEqual(['__jev:00','__jev:01','__jev:02']);
  expect((await db.query<{jev_stage_count:number}>('select jev_stage_count from marketing_dneskai_runs where id=$1',[run])).rows[0].jev_stage_count).toBe(3);
  const permissions=(await db.query<{allowed:boolean}>("select has_function_privilege('authenticated','marketing_dneskai_plan_jev(uuid,uuid,uuid,integer)','execute') allowed")).rows[0];expect(permissions.allowed).toBe(false);
  await expect(db.query('select marketing_dneskai_plan_jev($1,$2,$3,$4)',[owner,run,'66666666-6666-4666-8666-666666666666',1])).rejects.toThrow('fence');
 });
 it('admits 10-item Instagram stages and 50 reserved items a day within the unchanged $0.25',async()=>{
  await at('2026-10-16T20:30:00Z');
  const profiles=['mosseri','meta.ai','technology','techcrunch','theapplehub','insidertech'].map(name=>({id:`instagram:${name}`,kind:'instagram',maxItems:10}));
  const run=await admit('2026-10-16',profiles);await claim(run);
  for(const profile of profiles.slice(0,5)){await claimStage(run,profile.id,true);await save(run,profile.id,{status:'partial',items:[],complete:false,costUsd:0.023,errorCode:'collection-source-partial'});}
  expect(Number((await db.query<{n:string}>('select sum(reserved_items) n from marketing_dneskai_stages where run_id=$1',[run])).rows[0].n)).toBe(50);
  expect(Number((await db.query<{n:string}>('select sum(reserved_usd) n from marketing_dneskai_stages where run_id=$1',[run])).rows[0].n)).toBeCloseTo(0.2);
  await expect(claimStage(run,profiles[5].id,true)).rejects.toThrow('daily budget exceeded');
  await at('2026-10-17T20:30:00Z');
  const next=await admit('2026-10-17',[{id:'instagram:mosseri',kind:'instagram',maxItems:11}]);await claim(next);
  await expect(claimStage(next,'instagram:mosseri',true)).rejects.toThrow('daily budget exceeded');
  await expect(db.query("update marketing_dneskai_stages set reserved_items=11 where run_id=$1",[next])).rejects.toThrow('reserved_items');
 });
});
