import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { awaitWithSignal } from '@/lib/abortable';
import { savedCareerRecordSchema, type CareerScope } from '@/lib/career-records';
import { databaseTimestamp } from '@/lib/database-version';
import { isJobUrl } from '@/lib/jobs/availability';
import type { JobListing, SavedJobPosition } from '@/lib/types';

const intentSchema=z.strictObject({ id:z.uuid(),url:z.string().max(2048),last_seen_at:databaseTimestamp,
 source:z.string().min(1).max(140),title:z.string().min(1).max(300),company:z.string().max(500).nullable(),
 location:z.string().max(500).nullable(),description:z.string().max(12_000).nullable(),remote:z.boolean() });
type ListingCapture=Pick<JobListing,'id'|'url'|'last_seen_at'|'source'|'title'|'company'|'location'|'description'|'remote'>;
const receiptSchema=z.strictObject({ ownerId:z.uuid(),requestId:z.uuid(),created:z.boolean(),row:savedCareerRecordSchema });
export type CareerSaveReceipt=z.infer<typeof receiptSchema>;
export class CareerSaveError extends Error {
 constructor(readonly reason:'unavailable'|'changed'='unavailable'){super('Career save unconfirmed');}
}
/** A stable id and original listing version survive an uncertain attempt. The
 * database snapshots public fields once and never overwrites an existing draft. */
export async function captureCareerListing(db:SupabaseClient,scope:CareerScope,requestId:string,listing:ListingCapture):Promise<CareerSaveReceipt>{
 const {ownerId,signal:parent}=scope,lifetime=new AbortController();
 const signal=AbortSignal.any([parent,lifetime.signal,AbortSignal.timeout(15_000)]);
 try{
  signal.throwIfAborted();z.uuid().parse(ownerId);z.uuid().parse(requestId);
  const intent=intentSchema.parse({id:listing.id,url:listing.url,last_seen_at:listing.last_seen_at,source:listing.source,title:listing.title,company:listing.company,location:listing.location,description:listing.description,remote:listing.remote});
  if(!isJobUrl(intent.url))throw new CareerSaveError();
  const result=await awaitWithSignal(db.rpc('capture_career_listing',{p_expected_owner:ownerId,p_saved_id:requestId,p_listing_id:intent.id,p_last_seen_at:intent.last_seen_at,p_url:intent.url}).retry(false).abortSignal(signal),signal);
  signal.throwIfAborted();
  if(result.error)throw new CareerSaveError(result.error.code==='P0002'?'changed':'unavailable');
  const receipt=receiptSchema.parse(result.data);
  if(receipt.ownerId!==ownerId||receipt.requestId!==requestId||receipt.row.user_id!==ownerId||receipt.row.url!==intent.url
   ||(receipt.created&&(receipt.row.id!==requestId||receipt.row.listing_id!==intent.id
    ||receipt.row.title!==intent.title||receipt.row.source!==intent.source||receipt.row.company!==intent.company
    ||receipt.row.location!==intent.location||receipt.row.description!==intent.description||receipt.row.remote!==intent.remote
    ||receipt.row.cover_letter!==''||receipt.row.notes!==null||receipt.row.cover_letter_url!==null||receipt.row.readiness!=='draft')))throw new CareerSaveError();
  return receipt;
 }catch(error){
  if(parent.aborted)throw new DOMException('Request aborted','AbortError');
  throw error instanceof CareerSaveError?error:new CareerSaveError();
 }finally{lifetime.abort();}
}
/** Never replace a newer confirmed/private edit with a delayed save result. */
export function applyCareerSaveReceipt(rows:SavedJobPosition[],base:SavedJobPosition[],receipt:CareerSaveReceipt):SavedJobPosition[]{
 if(rows.some(row=>row.id===receipt.row.id)||rows!==base)return rows;
 return [receipt.row,...rows];
}
