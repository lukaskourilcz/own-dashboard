import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {awaitWithSignal} from '@/lib/abortable';
import {databaseVersion} from '@/lib/database-version';
import {careerTemplateRecordSchema,type CareerScope} from '@/lib/career-records';
import type {CoverLetterTemplate} from '@/lib/types';

export const CAREER_TEMPLATE_NAME_MAX=150;
export const CAREER_TEMPLATE_BODY_MAX=64_000;
const fields=z.strictObject({name:z.string().trim().min(1).max(CAREER_TEMPLATE_NAME_MAX),body:z.string().max(CAREER_TEMPLATE_BODY_MAX).refine(value=>value.trim().length>0)});
const patchSchema=fields.partial().refine(value=>Object.keys(value).length>0&&Object.values(value).every(field=>field!==undefined));
export type CareerTemplateFields=z.input<typeof fields>;
export type CareerTemplatePatch=z.input<typeof patchSchema>;
export class CareerTemplateError extends Error{constructor(readonly reason:'changed'|'invalid'|'unavailable'='unavailable'){super('Template unconfirmed');}}
const columns=Object.keys(careerTemplateRecordSchema.shape).join(',');
function owned(value:unknown,ownerId:string){const row=careerTemplateRecordSchema.parse(value);if(row.user_id!==ownerId)throw new CareerTemplateError();return row;}
function one(data:unknown,ownerId:string){if(!Array.isArray(data)||data.length!==1)throw new CareerTemplateError(Array.isArray(data)&&data.length===0?'changed':'unavailable');return owned(data[0],ownerId);}
function matches(row:CoverLetterTemplate,expected:Partial<CoverLetterTemplate>){return Object.entries(expected).every(([key,value])=>{const actual=row[key as keyof CoverLetterTemplate];return typeof value==='string'&&typeof actual==='string'&&(key==='created_at'||key==='updated_at')?databaseVersion(actual)===databaseVersion(value):actual===value;});}
function intent<T>(schema:z.ZodType<T>,value:unknown){const parsed=schema.safeParse(value);if(!parsed.success||new TextEncoder().encode(JSON.stringify(parsed.data)).byteLength>256*1024)throw new CareerTemplateError('invalid');return parsed.data;}
async function within<T>(scope:CareerScope,action:(ownerId:string,signal:AbortSignal)=>Promise<T>){
 const {ownerId,signal:parent}=scope,lifetime=new AbortController(),signal=AbortSignal.any([parent,lifetime.signal,AbortSignal.timeout(15_000)]);
 try{signal.throwIfAborted();z.uuid().parse(ownerId);const value=await action(ownerId,signal);signal.throwIfAborted();return value;}
 catch(error){if(parent.aborted)throw new DOMException('Request aborted','AbortError');throw error instanceof CareerTemplateError?error:new CareerTemplateError();}
 finally{lifetime.abort();}
}
/** Retain this id and exact intent after uncertainty. Recover only the same
 * owned id; a duplicate name is not permission to replace another template. */
export function createCareerTemplate(db:SupabaseClient,scope:CareerScope,id:string,value:CareerTemplateFields){
 return within(scope,async(ownerId,signal)=>{
  z.uuid().parse(id);const captured=intent(fields,value),result=await awaitWithSignal(db.from('cover_letter_templates').insert({...captured,id,user_id:ownerId}).select(columns).retry(false).abortSignal(signal),signal);signal.throwIfAborted();let data:unknown=result.data;
  if(result.error?.code==='23505'){
   const recovery=await awaitWithSignal(db.from('cover_letter_templates').select(columns).eq('id',id).eq('user_id',ownerId).retry(false).abortSignal(signal),signal);signal.throwIfAborted();if(recovery.error)throw new CareerTemplateError();data=recovery.data;
  }else if(result.error)throw new CareerTemplateError();
  const row=one(data,ownerId);if(databaseVersion(row.updated_at)!<databaseVersion(row.created_at)!)throw new CareerTemplateError();if(row.id!==id||!matches(row,captured))throw new CareerTemplateError('changed');return row;
 });
}
export function updateCareerTemplate(db:SupabaseClient,scope:CareerScope,source:CoverLetterTemplate,value:CareerTemplatePatch){
 return within(scope,async(ownerId,signal)=>{
  const captured=owned(source,ownerId),patch=intent(patchSchema,value),result=await awaitWithSignal(db.from('cover_letter_templates').update(patch).eq('id',captured.id).eq('user_id',ownerId).eq('updated_at',captured.updated_at).select(columns).retry(false).abortSignal(signal),signal);signal.throwIfAborted();if(result.error)throw new CareerTemplateError();
  const row=one(result.data,ownerId),{updated_at:previous,...expected}={...captured,...patch};if(!matches(row,expected)||databaseVersion(row.updated_at)!<=databaseVersion(previous)!)throw new CareerTemplateError();return row;
 });
}
export function removeCareerTemplate(db:SupabaseClient,scope:CareerScope,source:CoverLetterTemplate){
 return within(scope,async(ownerId,signal)=>{
  const captured=owned(source,ownerId),result=await awaitWithSignal(db.from('cover_letter_templates').delete().eq('id',captured.id).eq('user_id',ownerId).eq('updated_at',captured.updated_at).select(columns).retry(false).abortSignal(signal),signal);signal.throwIfAborted();if(result.error)throw new CareerTemplateError();const row=one(result.data,ownerId);if(!matches(row,captured))throw new CareerTemplateError();return row;
 });
}
export function applyCareerTemplateReceipt(rows:CoverLetterTemplate[],source:CoverLetterTemplate,receipt:CoverLetterTemplate|null){
 if(receipt&&(receipt.id!==source.id||receipt.user_id!==source.user_id))return rows;
 const index=rows.findIndex(row=>row.id===source.id&&matches(row,source));if(index<0)return rows;if(!receipt)return rows.filter((_,position)=>position!==index);const next=rows.slice();next[index]=receipt;return next;
}
