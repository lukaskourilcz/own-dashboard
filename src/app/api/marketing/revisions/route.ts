import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rejectCrossOrigin } from '@/lib/csrf';
import { saveRevision } from '@/lib/marketing/store';
import { parseContentRevision, type ContentRevision } from '@/lib/marketing/contracts';
import { refreshMarketingAssetUrls } from '@/lib/marketing/asset-urls';
import { notifyMarketingApproval } from '@/lib/marketing/approval-notification';
import { recordMarketingOwnerFeedback } from '@/lib/marketing/owner-feedback';
import { revisionContentHash } from '@/lib/marketing/hashes';
import { DneskaiDeckEditSchema, DneskaiRevisionEditError, prepareDneskaiRevisionEdit, renderAndAttachDneskaiRevision } from '@/lib/marketing/dneskai-revision-edit';
import { getBriefAssetHashLister, getDneskaiMediaLoader, getRenderDneskaiDeck } from '@/lib/marketing/dneskai-wiring';
export const maxDuration=60;
const Input=z.discriminatedUnion('action',[
 z.strictObject({action:z.literal('approve'),id:z.uuid(),expectedHash:z.string().regex(/^[a-f0-9]{64}$/)}),
 z.strictObject({action:z.enum(['returned','skipped']),id:z.uuid(),feedback:z.string().max(2000).optional()}),
 // A deck edit (DNESKAi marketing-content/2) re-renders through the wired renderer; `accountId` is a marketing_accounts row.
 z.strictObject({action:z.literal('edit'),id:z.uuid(),caption:z.string().min(1).max(2200),scheduledAt:z.iso.datetime({offset:true}),accountId:z.uuid().optional(),deck:DneskaiDeckEditSchema.optional()}),
]);
// SQL refusals the review UI can explain; anything else stays the generic code.
const approvalReasons:Record<string,string>={'revision not ready':'revision-not-ready','render blocked':'render-blocked','revision changed':'revision-changed','schedule expired':'schedule-expired','source changed':'source-changed','account unverified':'account-unverified','campaign inactive':'campaign-inactive'};
const unwired=new Set(['renderer-unwired','media-unwired']);
export async function POST(request:Request){
 const csrf=rejectCrossOrigin(request);if(csrf)return csrf;
 const db=await createClient();const {data:{user}}=await db.auth.getUser();
 if(!user)return NextResponse.json({error:'unauthorized'},{status:401});
 try{
  const input=Input.parse(await request.json());
  const {data:original}=await db.from('marketing_revisions').select('revision,content_hash').eq('id',input.id).eq('user_id',user.id).maybeSingle();
  if(input.action==='approve'){
   const {data,error}=await db.rpc('marketing_approve_revision',{p_revision_id:input.id,p_expected_hash:input.expectedHash});
   if(error)return NextResponse.json({error:'approval-unavailable',reason:approvalReasons[error.message]??null},{status:409});
   if(original)await recordMarketingOwnerFeedback({traceId:original.revision.traceId,revisionId:input.id,revisionHash:original.content_hash,decision:'approved'},process.env,{db,ownerId:user.id});
   const scheduling=await notifyMarketingApproval(data);
   return NextResponse.json({publicationId:data,scheduling});
  }
  if(input.action==='edit'){
   const {data:row,error}=await db.from('marketing_revisions').select('revision,slides,offline_import_receipt').eq('id',input.id).eq('user_id',user.id).single();
   if(error||!row)return NextResponse.json({error:'revision-unavailable'},{status:404});
   const scheduled=Date.parse(input.scheduledAt);if(scheduled<=Date.now()||scheduled>Date.now()+6*86400000)return NextResponse.json({error:'schedule-outside-asset-window'},{status:409});
   const current=parseContentRevision(row.revision);
   let account:ContentRevision['account']=current.account;
   if(input.accountId){
    const {data:chosen,error:accountError}=await db.from('marketing_accounts').select('brand,platform,remote_account_id,handle,verified_at').eq('id',input.accountId).eq('user_id',user.id).maybeSingle();
    if(accountError||!chosen||chosen.brand!==current.brand||chosen.platform!==current.account.platform||!chosen.verified_at)return NextResponse.json({error:'account-unavailable'},{status:409});
    account={id:chosen.remote_account_id,platform:chosen.platform,handle:chosen.handle};
   }
   const admin=createAdminClient();
   if(current.deck){
    // Resolve every dependency before writing: an unwired renderer or media store refuses the edit and the current revision keeps its state.
    let wiring;
    try{wiring={render:getRenderDneskaiDeck(),loadMedia:getDneskaiMediaLoader(admin,user.id),listBriefAssetHashes:getBriefAssetHashLister(admin,user.id)};}
    catch(failure){const code=failure instanceof Error&&unwired.has(failure.message)?failure.message:'renderer-unavailable';return NextResponse.json({error:code},{status:503});}
    let revision:ContentRevision;
    try{revision=await prepareDneskaiRevisionEdit(current,{caption:input.caption,scheduledAt:input.scheduledAt,account,deck:input.deck},wiring.listBriefAssetHashes);}
    catch(failure){
     if(failure instanceof DneskaiRevisionEditError)return NextResponse.json({error:failure.code},{status:409});
     return NextResponse.json({error:failure instanceof Error&&unwired.has(failure.message)?failure.message:'media-unavailable'},{status:503});
    }
    // Saved unready and without assets: the previous revision is superseded now, so its approval cannot be used meanwhile.
    const saved=await saveRevision(admin,user.id,revision,{replacesId:input.id,slides:[]});
    let rendered;
    try{rendered=await renderAndAttachDneskaiRevision(admin,user.id,{revisionId:saved.id,revision},{render:wiring.render,loadMedia:wiring.loadMedia,signal:AbortSignal.timeout(45000)});}
    catch{return NextResponse.json({id:saved.id,ready:false,error:'render-attach-failed'},{status:502});}
    await recordMarketingOwnerFeedback({traceId:revision.traceId,revisionId:saved.id,revisionHash:rendered.contentHash,decision:'edited'},process.env,{db,ownerId:user.id});
    return NextResponse.json({id:saved.id,ready:rendered.ready,contentHash:rendered.contentHash,render:{status:rendered.report.status,problems:rendered.report.problems}});
   }
   if(input.deck)return NextResponse.json({error:'deck-edit-unsupported'},{status:409});
   const assets=await refreshMarketingAssetUrls(admin,user.id,current.assets);
   const revision=parseContentRevision({...row.revision,assets,account,caption:input.caption,scheduledAt:input.scheduledAt});
   const saved=await saveRevision(admin,user.id,revision,{replacesId:input.id,slides:row.slides});
   await recordMarketingOwnerFeedback({traceId:revision.traceId,revisionId:saved.id,revisionHash:revisionContentHash(revision),decision:'edited'},process.env,{db,ownerId:user.id});
   return NextResponse.json(row.offline_import_receipt?{...saved,ready:false,holdCode:'offline-import-review-required'}:saved);
  }
  const {error}=await db.rpc('marketing_decide_revision',{p_revision_id:input.id,p_action:input.action,p_feedback:input.feedback??null});
  if(error)return NextResponse.json({error:'decision-unavailable'},{status:409});
  if(original)await recordMarketingOwnerFeedback({traceId:original.revision.traceId,revisionId:input.id,revisionHash:original.content_hash,decision:input.action},process.env,{db,ownerId:user.id});
  return NextResponse.json({ok:true});
 }catch{return NextResponse.json({error:'invalid-revision'},{status:400});}
}
