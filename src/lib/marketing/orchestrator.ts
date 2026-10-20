import 'server-only';
import { createHash } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseContentRevision,parseSourcePacket,publishedStoryReceipt,sourceUsable,type MarketingBrand,type MarketingRevisionRow,type PublicationRow,type SourcePacket } from './contracts';
import { ingestSource,sourceReferences } from './store';
import { SourceRefreshError,refreshMarketingSources,refreshSource } from './source-refresh';
import { enqueueMarketingJob,executeMarketingJob } from './worker-runtime';
import { trustedMarketingTemplate } from './template-registry';
import { pragueScheduledAt } from './clock';
import { publishMarketingRevision,reconcileMarketingPublication,type MarketingPublishAccount,type PublisherState } from './publisher';
import { resolveMetaPublisherConfig } from './meta-credentials';
import { createDneskaiMediaLoader } from './dneskai-media';
export { metaConfiguration } from './meta-credentials';
type Database=ReturnType<typeof createAdminClient>;
export function marketingSlotId(owner:string,brand:string,platform:string,scheduledAt:string,version=1,entryId?:string):string{
 const value=createHash('sha256').update([owner,brand,platform,scheduledAt,String(version),entryId??''].join('|')).digest('hex').slice(0,32);
 return `${value.slice(0,8)}-${value.slice(8,12)}-5${value.slice(13,16)}-8${value.slice(17,20)}-${value.slice(20)}`;
}
export async function synchronizeMarketingSources(db:Database,owner:string,brand:MarketingBrand,sourceIds?:string[],cursor?:string,signal?:AbortSignal){
 const previous=sourceIds?await db.from('marketing_sources').select('packet').eq('user_id',owner).eq('brand',brand).in('source_id',sourceIds):null;
 if(previous?.error)throw new Error('source-state-unavailable');
 let discoveryCursor=cursor;
 if(brand==='devshark'&&!sourceIds&&!cursor){const {data:head,error}=await db.from('marketing_events').select('payload').eq('user_id',owner).eq('kind','source-discovery-devshark').order('created_at',{ascending:false}).limit(1).maybeSingle();if(error)throw new Error('source-cursor-state-unavailable');discoveryCursor=head?.payload?.cursor??undefined;}
 let refreshed;
 try{refreshed=await refreshMarketingSources({brand,sourceIds,cursor:discoveryCursor,signal,previousPackets:previous?.data?.map(row=>parseSourcePacket(row.packet))});}
 catch(error){if(!sourceIds&&brand==='devshark'&&discoveryCursor&&error instanceof SourceRefreshError&&error.code==='source-cursor-stale')refreshed=await refreshMarketingSources({brand,signal});else throw error;}

 for(const packet of refreshed.packets)await ingestSource(db,owner,packet,brand);
 // A producer tombstone without safe export text still retires the known head.
 for(const held of refreshed.held){
  if(refreshed.packets.some(packet=>packet.sourceId===held.sourceId))continue;
  const known=previous?.data?.map(row=>parseSourcePacket(row.packet)).find(packet=>packet.sourceId===held.sourceId);
  if(known)await ingestSource(db,owner,{...known,eligible:false,eligibilityReason:held.reason,observedAt:refreshed.observedAt},brand);
 }
 if(brand==='devshark'&&!sourceIds){const {error}=await db.from('marketing_events').insert({user_id:owner,kind:'source-discovery-devshark',payload:{cursor:refreshed.nextCursor}});if(error)throw new Error('source-cursor-save-failed');}
 return refreshed;
}
export async function enqueueCalendarMarketingJob(db:Database,owner:string,input:{brand:MarketingBrand;entryId:string;platform:'instagram'|'threads';sourceId?:string}){
 // DNESKAi has no single-layout template since #117; its decks render through the carousel studio.
 const template=input.brand==='devshark'?trustedMarketingTemplate(input.brand):null;
 const {data:entry,error}=await db.from('marketing_calendar_entries').select('*').eq('user_id',owner).eq('id',input.entryId).single();
 if(error||!entry||!['post','carousel','thread'].includes(entry.kind)||entry.needs_review||entry.status!=='planned'||entry.platform!==input.platform)throw new Error('calendar-entry-held');
 const {data:campaign,error:campaignError}=await db.from('marketing_campaigns').select('*').eq('user_id',owner).eq('id',entry.campaign_id).eq('brand',input.brand).eq('status','active').single();
 if(campaignError||!campaign||entry.date<campaign.starts_on||entry.date>campaign.ends_on)throw new Error('campaign-not-active');
 const scheduledAt=pragueScheduledAt(entry.date,entry.local_time??'09:00');
 const key=marketingSlotId(owner,input.brand,input.platform,scheduledAt,entry.generation_version,entry.id);
 const {data:existing,error:existingError}=await db.from('marketing_jobs').select('id,status').eq('user_id',owner).eq('idempotency_key',key).maybeSingle();
 if(existingError)throw new Error('job-state-unavailable');if(existing)return {jobId:existing.id,status:existing.status,duplicate:true};
 const {data:account,error:accountError}=await db.from('marketing_accounts').select('*').eq('user_id',owner).eq('brand',input.brand).eq('platform',input.platform).not('verified_at','is',null).single();
 if(accountError||!account)throw new Error('account-unverified');
 const {data:sources,error:sourceError}=await db.from('marketing_sources').select('id,packet').eq('user_id',owner).eq('brand',input.brand).eq('eligible',true).order('observed_at',{ascending:false}).limit(100);
 if(sourceError)throw new Error('sources-unavailable');
 const candidates:SourcePacket[]=(sources??[]).map(row=>parseSourcePacket(row.packet)).filter(packet=>sourceUsable(packet)&&packet.kind!=='instagram-reference');
 const {data:previous,error:previousError}=await db.from('marketing_revisions').select('revision').eq('user_id',owner).eq('brand',input.brand).order('created_at',{ascending:false}).limit(200);
 if(previousError)throw new Error('revision-history-unavailable');
 const used=new Set((previous??[]).flatMap(row=>{const revision=parseContentRevision(row.revision);return revision.account.platform===input.platform?revision.sources.map(ref=>`${ref.sourceId}|${ref.sourceRevision}|${ref.contentHash}`):[];}));
 let bound=entry.bound_source_id?sources?.find(row=>row.id===entry.bound_source_id):null;
 if(entry.bound_source_id&&!bound){const {data,error}=await db.from('marketing_sources').select('id,packet').eq('user_id',owner).eq('brand',input.brand).eq('id',entry.bound_source_id).eq('eligible',true).maybeSingle();if(error)throw new Error('bound-source-unavailable');bound=data;}
 if(entry.bound_source_id&&!bound)throw new Error('bound-source-unavailable');
 const source=bound?parseSourcePacket(bound.packet):input.sourceId?candidates.find(packet=>packet.sourceId===input.sourceId):candidates.find(packet=>!used.has(`${packet.sourceId}|${packet.sourceRevision}|${packet.contentHash}`));
 if(!source||!sourceUsable(source)||source.brand!==input.brand)throw new Error('eligible-source-required');
 if(!template)throw new Error('template-unavailable');

 // Only explicitly reviewed advice may influence presentation. Product facts stay in the source.
 const {data:items,error:knowledgeError}=await db.from('marketing_knowledge_items').select('ai_link_id,metadata').eq('user_id',owner).eq('review_status','reviewed').limit(50);
 if(knowledgeError)throw new Error('knowledge-state-unavailable');
 const knowledge=(items??[]).filter(item=>Array.isArray(item.metadata?.tags?.brand)&&item.metadata.tags.brand.includes(input.brand)&&(entry.knowledge_ids.length===0||entry.knowledge_ids.includes(item.ai_link_id))).slice(0,8).map(item=>({id:item.ai_link_id,brand:input.brand,presentation:String(item.metadata.summary??'').slice(0,1200)})).filter(item=>item.presentation.length>0);
 return enqueueMarketingJob(db,owner,{schemaVersion:'marketing-job/1',idempotencyKey:key,calendarEntryId:entry.id,calendarEntryVersion:entry.generation_version,generation:{source,account:{id:account.remote_account_id,platform:input.platform,handle:account.handle},scheduledAt,templateVersion:template.version,knowledge,consent:true,revisionId:key},template});
}
async function publishingState(db:Database,owner:string,revisionId:string,refresh:boolean,signal=AbortSignal.timeout(55000)):Promise<PublisherState>{
 const {data:row,error}=await db.from('marketing_revisions').select('*').eq('user_id',owner).eq('id',revisionId).single();
 if(error||!row)throw new Error('revision-unavailable');
 const assertCampaign=async(campaignId:string|null)=>{if(!campaignId)return;const {data:campaign,error}=await db.from('marketing_campaigns').select('id').eq('user_id',owner).eq('id',campaignId).eq('status','active').maybeSingle();if(error||!campaign)throw new Error('campaign-not-active');};
 if(refresh)await assertCampaign(row.campaign_id);
 const revision=parseContentRevision(row.revision);
 const {data:account,error:accountError}=await db.from('marketing_accounts').select('*').eq('user_id',owner).eq('brand',revision.brand).eq('platform',revision.account.platform).eq('remote_account_id',revision.account.id).single();
 if(accountError||!account)throw new Error('account-unavailable');
 const sources=await sourceReferences(db,owner,revision);
 if(refresh){
  try{await synchronizeMarketingSources(db,owner,revision.brand,revision.sources.map(source=>source.sourceId),undefined,signal);}catch(error){
   if(error instanceof SourceRefreshError&&error.code==='source-removed')for(const source of sources)await ingestSource(db,owner,{...source,eligible:false,eligibilityReason:'source-removed',observedAt:new Date().toISOString()},source.brand);
   throw error;
  }
  const {data:currentAccount,error:currentAccountError}=await db.from('marketing_accounts').select('*').eq('user_id',owner).eq('id',account.id).single();
  if(currentAccountError||!currentAccount)throw new Error('account-unavailable');
  const {data:current,error:currentError}=await db.from('marketing_revisions').select('*').eq('user_id',owner).eq('id',revisionId).single();
  if(currentError||!current)throw new Error('revision-unavailable');
  await assertCampaign(current.campaign_id);
  return {revisionRow:current as MarketingRevisionRow,account:currentAccount as MarketingPublishAccount,sources:await sourceReferences(db,owner,revision)};
 }
 return {revisionRow:row as MarketingRevisionRow,account:account as MarketingPublishAccount,sources};
}
export async function executeOrchestratedMarketingJob(db:Database,owner:string,id:string){
 return executeMarketingJob(db,owner,id,{refreshSource,loadDneskaiMedia:createDneskaiMediaLoader(db,owner)});
}
/** `options.preflight` adds the read-only Meta checks to a dry run and stops before the container-create intent. */
export async function publishDueMarketing(db:Database,owner:string,brand:MarketingBrand,dryRun=true,signal=AbortSignal.timeout(55000),publicationId?:string,options:{preflight?:boolean}={}){
 if(!dryRun&&(process.env.MARKETING_PUBLISH_ENABLED!=='true'||process.env[`MARKETING_${brand.toUpperCase()}_PUBLISH_ENABLED`]!=='true'))throw new Error('publishing-held');
 let dueQuery=db.from('marketing_publications').select('id,revision_id,marketing_revisions!inner(brand)').eq('user_id',owner).eq('marketing_revisions.brand',brand).eq('status','queued').lte('scheduled_at',new Date().toISOString()).gte('scheduled_at',new Date(Date.now()-15*60000).toISOString()).order('scheduled_at').limit(1);if(publicationId)dueQuery=dueQuery.eq('id',publicationId);
 const {data:due,error}=await dueQuery;
 if(error)throw new Error('publication-state-unavailable');
 // Recheck live producer before a claim; an unavailable source creates no send.
 // A credential that cannot be used now (expired, missing, store unreadable)
 // also stops before the claim: the publication stays queued instead of being
 // recorded as failed by the post-claim hold below.
 let credentialHold:{publicationId:string;code:string}|null=null;
 for(const publication of due??[]){const state=await publishingState(db,owner,publication.revision_id,false);if(state.revisionRow.revision.brand===brand){await publishingState(db,owner,publication.revision_id,true,signal);
  if(!dryRun&&!credentialHold){const config=await resolveMetaPublisherConfig(db,owner,state.account,process.env);if(config.credentialHold)credentialHold={publicationId:publication.id,code:config.credentialHold};}}}
 let pendingQuery=db.from('marketing_publications').select('*,marketing_revisions!inner(brand)').eq('user_id',owner).eq('marketing_revisions.brand',brand).eq('status','claimed').eq('error_code','container-pending').gt('lease_until',new Date().toISOString()).limit(1);if(publicationId)pendingQuery=pendingQuery.eq('id',publicationId);const pending=await pendingQuery;
 if(pending.error)throw new Error('publication-state-unavailable');
 if(credentialHold&&!pending.data?.length)return {outcomes:[{publicationId:credentialHold.publicationId,status:'held' as const,errorCode:credentialHold.code,remoteContainerId:null,remoteMediaId:null,remoteUrl:null}]};
 let dryQuery=db.from('marketing_publications').select('*,marketing_revisions!inner(brand)').eq('user_id',owner).eq('marketing_revisions.brand',brand).eq('status','queued').lte('scheduled_at',new Date().toISOString()).limit(1);if(publicationId)dryQuery=dryQuery.eq('id',publicationId);
 const claimed=pending.data?.length?pending:dryRun?await dryQuery:await db.rpc('marketing_claim_due',{p_owner:owner,p_limit:1,p_brand:brand,...(publicationId?{p_publication:publicationId}:{})});
 if(claimed.error)throw new Error('publication-claim-failed');
 const outcomes=[];
 for(const raw of claimed.data??[]){
  const publication=raw as PublicationRow&{user_id:string;lease_until:string|null};const state=await publishingState(db,owner,publication.revision_id,true,signal);
  if(state.revisionRow.revision.brand!==brand)throw new Error('publication-brand-mismatch');
  let container=publication.remote_container_id,code=publication.error_code;
  // The stored account token wins over the environment bootstrap; a held credential stops at the gate.
  const config=await resolveMetaPublisherConfig(db,owner,state.account,process.env);
  const outcome=await publishMarketingRevision({...state,publication,config,dryRun,preflight:dryRun&&options.preflight===true,signal,revalidate:()=>publishingState(db,owner,publication.revision_id,true,signal),checkpoint:async checkpoint=>{
   if(checkpoint.stage==='outcome'){
    const {error:receiptError}=await db.rpc('marketing_finish_publication',{p_owner:owner,p_publication:publication.id,p_expected_container:container,p_expected_error:code,p_status:checkpoint.status,p_container:checkpoint.remoteContainerId,p_media:checkpoint.remoteMediaId,p_url:checkpoint.remoteUrl,p_error:checkpoint.errorCode});
    if(receiptError)throw new Error('publication-receipt-fence-lost');
   }else{
    const {error:checkpointError}=await db.rpc('marketing_checkpoint_publication',{p_owner:owner,p_publication:publication.id,p_expected_container:container,p_expected_error:code,p_container:checkpoint.remoteContainerId,p_error:checkpoint.errorCode});
    if(checkpointError)throw new Error('publication-fence-lost');
   }
   container=checkpoint.remoteContainerId;code=checkpoint.errorCode;
  }});
  if(!dryRun&&outcome.status==='held'&&outcome.errorCode!=='checkpoint-fence-lost'){
   const {error:finishError}=await db.rpc('marketing_finish_publication',{p_owner:owner,p_publication:publication.id,p_expected_container:container,p_expected_error:code,p_status:'failed',p_container:outcome.remoteContainerId,p_media:outcome.remoteMediaId,p_url:outcome.remoteUrl,p_error:outcome.errorCode});
   if(finishError)throw new Error('publication-finish-fence-lost');
  }
  outcomes.push({publicationId:publication.id,...outcome});
 }
 return {outcomes};
}
export async function reconcileStoredMarketingPublication(db:Database,owner:string,id:string){
 const {data:publication,error}=await db.from('marketing_publications').select('*').eq('user_id',owner).eq('id',id).in('status',['claimed','reconciliation','published']).single();
 if(error||!publication)throw new Error('publication-unavailable');
 const state=await publishingState(db,owner,publication.revision_id,false);
 const outcome=await reconcileMarketingPublication({...state,publication,config:await resolveMetaPublisherConfig(db,owner,state.account,process.env),checkpoint:async()=>{throw new Error('read-only-reconciliation');},revalidate:async()=>state});
 if(outcome.status==='published'&&(outcome.remoteUrl||publishedStoryReceipt(state.revisionRow.revision,{status:outcome.status,platform:publication.platform,remote_media_id:outcome.remoteMediaId,remote_url:outcome.remoteUrl}))){const {error:saveError}=await db.rpc('marketing_finish_publication',{p_owner:owner,p_publication:id,p_expected_container:publication.remote_container_id,p_expected_error:publication.error_code,p_status:'published',p_container:outcome.remoteContainerId,p_media:outcome.remoteMediaId,p_url:outcome.remoteUrl,p_error:null});if(saveError)throw new Error('receipt-reconciliation-required');}
 return outcome;
}
