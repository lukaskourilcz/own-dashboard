import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let db: PGlite;
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
type Decision={admitted:boolean;reason?:string;spentUsd:number;reservation?:{id:string}};
const reserve=async(item: string=randomUUID(),cap=5,who=owner,plan='a'.repeat(64),ceiling=150)=>(await db.query<{v:Decision}>(
 'select marketing_reserve_dneskai_apify_research($1,$2,$3,0,$4,$5,$6,$7,$8) v',[who,plan,'item-'+item,'actor','1.2.3',cap,'b'.repeat(64),ceiling])).rows[0]!.v;
const mark=(id:string,status:string,cost:number|null=null,who=owner,run:string|null=null)=>db.query('select marketing_mark_dneskai_apify_research($1,$2,$3,$4,$5)',[who,id,status,run,cost]);
const spent=async(who=owner)=>Number((await db.query<{v:string}>('select marketing_dneskai_apify_research_spent($1) v',[who])).rows[0]!.v);
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role bypassrls;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
 insert into auth.users values('${owner}'),('${other}');`);
 await db.exec(readFileSync('supabase/migrations/20261022013957_dneskai_apify_research.sql','utf8'));
},30000);
beforeEach(async()=>{await db.exec('truncate marketing_private.dneskai_apify_research cascade');});
afterAll(async()=>{await db?.close();});

describe('isolated research ledger migration',()=>{
 it('reserves exactly $150 across changed plans, then holds the next call',async()=>{
  for(let i=0;i<30;i++)expect((await reserve(String(i),5,owner,(i%2?'b':'a').repeat(64))).admitted).toBe(true);
  expect(await spent()).toBe(150);
  expect(await reserve('over',0.01)).toMatchObject({admitted:false,reason:'ceiling',spentUsd:150});
  expect((await reserve('other',5,other)).admitted).toBe(true);
 });
 it('atomically refuses duplicates, including duplicate requests queued together',async()=>{
  const decisions=await Promise.all([reserve('same'),reserve('same')]);
  expect(decisions.map(d=>d.admitted)).toEqual([true,false]);
  expect(decisions[1].reason).toBe('duplicate');expect(await spent()).toBe(5);
 });
 it('counts started and ambiguous runs at their cap and settled costs as charged',async()=>{
  const r=(await reserve('one')).reservation!;
  await mark(r.id,'started',null,owner,'remote1');expect(await spent()).toBe(5);
  await mark(r.id,'ambiguous');expect(await spent()).toBe(5);
  await mark(r.id,'settled',5.5);expect(await spent()).toBe(5.5);
  await mark(r.id,'settled',5.5);
  await expect(mark(r.id,'settled',0)).rejects.toThrow('immutable');
  await expect(mark(r.id,'started',null,owner,'remote1')).rejects.toThrow('immutable');
 });
 it('never changes a remote identity or releases another owner reservation',async()=>{
  const r=(await reserve()).reservation!;
  await expect(mark(r.id,'settled',0,other)).rejects.toThrow('unavailable');
  await mark(r.id,'started',null,owner,'remote1');
  await expect(mark(r.id,'started',null,owner,'remote2')).rejects.toThrow('identity');
  await expect(mark(r.id,'settled',null)).rejects.toThrow('invalid');
  await expect(mark(r.id,'ambiguous',0)).rejects.toThrow('invalid');
  expect(await spent()).toBe(5);
 });
 it('rejects invalid and raised ceilings and caps',async()=>{
  for(const cap of [0,-1,5.1,Number.NaN,Number.POSITIVE_INFINITY])await expect(reserve('bad',cap)).rejects.toThrow();
  for(const ceiling of [0,150.01,Number.NaN,Number.POSITIVE_INFINITY])await expect(reserve('bad',1,owner,'a'.repeat(64),ceiling)).rejects.toThrow();
  expect(await spent()).toBe(0);
 });
 it('denies browser ledger access and RPC execution despite inherited default grants',async()=>{
  for(const signature of ['marketing_dneskai_apify_research_spent(uuid)','marketing_reserve_dneskai_apify_research(uuid,text,text,integer,text,text,numeric,text,numeric)','marketing_mark_dneskai_apify_research(uuid,uuid,text,text,numeric)']){
   const r=(await db.query("select has_function_privilege('anon',$1,'EXECUTE') a,has_function_privilege('authenticated',$1,'EXECUTE') b,has_function_privilege('service_role',$1,'EXECUTE') c",[signature])).rows[0];
   expect(r).toEqual({a:false,b:false,c:true});
  }
  for(const role of ['anon','authenticated']){
   await db.exec('set role '+role);
   await expect(db.query('select * from marketing_private.dneskai_apify_research')).rejects.toThrow('permission denied');
   await db.exec('reset role');
  }
 });
 it('lets owners read only their derived public metrics and never write them',async()=>{
  const a=(await reserve()).reservation!,b=(await reserve('other',5,other)).reservation!;
  for(const [who,r] of [[owner,a],[other,b]] as const)await db.query("insert into marketing_dneskai_research_metrics(user_id,reservation_id,short_code,account_handle,features) values($1,$2,'Abc123','public.brand','{\"likes\":null}')",[who,r.id]);
  await expect(db.query("insert into marketing_dneskai_research_metrics(user_id,reservation_id,short_code,account_handle,features) values($1,$2,'Secret','public.brand','{\"caption\":\"raw\"}')",[owner,a.id])).rejects.toThrow();
  await expect(db.query("insert into marketing_dneskai_research_metrics(user_id,reservation_id,short_code,account_handle,features) values($1,$2,'Other1','public.brand','{}')",[owner,b.id])).rejects.toThrow();
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated');
  expect((await db.query('select user_id,features from marketing_dneskai_research_metrics')).rows).toEqual([{user_id:owner,features:{likes:null}}]);
  await expect(db.query('delete from marketing_dneskai_research_metrics')).rejects.toThrow('permission denied');
  await expect(db.query("update marketing_dneskai_research_metrics set features='{}'")).rejects.toThrow('permission denied');
  await expect(db.query("insert into marketing_dneskai_research_metrics(user_id,reservation_id,short_code,account_handle,features) values($1,$2,'Write1','public.brand','{}')",[owner,a.id])).rejects.toThrow('permission denied');
  await db.exec('reset role');
  await db.exec('set role anon');await expect(db.query('select * from marketing_dneskai_research_metrics')).rejects.toThrow('permission denied');await db.exec('reset role');
 });
});
