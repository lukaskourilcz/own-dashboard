import { z } from 'zod';
import { awaitWithSignal } from '@/lib/abortable';
import { readVerifiedServerContext } from '@/lib/supabase/server-owner';
import { rejectCrossOrigin } from '@/lib/csrf';
import { readKnowledgeBody } from '@/lib/marketing/knowledge-body';
import { CalendarReleaseIntentSchema,confirmCalendarRelease } from '@/lib/marketing/calendar-release';
import { pragueScheduledAt } from '@/lib/marketing/clock';

export const maxDuration=30;
const Input=CalendarReleaseIntentSchema;
const reply=(body:object,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function POST(request:Request){
 const csrf=rejectCrossOrigin(request);if(csrf)return csrf;
 const retirement=new AbortController(),signal=AbortSignal.any([request.signal,retirement.signal,AbortSignal.timeout(30_000)]);let writing=false;
 try{
  signal.throwIfAborted();const expectedOwner=request.headers.get('x-own-dashboard-owner');
  if(expectedOwner!==null&&!z.uuid().safeParse(expectedOwner).success)return reply({error:'invalid-calendar-owner'},400);
  const context=await readVerifiedServerContext(signal);if(!context)return reply({error:'unauthorized'},401);signal.throwIfAborted();
  if(expectedOwner!==null&&expectedOwner!==context.ownerId)return reply({error:'calendar-owner-changed'},409);
  let input:z.infer<typeof Input>;
  try{
   input=Input.parse(JSON.parse(await readKnowledgeBody(request,4096,signal)));
   const scheduled=Date.parse(pragueScheduledAt(input.date,input.time));if(!Number.isFinite(scheduled)||scheduled<=Date.now())throw new Error('slot-expired');
  }catch(error){if(signal.aborted)throw error;return reply({error:'invalid-calendar-release'},error instanceof Error&&error.message==='capture-too-large'?413:error instanceof Error&&error.name==='AbortError'?408:400);}
  const writeSignal=AbortSignal.any([signal,AbortSignal.timeout(15_000)]);writeSignal.throwIfAborted();writing=true;
  const result=await awaitWithSignal(context.db.rpc('marketing_release_calendar_entry_captured',{p_entry:input.id,p_entry_hash:input.expectedEntryHash,p_campaign_hash:input.expectedCampaignHash,p_source:input.sourceId,p_source_hash:input.expectedSourceHash,p_source_revision:input.expectedSourceRevision,p_date:input.date,p_time:input.time,p_kind:input.kind,p_when:pragueScheduledAt(input.date,input.time)}).retry(false).abortSignal(writeSignal),writeSignal);signal.throwIfAborted();
  if(result.error?.code==='P0001')return reply({error:'calendar-release-unavailable'},409);
  if(result.error)throw new Error('release-unconfirmed');
  const receipt=confirmCalendarRelease(result.data,context.ownerId,input);signal.throwIfAborted();
  return reply(receipt);
 }catch{return reply({error:writing?'calendar-release-unconfirmed':'calendar-release-unavailable'},503);}
 finally{retirement.abort();if(request.body&&!request.body.locked&&!request.bodyUsed)void request.body.cancel().catch(()=>undefined);}
}
