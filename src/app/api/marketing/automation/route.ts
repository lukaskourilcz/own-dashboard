import { NextResponse } from 'next/server';
import { z } from 'zod';
import { boundedRequestText } from '@/lib/marketing/http';
import { authenticateAutomation } from '@/lib/marketing/automation-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { ingestSource,saveRevision } from '@/lib/marketing/store';
export const maxDuration=60;
const RequestSchema=z.discriminatedUnion('action',[
 z.strictObject({action:z.literal('source'),packet:z.unknown()}),
 z.strictObject({action:z.literal('revision'),id:z.uuid(),revision:z.unknown(),slides:z.array(z.unknown()).max(10),replacesId:z.uuid().nullable().optional()}),

]);
export async function POST(request:Request) {
 let raw:string;try{raw=await boundedRequestText(request,1024*1024);}catch{return NextResponse.json({error:'payload-too-large'},{status:413});}
 const principal=authenticateAutomation(request,raw);
 if(!principal) return NextResponse.json({error:'unauthorized'},{status:401});
 try{
  const input=RequestSchema.parse(JSON.parse(raw));const db=createAdminClient();
  if(input.action==='source'){
   if(principal.role!=='source') return NextResponse.json({error:'forbidden'},{status:403});
   return NextResponse.json(await ingestSource(db,principal.ownerId,input.packet,principal.brand));
  }
  if(input.action==='revision'){
   if(principal.role!=='worker') return NextResponse.json({error:'forbidden'},{status:403});
   return NextResponse.json(await saveRevision(db,principal.ownerId,input.revision,{id:input.id,slides:input.slides,replacesId:input.replacesId}));
  }
  return NextResponse.json({error:'external-publisher-retired'},{status:410});
 }catch(error){
  const invalid=error instanceof z.ZodError||error instanceof SyntaxError;
  return NextResponse.json({error:invalid?'invalid-payload':'marketing-action-failed'},{status:invalid?400:409});
 }
}
