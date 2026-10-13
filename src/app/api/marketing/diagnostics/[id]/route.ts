import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createMarketingTracer,LANGSMITH_EU_ENDPOINT } from '@/lib/marketing/tracing';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)return Response.json({error:'unauthorized'},{status:401});
 const {id}=await params;if(!z.uuid().safeParse(id).success)return Response.json({error:'invalid-revision'},{status:400});
 const {data,error}=await db.from('marketing_revisions').select('revision').eq('id',id).eq('user_id',user.id).maybeSingle();
 if(error||!data)return Response.json({error:'revision-unavailable'},{status:404});
 const env=process.env;
 if(!data.revision.traceId||env.MARKETING_LANGSMITH_ENABLED!=='true'||env.LANGSMITH_ENDPOINT!==LANGSMITH_EU_ENDPOINT||!env.LANGSMITH_API_KEY||!env.LANGSMITH_PROJECT)return Response.json({error:'diagnostics-unavailable'},{status:409});
 try{const tracer=await createMarketingTracer({apiKey:env.LANGSMITH_API_KEY,projectName:env.LANGSMITH_PROJECT,endpoint:env.LANGSMITH_ENDPOINT});const url=await tracer.getTraceUrl(data.revision.traceId);return url?Response.json({url},{headers:{'Cache-Control':'private, no-store'}}):Response.json({error:'diagnostics-unavailable'},{status:409});}catch{return Response.json({error:'diagnostics-unavailable'},{status:503});}
}
