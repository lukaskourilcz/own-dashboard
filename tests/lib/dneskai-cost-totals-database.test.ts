import { createClient } from '@supabase/supabase-js';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import { readDneskaiCosts } from '@/lib/marketing/dneskai-workspace-read';
import type { DneskaiReadDatabase } from '@/lib/marketing/dneskai-read-database.generated';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { DneskaiCostsReadSchema } from '@/lib/marketing/dneskai-workspace';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',project='33333333-3333-4333-8333-333333333333',foreign='44444444-4444-4444-8444-444444444444';
const now='2026-10-25T12:00:00Z';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
vi.mock('server-only', () => ({}));
let db:PGlite; let transaction=true;
type Snapshot={ownerId:string;projectId:string;dayCount:number;asOf:string;days:Array<{date:string;collectionUsd:number;generationUsd:number;generationBookedUsd:number;unknown:number}>;ticks:{total:number;withErrors:number;generationDeferred:number;meaningfulCount:number;lastStartedAt:string|null;recent:Array<{id:string;started_at:string;did:unknown[];errors:unknown[]}>}};
async function snapshot(days=7,at=now,sub:string|null=owner,target=project){
 await db.exec('savepoint cost_read');
 try {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[sub??'']);await db.exec('set role authenticated');
  const value=(await db.query<{result:Snapshot}>('select public.marketing_dneskai_cost_totals($1,$2,$3::timestamptz) as result',[target,days,at])).rows[0]!.result;
  await db.exec('reset role; release savepoint cost_read');return value;
 } catch(error) {await db.exec('rollback to savepoint cost_read; reset role; release savepoint cost_read');throw error;}

}
beforeAll(async()=>{
 db=await createMigratedDatabase({owner,instant:now});await db.query('insert into auth.users(id,email) values($1,$2)',[other,'other@example.test']);
 await db.query("insert into public.projects(id,user_id,name,slug) values($1,$2,'Offline project','offline'),($3,$4,'Foreign project','offline')",[project,owner,foreign,other]);
 await db.query(`insert into public.marketing_jobs(id,user_id,idempotency_key,request_hash,request,status,result,created_at)
 select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,repeat('a',64),
 '{"generation":{"source":{"brand":"dneskai"}}}'::jsonb,'review','{"usage":{"estimatedCostUsd":"0.01"}}'::jsonb,$2::timestamptz-interval '1 hour' from generate_series(1,120) n`,[owner,now]);
 await db.query(`insert into public.marketing_ticks(id,user_id,kind,started_at,did,errors)
 select ('00000000-0000-4000-8000-'||lpad((10000+n)::text,12,'0'))::uuid,$1,'minute',$2::timestamptz-n*interval '40 seconds',
 case when n=1900 then '[{"category":"generation","status":"deferred","code":"tick-budget-exhausted"}]'::jsonb else '[]'::jsonb end,
 case when n=1800 then '[{"category":"token","code":"token-failed"}]'::jsonb else '[]'::jsonb end from generate_series(0,2000) n`,[owner,now]);
 await db.query("insert into public.marketing_dneskai_runs(user_id,project_id,date,target_date,status,cost_usd,created_at) values($1,$2,'2026-10-25','2026-10-26','complete',0.04,$3)",[owner,project,now]);
},120000);
afterAll(async()=>{await db?.close();});beforeEach(async()=>{transaction=true;await db.exec('begin');});afterEach(async()=>{if(transaction)await db.exec('rollback');});
describe('complete costs on the real migration chain',()=>{
 it('aggregates beyond REST/list caps and selects meaningful older ticks before the recent limit',async()=>{
  const value=await snapshot();expect(value).toMatchObject({ownerId:owner,projectId:project,dayCount:7});
  expect(value.days).toHaveLength(7);DneskaiCostsReadSchema.shape.days.parse(value.days);
  expect(value.days[0]).toEqual({date:'2026-10-25',collectionUsd:0.04,generationUsd:1.2,generationBookedUsd:0,unknown:0});
  expect(value.ticks).toMatchObject({total:2001,withErrors:1,generationDeferred:1});
  expect(value.ticks.recent.map(t=>t.id)).toEqual([id(11800),id(11900)]);
 });
 it('caps meaningful detail at twenty while preserving complete counts',async()=>{
  await db.query(`insert into public.marketing_ticks(id,user_id,kind,started_at,errors)
   select ('00000000-0000-4000-8000-'||lpad((25000+n)::text,12,'0'))::uuid,$1,'minute',$2::timestamptz-n*interval '1 second','[{"category":"token","code":"token-failed"}]'::jsonb from generate_series(1,30) n`,[owner,now]);
  const value=await snapshot();expect(value.ticks).toMatchObject({total:2031,withErrors:31,meaningfulCount:32});expect(value.ticks.recent).toHaveLength(20);expect(value.ticks.recent[0]!.id).toBe(id(25001));
 });
 it('keeps measured, booked, unknown and queued amounts distinct, including malformed numeric values',async()=>{
  await db.exec('delete from public.marketing_jobs');
  const entries=[['review','0.031'],['failed','0.13'],['reconciliation',null],['running',null],['queued',null],['review','not-a-cost'],['review','10001'],['review','0'.repeat(129)]];
  for(let n=0;n<entries.length;n++)await db.query('insert into public.marketing_jobs(id,user_id,idempotency_key,request_hash,request,status,result,created_at) values($1,$2,$1,$3,$4,$5,$6,$7)',[id(n+300),owner,'a'.repeat(64),JSON.stringify({generation:{source:{brand:'dneskai'}}}),entries[n]![0],JSON.stringify({usage:{estimatedCostUsd:entries[n]![1]}}),now]);
  await db.exec("update public.marketing_dneskai_runs set status='running',cost_usd=0");
  expect((await snapshot()).days[0]).toEqual({date:'2026-10-25',collectionUsd:0,generationUsd:0.031,generationBookedUsd:0.13,unknown:6});
 });
 it('excludes foreign owners, other brands, future rows and rows before the bounded window',async()=>{
  for(const [n,user,brand,at]of [[500,other,'dneskai',now],[501,owner,'devshark',now],[502,owner,'dneskai','2026-10-26T12:00:00Z'],[503,owner,'dneskai','2026-10-01T12:00:00Z']]as const)
   await db.query('insert into public.marketing_jobs(id,user_id,idempotency_key,request_hash,request,status,result,created_at) values($1,$2,$1,$3,$4,$5,$6,$7)',[id(n),user,'a'.repeat(64),JSON.stringify({generation:{source:{brand}}}),'review',JSON.stringify({usage:{estimatedCostUsd:'9'}}),at]);
  await db.query("insert into public.marketing_ticks(id,user_id,kind,started_at) values($1,$2,'minute',$3),($4,$5,'minute',$6),($7,$5,'minute',$8)",[id(20001),other,now,id(20002),owner,'2026-10-25T12:00:01Z',id(20003),'2026-10-24T11:59:59Z']);
  const value=await snapshot();expect(value.days[0]!.generationUsd).toBe(1.2);expect(value.ticks.total).toBe(2001);
 });
 it('uses Prague midnight and a 24-hour tick window across the autumn clock change',async()=>{
  await db.exec('delete from public.marketing_jobs; delete from public.marketing_ticks');
  for(const [n,at]of [[600,'2026-10-25T22:59:59.999Z'],[601,'2026-10-25T23:00:00Z']]as const)
   await db.query('insert into public.marketing_jobs(id,user_id,idempotency_key,request_hash,request,status,result,created_at) values($1,$2,$1,$3,$4,$5,$6,$7)',[id(n),owner,'a'.repeat(64),JSON.stringify({generation:{source:{brand:'dneskai'}}}),'review',JSON.stringify({usage:{estimatedCostUsd:'0.02'}}),at]);
  await db.query("insert into public.marketing_ticks(id,user_id,kind,started_at) values($1,$2,'minute','2026-10-24T23:30:00Z'),($3,$2,'minute','2026-10-24T23:29:59.999Z')",[id(21001),owner,id(21002)]);
  const value=await snapshot(1,'2026-10-25T23:30:00Z');expect(value.days).toEqual([{date:'2026-10-26',collectionUsd:0,generationUsd:0.02,generationBookedUsd:0,unknown:0}]);expect(value.ticks.total).toBe(1);
 });
 it.each([0,8])('refuses an unbounded day count %s',async days=>{await expect(snapshot(days)).rejects.toThrow('invalid cost range');});
 it.each(['infinity','-infinity'])('refuses a nonfinite clock %s',async at=>{await expect(snapshot(7,at)).rejects.toThrow('invalid cost range');});
 it.each([null,other])('refuses missing or foreign owner access (%s)',async user=>{await expect(snapshot(7,now,user)).rejects.toThrow('project unavailable');});
 it('reads the complete snapshot through the installed SDK and real invoker/RLS emulator without a tick-list request',async()=>{
  await db.exec('rollback');transaction=false;
  const emulator=new SupabaseEmulator(db,'https://offline.supabase.test',{service:'TEST-ONLY-service',users:{[owner]:'TEST-ONLY-owner-session'}},()=>new Date(now));
  const client=createClient<DneskaiReadDatabase>('https://offline.supabase.test','TEST-ONLY-public-key',{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:'Bearer TEST-ONLY-owner-session'},fetch:(input,init)=>emulator.fetch(new Request(input,init))}});
  const read=await readDneskaiCosts(client,owner,project,new Date(now),{spentUsd:0.5,ceilingUsd:1,code:null});
  expect(read.days[0]!.generationUsd).toBe(1.2);expect(read.ticks).toMatchObject({total:2001,withErrors:1,generationDeferred:1});expect(read.ticks.recent).toHaveLength(2);
  expect(emulator.requests).toHaveLength(4);expect(emulator.requests.every(r=>r.status===200)).toBe(true);expect(emulator.requests.some(r=>r.path.includes('/marketing_ticks'))).toBe(false);
  expect(emulator.requests.some(r=>r.path.includes('/rpc/marketing_dneskai_cost_totals'))).toBe(true);
  const cancelled=AbortSignal.abort();
  await expect(readDneskaiCosts(client,owner,project,new Date(now),{spentUsd:0.5,ceilingUsd:1,code:null},'7d',{signal:cancelled})).rejects.toThrow();
  expect(emulator.requests).toHaveLength(4);
 });
 it('revokes anonymous/service execution and preserves invoker RLS with an empty search path',async()=>{
  const row=(await db.query<{definer:boolean;config:string[];anon:boolean;service:boolean;authenticated:boolean}>(`select p.prosecdef as definer,p.proconfig as config,
   has_function_privilege('anon',p.oid,'execute') as anon,has_function_privilege('service_role',p.oid,'execute') as service,has_function_privilege('authenticated',p.oid,'execute') as authenticated
   from pg_proc p where p.oid='public.marketing_dneskai_cost_totals(uuid,integer,timestamptz)'::regprocedure`)).rows[0]!;
  expect(row).toMatchObject({definer:false,anon:false,service:false,authenticated:true});expect(row.config).toContain('search_path=""');
 });
});
