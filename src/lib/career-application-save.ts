import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {awaitWithSignal} from '@/lib/abortable';
import {databaseVersion} from '@/lib/database-version';
import {savedCareerRecordSchema,careerApplicationRecordSchema,careerApplicationEventSchema,type CareerScope} from '@/lib/career-records';
import {normalizeJobUrl} from '@/lib/jobs/enrich';
import {isGoogleLetterUrl} from '@/lib/jobs/pipeline';
import type {SavedJobPosition,JobApplication,JobApplicationEvent} from '@/lib/types';

const nullableText=(maximum:number)=>z.string().trim().max(maximum).transform(value=>value||null).nullable();
export const careerApplicationFieldsSchema=z.strictObject({
 title:z.string().trim().min(1).max(300),company:nullableText(500),
 url:z.string().trim().transform((value,context)=>{
  if(!value)return null;const url=normalizeJobUrl(value);if(url)return url;
  context.addIssue({code:'custom',message:'Invalid URL'});return z.NEVER;
 }).nullable(),
 cover_letter:z.string().max(64_000),
 cover_letter_url:z.string().trim().max(2048).transform((value,context)=>{
  if(!value)return null;if(isGoogleLetterUrl(value))return new URL(value).href;
  context.addIssue({code:'custom',message:'Invalid letter URL'});return z.NEVER;
 }).nullable(),
 applied_on:z.iso.date(),notes:nullableText(30_000),
});
export type CareerApplicationFields=z.input<typeof careerApplicationFieldsSchema>;
const receiptSchema=z.strictObject({ownerId:z.uuid(),requestId:z.uuid(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),created:z.boolean(),row:careerApplicationRecordSchema,event:careerApplicationEventSchema.nullable()});
export type CareerApplicationReceipt=z.infer<typeof receiptSchema>;
export class CareerApplicationError extends Error{
 constructor(readonly reason:'unavailable'|'changed'|'invalid'='unavailable'){super('Application unconfirmed');}
}

async function intentFingerprint(ownerId:string,saved:SavedJobPosition,fields:z.output<typeof careerApplicationFieldsSchema>){
 const encoder=new TextEncoder(),values=[ownerId,saved.id,databaseVersion(saved.updated_at)!.toString(),fields.title,fields.company,fields.url,fields.cover_letter,fields.cover_letter_url,fields.applied_on,fields.notes];
 const text=values.map(value=>value===null?'-1:':`${encoder.encode(value).byteLength}:${value}`).join('');
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text))),byte=>byte.toString(16).padStart(2,'0')).join('');
}

/** Stable Saved identity/version and exact fields survive an explicit retry.
 * The SQL owns its 10MiB receipt bound; this is not a streamed SDK byte cap. */
export async function recordCareerApplication(db:SupabaseClient,scope:CareerScope,source:SavedJobPosition,values:CareerApplicationFields):Promise<CareerApplicationReceipt>{
 const {ownerId,signal:parent}=scope,lifetime=new AbortController(),signal=AbortSignal.any([parent,lifetime.signal,AbortSignal.timeout(15_000)]);
 try{
  signal.throwIfAborted();z.uuid().parse(ownerId);const saved=savedCareerRecordSchema.parse(source);
  if(saved.user_id!==ownerId)throw new CareerApplicationError();
  const parsed=careerApplicationFieldsSchema.safeParse(values);if(!parsed.success)throw new CareerApplicationError('invalid');
  const fields=parsed.data;if(new TextEncoder().encode(JSON.stringify(fields)).byteLength>256*1024)throw new CareerApplicationError('invalid');
  const fingerprint=await awaitWithSignal(intentFingerprint(ownerId,saved,fields),signal);signal.throwIfAborted();
  const result=await awaitWithSignal(db.rpc('record_captured_job_application',{p_expected_owner:ownerId,p_saved_id:saved.id,p_saved_updated_at:saved.updated_at,p_payload:fields}).retry(false).abortSignal(signal),signal);
  signal.throwIfAborted();if(result.error)throw new CareerApplicationError(result.error.code==='P0002'?'changed':result.error.code==='22023'?'invalid':'unavailable');
  const receipt=receiptSchema.parse(result.data),row=receipt.row,event=receipt.event;
  if(receipt.ownerId!==ownerId||receipt.requestId!==saved.id||receipt.fingerprint!==fingerprint||row.user_id!==ownerId||row.request_id!==saved.id
   ||databaseVersion(row.updated_at)!<databaseVersion(row.created_at)!)throw new CareerApplicationError();
  if(event&&(event.user_id!==ownerId||event.application_id!==row.id||event.kind!=='applied'||event.detail!==fields.applied_on))throw new CareerApplicationError();
  if(receipt.created){
   const expected={...fields,listing_id:saved.listing_id,source:saved.source,location:saved.location,remote:saved.remote,
    status:'applied',organization_id:null,next_follow_up_at:null,responded_on:null,response_kind:null,contact_name:null,contact_email:null};
   if(!event||Object.entries(expected).some(([key,value])=>row[key as keyof typeof row]!==value)
    ||databaseVersion(row.created_at)!==databaseVersion(row.updated_at)
    ||databaseVersion(event.created_at)!==databaseVersion(row.created_at))throw new CareerApplicationError();
  }
  return receipt;
 }catch(error){
  if(parent.aborted)throw new DOMException('Request aborted','AbortError');
  throw error instanceof CareerApplicationError?error:new CareerApplicationError();
 }finally{lifetime.abort();}
}

/** Current progress and newer/missing cache snapshots always win. */
export function applyCareerApplicationReceipt(rows:JobApplication[],base:JobApplication[],receipt:CareerApplicationReceipt):JobApplication[]{
 if(rows!==base||receipt.row.user_id!==receipt.ownerId||rows.some(row=>row.user_id!==receipt.ownerId||row.id===receipt.row.id||row.request_id===receipt.requestId))return rows;
 return [receipt.row,...rows];
}
export function applyCareerApplicationEvent(rows:JobApplicationEvent[],base:JobApplicationEvent[],receipt:CareerApplicationReceipt):JobApplicationEvent[]{
 const event=receipt.event;if(!event||event.user_id!==receipt.ownerId||rows!==base||rows.some(row=>row.user_id!==receipt.ownerId||row.id===event.id))return rows;
 return [event,...rows];
}
