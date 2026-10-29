import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {awaitWithSignal} from '@/lib/abortable';
import {databaseTimestamp,databaseVersion} from '@/lib/database-version';
import {careerApplicationRecordSchema,careerApplicationEventSchema,matchesCareerApplication,type CareerScope} from '@/lib/career-records';
import type {JobApplication,JobApplicationEvent} from '@/lib/types';

const text=(maximum:number)=>z.string().trim().max(maximum).transform(value=>value||null).nullable();
export const careerProgressPatchSchema=z.strictObject({
 status:z.enum(['applied','interviewing','offer','rejected','withdrawn']).optional(),
 responded_on:z.iso.date().nullable().optional(),response_kind:z.enum(['positive','negative','neutral']).nullable().optional(),
 next_follow_up_at:databaseTimestamp.nullable().optional(),notes:text(30_000).optional(),contact_name:text(200).optional(),
 contact_email:z.string().trim().max(200).transform(value=>value||null).nullable().refine(value=>value===null||z.email().safeParse(value).success).optional(),
}).refine(value=>Object.values(value).every(field=>field!==undefined));
export type CareerProgressPatch=z.input<typeof careerProgressPatchSchema>;
const receiptSchema=z.strictObject({ownerId:z.uuid(),source:z.strictObject({id:z.uuid(),updatedAt:databaseTimestamp}),row:careerApplicationRecordSchema,events:z.array(careerApplicationEventSchema).max(2)});
export type CareerProgressReceipt=z.infer<typeof receiptSchema>;
export class CareerProgressError extends Error{constructor(readonly reason:'changed'|'invalid'|'unavailable'='unavailable'){super('Career progress unconfirmed');}}
function equal(key:string,a:unknown,b:unknown){return typeof a==='string'&&typeof b==='string'&&['updated_at','created_at','next_follow_up_at','follow_up_at'].includes(key)?databaseVersion(a)===databaseVersion(b):a===b;}
const noteSchema=z.strictObject({responded_on:z.iso.date().nullable(),response_kind:z.enum(['positive','negative','neutral']).nullable(),follow_up_at:databaseTimestamp.nullable(),notes:z.string().nullable()});

/** Only changed fields enter the write bounds; the original full owned version
 * remains the receipt/cache predicate. No hidden retry after uncertainty. */
export async function progressCareerApplication(db:SupabaseClient,scope:CareerScope,source:JobApplication,values:CareerProgressPatch):Promise<CareerProgressReceipt>{
 const {ownerId,signal:parent}=scope,lifetime=new AbortController(),signal=AbortSignal.any([parent,lifetime.signal,AbortSignal.timeout(15_000)]);
 try{
  signal.throwIfAborted();z.uuid().parse(ownerId);const captured=careerApplicationRecordSchema.parse(source);
  if(captured.user_id!==ownerId)throw new CareerProgressError();
  const input=careerProgressPatchSchema.safeParse(values);if(!input.success)throw new CareerProgressError('invalid');const patch=input.data;
  if(new TextEncoder().encode(JSON.stringify(patch)).byteLength>256*1024)throw new CareerProgressError('invalid');
  const result=await awaitWithSignal(db.rpc('update_captured_job_application',{p_expected_owner:ownerId,p_id:captured.id,p_updated_at:captured.updated_at,p_patch:patch}).retry(false).abortSignal(signal),signal);signal.throwIfAborted();
  if(result.error)throw new CareerProgressError(result.error.code==='P0002'?'changed':result.error.code==='22023'?'invalid':'unavailable');
  const receipt=receiptSchema.parse(result.data),{row,events}=receipt;
  const {updated_at:previous,...expected}={...captured,...patch},changed=Object.entries(patch).some(([key,value])=>!equal(key,captured[key as keyof typeof captured],value));
  if(receipt.ownerId!==ownerId||receipt.source.id!==captured.id||databaseVersion(receipt.source.updatedAt)!==databaseVersion(previous)||!matchesCareerApplication(row,expected)
   ||(changed?databaseVersion(row.updated_at)!<=databaseVersion(previous)!:databaseVersion(row.updated_at)!==databaseVersion(previous)))throw new CareerProgressError();
  const statusChanged=captured.status!==row.status,noteChanged=['responded_on','response_kind','next_follow_up_at','notes'].some(key=>!equal(key,captured[key as keyof typeof captured],row[key as keyof typeof row]));
  if(events.length!==Number(statusChanged)+Number(noteChanged)||new Set(events.map(event=>event.id)).size!==events.length||new Set(events.map(event=>event.kind)).size!==events.length)throw new CareerProgressError();
  for(const event of events){
   if(event.user_id!==ownerId||event.application_id!==row.id)throw new CareerProgressError();
   if(event.kind==='status'){if(!statusChanged||event.detail!==row.status)throw new CareerProgressError();}
   else if(event.kind==='note'){
    if(!noteChanged||event.detail===null)throw new CareerProgressError();const note=noteSchema.parse(JSON.parse(event.detail));
    if(note.responded_on!==row.responded_on||note.response_kind!==row.response_kind||!equal('follow_up_at',note.follow_up_at,row.next_follow_up_at)||note.notes!==row.notes)throw new CareerProgressError();
   }else throw new CareerProgressError();
  }
  return receipt;
 }catch(error){if(parent.aborted)throw new DOMException('Request aborted','AbortError');throw error instanceof CareerProgressError?error:new CareerProgressError();}
 finally{lifetime.abort();}
}
export function applyCareerProgressReceipt(rows:JobApplication[],source:JobApplication,receipt:CareerProgressReceipt):JobApplication[]{
 if(receipt.ownerId!==source.user_id||receipt.row.id!==source.id||receipt.row.user_id!==source.user_id||receipt.source.id!==source.id||databaseVersion(receipt.source.updatedAt)!==databaseVersion(source.updated_at))return rows;
 const index=rows.findIndex(row=>row.id===source.id&&matchesCareerApplication(row,source));if(index<0||matchesCareerApplication(rows[index],receipt.row))return rows;
 const next=rows.slice();next[index]=receipt.row;return next;
}
export function applyCareerProgressEvents(rows:JobApplicationEvent[],base:JobApplicationEvent[],receipt:CareerProgressReceipt):JobApplicationEvent[]{
 if(rows!==base||rows.some(row=>row.user_id!==receipt.ownerId)||receipt.events.some(event=>event.user_id!==receipt.ownerId||event.application_id!==receipt.row.id))return rows;
 const ids=new Set(rows.map(row=>row.id)),added=receipt.events.filter(row=>!ids.has(row.id));return added.length?[...added,...rows]:rows;
}
