import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';
import { taskCreateValuesSchema, writeTask } from '@/lib/task-write';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createMigratedDatabase, setDatabaseTime } from '../helpers/supabase-pglite';

const owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222', id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const project='33333333-3333-4333-8333-333333333333', organization='44444444-4444-4444-8444-444444444444';
const migration='20261025000844_confirmed_task_writes.sql', instant='2026-10-25T00:00:00.123456Z';
type Row={id:string;user_id:string;title:string;done:boolean;updated_at:string;created_at:string;[key:string]:unknown};
type Receipt={kind:'saved'|'conflict'|'absent'|'deleted';ownerId:string;id:string;task:Row|null};
let db:PGlite, beforeUpgrade:Record<string,unknown>, afterUpgrade:Row;
const values=(patch:Record<string,unknown>={})=>({title:'TEST_ONLY task',due_date:null,importance:null,estimated_minutes:null,task_kind:null,is_global:false,project_id:null,organization_id:null,...patch});
const call=async(action='create',expected:Row|null=null,patch:unknown=action==='create'?values():action==='toggle'?{done:!expected?.done}:{},actor=owner,taskId=id)=>
 (await db.query<{result:Receipt}>('select public.write_task($1,$2,$3,$4,$5) as result',[actor,taskId,action,expected===null?null:JSON.stringify(expected),JSON.stringify(patch)])).rows[0]!.result;
const row=async(taskId=id)=>(await db.query<{row:Row}>('select to_jsonb(t) as row from public.todos t where id=$1',[taskId])).rows[0]?.row;
const saved=async(patch:Record<string,unknown>={})=>{const result=await call('create',null,values(patch));expect(result.kind).toBe('saved');return result.task!;};
const count=async(table='public.todos')=>(await db.query<{count:number}>(`select count(*)::int as count from ${table}`)).rows[0]!.count;
beforeAll(async()=>{
 db=await createMigratedDatabase({owner,instant,beforeMigration:migration});
 await db.query('insert into auth.users(id) values($1)',[other]);
 await db.query("insert into todos(id,user_id,title,category,source,repo_id,needed_raw) values($1,$2,'Legacy task','Legacy','github','123','TEST_ONLY legacy line')",[id,owner]);
 beforeUpgrade=(await db.query<{row:Record<string,unknown>}>('select to_jsonb(t) as row from todos t where id=$1',[id])).rows[0]!.row;
 await db.exec(readFileSync(`supabase/migrations/${migration}`,'utf8'));
 afterUpgrade=(await row())!;
 await db.query("insert into projects(id,user_id,name,slug) values($1,$2,'Owned project','test-owned-project')",[project,owner]);
 await db.query("insert into organizations(id,user_id,name) values($1,$2,'Foreign organization')",[organization,other]);
},120_000);
beforeEach(async()=>{
 await db.exec('reset role; drop trigger if exists test_task_insert on public.todos; drop trigger if exists test_task_update on public.todos; drop trigger if exists test_task_delete on public.todos; drop trigger if exists test_task_receipt on dashboard_private.task_create_receipts; delete from public.todos; delete from dashboard_private.task_create_receipts');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated');await setDatabaseTime(db,instant);
});
afterAll(async()=>db?.close());

it('upgrades existing tasks with a fast finite version default and no metadata change',async()=>{
 const {updated_at,...rest}=afterUpgrade;expect(rest).toEqual(beforeUpgrade);expect(Date.parse(updated_at)).toBe(Date.parse(instant));
 expect((await db.query("select atthasmissing from pg_attribute where attrelid='public.todos'::regclass and attname='updated_at'")).rows[0]).toEqual({atthasmissing:true});
});
it('creates one stable manual task and stores only retry metadata, acknowledging an identical retry unchanged',async()=>{
 const first=await saved({due_date:'2026-10-26',estimated_minutes:30,task_kind:'deploy',importance:4,project_id:project});
 expect(first).toMatchObject({id,user_id:owner,done:false,title:'TEST_ONLY task',source:null,project_id:project});
 await setDatabaseTime(db,'2026-10-26T00:00:00Z');expect((await call('create',null,values({due_date:'2026-10-26',estimated_minutes:30,task_kind:'deploy',importance:4,project_id:project}))).task).toEqual(first);expect(await count()).toBe(1);
 const receipts=(await db.query<Record<string,unknown>>('select * from dashboard_private.task_create_receipts')).rows;expect(receipts).toHaveLength(1);expect(Object.keys(receipts[0]).sort()).toEqual(['created_at','request_hash','task_id','user_id']);
});
it('refuses a changed creation payload or a pre-existing unrelated task id',async()=>{
 const first=await saved();const result=await call('create',null,values({title:'Changed retry'}));expect(result.kind).toBe('conflict');expect(await row()).toEqual(first);expect(await count()).toBe(1);
 await db.exec('reset role; delete from dashboard_private.task_create_receipts; set role authenticated');expect((await call()).kind).toBe('conflict');expect(await count('dashboard_private.task_create_receipts')).toBe(0);
});
it('does not recreate a deliberately deleted task after an ambiguous creation response',async()=>{
 const source=await saved();expect((await call('delete',source)).kind).toBe('deleted');expect(await row()).toBeUndefined();
 expect((await call()).kind).toBe('absent');expect(await row()).toBeUndefined();expect(await count('dashboard_private.task_create_receipts')).toBe(1);
});
it('preserves GLOBAL priority/project rules and rejects a foreign parent without writing either row',async()=>{
 const global=await saved({is_global:true,importance:6});expect(global).toMatchObject({is_global:true,importance:6,project_id:null});
 await expect(call('create',null,values({organization_id:organization}),owner,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).rejects.toThrow('Task unavailable');
 expect(await count()).toBe(1);expect(await count('dashboard_private.task_create_receipts')).toBe(1);
});
it('changes only done/version, preserving complete legacy and repository metadata with microsecond precision',async()=>{
 await saved();await db.query("update todos set category='Legacy',source='github',repo_id='123',repo_full_name='owner/repo',needed_raw='TEST_ONLY legacy' where id=$1",[id]);const source=(await row())!;
 const result=await call('toggle',source);expect(result.kind).toBe('saved');expect(result.task?.done).toBe(true);
 expect({...result.task!,done:source.done,updated_at:source.updated_at}).toEqual(source);expect(result.task!.updated_at).not.toBe(source.updated_at);
 const delta=(await db.query<{delta:string}>('select (extract(epoch from (updated_at-$1::timestamptz))*1000000)::text as delta from todos where id=$2',[source.updated_at,id])).rows[0]!.delta;expect(Number(delta)).toBe(1);
 expect((await call('toggle',source)).task).toEqual(result.task);
});
it('refuses a stale differing task and an ABA change rather than replaying an old completion',async()=>{
 const original=await saved();await db.query("update todos set title='Other tab' where id=$1",[id]);expect((await call('toggle',original)).kind).toBe('conflict');expect((await row())!.done).toBe(false);
 const source=(await row())!;const completed=(await call('toggle',source)).task!;const reopened=(await call('toggle',completed)).task!;expect(reopened.done).toBe(false);
 expect((await call('toggle',source)).kind).toBe('conflict');expect(await row()).toEqual(reopened);
});
it('reports confirmed absence separately from a confirmed deletion, and refuses stale deletion',async()=>{
 const source=await saved();await db.query("update todos set title='Keep changed task' where id=$1",[id]);expect((await call('delete',source)).kind).toBe('conflict');
 const current=(await row())!;expect(await call('delete',current)).toMatchObject({kind:'deleted',ownerId:owner,id,task:null});
 expect(await call('delete',current)).toMatchObject({kind:'absent',task:null});expect(await count()).toBe(0);
});
it('uses authenticated invoker rights with own-only private receipts and no anonymous/service execution',async()=>{
 expect((await db.query("select prosecdef,proconfig,has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('service_role',oid,'execute') as service from pg_proc where oid='public.write_task(uuid,uuid,text,jsonb,jsonb)'::regprocedure")).rows[0]).toEqual({prosecdef:false,proconfig:['search_path=""','lock_timeout=5s'],anon:false,service:false});
 await saved();await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);expect(await row()).toBeUndefined();expect(await count('dashboard_private.task_create_receipts')).toBe(0);
 await expect(call()).rejects.toThrow('Task unavailable');await expect(db.query('insert into dashboard_private.task_create_receipts(user_id,task_id,request_hash,created_at) values($1,$2,$3,now())',[owner,id,'a'.repeat(64)])).rejects.toThrow('row-level security');
 for(const role of ['anon','service_role']){await db.exec(`reset role; set role ${role}`);await expect(call()).rejects.toThrow('permission denied');}
});
it('validates bounded inputs before any task or retry receipt is written',async()=>{
 const patches:unknown[]=[null,[],{},values({extra:true}),values({title:' '}),values({title:'x'.repeat(501)}),values({importance:1.5}),values({importance:7}),values({estimated_minutes:0}),values({estimated_minutes:1.5}),values({task_kind:'personal'}),values({due_date:'2026-02-30'}),values({is_global:true,importance:null}),values({is_global:true,importance:6,project_id:project}),values({importance:6})];
 for(const [index,patch] of patches.entries())await expect(call('create',null,patch),`Invalid input ${index}`).rejects.toThrow();
 expect(await count()).toBe(0);expect(await count('dashboard_private.task_create_receipts')).toBe(0);
});
it.each(['return null','new.title:=\'Changed by fixture\'; return new'])('rolls back a suppressed/altered task insert and its receipt: %s',async body=>{
 await db.exec(`reset role; create or replace function public.test_task_change() returns trigger language plpgsql as $$ begin ${body}; end $$; create trigger test_task_insert before insert on public.todos for each row execute function public.test_task_change(); set role authenticated`);
 await expect(call()).rejects.toThrow('Task write unconfirmed');expect(await count()).toBe(0);expect(await count('dashboard_private.task_create_receipts')).toBe(0);
});
it.each(['return null','new.request_hash:=repeat(\'b\',64); return new'])('refuses an unconfirmed durable retry receipt: %s',async body=>{
 await db.exec(`reset role; create or replace function public.test_task_receipt_change() returns trigger language plpgsql as $$ begin ${body}; end $$; create trigger test_task_receipt before insert on dashboard_private.task_create_receipts for each row execute function public.test_task_receipt_change(); set role authenticated`);
 await expect(call()).rejects.toThrow('Task write unconfirmed');expect(await count()).toBe(0);expect(await count('dashboard_private.task_create_receipts')).toBe(0);
});
it.each(['return null','new.title:=\'Changed by fixture\'; return new'])('rolls back a suppressed/altered toggle: %s',async body=>{
 const source=await saved();await db.exec(`reset role; create or replace function public.test_task_change() returns trigger language plpgsql as $$ begin ${body}; end $$; create trigger test_task_update before update on public.todos for each row execute function public.test_task_change(); set role authenticated`);
 await expect(call('toggle',source)).rejects.toThrow('Task write unconfirmed');expect(await row()).toEqual(source);
});
it('refuses a suppressed deletion and retains its original source',async()=>{
 const source=await saved();await db.exec('reset role; create or replace function public.test_task_change() returns trigger language plpgsql as $$ begin return null; end $$; create trigger test_task_delete before delete on public.todos for each row execute function public.test_task_change(); set role authenticated');
 await expect(call('delete',source)).rejects.toThrow('Task write unconfirmed');expect(await row()).toEqual(source);
});

it('rolls back an AFTER-trigger alteration that is absent from RETURNING',async()=>{
 const source=await saved();
 await db.exec("reset role; create or replace function public.test_task_after() returns trigger language plpgsql as $$ begin if new.title<>'After-trigger change' then update public.todos set title='After-trigger change' where id=new.id; end if; return new; end $$; create trigger test_task_update after update on public.todos for each row execute function public.test_task_after(); set role authenticated");
 await expect(call('toggle',source)).rejects.toThrow('Task write unconfirmed');expect(await row()).toEqual(source);
});

it('validates real database create, toggle and deletion receipts through the client boundary',async()=>{
 const transport={rpc:(_name:string,args:Record<string,unknown>)=>{
  const pending=db.query<{result:Receipt}>('select public.write_task($1,$2,$3,$4,$5) as result',[args.p_owner,args.p_id,args.p_action,args.p_expected===null?null:JSON.stringify(args.p_expected),JSON.stringify(args.p_values)]).then(result=>({data:result.rows[0]!.result,error:null}));
  return{retry:()=>({abortSignal:()=>pending})};
 }} as unknown as SupabaseClient;
 const created=await writeTask(transport,{ownerId:owner,id,action:'create',expected:null,values:taskCreateValuesSchema.parse(values())});expect(created.kind).toBe('saved');
 if(created.kind!=='saved')throw Error('Fixture not saved');
 const completed=await writeTask(transport,{ownerId:owner,id,action:'toggle',expected:created.task,values:{done:true}});expect(completed.kind).toBe('saved');
 if(completed.kind!=='saved')throw Error('Fixture not saved');
 expect(completed.task).toEqual(await row());
 expect(await writeTask(transport,{ownerId:owner,id,action:'delete',expected:completed.task,values:{}})).toMatchObject({kind:'deleted',task:null});
});

it('refuses missing, foreign, malformed and oversized captured source identities',async()=>{
 const source=await saved();
 for(const expected of [null,{...source,id:other},{...source,user_id:other},{...source,updated_at:'infinity'},{...source,unknown:'x'.repeat(524288)}])
  await expect(call('toggle',expected as Row|null)).rejects.toThrow('Task invalid');
 await expect(call('unknown',source)).rejects.toThrow('Task invalid');
 expect(await row()).toEqual(source);
 await db.query("select set_config('request.jwt.claim.sub','',false)");await expect(call()).rejects.toThrow('Task unavailable');
});
it('keeps the complete-collection ceiling atomic with imports and leaves no retry receipt when full',async()=>{
 await db.exec("reset role; insert into todos(user_id,title) select '11111111-1111-4111-8111-111111111111','TEST_ONLY '||n from generate_series(1,20000) n; set role authenticated");
 await expect(call()).rejects.toThrow('Task limit');expect(await count()).toBe(20000);expect(await count('dashboard_private.task_create_receipts')).toBe(0);
});
it('keeps private retry metadata immutable for the session role and removes it with its owner account',async()=>{
 await saved();
 await expect(db.exec('update dashboard_private.task_create_receipts set request_hash=repeat(\'c\',64)')).rejects.toThrow('permission denied');
 await expect(db.exec('delete from dashboard_private.task_create_receipts')).rejects.toThrow('permission denied');
 await db.query("reset role");await db.query('delete from auth.users where id=$1',[owner]);
 expect(await count('dashboard_private.task_create_receipts')).toBe(0);
});
