import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { authenticateN8n,boundedRequestText } from '@/lib/marketing/http';
import { synchronizeMarketingSources,enqueueCalendarMarketingJob,executeOrchestratedMarketingJob,publishDueMarketing,reconcileStoredMarketingPublication } from '@/lib/marketing/orchestrator';
import { enqueueMarketingJob,readMarketingJob } from '@/lib/marketing/worker-runtime';
import { BrandSchema } from '@/lib/marketing/contracts';
import { runQueuedKnowledgeAnalysis,pollQueuedKnowledgeAnalysis,abortQueuedKnowledgeAnalysis,createKnowledgeDiagnostics } from '@/lib/marketing/knowledge-runner';
import { refreshSource,refreshMarketingSources,type SourceRefreshResult } from '@/lib/marketing/source-refresh';
import { contentHash } from '@/lib/marketing/hashes';
import { ingestSource } from '@/lib/marketing/store';
import { runMarketingRenderPreflight,MARKETING_PREFLIGHT_HOLD_CODES } from '@/lib/marketing/render-preflight';
import { MARKETING_RENDER_FAILURE_CODES } from '@/lib/marketing/render';
import { pragueMarketingDate,sevenDayMarketingWindow } from '@/lib/marketing/weekly-planning';
export const runtime='nodejs';
export const maxDuration=60;
const Input=z.discriminatedUnion('operation',[
 z.strictObject({operation:z.literal('discover'),brand:BrandSchema,date:z.iso.date().optional(),dates:z.array(z.iso.date()).min(1).max(7).optional(),cursor:z.string().max(1000).optional()}),
 z.strictObject({operation:z.literal('refresh'),brand:BrandSchema,sourceIds:z.array(z.string().min(1).max(200)).min(1).max(20)}),
 z.strictObject({operation:z.literal('enqueue'),brand:BrandSchema,job:z.unknown().optional(),entryId:z.uuid().optional(),platform:z.enum(['instagram','threads']).optional(),sourceId:z.string().max(200).optional()}),
 z.strictObject({operation:z.literal('execute'),jobId:z.uuid()}),
 z.strictObject({operation:z.literal('status'),jobId:z.uuid()}),
 z.strictObject({operation:z.literal('render-preflight'),brand:BrandSchema,sourceId:z.string().min(1).max(200),scheduledAt:z.iso.datetime({offset:true})}),
 z.strictObject({operation:z.literal('knowledge-queue')}),
 z.strictObject({operation:z.literal('weekly-report'),brand:BrandSchema.optional(),weekStartsOn:z.iso.date()}),
 z.strictObject({operation:z.enum(['knowledge-run','knowledge-poll','knowledge-abort']),sourceId:z.uuid()}),
 z.strictObject({operation:z.literal('publication-plan'),publicationId:z.uuid().optional(),brand:BrandSchema.optional()}),
 z.strictObject({operation:z.literal('publish'),brand:BrandSchema,dryRun:z.boolean().default(true),publicationId:z.uuid().optional()}),
 z.strictObject({operation:z.literal('reconcile'),publicationId:z.uuid().optional(),brand:BrandSchema.optional()}),
]);
function discoveryDates(input:Extract<z.infer<typeof Input>,{operation:'discover'}>,today:string):string[]{
 const dates=input.dates??[input.date??today];
 const invalid=(input.date!==undefined&&input.dates!==undefined)||(input.dates!==undefined&&input.cursor!==undefined)
  ||(input.brand==='dneskai'&&(input.dates!==undefined||dates[0]!==today))
  ||(input.dates!==undefined&&(new Date(`${dates[0]}T12:00:00Z`).getUTCDay()!==0||dates.some((date,index)=>date!==sevenDayMarketingWindow(dates[0]).dates[index])));
 if(invalid)throw new z.ZodError([{code:'custom',path:['dates'],message:'invalid-discovery-date-scope'}]);
 return dates;
}
async function weeklySourceDiscovery(db:ReturnType<typeof createAdminClient>,owner:string,dates:string[],signal:AbortSignal):Promise<SourceRefreshResult&{sourceDates:string[]}>{
 const result:SourceRefreshResult&{sourceDates:string[]}={packets:[],held:[],observedAt:new Date().toISOString(),noEditionDates:[],nextCursor:null,dropped:0,sourceDates:dates};
 const identities=new Map<string,string>();
 for(const date of dates){
  const refreshed=await refreshMarketingSources({brand:'devshark',date,signal});
  result.held.push(...refreshed.held);result.dropped+=refreshed.dropped;result.noEditionDates.push(...refreshed.noEditionDates);
  if(!refreshed.packets.length)result.held.push({sourceId:`daily:${date}`,reason:'daily-source-unavailable'});
  for(const packet of refreshed.packets){
   const canonical=new URL(packet.canonicalUrl);
   if(canonical.pathname!==`/daily/${date}`&&canonical.pathname!==`/daily/${date}/`){result.held.push({sourceId:packet.sourceId,reason:'daily-source-date-mismatch'});continue;}
   const identity=contentHash({...packet,observedAt:null});
   if(identities.has(packet.sourceId)){if(identities.get(packet.sourceId)!==identity)throw new Error('weekly-source-identity-conflict');continue;}
   if(result.packets.length>=42){result.dropped++;result.held.push({sourceId:packet.sourceId,reason:'weekly-source-limit'});continue;}
   await ingestSource(db,owner,packet,'devshark');identities.set(packet.sourceId,identity);result.packets.push(packet);
  }
 }
 return result;
}
export async function POST(request:Request){
 const owner=authenticateN8n(request);if(!owner)return Response.json({error:'unauthorized'},{status:401});
 try{
  const input=Input.parse(JSON.parse(await boundedRequestText(request)));const dates=input.operation==='discover'?discoveryDates(input,pragueMarketingDate(new Date())):null;
  const db=createAdminClient();const signal=AbortSignal.any([request.signal,AbortSignal.timeout(55000)]);
  if(input.operation==='discover'||input.operation==='refresh'){
   const weekly=input.operation==='discover'&&input.dates!==undefined;
   const refreshed=weekly?await weeklySourceDiscovery(db,owner,dates!,signal):await synchronizeMarketingSources(db,owner,input.brand,input.operation==='refresh'?input.sourceIds:undefined,input.operation==='discover'?input.cursor:undefined,signal);
   if(input.operation==='refresh')return Response.json({...refreshed,brand:input.brand});
   const date=dates![0];
   const {data:campaigns,error}=await db.from('marketing_campaigns').select('id').eq('user_id',owner).eq('brand',input.brand).eq('status','active');
   if(error)throw new Error('campaign-unavailable');
   const {data:rows,error:entryError}=await db.from('marketing_calendar_entries').select('id,date,kind,platform,local_time,status,needs_review').eq('user_id',owner).in('campaign_id',(campaigns??[]).map(c=>c.id)).in('date',dates!).order('date').order('local_time').order('id').limit(43);
   if(entryError)throw new Error('calendar-unavailable');
   const calendarHasMore=(rows?.length??0)>42,observed=(rows??[]).slice(0,42),entries:typeof observed=[],heldEntries:Array<{entryId:string;date:string;reason:string}>=[];
   let heldUnsupportedStoryCount=0;
   for(const entry of observed){
    const story=/^stor(?:y|ies)$/i.test(entry.kind)||/stor(?:y|ies)/i.test(entry.platform);
    const reason=story?'story-publication-unsupported':!['post','carousel','thread'].includes(entry.kind)||!['instagram','threads'].includes(entry.platform)?'calendar-format-unsupported':entry.status!=='planned'||entry.needs_review?'calendar-entry-held':null;
    if(story)heldUnsupportedStoryCount++;
    if(reason)heldEntries.push({entryId:entry.id,date:entry.date,reason});else entries.push(entry);
   }
   return Response.json({...refreshed,brand:input.brand,date,dates,entries,heldEntries,heldUnsupportedStoryCount,
    planning:{calendarObservedCount:observed.length,calendarHasMore,coverage:calendarHasMore?'partial':'complete',requestedDates:dates,
     weeklyGenerationImplemented:false,weeklyGenerationHoldCodes:weekly?['weekly-paid-admission-extension-required','thread-variants-unimplemented','story-publication-unsupported','weekly-asset-window-required']:[],
     limits:{calendarEntries:42,jobAdmissionsPerRolling24Hours:8,pilotLifetimeJobs:3,pilotReservedUsd:0.75},remainingAdmissions:null}},{headers:{'Cache-Control':'no-store'}});
  }
  if(input.operation==='weekly-report'){
   const window=sevenDayMarketingWindow(input.weekStartsOn);
   let query=db.from('marketing_publications').select('status,platform,scheduled_at,marketing_revisions!inner(brand)').eq('user_id',owner).gte('scheduled_at',window.startAt).lt('scheduled_at',window.endAtExclusive).order('scheduled_at').order('id').limit(1001);
   if(input.brand)query=query.eq('marketing_revisions.brand',input.brand);
   const {data,error}=await query;if(error)throw new Error('weekly-report-unavailable');
   const sampled=(data??[]).slice(0,1000),statusCounts={queued:0,claimed:0,published:0,failed:0,reconciliation:0,cancelled:0};let unknownStatusCount=0;
   for(const row of sampled){if(Object.hasOwn(statusCounts,row.status))statusCounts[row.status as keyof typeof statusCounts]++;else unknownStatusCount++;}
   const hasMore=(data?.length??0)>1000;
   return Response.json({mode:'read-only',brand:input.brand??'all',window,coverage:hasMore||unknownStatusCount?'partial':'complete',hasMore,sampleSize:sampled.length,limit:1000,statusCounts,unknownStatusCount,
    providerMetrics:{status:'unavailable',values:null,reason:'provider-metrics-not-collected'},weeklyComparison:null},{headers:{'Cache-Control':'no-store'}});
  }
  if(input.operation==='enqueue'){
   if(input.job){
    const {MarketingWorkerRequestSchema}=await import('../../../../../services/marketing-worker/protocol');
    const job=MarketingWorkerRequestSchema.parse(input.job);
    const {parseSourcePacket}=await import('@/lib/marketing/contracts');const packet=parseSourcePacket(job.generation.source);
    if(packet.brand!==input.brand)throw new Error('source-brand-mismatch');
    const current=await refreshSource(packet,signal);
    if(current.brand!==packet.brand||current.kind!==packet.kind||current.sourceId!==packet.sourceId||current.sourceRevision!==packet.sourceRevision||current.contentHash!==packet.contentHash||current.canonicalUrl!==packet.canonicalUrl||current.locale!==packet.locale||contentHash(current.content)!==packet.contentHash)throw new Error('source-superseded');
    await ingestSource(db,owner,current,input.brand);
    return Response.json(await enqueueMarketingJob(db,owner,{...job,generation:{...job.generation,source:current}}));
   }
   if(!input.entryId||!input.platform)return Response.json({error:'calendar-entry-required'},{status:400});
   return Response.json(await enqueueCalendarMarketingJob(db,owner,{...input,entryId:input.entryId,platform:input.platform}));
  }
  if(input.operation==='execute')return Response.json(await executeOrchestratedMarketingJob(db,owner,input.jobId));
  if(input.operation==='status')return Response.json(await readMarketingJob(db,owner,input.jobId));
  if(input.operation==='render-preflight')return Response.json(await runMarketingRenderPreflight(db,owner,{brand:input.brand,sourceId:input.sourceId,scheduledAt:input.scheduledAt},{signal}),{headers:{'Cache-Control':'no-store'}});
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
  const allowed=new Set(['calendar-entry-held','campaign-not-active','account-unverified','eligible-source-required','bound-source-unavailable','template-unavailable','template-not-approved','source-cursor-stale','source-integration-unconfigured','source-current-unavailable','source-removed','source-recheck-unavailable','source-superseded','marketing-generation-consent-required','schedule-outside-asset-window','knowledge-apify-configuration-required','knowledge-model-configuration-required','knowledge-reviewed-consent-required','knowledge-reviewed-plan-changed','knowledge-source-unavailable','knowledge-reference-unavailable','weekly-source-identity-conflict','weekly-report-unavailable']);
  const code=error instanceof Error?(('code' in error&&typeof error.code==='string')?error.code:error.message):'';
  return Response.json({error:invalid?'invalid-request':allowed.has(code)||MARKETING_PREFLIGHT_HOLD_CODES.some(value=>value===code)||MARKETING_RENDER_FAILURE_CODES.some(value=>value===code)?code:'marketing-operation-held'},{status:invalid?400:409});
 }
}
