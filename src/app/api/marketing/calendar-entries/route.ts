import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { rejectCrossOrigin } from '@/lib/csrf';
import { pragueScheduledAt } from '@/lib/marketing/clock';
const Input=z.strictObject({id:z.uuid(),expectedCampaignHash:z.string().regex(/^[a-f0-9]{64}$/),sourceId:z.uuid(),date:z.iso.date(),time:z.string(),kind:z.enum(['carousel','thread'])});
export async function POST(request:Request){
 const csrf=rejectCrossOrigin(request);if(csrf)return csrf;
 const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)return Response.json({error:'unauthorized'},{status:401});
 try{const input=Input.parse(await request.json());if(Date.parse(pragueScheduledAt(input.date,input.time))<=Date.now())throw new Error('slot-expired');const {error}=await db.rpc('marketing_release_calendar_entry',{p_entry:input.id,p_hash:input.expectedCampaignHash,p_source:input.sourceId,p_date:input.date,p_time:input.time,p_kind:input.kind});if(error)return Response.json({error:'calendar-release-unavailable'},{status:409});return Response.json({ok:true});}catch{return Response.json({error:'invalid-calendar-release'},{status:400});}
}
