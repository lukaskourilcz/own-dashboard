import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { BRIEF_MIGRATIONS, createBriefsDatabase } from './marketing-dneskai-briefs-db';
import { DneskaiSourceReceiptSchema, type DneskaiSourceRow } from '@/lib/marketing/dneskai-source-list';
vi.mock('server-only',()=>({}));
const owner='11111111-1111-4111-8111-111111111111',other='33333333-3333-4333-8333-333333333333';
const project='22222222-2222-4222-8222-222222222222',foreign='44444444-4444-4444-8444-444444444444';
const base:DneskaiSourceRow={sourceId:'instagram:fixture',kind:'instagram',topic:'education',handleOrUrl:'fixture',name:'Fixture',tier:0,weekdays:[1,2],maxItems:10,enabled:true};
let db:PGlite;
beforeAll(async()=>{db=await createBriefsDatabase([owner,other],[{id:project,owner},{id:foreign,owner:other}],'2026-10-24T18:00:00Z',[...BRIEF_MIGRATIONS,'20261023110000_dneskai_sources_table.sql','20261024174247_confirmed_dneskai_sources.sql']);},60_000);
beforeEach(async()=>{await db.exec('delete from marketing_dneskai_sources');});
afterAll(async()=>{await db?.close();});
async function as<T>(user:string,sql:string,params:unknown[]=[]){
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec('set role authenticated');
 try{return(await db.query<T>(sql,params)).rows;}finally{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");}
}
async function change(expected:unknown,desired:unknown,action='save',user=owner,id=project){
 const result=await as<{receipt:unknown}>(user,'select change_dneskai_source($1,$2,$3::jsonb,$4::jsonb) receipt',[id,action,expected===null?null:JSON.stringify(expected),desired===null?null:JSON.stringify(desired)]);
 return DneskaiSourceReceiptSchema.parse(result[0]!.receipt);
}
const version=async()=>((await db.query<{value:string}>('select updated_at::text value from marketing_dneskai_sources where user_id=$1 and project_id=$2',[owner,project])).rows[0]!.value);
it('returns the exact narrow persisted source and keeps an identical retry at the same version',async()=>{
 const saved=await change(null,base);expect(saved).toEqual({kind:'saved',ownerId:owner,projectId:project,sourceId:base.sourceId,source:base});
 const before=await version();expect(await change(null,base)).toEqual(saved);expect(await version()).toBe(before);
 expect(JSON.stringify(saved).length).toBeLessThan(1000);expect(JSON.stringify(saved)).not.toContain('created_at');
});
it('saves the captured settings and refuses stale edits, creates and removals',async()=>{
 await change(null,base);const desired={...base,name:'Changed elsewhere'};expect((await change(base,desired)).source).toEqual(desired);const before=await version();
 for(const [expected,source,action]of[[base,{...base,name:'Stale draft'},'save'],[null,{...base,name:'Another create'},'save'],[base,null,'remove']] as const){
  expect(await change(expected,source,action)).toEqual({kind:'conflict',ownerId:owner,projectId:project,sourceId:base.sourceId,source:desired});
 }
 expect(await version()).toBe(before);
});
it('confirms removal and its retry, but does not recreate a removed source from a stale form',async()=>{
 await change(null,base);const result={kind:'removed',ownerId:owner,projectId:project,sourceId:base.sourceId,source:null};
 expect(await change(base,null,'remove')).toEqual(result);expect(await change(base,null,'remove')).toEqual(result);
 expect((await change(base,{...base,name:'Stale'}))).toMatchObject({kind:'conflict',source:null});
 expect((await db.query('select source_id from marketing_dneskai_sources')).rows).toEqual([]);
});
it('keeps source address and kind immutable',async()=>{
 await change(null,base);
 await expect(change(base,{...base,kind:'rss',handleOrUrl:'https://example.com/feed'})).rejects.toThrow(/source address changed/);
});
it('refuses foreign projects, missing owners and ungranted roles',async()=>{
 await expect(change(null,base,'save',other)).rejects.toThrow(/source unavailable/);
 await expect(change(null,base,'save','')).rejects.toThrow(/source unavailable/);
 expect((await change(null,base,'save',other,foreign)).ownerId).toBe(other);
 expect(await as(owner,'select source_id from marketing_dneskai_sources')).toEqual([]);
 for(const role of ['anon','service_role'])expect((await db.query<{allowed:boolean}>('select has_function_privilege($1,$2,$3) allowed',[role,'public.change_dneskai_source(uuid,text,jsonb,jsonb)','EXECUTE'])).rows[0]!.allowed).toBe(false);
 expect((await db.query<{allowed:boolean}>("select has_table_privilege('authenticated','public.marketing_dneskai_sources','INSERT') allowed")).rows[0]!.allowed).toBe(false);
 expect((await db.query<{allowed:boolean}>("select has_function_privilege('authenticated','marketing_private.dneskai_source_values(public.marketing_dneskai_sources)','EXECUTE') allowed")).rows[0]!.allowed).toBe(false);
 const metadata=(await db.query<{security:boolean;config:string[]}>('select prosecdef security,proconfig config from pg_proc where oid=$1::regprocedure',['public.change_dneskai_source(uuid,text,jsonb,jsonb)'])).rows[0]!;
 expect(metadata.security).toBe(true);expect(metadata.config).toEqual(expect.arrayContaining(['search_path=""','lock_timeout=5s']));
});
it('rejects invalid fields, byte overflow and mismatched captured identities before writing',async()=>{
 for(const desired of [{...base,extra:true},{...base,weekdays:[1,1]},{...base,maxItems:1.5},{...base,tier:'0'},{...base,enabled:null},{...base,name:'Two\nlines'},
  {...base,kind:'rss',handleOrUrl:'https://fixture-only@example.com/feed'},{...base,kind:'rss',handleOrUrl:'https://example.com:8443/feed'},
  {...base,kind:'rss',handleOrUrl:'https://[]'},{...base,handleOrUrl:'x'.repeat(9000)}])await expect(change(null,desired)).rejects.toThrow(/source invalid/);
 await expect(change({...base,sourceId:'instagram:another'},base)).rejects.toThrow(/source invalid/);
 expect((await db.query('select source_id from marketing_dneskai_sources')).rows).toEqual([]);
});
it('rolls back suppressed inserts, altered updates and suppressed removals instead of acknowledging them',async()=>{
 await db.exec('create function suppress_source() returns trigger language plpgsql as $$begin return null;end$$;create trigger suppress_source before insert on marketing_dneskai_sources for each row execute function suppress_source();');
 try{await expect(change(null,base)).rejects.toThrow(/unconfirmed/);}finally{await db.exec('drop trigger suppress_source on marketing_dneskai_sources;');}
 await change(null,base);const before=await version();
 await db.exec('create function alter_source() returns trigger language plpgsql as $$begin new.max_items:=19;return new;end$$;create trigger alter_source before update on marketing_dneskai_sources for each row execute function alter_source();');
 try{await expect(change(base,{...base,maxItems:2})).rejects.toThrow(/unconfirmed/);}finally{await db.exec('drop trigger alter_source on marketing_dneskai_sources;drop function alter_source();');}
 expect(await version()).toBe(before);
 await db.exec('create trigger suppress_source before delete on marketing_dneskai_sources for each row execute function suppress_source();');
 try{await expect(change(base,null,'remove')).rejects.toThrow(/unconfirmed/);}finally{await db.exec('drop trigger suppress_source on marketing_dneskai_sources;drop function suppress_source();');}
 expect((await change(base,base)).source).toEqual(base);
});
it('shares the 120-source limit with legacy save/seed without blocking a no-op at the cap',async()=>{
 const rows=Array.from({length:120},(_,i)=>({...base,sourceId:`instagram:fixture${i}`,handleOrUrl:`fixture${i}`}));
 expect((await as<{count:number}>(owner,'select marketing_dneskai_sources_seed($1,$2::jsonb) count',[project,JSON.stringify(rows)]))[0]!.count).toBe(120);
 expect((await change(null,rows[0]!)).kind).toBe('saved');const overflow={...base,sourceId:'instagram:overflow',handleOrUrl:'overflow'};
 await expect(change(null,overflow)).rejects.toThrow(/source limit/);
 await expect(as(owner,'select marketing_dneskai_source_save($1,$2::jsonb)',[project,JSON.stringify(overflow)])).rejects.toThrow(/source limit/);
 expect((await db.query<{count:number}>('select count(*)::int count from marketing_dneskai_sources')).rows[0]!.count).toBe(120);
});
