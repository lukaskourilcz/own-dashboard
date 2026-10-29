import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {awaitWithSignal} from '@/lib/abortable';
import {databaseVersion} from '@/lib/database-version';
import {careerApplicationRecordSchema,matchesCareerApplication,type CareerScope} from '@/lib/career-records';
import {CareerApplicationError} from '@/lib/career-application-save';
import type {JobApplication} from '@/lib/types';

const columns=Object.keys(careerApplicationRecordSchema.shape).join(',');
async function within(scope:CareerScope,source:JobApplication,action:(captured:JobApplication,signal:AbortSignal)=>Promise<JobApplication>){
 const {ownerId,signal:parent}=scope,lifetime=new AbortController(),signal=AbortSignal.any([parent,lifetime.signal,AbortSignal.timeout(15_000)]);
 try{
  signal.throwIfAborted();z.uuid().parse(ownerId);const captured=careerApplicationRecordSchema.parse(source);
  if(captured.user_id!==ownerId)throw new CareerApplicationError();
  const receipt=await action(captured,signal);signal.throwIfAborted();return receipt;
 }catch(error){if(parent.aborted)throw new DOMException('Request aborted','AbortError');throw error instanceof CareerApplicationError?error:new CareerApplicationError();}
 finally{lifetime.abort();}
}
function one(data:unknown,ownerId:string){
 if(!Array.isArray(data)||data.length!==1)throw new CareerApplicationError(Array.isArray(data)&&data.length===0?'changed':'unavailable');
 const row=careerApplicationRecordSchema.parse(data[0]);if(row.user_id!==ownerId)throw new CareerApplicationError();return row;
}
export function updateCareerApplicationLetter(db:SupabaseClient,scope:CareerScope,source:JobApplication,letter:string){
 return within(scope,source,async(captured,signal)=>{
  if(!z.string().max(64_000).safeParse(letter).success||new TextEncoder().encode(JSON.stringify({cover_letter:letter})).byteLength>256*1024)throw new CareerApplicationError('invalid');
  const result=await awaitWithSignal(db.from('job_applications').update({cover_letter:letter}).eq('id',captured.id).eq('user_id',captured.user_id).eq('updated_at',captured.updated_at).select(columns).retry(false).abortSignal(signal),signal);signal.throwIfAborted();if(result.error)throw new CareerApplicationError();
  const row=one(result.data,captured.user_id),{updated_at:previous,...expected}={...captured,cover_letter:letter};
  if(!matchesCareerApplication(row,expected)||databaseVersion(row.updated_at)!<=databaseVersion(previous)!)throw new CareerApplicationError();return row;
 });
}
export function removeCareerApplicationRecord(db:SupabaseClient,scope:CareerScope,source:JobApplication){
 return within(scope,source,async(captured,signal)=>{
  const result=await awaitWithSignal(db.from('job_applications').delete().eq('id',captured.id).eq('user_id',captured.user_id).eq('updated_at',captured.updated_at).select(columns).retry(false).abortSignal(signal),signal);signal.throwIfAborted();if(result.error)throw new CareerApplicationError();
  const row=one(result.data,captured.user_id);if(!matchesCareerApplication(row,captured))throw new CareerApplicationError();return row;
 });
}
/** A confirmation cannot replace newer progress or resurrect a removed record. */
export function applyCareerApplicationRecord(rows:JobApplication[],source:JobApplication,receipt:JobApplication|null){
 if(receipt&&(receipt.id!==source.id||receipt.user_id!==source.user_id))return rows;
 const index=rows.findIndex(row=>row.id===source.id&&matchesCareerApplication(row,source));if(index<0)return rows;
 if(!receipt)return rows.filter((_,position)=>position!==index);
 const next=rows.slice();next[index]=receipt;return next;
}
