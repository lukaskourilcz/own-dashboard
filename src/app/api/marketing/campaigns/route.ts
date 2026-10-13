import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { rejectCrossOrigin } from '@/lib/csrf';
const Input=z.strictObject({id:z.uuid(),expectedHash:z.string().regex(/^[a-f0-9]{64}$/)});
export async function POST(request:Request){
 const csrf=rejectCrossOrigin(request);if(csrf)return csrf;
 const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)return Response.json({error:'unauthorized'},{status:401});
 try{const input=Input.parse(await request.json());const {error}=await db.rpc('marketing_activate_campaign',{p_campaign:input.id,p_hash:input.expectedHash});if(error)return Response.json({error:'campaign-unavailable'},{status:409});return Response.json({ok:true});}catch{return Response.json({error:'invalid-campaign'},{status:400});}
}
