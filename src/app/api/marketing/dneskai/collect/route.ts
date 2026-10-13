import { createAdminClient } from '@/lib/supabase/admin';
import { authenticateN8n,boundedRequestText } from '@/lib/marketing/http';
import { DneskaiCollectInput,tickDneskaiCollection } from '@/lib/marketing/dneskai-collection';
import { createDneskaiCollectionStore,requireDneskaiProject } from '@/lib/marketing/dneskai-store';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request:Request){
 const owner=authenticateN8n(request,{...process.env,MARKETING_N8N_SECRET:process.env.MARKETING_DNESKAI_COLLECTION_SECRET});if(!owner)return Response.json({error:'unauthorized'},{status:401});
 if(process.env.MARKETING_DNESKAI_COLLECTION_ENABLED!=='true')return Response.json({error:'collection-disabled'},{status:403});
 let input;try{input=DneskaiCollectInput.parse(JSON.parse(await boundedRequestText(request,4000)));}catch{return Response.json({error:'collection-input-invalid'},{status:400});}
 try{const db=createAdminClient();await requireDneskaiProject(db,owner,input.projectId);return Response.json(await tickDneskaiCollection(owner,input,{store:createDneskaiCollectionStore(db),signal:request.signal}),{headers:{'Cache-Control':'no-store'}});}catch(error){const code=error instanceof Error&&['collection-project-unavailable','collection-not-due','collection-disabled','collection-run-unavailable'].includes(error.message)?error.message:'collection-unavailable';return Response.json({error:code},{status:code==='collection-project-unavailable'||code==='collection-run-unavailable'?404:409});}
}
