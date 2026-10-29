import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {awaitWithSignal} from '@/lib/abortable';
import {careerTriageRecordSchema,type CareerScope} from '@/lib/career-records';
import {databaseTimestamp,databaseVersion} from '@/lib/database-version';
import {isJobUrl} from '@/lib/jobs/availability';
import type {JobListing,JobUserState,JobUserStateValue} from '@/lib/types';
export type CareerTriageIntent={id:string;listing:Pick<JobListing,'id'|'url'|'last_seen_at'>;next:JobUserStateValue|null;existing:JobUserState|null};
const expectedSchema=z.strictObject({id:z.uuid(),state:z.enum(['shortlisted','deleted']),createdAt:databaseTimestamp,updatedAt:databaseTimestamp.nullable()});
const changeSchema=z.strictObject({id:z.uuid(),listingId:z.uuid(),url:z.string().max(2048),lastSeenAt:databaseTimestamp,next:z.enum(['shortlisted','deleted']).nullable(),expected:expectedSchema.nullable()});
const receiptSchema=z.strictObject({ownerId:z.uuid(),changes:z.array(z.strictObject({listingId:z.uuid(),next:z.enum(['shortlisted','deleted']).nullable(),row:careerTriageRecordSchema.nullable()})).min(1).max(1000)});
export type CareerTriageReceipt=z.infer<typeof receiptSchema>;
export class CareerTriageError extends Error{
 constructor(readonly reason:'unavailable'|'changed'|'limit'='unavailable'){super('Career triage unconfirmed');}
}
/** One captured atomic intent, including the state/version before confirmation.
 * Already-confirmed desired states remain unchanged; deleted intent is durable. */
export async function applyCareerTriage(db:SupabaseClient,scope:CareerScope,intents:readonly CareerTriageIntent[]):Promise<CareerTriageReceipt>{
 const {ownerId,signal:parent}=scope,lifetime=new AbortController(),signal=AbortSignal.any([parent,lifetime.signal,AbortSignal.timeout(15_000)]);
 try{
  signal.throwIfAborted();z.uuid().parse(ownerId);
  if(intents.length>1000)throw new CareerTriageError('limit');
  const changes=z.array(changeSchema).min(1).max(1000).parse(intents.map(input=>{
   const row=input.existing?careerTriageRecordSchema.parse({...input.existing,updated_at:input.existing.updated_at??null}):null;
   if(row&&(row.user_id!==ownerId||row.listing_id!==input.listing.id))throw new CareerTriageError();
   if((row?.state==='deleted'&&input.next!=='deleted')||(!row&&input.next===null))throw new CareerTriageError('changed');
   return{id:input.id,listingId:input.listing.id,url:input.listing.url,lastSeenAt:input.listing.last_seen_at,next:input.next,expected:row?{id:row.id,state:row.state,createdAt:row.created_at,updatedAt:row.updated_at}:null};
  }));
  if(new Set(changes.map(change=>change.id)).size!==changes.length||new Set(changes.map(change=>change.listingId)).size!==changes.length||changes.some(change=>!isJobUrl(change.url)))throw new CareerTriageError();
  const result=await awaitWithSignal(db.rpc('apply_career_triage',{p_expected_owner:ownerId,p_changes:changes}).retry(false).abortSignal(signal),signal);signal.throwIfAborted();
  if(result.error)throw new CareerTriageError(result.error.code==='P0002'?'changed':'unavailable');
  const receipt=receiptSchema.parse(result.data),expected=new Map(changes.map(change=>[change.listingId,change]));
  if(receipt.ownerId!==ownerId||receipt.changes.length!==changes.length||new Set(receipt.changes.map(change=>change.listingId)).size!==changes.length)throw new CareerTriageError();
  for(const change of receipt.changes){
   const intent=expected.get(change.listingId);
   if(!intent||change.next!==intent.next||(intent.next===null?change.row!==null:!change.row||change.row.user_id!==ownerId||change.row.listing_id!==intent.listingId||change.row.state!==intent.next))throw new CareerTriageError();
   if(intent.expected&&change.row&&change.row.id===intent.expected.id){
    const oldVersion=intent.expected.updatedAt===null?null:databaseVersion(intent.expected.updatedAt),newVersion=change.row.updated_at===null?null:databaseVersion(change.row.updated_at);
    if(databaseVersion(change.row.created_at)!==databaseVersion(intent.expected.createdAt)
     ||(oldVersion!==null&&(newVersion===null||newVersion<oldVersion))
     ||(change.row.state!==intent.expected.state&&(newVersion===null||(oldVersion!==null&&newVersion<=oldVersion))))throw new CareerTriageError();
   }
  }
  return receipt;
 }catch(error){if(parent.aborted)throw new DOMException('Request aborted','AbortError');throw error instanceof CareerTriageError?error:new CareerTriageError();}
 finally{lifetime.abort();}
}
function sameRow(left:JobUserState|undefined,right:JobUserState|undefined){
 return !left||!right?left===right:left.id===right.id&&left.user_id===right.user_id&&left.listing_id===right.listing_id&&left.state===right.state
  &&databaseVersion(left.created_at)===databaseVersion(right.created_at)
  &&(left.updated_at==null||right.updated_at==null?left.updated_at==null&&right.updated_at==null:databaseVersion(left.updated_at)===databaseVersion(right.updated_at));
}
/** A late shortlist/clear receipt cannot replace a newer permanent marker. */
export function applyCareerTriageReceipt(rows:JobUserState[],base:JobUserState[],receipt:CareerTriageReceipt):JobUserState[]{
 const previous=new Map(base.map(row=>[row.listing_id,row])),current=new Map(rows.map(row=>[row.listing_id,row]));
 let changed=false;
 for(const item of receipt.changes){
  const old=previous.get(item.listingId),now=current.get(item.listingId);
  if((old&&old.user_id!==receipt.ownerId)||(now&&now.user_id!==receipt.ownerId)||!sameRow(old,now)||(!old&&rows!==base))continue;
  if(item.row)current.set(item.listingId,item.row);else current.delete(item.listingId);changed=true;
 }
 return changed?[...current.values()]:rows;
}
