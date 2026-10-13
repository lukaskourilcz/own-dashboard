import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { authenticateN8n,boundedRequestText } from '@/lib/marketing/http';
import { synchronizeMarketingSources,enqueueCalendarMarketingJob,executeOrchestratedMarketingJob,publishDueMarketing,reconcileStoredMarketingPublication } from '@/lib/marketing/orchestrator';
import { enqueueMarketingJob,readMarketingJob } from '@/lib/marketing/worker-runtime';
import { BrandSchema } from '@/lib/marketing/contracts';
import { runQueuedKnowledgeAnalysis,pollQueuedKnowledgeAnalysis,abortQueuedKnowledgeAnalysis,createKnowledgeDiagnostics } from '@/lib/marketing/knowledge-runner';
import { ingestSource } from '@/lib/marketing/store';
export const runtime='nodejs';
export const maxDuration=60;
const Input=z.discriminatedUnion('operation',[
 z.strictObject({operation:z.literal('discover'),brand:BrandSchema,date:z.iso.date().optional(),cursor:z.string().max(1000).optional()}),
 z.strictObject({operation:z.literal('refresh'),brand:BrandSchema,sourceIds:z.array(z.string().min(1).max(200)).min(1).max(20)}),
 z.strictObject({operation:z.literal('enqueue'),brand:BrandSchema,job:z.unknown().optional(),entryId:z.uuid().optional(),platform:z.enum(['instagram','threads']).optional(),sourceId:z.string().max(200).optional()}),
 z.strictObject({operation:z.literal('execute'),jobId:z.uuid()}),
 z.strictObject({operation:z.literal('status'),jobId:z.uuid()}),
 z.strictObject({operation:z.literal('knowledge-queue')}),
 z.strictObject({operation:z.enum(['knowledge-run','knowledge-poll','knowledge-abort']),sourceId:z.uuid()}),
 z.strictObject({operation:z.literal('publication-plan'),publicationId:z.uuid().optional(),brand:BrandSchema.optional()}),
 z.strictObject({operation:z.literal('publish'),brand:BrandSchema,dryRun:z.boolean().default(true),publicationId:z.uuid().optional()}),
 z.strictObject({operation:z.literal('reconcile'),publicationId:z.uuid().optional(),brand:BrandSchema.optional()}),
]);
export async function POST(request:Request){
 const owner=authenticateN8n(request);if(!owner)return Response.json({error:'unauthorized'},{status:401});
 try{
  const input=Input.parse(JSON.parse(await boundedRequestText(request)));const db=createAdminClient();const signal=AbortSignal.any([request.signal,AbortSignal.timeout(55000)]);
  if(input.operation==='discover'||input.operation==='refresh'){
   const refreshed=await synchronizeMarketingSources(db,owner,input.brand,input.operation==='refresh'?input.sourceIds:undefined,input.operation==='discover'?input.cursor:undefined,signal);
   if(input.operation==='refresh')return Response.json({...refreshed,brand:input.brand});
   const date=input.date??new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+86400000));
   const {data:campaigns,error}=await db.from('marketing_campaigns').select('id').eq('user_id',owner).eq('brand',input.brand).eq('status','active');
   if(error)throw new Error('campaign-unavailable');
   const {data:entries,error:entryError}=await db.from('marketing_calendar_entries').select('id,platform,local_time,title').eq('user_id',owner).in('campaign_id',(campaigns??[]).map(c=>c.id)).eq('date',date).in('kind',['post','carousel','thread']).in('platform',['instagram','threads']).eq('status','planned').eq('needs_review',false).limit(8);
   if(entryError)throw new Error('calendar-unavailable');
   return Response.json({...refreshed,brand:input.brand,date,entries:entries??[]});
  }
  if(input.operation==='enqueue'){
   if(input.job){
    const {MarketingWorkerRequestSchema}=await import('../../../../../services/marketing-worker/protocol');
    const job=MarketingWorkerRequestSchema.parse(input.job);
    const {parseSourcePacket}=await import('@/lib/marketing/contracts');const packet=parseSourcePacket(job.generation.source);
    if(packet.brand!==input.brand)throw new Error('source-brand-mismatch');
    await ingestSource(db,owner,packet,input.brand);
    return Response.json(await enqueueMarketingJob(db,owner,job));
   }
   if(!input.entryId||!input.platform)return Response.json({error:'calendar-entry-required'},{status:400});
   return Response.json(await enqueueCalendarMarketingJob(db,owner,{...input,entryId:input.entryId,platform:input.platform}));
  }
  if(input.operation==='execute')return Response.json(await executeOrchestratedMarketingJob(db,owner,input.jobId));
  if(input.operation==='status')return Response.json(await readMarketingJob(db,owner,input.jobId));
  if(input.operation==='knowledge-queue'){const {data,error}=await db.from('marketing_knowledge_sources').select('id,status').eq('user_id',owner).in('status',['queued','analyzing']).order('updated_at').limit(5);if(error)throw new Error('knowledge-state-unavailable');return Response.json({sources:data??[]});}
  if(input.operation==='knowledge-run')return Response.json(await runQueuedKnowledgeAnalysis(owner,input.sourceId,{diagnostics:await createKnowledgeDiagnostics()}));
  if(input.operation==='knowledge-poll')return Response.json(await pollQueuedKnowledgeAnalysis(owner,input.sourceId));
  if(input.operation==='knowledge-abort')return Response.json(await abortQueuedKnowledgeAnalysis(owner,input.sourceId));
  if(input.operation==='publication-plan'){
   let selection=db.from('marketing_publications').select('id,scheduled_at,marketing_revisions!inner(id,campaign_id,brand,ready,status,approved_hash,content_hash)').eq('user_id',owner).eq('status','queued').eq('marketing_revisions.ready',true).eq('marketing_revisions.status','approved').gte('scheduled_at',new Date().toISOString()).lte('scheduled_at',new Date(Date.now()+86400000).toISOString()).order('scheduled_at').limit(8);
   if(input.publicationId)selection=selection.eq('id',input.publicationId);if(input.brand)selection=selection.eq('marketing_revisions.brand',input.brand);
   const {data,error}=await selection;if(error)throw new Error('publication-plan-unavailable');
   const {data:campaigns,error:campaignError}=await db.from('marketing_campaigns').select('id').eq('user_id',owner).eq('status','active');if(campaignError)throw new Error('campaign-state-unavailable');const active=new Set((campaigns??[]).map(c=>c.id));
   const publications=(data??[]).flatMap(row=>{const revision=Array.isArray(row.marketing_revisions)?row.marketing_revisions[0]:row.marketing_revisions;return revision&&(!revision.campaign_id||active.has(revision.campaign_id))&&revision.approved_hash===revision.content_hash?[{publicationId:row.id,brand:revision.brand,scheduledAt:row.scheduled_at}]:[];});
   return Response.json({publications});
  }
  if(input.operation==='publish')return Response.json(await publishDueMarketing(db,owner,input.brand,input.dryRun,signal,input.publicationId));
  if(input.operation!=='reconcile')return Response.json({error:'invalid-request'},{status:400});
  if(input.publicationId)return Response.json(await reconcileStoredMarketingPublication(db,owner,input.publicationId));
  if(!input.brand)return Response.json({error:'reconciliation-scope-required'},{status:400});
  const {data:pending,error}=await db.from('marketing_publications').select('id,marketing_revisions!inner(brand)').eq('user_id',owner).eq('marketing_revisions.brand',input.brand).in('status',['claimed','reconciliation']).order('last_checked_at',{ascending:true,nullsFirst:true}).limit(1);
  if(error)throw new Error('reconciliation-state-unavailable');
  const outcomes=[];for(const item of pending??[]){await db.from('marketing_publications').update({last_checked_at:new Date().toISOString()}).eq('user_id',owner).eq('id',item.id);outcomes.push({publicationId:item.id,...await reconcileStoredMarketingPublication(db,owner,item.id)});}
  return Response.json({outcomes});
 }catch(error){
  const invalid=error instanceof z.ZodError||error instanceof SyntaxError;
  const allowed=new Set(['calendar-entry-held','campaign-not-active','account-unverified','eligible-source-required','bound-source-unavailable','template-unavailable','template-not-approved','source-cursor-stale','source-integration-unconfigured','source-current-unavailable','source-removed','source-recheck-unavailable','source-superseded','marketing-generation-consent-required','schedule-outside-asset-window','knowledge-apify-configuration-required','knowledge-model-configuration-required','knowledge-reviewed-consent-required','knowledge-reviewed-plan-changed','knowledge-source-unavailable']);
  const code=error instanceof Error?(('code' in error&&typeof error.code==='string')?error.code:error.message):'';
  return Response.json({error:invalid?'invalid-request':allowed.has(code)?code:'marketing-operation-held'},{status:invalid?400:409});
 }
}
