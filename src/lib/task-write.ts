import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { awaitWithSignal } from '@/lib/abortable';
import { databaseTimestamp, databaseVersion } from '@/lib/database-version';
import { TASK_KINDS } from '@/lib/task-meta';
import type { Todo } from '@/lib/types';

export const taskCreateValuesSchema = z.strictObject({
 title:z.string().trim().min(1).max(500),due_date:z.iso.date().refine(value=>value.slice(0,4)!=='0000').nullable(),
 importance:z.number().int().min(1).max(6).nullable(),estimated_minutes:z.number().int().min(1).max(100000).nullable(),
 task_kind:z.enum(TASK_KINDS).nullable(),is_global:z.boolean(),project_id:z.uuid().nullable(),organization_id:z.uuid().nullable(),
}).refine(value=>value.is_global ? value.importance===6 && value.project_id===null : value.importance!==6);
export type TaskCreateValues=z.infer<typeof taskCreateValuesSchema>;
const nullableText=z.string().nullable();
const taskSchema=z.looseObject({
 id:z.uuid(),user_id:z.uuid(),title:z.string(),done:z.boolean(),due_date:z.iso.date().nullable(),category:nullableText,
 created_at:databaseTimestamp,updated_at:databaseTimestamp,source:z.enum(['github','manual']).nullable(),
 repo_id:nullableText,repo_full_name:nullableText,repo_owner:nullableText,repo_name:nullableText,repo_url:nullableText,
 needed_raw:nullableText,needed_assignee:z.enum(['me','ai']).nullable(),generated_at:databaseTimestamp.nullable(),
 importance:z.number().int().min(1).max(6).nullable(),estimated_minutes:z.number().int().min(1).max(100000).nullable(),
 task_kind:z.enum(TASK_KINDS).nullable(),is_global:z.boolean(),project_id:z.uuid().nullable(),organization_id:z.uuid().nullable(),
 opportunity_id:z.uuid().nullable(),job_application_id:z.uuid().nullable(),
});
export type VersionedTask=z.infer<typeof taskSchema>;
export type TaskWrite={ownerId:string;id:string}&(
 {action:'create';expected:null;values:TaskCreateValues}|
 {action:'toggle';expected:Todo;values:{done:boolean}}|
 {action:'delete';expected:Todo;values:Record<string,never>}
);
const identity={ownerId:z.uuid(),id:z.uuid()};
const receiptSchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('saved'),...identity,task:taskSchema}),
 z.strictObject({kind:z.literal('conflict'),...identity,task:taskSchema.nullable()}),
 z.strictObject({kind:z.enum(['absent','deleted']),...identity,task:z.null()}),
]);
export type TaskWriteReceipt=z.infer<typeof receiptSchema>;
const emptyFields=['category','source','repo_id','repo_full_name','repo_owner','repo_name','repo_url','needed_raw','needed_assignee','generated_at','opportunity_id','job_application_id'] as const;
const bytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
function equal(a:unknown,b:unknown):boolean{
 if(Object.is(a,b))return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
 const left=Object.keys(a),right=Object.keys(b);
 return left.length===right.length&&left.every(key=>Object.hasOwn(b,key)&&equal((a as Record<string,unknown>)[key],(b as Record<string,unknown>)[key]));
}

/** Capture before the first await. Do not infer the writer from a later authentication response. */
export function captureTaskWrite(input:TaskWrite):TaskWrite{
 try{
  const captured=structuredClone(input);z.uuid().parse(captured.ownerId);z.uuid().parse(captured.id);
  if(captured.action==='create'){
   if(captured.expected!==null)throw Error();
   captured.values=taskCreateValuesSchema.parse(captured.values);
  }else{
   if(captured.action!=='toggle'&&captured.action!=='delete')throw Error();
   const source=taskSchema.parse(captured.expected);
   if(source.id!==captured.id||source.user_id!==captured.ownerId||bytes(source)>524288)throw Error();
   captured.expected=source;
   if(captured.action==='toggle')captured.values=z.strictObject({done:z.boolean()}).parse(captured.values);
   else captured.values=z.strictObject({}).parse(captured.values);
  }
  if(bytes(captured.values)>8192)throw Error();
  return captured;
 }catch{throw Error('Task input unavailable');}
}

/** One owner-bound, non-retrying write with a confirmed row or an explicit absence/conflict. */
export async function writeTask(client:SupabaseClient,input:TaskWrite,parent?:AbortSignal):Promise<TaskWriteReceipt>{
 const signal=AbortSignal.any([AbortSignal.timeout(15000),...(parent?[parent]:[])]);
 try{
  signal.throwIfAborted();const captured=captureTaskWrite(input);
  const {data,error}=await awaitWithSignal(client.rpc('write_task',{p_owner:captured.ownerId,p_id:captured.id,p_action:captured.action,p_expected:captured.expected,p_values:captured.values}).retry(false).abortSignal(signal),signal);
  if(error||bytes(data)>524288)throw Error();
  const receipt=receiptSchema.parse(data);
  if(receipt.ownerId!==captured.ownerId||receipt.id!==captured.id||(receipt.task&&(receipt.task.id!==captured.id||receipt.task.user_id!==captured.ownerId)))throw Error();
  if(receipt.kind==='saved'){
   if(captured.action==='delete')throw Error();
   const task=receipt.task;
   if(captured.action==='create'){
    if(task.done||Object.entries(captured.values).some(([key,value])=>!equal(task[key],value))||emptyFields.some(key=>task[key]!==null)
     ||databaseVersion(task.updated_at)!<databaseVersion(task.created_at)!)throw Error();
   }else{
    const source=captured.expected;
    const before={...source,done:captured.values.done,updated_at:null};
    const after={...task,updated_at:null};
    const from=databaseVersion(source.updated_at!)!,to=databaseVersion(task.updated_at)!;
    if(!equal(before,after)||to<from||(source.done!==captured.values.done&&to<=from))throw Error();
   }
  }else if(receipt.kind==='deleted'&&captured.action!=='delete')throw Error();
  return receipt;
 }catch{if(parent?.aborted)throw new DOMException('Request aborted','AbortError');throw Error('Task write unconfirmed');}
}

/** Exact conflict recovery; an unavailable read must never masquerade as a missing task. */
export async function loadTask(client:SupabaseClient,ownerId:string,id:string,parent?:AbortSignal):Promise<VersionedTask|null>{
 const signal=AbortSignal.any([AbortSignal.timeout(15000),...(parent?[parent]:[])]);
 try{
  z.uuid().parse(ownerId);z.uuid().parse(id);signal.throwIfAborted();
  const {data,error}=await awaitWithSignal(client.from('todos').select('*').eq('user_id',ownerId).eq('id',id).retry(false).abortSignal(signal).maybeSingle(),signal);
  if(error||bytes(data)>524288)throw Error();if(data===null)return null;
  const task=taskSchema.parse(data);if(task.id!==id||task.user_id!==ownerId)throw Error();return task;
 }catch{if(parent?.aborted)throw new DOMException('Request aborted','AbortError');throw Error('Task unavailable');}
}

/** Replace/remove only the captured cache row; retain unrelated successes and newer versions. */
export function applyTaskWriteReceipt(rows:Todo[],input:TaskWrite,receipt:TaskWriteReceipt):{rows:Todo[];reconcile:boolean}{
 if(receipt.ownerId!==input.ownerId||receipt.id!==input.id||receipt.kind==='conflict'||(receipt.task&&(receipt.task.id!==input.id||receipt.task.user_id!==input.ownerId))||rows.some(row=>row.user_id!==input.ownerId))return{rows,reconcile:true};
 const current=rows.find(row=>row.id===input.id);
 if(receipt.kind==='saved'){
  if(input.action==='delete')return{rows,reconcile:true};
  if(current&&equal(current,receipt.task))return{rows,reconcile:false};
  if(input.action==='create')return current||rows.length>=20000?{rows,reconcile:true}:{rows:[receipt.task,...rows],reconcile:false};
  if(!current||!equal(current,input.expected))return{rows,reconcile:true};
  return{rows:rows.map(row=>row===current?receipt.task:row),reconcile:false};
 }
 if(input.action==='create')return{rows,reconcile:true};
 if(!current)return{rows,reconcile:false};
 if(!equal(current,input.expected))return{rows,reconcile:true};
 return{rows:rows.filter(row=>row!==current),reconcile:false};
}
