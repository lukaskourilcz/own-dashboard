import { z } from 'zod';
import { awaitWithSignal } from '@/lib/abortable';
import { boundedResponseText } from '@/lib/bounded-response';
import { MarketingCalendarEntrySchema, type MarketingCalendarEntry } from './state-contracts';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const CalendarReleaseIntentSchema=z.strictObject({id:z.uuid(),expectedEntryHash:hash,expectedCampaignHash:hash,sourceId:z.uuid(),expectedSourceHash:hash,expectedSourceRevision:z.string().min(1).max(200),date:z.iso.date(),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),kind:z.enum(['carousel','thread'])});
export type CalendarReleaseIntent=z.infer<typeof CalendarReleaseIntentSchema>;
export const CalendarReleaseReceiptSchema=z.strictObject({ownerId:z.uuid(),previousHash:hash,source:z.strictObject({id:z.uuid(),sourceRevision:z.string().min(1).max(200),contentHash:hash}),entry:MarketingCalendarEntrySchema});
export type CalendarReleaseScope={ownerId:string;signal:AbortSignal};
export class CalendarReleaseError extends Error{constructor(readonly reason:'changed'|'unavailable'|'unconfirmed'){super('Calendar release unavailable');}}
export function confirmCalendarRelease(value:unknown,ownerId:string,intent:CalendarReleaseIntent,original?:MarketingCalendarEntry){
 const receipt=CalendarReleaseReceiptSchema.parse(value),entry=receipt.entry;
 if(receipt.ownerId!==ownerId||receipt.previousHash!==intent.expectedEntryHash||receipt.source.id!==intent.sourceId||receipt.source.contentHash!==intent.expectedSourceHash||receipt.source.sourceRevision!==intent.expectedSourceRevision||entry.id!==intent.id||entry.date!==intent.date||entry.local_time!==intent.time||entry.kind!==intent.kind||entry.platform!==(intent.kind==='thread'?'threads':'instagram')||entry.bound_source_id!==intent.sourceId||entry.status!=='planned'||entry.needs_review||entry.capture_hash===intent.expectedEntryHash
  ||(original&&(entry.campaign_id!==original.campaign_id||entry.title!==original.title||entry.platform!==original.platform)))throw new Error('Calendar release unconfirmed');
 return receipt;
}
/** One original attempt, including complete bounded response consumption. */
export async function releaseCalendarSlot(scope:CalendarReleaseScope,input:CalendarReleaseIntent,original:MarketingCalendarEntry){
 const parent=scope.signal,originalOwner=scope.ownerId;
 const retirement=new AbortController(),signal=AbortSignal.any([parent,retirement.signal,AbortSignal.timeout(35_000)]);let response:Response|undefined,admitted=false;
 const discard=(value:Response)=>{if(value.body&&!value.body.locked)void value.body.cancel().catch(()=>undefined);};
 try{
  signal.throwIfAborted();const ownerId=z.uuid().parse(originalOwner),intent=CalendarReleaseIntentSchema.parse(input),captured=MarketingCalendarEntrySchema.parse(original);
  if(intent.id!==captured.id||intent.expectedEntryHash!==captured.capture_hash)throw new Error();
  await Promise.resolve();signal.throwIfAborted();admitted=true;
  const pending=fetch('/api/marketing/calendar-entries',{method:'POST',cache:'no-store',redirect:'error',signal,headers:{'Content-Type':'application/json','x-own-dashboard-owner':ownerId},body:JSON.stringify(intent)});
  void pending.then(value=>{if(signal.aborted)discard(value);},()=>undefined);response=await awaitWithSignal(pending,signal);signal.throwIfAborted();
  if(response.redirected||response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')throw new Error();
  const value:unknown=JSON.parse(await boundedResponseText(response,response.status===200?65536:4096,signal));
  if(response.status!==200){const refusal=z.strictObject({error:z.string()}).safeParse(value);if(response.status===409&&refusal.success&&['calendar-owner-changed','calendar-release-unavailable'].includes(refusal.data.error))throw new CalendarReleaseError('changed');throw new Error();}
  const result=confirmCalendarRelease(value,ownerId,intent,captured);signal.throwIfAborted();return result;
 }catch(error){if(parent.aborted)throw new DOMException('Request aborted','AbortError');throw error instanceof CalendarReleaseError?error:new CalendarReleaseError(admitted?'unconfirmed':'unavailable');}
 finally{retirement.abort();if(response)discard(response);}
}
