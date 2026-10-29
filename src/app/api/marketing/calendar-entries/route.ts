import { z } from 'zod';
import { awaitWithSignal } from '@/lib/abortable';
import { readVerifiedServerContext } from '@/lib/supabase/server-owner';
import { rejectCrossOrigin } from '@/lib/csrf';
import { readKnowledgeBody } from '@/lib/marketing/knowledge-body';
import { pragueScheduledAt } from '@/lib/marketing/clock';

export const maxDuration=30;
const Input=z.strictObject({id:z.uuid(),expectedCampaignHash:z.string().regex(/^[a-f0-9]{64}$/),sourceId:z.uuid(),date:z.iso.date(),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),kind:z.enum(['carousel','thread'])});
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
  const result=await awaitWithSignal(context.db.rpc('marketing_release_calendar_entry',{p_entry:input.id,p_hash:input.expectedCampaignHash,p_source:input.sourceId,p_date:input.date,p_time:input.time,p_kind:input.kind}).retry(false).abortSignal(writeSignal),writeSignal);signal.throwIfAborted();
  if(result.error?.code==='P0001')return reply({error:'calendar-release-unavailable'},409);
  if(result.error||result.data!==null)throw new Error('release-unconfirmed');
  return reply({ok:true});
 }catch{return reply({error:writing?'calendar-release-unconfirmed':'calendar-release-unavailable'},503);}
 finally{retirement.abort();if(request.body&&!request.body.locked&&!request.bodyUsed)void request.body.cancel().catch(()=>undefined);}
}
