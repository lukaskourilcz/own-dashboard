import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { applyTaskWriteReceipt, captureTaskWrite, loadTask, taskCreateValuesSchema, writeTask, type TaskWrite, type TaskWriteReceipt } from '@/lib/task-write';
import type { Todo } from '@/lib/types';
const owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222', id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const stamp='2026-10-25T00:00:00.123456+00:00';
const row=(patch:Record<string,unknown>={})=>({id,user_id:owner,title:'TEST_ONLY',done:false,due_date:null,category:null,created_at:stamp,updated_at:stamp,source:null,
 repo_id:null,repo_full_name:null,repo_owner:null,repo_name:null,repo_url:null,needed_raw:null,needed_assignee:null,generated_at:null,importance:null,estimated_minutes:null,task_kind:null,
 is_global:false,project_id:null,organization_id:null,opportunity_id:null,job_application_id:null,...patch});
const values=()=>taskCreateValuesSchema.parse({title:'TEST_ONLY',due_date:null,importance:null,estimated_minutes:null,task_kind:null,is_global:false,project_id:null,organization_id:null});
const create=():Extract<TaskWrite,{action:'create'}>=>({ownerId:owner,id,action:'create',expected:null,values:values()});
const toggle=(expected:Todo=row() as Todo):TaskWrite=>({ownerId:owner,id,action:'toggle',expected,values:{done:true}});
const receipt=(task=row()):TaskWriteReceipt=>({kind:'saved',ownerId:owner,id,task:task as Extract<TaskWriteReceipt,{kind:'saved'}>['task']});
function transport(data:unknown,error:unknown=null){
 const retry=vi.fn(),abort=vi.fn();
 const rpc=vi.fn(()=>({retry:(enabled:boolean)=>{retry(enabled);return{abortSignal:(signal:AbortSignal)=>{abort(signal);return Promise.resolve({data,error});}};}}));
 return{client:{rpc} as unknown as SupabaseClient,rpc,retry,abort};
}

it('captures normalized manual input and source objects before waiting, without mutating their drafts',()=>{
 const input=create();input.values.title=' TEST_ONLY ';const captured=captureTaskWrite(input);input.values.title='Changed';expect(captured.values).toMatchObject({title:'TEST_ONLY'});
 const source=row({future_field:{keep:true}});const command=toggle(source as Todo);const snapshot=captureTaskWrite(command);source.title='Changed';expect(snapshot.expected?.title).toBe('TEST_ONLY');expect(snapshot.expected).toHaveProperty('future_field',{keep:true});
});
it.each([create,toggle])('calls one owner-bound RPC with SDK retry off and a real operation signal',async factory=>{
 const input=factory();const expected=input.action==='create'?row():row({done:true,updated_at:'2026-10-25T00:00:00.123457+00:00'});
 const mock=transport(receipt(expected));expect((await writeTask(mock.client,input)).kind).toBe('saved');
 expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('write_task',{p_owner:owner,p_id:id,p_action:input.action,p_expected:input.expected,p_values:input.values});
 expect(mock.retry).toHaveBeenCalledExactlyOnceWith(false);expect(mock.abort.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
});
it('accepts an explicit conflict or absence while never treating absence as a deletion',async()=>{
 for(const result of [{kind:'conflict',ownerId:owner,id,task:row({title:'Other tab'})},{kind:'absent',ownerId:owner,id,task:null}] as const){
  const mock=transport(result);expect(await writeTask(mock.client,toggle())).toEqual(result);
 }
 const mock=transport({kind:'deleted',ownerId:owner,id,task:null});await expect(writeTask(mock.client,toggle())).rejects.toThrow('Task write unconfirmed');
});
it.each([
 null,{kind:'saved',ownerId:other,id,task:row()},receipt(row({id:other})),receipt(row({user_id:other})),receipt(row({title:'Changed'})),receipt(row({done:true})),receipt(row({source:'github'})),receipt(row({repo_id:'123'})),receipt(row({created_at:'not-a-date'})),receipt(row({updated_at:'2026-10-25T00:00:00.123455+00:00'})),
])('rejects a malformed or uncorrelated creation receipt without exposing it: %j',async data=>{
 const mock=transport(data);await expect(writeTask(mock.client,create())).rejects.toThrow('Task write unconfirmed');expect(mock.rpc).toHaveBeenCalledTimes(1);
});
it.each([
 row({done:true}),row({done:false,updated_at:'2026-10-25T00:00:00.123457+00:00'}),row({done:true,title:'Changed',updated_at:'2026-10-25T00:00:00.123457+00:00'}),
])('rejects unconfirmed toggle values or a nonadvancing version: %j',async task=>{
 await expect(writeTask(transport(receipt(task)).client,toggle())).rejects.toThrow('Task write unconfirmed');
});
it('refuses missing versions and foreign captured sources before an RPC',async()=>{
 const legacy=row({updated_at:undefined});
 for(const expected of [legacy,row({user_id:other})]){
  const mock=transport(receipt());await expect(writeTask(mock.client,toggle(expected as Todo))).rejects.toThrow('Task write unconfirmed');expect(mock.rpc).not.toHaveBeenCalled();
 }
});
it('returns fixed failures for private SDK errors and keeps a cancelled late promise observed',async()=>{
 await expect(writeTask(transport(null,{message:'TEST_ONLY_PRIVATE'}).client,create())).rejects.toThrow('Task write unconfirmed');
 let resolve!:(value:unknown)=>void;let sent:AbortSignal|undefined;
 const pending=new Promise(done=>{resolve=done;});
 const rpc=vi.fn(()=>({retry:()=>({abortSignal:(signal:AbortSignal)=>{sent=signal;return pending;}})}));
 const controller=new AbortController();const result=writeTask({rpc} as unknown as SupabaseClient,create(),controller.signal);
 controller.abort('TEST_ONLY_PRIVATE');await expect(result).rejects.toMatchObject({name:'AbortError',message:'Request aborted'});expect(sent?.aborted).toBe(true);
 resolve({data:receipt(),error:null});await Promise.resolve();expect(rpc).toHaveBeenCalledTimes(1);
});
it('does not start transport for a pre-cancelled command',async()=>{
 const controller=new AbortController();controller.abort();const mock=transport(receipt());
 await expect(writeTask(mock.client,create(),controller.signal)).rejects.toMatchObject({name:'AbortError'});expect(mock.rpc).not.toHaveBeenCalled();
});

describe('source-safe task cache receipts',()=>{
 const source=row() as Todo,otherRow=row({id:other,title:'Unrelated success'}) as Todo;
 const saved=receipt(row({done:true,updated_at:'2026-10-25T00:00:00.123457+00:00'}));
 it('applies only the captured row and retains unrelated work',()=>{
  expect(applyTaskWriteReceipt([source,otherRow],toggle(source),saved)).toEqual({rows:[saved.task,otherRow],reconcile:false});
 });
 it('never restores a removed row or replaces a newer cached task',()=>{
  const newer=row({title:'Other tab',updated_at:'2026-10-25T00:00:00.123458+00:00'}) as Todo;
  for(const rows of [[otherRow],[newer,otherRow]])expect(applyTaskWriteReceipt(rows,toggle(source),saved)).toEqual({rows,reconcile:true});
 });
 it('does not roll back other rows after a failed/conflicting write',()=>{
  const rows=[source,otherRow];expect(applyTaskWriteReceipt(rows,toggle(source),{kind:'conflict',ownerId:owner,id,task:null})).toEqual({rows,reconcile:true});
 });
 it('removes only a captured target for confirmed deletion or confirmed absence',()=>{
  const input:TaskWrite={ownerId:owner,id,action:'delete',expected:source,values:{}};
  for(const kind of ['deleted','absent'] as const)expect(applyTaskWriteReceipt([source,otherRow],input,{kind,ownerId:owner,id,task:null})).toEqual({rows:[otherRow],reconcile:false});
  expect(applyTaskWriteReceipt([otherRow],input,{kind:'deleted',ownerId:owner,id,task:null})).toEqual({rows:[otherRow],reconcile:false});
 });
 it('deduplicates a confirmed create and refuses a changed or foreign cache',()=>{
  const savedCreate=receipt();expect(applyTaskWriteReceipt([],create(),savedCreate)).toEqual({rows:[savedCreate.task],reconcile:false});
  expect(applyTaskWriteReceipt([savedCreate.task!] as Todo[],create(),savedCreate).rows).toHaveLength(1);
  for(const rows of [[row({title:'Newer'}) as Todo],[row({user_id:other}) as Todo]])expect(applyTaskWriteReceipt(rows,create(),savedCreate)).toEqual({rows,reconcile:true});
 });
});

describe('exact owner task recovery reads',()=>{
 function reader(data:unknown,error:unknown=null){
  const eq=vi.fn(),retry=vi.fn(),signal=vi.fn();
  const query={select:()=>query,eq:(key:string,value:string)=>{eq(key,value);return query;},retry:(value:boolean)=>{retry(value);return query;},abortSignal:(value:AbortSignal)=>{signal(value);return query;},maybeSingle:async()=>({data,error})};
  const from=vi.fn(()=>query);return{client:{from} as unknown as SupabaseClient,from,eq,retry,signal};
 }
 it('binds one exact id/owner read with cancellation and no SDK retry',async()=>{
  const mock=reader(row());expect(await loadTask(mock.client,owner,id)).toEqual(row());
  expect(mock.from).toHaveBeenCalledExactlyOnceWith('todos');expect(mock.eq.mock.calls).toEqual([['user_id',owner],['id',id]]);expect(mock.retry).toHaveBeenCalledExactlyOnceWith(false);expect(mock.signal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
 });
 it('keeps confirmed absence distinct from errors, missing versions and foreign rows',async()=>{
  expect(await loadTask(reader(null).client,owner,id)).toBeNull();
  for(const mock of [reader(null,{message:'TEST_ONLY_PRIVATE'}),reader(row({user_id:other})),reader(row({updated_at:undefined}))])await expect(loadTask(mock.client,owner,id)).rejects.toThrow('Task unavailable');
 });
 it('does not query for a pre-cancelled recovery request',async()=>{
  const mock=reader(row());const controller=new AbortController();controller.abort('TEST_ONLY_PRIVATE');
  await expect(loadTask(mock.client,owner,id,controller.signal)).rejects.toMatchObject({name:'AbortError',message:'Request aborted'});expect(mock.from).not.toHaveBeenCalled();
 });
});
