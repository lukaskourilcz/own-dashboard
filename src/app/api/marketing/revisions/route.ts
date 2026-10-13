import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rejectCrossOrigin } from '@/lib/csrf';
import { saveRevision } from '@/lib/marketing/store';
import { parseContentRevision } from '@/lib/marketing/contracts';
import { refreshMarketingAssetUrls } from '@/lib/marketing/asset-urls';
import { notifyMarketingApproval } from '@/lib/marketing/approval-notification';
import { recordMarketingOwnerFeedback } from '@/lib/marketing/owner-feedback';
export const maxDuration=60;
const Input=z.discriminatedUnion('action',[
 z.strictObject({action:z.literal('approve'),id:z.uuid(),expectedHash:z.string().regex(/^[a-f0-9]{64}$/)}),
 z.strictObject({action:z.enum(['returned','skipped']),id:z.uuid(),feedback:z.string().max(2000).optional()}),
 z.strictObject({action:z.literal('edit'),id:z.uuid(),caption:z.string().min(1).max(2200),scheduledAt:z.iso.datetime({offset:true})}),
]);
export async function POST(request:Request){
 const csrf=rejectCrossOrigin(request);if(csrf)return csrf;
 const db=await createClient();const {data:{user}}=await db.auth.getUser();
 if(!user)return NextResponse.json({error:'unauthorized'},{status:401});
 try{
  const input=Input.parse(await request.json());
  const {data:original}=await db.from('marketing_revisions').select('revision,content_hash').eq('id',input.id).eq('user_id',user.id).maybeSingle();
  if(input.action==='approve'){
   const {data,error}=await db.rpc('marketing_approve_revision',{p_revision_id:input.id,p_expected_hash:input.expectedHash});
   if(error)return NextResponse.json({error:'approval-unavailable'},{status:409});
   if(original)await recordMarketingOwnerFeedback({traceId:original.revision.traceId,revisionId:input.id,revisionHash:original.content_hash,decision:'approved'});
   const scheduling=await notifyMarketingApproval(data);
   return NextResponse.json({publicationId:data,scheduling});
  }
  if(input.action==='edit'){
   const {data:row,error}=await db.from('marketing_revisions').select('revision,slides').eq('id',input.id).eq('user_id',user.id).single();
   if(error||!row)return NextResponse.json({error:'revision-unavailable'},{status:404});
   const scheduled=Date.parse(input.scheduledAt);if(scheduled<=Date.now()||scheduled>Date.now()+6*86400000)return NextResponse.json({error:'schedule-outside-asset-window'},{status:409});
   const admin=createAdminClient();const assets=await refreshMarketingAssetUrls(admin,user.id,parseContentRevision(row.revision).assets);
   const revision=parseContentRevision({...row.revision,assets,caption:input.caption,scheduledAt:input.scheduledAt});
   return NextResponse.json(await saveRevision(admin,user.id,revision,{replacesId:input.id,slides:row.slides}));
  }
  const {error}=await db.rpc('marketing_decide_revision',{p_revision_id:input.id,p_action:input.action,p_feedback:input.feedback??null});
  if(error)return NextResponse.json({error:'decision-unavailable'},{status:409});
  if(original)await recordMarketingOwnerFeedback({traceId:original.revision.traceId,revisionId:input.id,revisionHash:original.content_hash,decision:input.action});
  return NextResponse.json({ok:true});
 }catch{return NextResponse.json({error:'invalid-revision'},{status:400});}
}
