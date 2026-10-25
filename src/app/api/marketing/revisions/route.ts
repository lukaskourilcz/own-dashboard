import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rejectCrossOrigin } from '@/lib/csrf';
import { saveRevision } from '@/lib/marketing/store';
import { ContentEngagementEditSchema, parseContentRevision, type ContentRevision } from '@/lib/marketing/contracts';
import { refreshMarketingAssetUrls } from '@/lib/marketing/asset-urls';
import { createMarketingOwnerFeedbackScope,recordMarketingOwnerFeedback,type MarketingOwnerFeedbackScope } from '@/lib/marketing/owner-feedback';
import { revisionContentHash } from '@/lib/marketing/hashes';
import { DneskaiAudioChoiceKeySchema, dneskaiAudioFromKey } from '@/lib/marketing/dneskai-audio-contracts';
import { dneskaiAudioTrendsEnabled } from '@/lib/marketing/dneskai-audio-trends';
import { dneskaiReelsEnabled } from '@/lib/marketing/dneskai-reel';
import { DneskaiDeckEditSchema, DneskaiRevisionEditError, prepareDneskaiRevisionEdit, renderAndAttachDneskaiRevision, reusableDneskaiRender } from '@/lib/marketing/dneskai-revision-edit';
import { getBriefAssetHashLister, getBriefPoolLoader, getDneskaiMediaLoader, getRenderDneskaiDeck } from '@/lib/marketing/dneskai-wiring';
import { DneskaiApproveManyInputSchema, type DneskaiApproveManyResult } from '@/lib/marketing/dneskai-lab';
import { marketingPublishingLive } from '@/lib/marketing/scheduler';
import { DNESKAI_CAPTION_HASHTAG_MAX, DNESKAI_PUBLISH_NOW_LEAD_MS, dneskaiCaptionHashtags } from '@/lib/marketing/dneskai-deck-editor';
import { dneskaiServerNextFreeSlot } from '@/lib/marketing/dneskai-move';
import { dneskaiEngagementEditorEnabled } from '@/lib/marketing/dneskai-engagement';
import { DNESKAI_REGENERATE_NOTE_MAX, DneskaiPaidActionError, regenerateDneskaiRevision } from '@/lib/marketing/dneskai-paid-actions';
// Regenerate may draft the post within the request (one paid call under the daily ceiling), so it keeps the full minute.
export const maxDuration=60;
const Input=z.discriminatedUnion('action',[
 z.strictObject({action:z.literal('approve'),id:z.uuid(),expectedHash:z.string().regex(/^[a-f0-9]{64}$/)}),
 // „Approve the day“ (Design Lab): each post approved only if its own hash still matches; per-post results.
 DneskaiApproveManyInputSchema,
 z.strictObject({action:z.enum(['returned','skipped']),id:z.uuid(),feedback:z.string().max(2000).optional()}),
 // A deck edit (DNESKAi marketing-content/2) re-renders through the wired renderer unless the deck is unchanged; `accountId` is a marketing_accounts row.
 // `engagement` (#157): the keyword, DM and public reply; null removes them. Accepted only with DNESKAI_ENGAGEMENT_EDITOR_ENABLED.
 z.strictObject({action:z.literal('edit'),id:z.uuid(),caption:z.string().min(1).max(2200),scheduledAt:z.iso.datetime({offset:true}),accountId:z.uuid().optional(),deck:DneskaiDeckEditSchema.optional(),engagement:ContentEngagementEditSchema.optional(),audioTrackId:DneskaiAudioChoiceKeySchema.nullable().optional(),format:z.enum(['carousel','reel']).optional()}),
 // „Publish now“: the exact saved version the owner reviewed (expectedHash), moved to DNESKAI_PUBLISH_NOW_LEAD_MS from now
 // and approved in the same request. The next scheduler tick (every 5 minutes) publishes it.
 z.strictObject({action:z.literal('publish-now'),id:z.uuid(),expectedHash:z.string().regex(/^[a-f0-9]{64}$/)}),
 // „Moved, approve again“ (owner decision 6): the same move and approval, to the next free daily slot. `scheduledAt` is
 // the slot the owner was shown; the server finds the free slot itself and refuses when the two differ.
 z.strictObject({action:z.literal('approve-at'),id:z.uuid(),expectedHash:z.string().regex(/^[a-f0-9]{64}$/),scheduledAt:z.iso.datetime({offset:true})}),
 // „Regenerate with a note“ (owner decision 8): a new drafting job for the same brief, the note as feedback to the model.
 z.strictObject({action:z.literal('regenerate'),id:z.uuid(),expectedHash:z.string().regex(/^[a-f0-9]{64}$/),note:z.string().trim().min(1).max(DNESKAI_REGENERATE_NOTE_MAX)}),
]);
// SQL refusals the review UI can explain; anything else stays the generic code.
const approvalReasons:Record<string,string>={'revision not ready':'revision-not-ready','render blocked':'render-blocked','revision changed':'revision-changed','schedule expired':'schedule-expired','source changed':'source-changed','account unverified':'account-unverified','campaign inactive':'campaign-inactive'};
const unwired=new Set(['renderer-unwired','media-unwired']);
export async function POST(request:Request){
 const csrf=rejectCrossOrigin(request);if(csrf)return csrf;
 const db=await createClient();const {data:{user}}=await db.auth.getUser();
 if(!user)return NextResponse.json({error:'unauthorized'},{status:401});
 const feedbackScope=createMarketingOwnerFeedbackScope(db,user.id,request.signal);
 try{
  const input=Input.parse(await request.json());
  if(input.action==='approve-many'){
   // One request, but every post goes through the same hash-binding SQL as a single approval, in order. A refusal
   // (hash changed, render blocked, slot expired) is that post's result and never stops the others.
   const results:DneskaiApproveManyResult['results']=[];
   for(const item of input.posts){
    const {data:original}=await db.from('marketing_revisions').select('revision,content_hash').eq('id',item.id).eq('user_id',user.id).maybeSingle();
    const {data,error}=await db.rpc('marketing_approve_revision',{p_revision_id:item.id,p_expected_hash:item.expectedHash});
    if(error){results.push({id:item.id,ok:false,publicationId:null,error:approvalReasons[error.message]??'approval-unavailable'});continue;}
    if(original)await recordMarketingOwnerFeedback({traceId:original.revision.traceId,revisionId:item.id,revisionHash:original.content_hash,decision:'approved'},process.env,feedbackScope);
    results.push({id:item.id,ok:true,publicationId:typeof data==='string'?data:null,error:null});
   }
   return NextResponse.json({results});
  }
  const {data:original}=await db.from('marketing_revisions').select('revision,content_hash').eq('id',input.id).eq('user_id',user.id).maybeSingle();
  if(input.action==='approve'){
   const {data,error}=await db.rpc('marketing_approve_revision',{p_revision_id:input.id,p_expected_hash:input.expectedHash});
   if(error)return NextResponse.json({error:'approval-unavailable',reason:approvalReasons[error.message]??null},{status:409});
   if(original)await recordMarketingOwnerFeedback({traceId:original.revision.traceId,revisionId:input.id,revisionHash:original.content_hash,decision:'approved'},process.env,feedbackScope);
   // The pg_cron tick publishes the queued slot; approval notifies nobody (audit finding cost-07).
   return NextResponse.json({publicationId:data,scheduling:'tick'});
  }
  if(input.action==='publish-now'||input.action==='approve-at'){
   const reviewed=await loadReviewed(db,user.id,input.id,input.expectedHash);
   if(reviewed instanceof Response)return reviewed;
   const {row,current}=reviewed;
   let scheduledAt:string;
   if(input.action==='publish-now'){
    // Both switches and the account's own switch: otherwise the tick would only dry-run and the slot would lapse.
    const {data:target}=await db.from('marketing_accounts').select('verified_at,enabled').eq('user_id',user.id).eq('brand',current.brand).eq('platform',current.account.platform).eq('remote_account_id',current.account.id).maybeSingle();
    if(!marketingPublishingLive(process.env)||!target?.verified_at||!target.enabled)return NextResponse.json({error:'publishing-disabled'},{status:409});
    scheduledAt=new Date(Date.now()+DNESKAI_PUBLISH_NOW_LEAD_MS).toISOString();
   }else{
    // Owner decision 6: only the slot the server finds free itself, and only the one the owner was shown.
    let free:string|null;
    try{free=await dneskaiServerNextFreeSlot(createAdminClient(),user.id,row.project_id,[current.scheduledAt],new Date());}
    catch{return NextResponse.json({error:'slot-unavailable'},{status:503});}
    if(!free)return NextResponse.json({error:'slot-none-free'},{status:409});
    if(Date.parse(free)!==Date.parse(input.scheduledAt))return NextResponse.json({error:'slot-unavailable',scheduledAt:free},{status:409});
    scheduledAt=free;
   }
   return moveAndApprove(db,user.id,input.id,current,row.render_report,scheduledAt,feedbackScope);
  }
  if(input.action==='regenerate'){
   try{
    const result=await regenerateDneskaiRevision({user:db,admin:createAdminClient(),owner:user.id,id:input.id,expectedHash:input.expectedHash,note:input.note,env:process.env,feedbackScope});
    return NextResponse.json(result,{status:202});
   }catch(failure){
    if(failure instanceof DneskaiPaidActionError)return NextResponse.json({error:failure.code},{status:failure.status});
    return NextResponse.json({error:'regenerate-unavailable'},{status:503});
   }
  }
  if(input.action==='edit'){
   const {data:row,error}=await db.from('marketing_revisions').select('revision,slides,offline_import_receipt,render_report').eq('id',input.id).eq('user_id',user.id).single();
   if(error||!row)return NextResponse.json({error:'revision-unavailable'},{status:404});
   const scheduled=Date.parse(input.scheduledAt);if(scheduled<=Date.now()||scheduled>Date.now()+6*86400000)return NextResponse.json({error:'schedule-outside-asset-window'},{status:409});
   if(dneskaiCaptionHashtags(input.caption)>DNESKAI_CAPTION_HASHTAG_MAX&&parseContentRevision(row.revision).brand==='dneskai')return NextResponse.json({error:'caption-hashtags-over-limit'},{status:409});
   const current=parseContentRevision(row.revision);
   if(input.engagement!==undefined){
    if(!dneskaiEngagementEditorEnabled(process.env))return NextResponse.json({error:'engagement-disabled'},{status:409});
    if(!current.deck)return NextResponse.json({error:'engagement-unsupported'},{status:409});
   }
   let account:ContentRevision['account']=current.account;
   if(input.accountId){
    const {data:chosen,error:accountError}=await db.from('marketing_accounts').select('brand,platform,remote_account_id,handle,verified_at').eq('id',input.accountId).eq('user_id',user.id).maybeSingle();
    if(accountError||!chosen||chosen.brand!==current.brand||chosen.platform!==current.account.platform||!chosen.verified_at)return NextResponse.json({error:'account-unavailable'},{status:409});
    account={id:chosen.remote_account_id,platform:chosen.platform,handle:chosen.handle};
   }
   const admin=createAdminClient();
   // #164: the post's Reel track. Only an enabled track of the owner's library, and only while Reels are switched on.
   if(input.audioTrackId!==undefined&&(!current.deck||!dneskaiReelsEnabled()))return NextResponse.json({error:'audio-track-unavailable'},{status:409});
   // #165: publishing a deck as a Reel needs the Reels switch; going back to a carousel is always allowed.
   if(input.format==='reel'&&(!current.deck||!dneskaiReelsEnabled()))return NextResponse.json({error:'revision-format-unsupported'},{status:409});
   // #167: a trending Instagram sound needs its own switch, Facebook Login and today's trend list.
   if(input.audioTrackId?.startsWith('ig:')){
    const {data:trend,error:trendError}=await db.from('marketing_audio_trends').select('audio_id').eq('audio_id',input.audioTrackId.slice(3)).eq('user_id',user.id).maybeSingle();
    if(!dneskaiAudioTrendsEnabled()||trendError||!trend)return NextResponse.json({error:'audio-track-unavailable'},{status:409});
   }else if(input.audioTrackId){
    const {data:track,error:trackError}=await db.from('marketing_audio_tracks').select('id,enabled,source').eq('id',input.audioTrackId).eq('user_id',user.id).maybeSingle();
    if(trackError||!track||!track.enabled||track.source==='instagram-library')return NextResponse.json({error:'audio-track-unavailable'},{status:409});
   }
   if(current.deck){
    const edited=await editDneskaiDeck(db,user.id,input.id,current,row.render_report,{caption:input.caption,scheduledAt:input.scheduledAt,account,deck:input.deck,engagement:input.engagement,...(input.audioTrackId!==undefined?{audio:dneskaiAudioFromKey(input.audioTrackId)}:{}),...(input.format?{format:input.format}:{})},feedbackScope);
    if(edited instanceof Response)return edited;
    return NextResponse.json({id:edited.id,ready:edited.ready,contentHash:edited.contentHash,render:{status:edited.report.status,problems:edited.report.problems}});
   }
   if(input.deck)return NextResponse.json({error:'deck-edit-unsupported'},{status:409});
   const assets=await refreshMarketingAssetUrls(admin,user.id,current.assets);
   const revision=parseContentRevision({...row.revision,assets,account,caption:input.caption,scheduledAt:input.scheduledAt});
   const saved=await saveRevision(admin,user.id,revision,{replacesId:input.id,slides:row.slides});
   await recordMarketingOwnerFeedback({traceId:revision.traceId,revisionId:saved.id,revisionHash:revisionContentHash(revision),decision:'edited'},process.env,feedbackScope);
   return NextResponse.json(row.offline_import_receipt?{...saved,ready:false,holdCode:'offline-import-review-required'}:saved);
  }
  const {error}=await db.rpc('marketing_decide_revision',{p_revision_id:input.id,p_action:input.action,p_feedback:input.feedback??null});
  if(error)return NextResponse.json({error:'decision-unavailable'},{status:409});
  if(original)await recordMarketingOwnerFeedback({traceId:original.revision.traceId,revisionId:input.id,revisionHash:original.content_hash,decision:input.action},process.env,feedbackScope);
  return NextResponse.json({ok:true});
 }catch{return NextResponse.json({error:'invalid-revision'},{status:400});}
}

type Database=Awaited<ReturnType<typeof createClient>>;
/** The exact saved version the owner reviewed: still this hash, in review, ready and a deck. Anything else is a refusal response. */
async function loadReviewed(db:Database,ownerId:string,id:string,expectedHash:string){
 const {data:row,error}=await db.from('marketing_revisions').select('revision,render_report,content_hash,status,ready,project_id').eq('id',id).eq('user_id',ownerId).maybeSingle();
 if(error||!row)return NextResponse.json({error:'revision-unavailable'},{status:404});
 if(row.content_hash!==expectedHash)return NextResponse.json({error:'approval-unavailable',reason:'revision-changed'},{status:409});
 if(row.status!=='review'||!row.ready)return NextResponse.json({error:'approval-unavailable',reason:'revision-not-ready'},{status:409});
 const current=parseContentRevision(row.revision);
 if(!current.deck)return NextResponse.json({error:'publish-now-unsupported'},{status:409});
 return {row,current};
}
/**
 * Publish now and approve-at: a new revision with the same caption, deck and account and only the time moved, so the
 * saved JPEGs are re-verified and reused, not re-rendered; then the approval of that revision's new hash.
 */
async function moveAndApprove(db:Database,ownerId:string,id:string,current:ContentRevision,renderReport:unknown,scheduledAt:string,feedbackScope:MarketingOwnerFeedbackScope){
 const edited=await editDneskaiDeck(db,ownerId,id,current,renderReport,{caption:current.caption,scheduledAt,account:current.account},feedbackScope);
 if(edited instanceof Response)return edited;
 if(!edited.ready)return NextResponse.json({error:'approval-unavailable',reason:'render-blocked',id:edited.id},{status:409});
 const {data,error:approval}=await db.rpc('marketing_approve_revision',{p_revision_id:edited.id,p_expected_hash:edited.contentHash});
 if(approval)return NextResponse.json({error:'approval-unavailable',reason:approvalReasons[approval.message]??null,id:edited.id},{status:409});
 await recordMarketingOwnerFeedback({traceId:current.traceId,revisionId:edited.id,revisionHash:edited.contentHash,decision:'approved'},process.env,feedbackScope);
 return NextResponse.json({id:edited.id,publicationId:data,scheduledAt,scheduling:'tick'});
}
/** Saves a DNESKAi deck edit as a new revision and attaches its render: the slides are reused when only caption, time, account, engagement or audio changed. */
async function editDneskaiDeck(db:Database,ownerId:string,id:string,current:ContentRevision,renderReport:unknown,edit:{caption:string;scheduledAt:string;account:ContentRevision['account'];deck?:z.infer<typeof DneskaiDeckEditSchema>;engagement?:z.infer<typeof ContentEngagementEditSchema>;audio?:ContentRevision['audio']|null;format?:'carousel'|'reel'},feedbackScope:MarketingOwnerFeedbackScope){
 const admin=createAdminClient();
 // Resolve every dependency before writing: an unwired renderer or media store refuses the edit and the current revision keeps its state.
 let wiring;
 try{wiring={render:getRenderDneskaiDeck(admin),loadMedia:getDneskaiMediaLoader(admin,ownerId),listBriefAssetHashes:getBriefAssetHashLister(admin,ownerId),loadBriefPool:getBriefPoolLoader(admin,ownerId)};}
 catch(failure){const code=failure instanceof Error&&unwired.has(failure.message)?failure.message:'renderer-unavailable';return NextResponse.json({error:code},{status:503});}
 let revision:ContentRevision;
 try{revision=await prepareDneskaiRevisionEdit(current,edit,wiring.listBriefAssetHashes,wiring.loadBriefPool);}
 catch(failure){
  if(failure instanceof DneskaiRevisionEditError)return NextResponse.json({error:failure.code},{status:409});
  return NextResponse.json({error:failure instanceof Error&&unwired.has(failure.message)?failure.message:'media-unavailable'},{status:503});
 }
 // Saved unready and without assets: the previous revision is superseded now, so its approval cannot be used meanwhile.
 // A caption-, time-, account- or engagement-only edit leaves the deck as it was: its previous JPEGs (same sha256s, re-verified
 // byte for byte and re-signed) are attached instead of a render (review-03). Anything that fails here renders.
 let reuse=reusableDneskaiRender(current,renderReport,revision);
 if(reuse){try{reuse={...reuse,assets:await refreshMarketingAssetUrls(admin,ownerId,reuse.assets)};}catch{reuse=null;}}
 const saved=await saveRevision(admin,ownerId,revision,{replacesId:id,slides:[]});
 let rendered;
 try{rendered=await renderAndAttachDneskaiRevision(admin,ownerId,{revisionId:saved.id,revision},{render:wiring.render,loadMedia:wiring.loadMedia,signal:AbortSignal.timeout(45000),reuse});}
 catch{return NextResponse.json({id:saved.id,ready:false,error:'render-attach-failed'},{status:502});}
 await recordMarketingOwnerFeedback({traceId:revision.traceId,revisionId:saved.id,revisionHash:rendered.contentHash,decision:'edited'},process.env,feedbackScope);
 return {id:saved.id,ready:rendered.ready,contentHash:rendered.contentHash,report:rendered.report};
}
