import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { readDneskaiCollectionState } from '@/lib/marketing/dneskai-store';
export const runtime='nodejs';
export async function GET(request:Request){
 const db=await createClient(),{data:{user}}=await db.auth.getUser();if(!user)return Response.json({error:'unauthorized'},{status:401});
 const projectId=new URL(request.url).searchParams.get('projectId');if(!z.uuid().safeParse(projectId).success)return Response.json({error:'invalid-project'},{status:400});
 try{return Response.json(await readDneskaiCollectionState(db,user.id,projectId!),{headers:{'Cache-Control':'private, no-store'}});}catch(error){return Response.json({error:error instanceof Error&&error.message==='collection-project-unavailable'?'project-unavailable':'collection-state-unavailable'},{status:error instanceof Error&&error.message==='collection-project-unavailable'?404:503});}
}
