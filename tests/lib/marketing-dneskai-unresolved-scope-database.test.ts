import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll,afterAll,describe,it,expect,vi } from 'vitest';
vi.mock('server-only',()=>({}));

// Owner decision 17: an unknown collection cost blocks paid work only on its own run and Prague day.
// Replays the collection migrations, unchanged, then the new scope migration, in isolated WASM Postgres.
const BASE=['20261013193134_marketing_dneskai_collection.sql','20261013193136_dneskai_collection_pilot.sql','20261021122104_dneskai_collection_cursor_limits.sql'];
const SCOPE='20261022171000_dneskai_collection_unresolved_scope.sql';
const owner='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222',secondProject='44444444-4444-4444-8444-444444444444',fence='55555555-5555-4555-8555-555555555555';
const sources=[{id:'instagram:mosseri',kind:'instagram',maxItems:10},{id:'instagram:meta.ai',kind:'instagram',maxItems:10}];
const json=JSON.stringify;
let db:PGlite;
const at=(instant:string)=>db.query("select set_config('marketing.test_time',$1,false)",[instant]);
async function admit(date:string,projectId=project){const id=(await db.query<{r:{id:string}}>('select marketing_dneskai_admit($1,$2,$3,$4) r',[owner,projectId,date,json(sources)])).rows[0].r.id;await db.query('select marketing_dneskai_claim($1,$2,$3)',[owner,id,fence]);return id;}
const paid=(run:string,source:string)=>db.query('select marketing_dneskai_claim_stage($1,$2,$3,$4,true)',[owner,run,fence,source]);
const unknown=(run:string,source:string)=>db.query('select marketing_dneskai_save_stage($1,$2,$3,$4,$5)',[owner,run,fence,source,json({status:'held',items:[],complete:false,costUsd:null,errorCode:'collection-paid-outcome-ambiguous'})]);
const definition=async()=>(await db.query<{d:string}>("select pg_get_functiondef('public.marketing_dneskai_claim_stage(uuid,uuid,uuid,text,boolean)'::regprocedure) d")).rows[0].d;
const row=async(run:string,source:string)=>(await db.query('select reserved_usd,cost_usd,status,error_code from marketing_dneskai_stages where run_id=$1 and source_id=$2',[run,source])).rows[0];

let oldRun:string;let before:string;
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table public.projects(id uuid primary key,user_id uuid,portfolio_key text,repo_full_name text,parent_id uuid,previous_repo_full_names text[] default '{}');create table public.user_preferences(hidden_project_tabs text[] default '{}');create schema marketing_private;grant usage on schema marketing_private to service_role;create table marketing_private.generation_pilots(user_id uuid primary key,starts_at timestamptz,expires_at timestamptz);`);
 // OFFLINE clock simulation in this isolated database only. Migration sources execute unchanged.
 await db.exec(`create or replace function pg_catalog.clock_timestamp() returns timestamptz language sql volatile as $$select current_setting('marketing.test_time')::timestamptz$$;`);
 await db.query('insert into auth.users values($1)',[owner]);await db.query("insert into projects(id,user_id,portfolio_key) values($1,$2,'aifirst'),($3,$2,'aifirst')",[project,owner,secondProject]);
 for(const file of BASE)await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
 // An old night leaves one paid stage whose cost never arrived, like the staging Apify run.
 await at('2026-10-13T20:30:00Z');oldRun=await admit('2026-10-13');await paid(oldRun,'instagram:mosseri');await unknown(oldRun,'instagram:mosseri');
 before=await definition();
},30000);
afterAll(async()=>await db?.close());

describe('unknown collection cost scoped to its run and Prague day (decision 17)',()=>{
 it('before the migration, an old unknown cost blocks every later night',async()=>{
  await at('2026-10-14T20:30:00Z');const run=await admit('2026-10-14');
  await expect(paid(run,'instagram:mosseri')).rejects.toThrow('collection cost unresolved');
 });

 it('rewrites only the guard and is idempotent',async()=>{
  await db.exec(readFileSync(`supabase/migrations/${SCOPE}`,'utf8'));
  const after=await definition();
  const unscoped="if exists(select 1 from public.marketing_dneskai_stages where user_id=p_owner and reserved_usd>0 and (cost_usd is null or cost_usd>reserved_usd)) then raise exception 'collection cost unresolved';end if;";
  expect(before.split(unscoped)).toHaveLength(2);
  expect(after).not.toContain(unscoped);
  // Everything else (limits, pilot checks, daily ceiling) is byte for byte what it was.
  const scoped="if exists(select 1 from public.marketing_dneskai_stages st join public.marketing_dneskai_runs ru on ru.id=st.run_id where st.user_id=p_owner and st.reserved_usd>0 and (st.cost_usd is null or st.cost_usd>st.reserved_usd) and (st.run_id=p_run or ru.date=r.date)) then raise exception 'collection cost unresolved';end if;";
  expect(after).toBe(before.split(unscoped).join(scoped));
  await db.exec(readFileSync(`supabase/migrations/${SCOPE}`,'utf8'));
  expect(await definition()).toBe(after);
  const grants=(await db.query<{a:boolean;s:boolean}>("select has_function_privilege('authenticated','public.marketing_dneskai_claim_stage(uuid,uuid,uuid,text,boolean)','execute') a,has_function_privilege('service_role','public.marketing_dneskai_claim_stage(uuid,uuid,uuid,text,boolean)','execute') s")).rows[0];
  expect(grants).toEqual({a:false,s:true});
 });

 it('lets a later night pay and leaves the old reservation untouched',async()=>{
  const run=(await db.query<{id:string}>("select id from marketing_dneskai_runs where date='2026-10-14' and project_id=$1",[project])).rows[0].id;
  await paid(run,'instagram:mosseri');
  expect(await row(run,'instagram:mosseri')).toMatchObject({reserved_usd:'0.04',status:'running'});
  expect(await row(oldRun,'instagram:mosseri')).toMatchObject({reserved_usd:'0.04',cost_usd:null,status:'held',error_code:'collection-paid-outcome-ambiguous'});
 });

 it('still blocks the same run and every run of the same Prague day',async()=>{
  const run=(await db.query<{id:string}>("select id from marketing_dneskai_runs where date='2026-10-14' and project_id=$1",[project])).rows[0].id;
  await unknown(run,'instagram:mosseri');
  await expect(paid(run,'instagram:meta.ai')).rejects.toThrow('collection cost unresolved');
  const other=await admit('2026-10-14',secondProject);
  await expect(paid(other,'instagram:mosseri')).rejects.toThrow('collection cost unresolved');
  // The next day is free of both.
  await at('2026-10-15T20:30:00Z');const next=await admit('2026-10-15');
  await paid(next,'instagram:mosseri');
  expect(await row(next,'instagram:mosseri')).toMatchObject({reserved_usd:'0.04',status:'running'});
 });
});
