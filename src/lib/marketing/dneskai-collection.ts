import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { dueDneskaiSources,DNESKAI_SOURCES,dneskaiCheapIdentity } from './dneskai-registry';
import { collectDneskaiFeed,startDneskaiInstagram,pollDneskaiInstagram,classifyDneskaiCandidates,jevRequest,DneskaiProviderError,type DneskaiApifyRegistration,type JevHistory,type ProviderEnvironment } from './dneskai-providers';
import { pragueMarketingDate } from './weekly-planning';
import { marketingPilotConfiguration } from './pilot';
import type { DneskaiCollectionStore,DneskaiRun } from './dneskai-store';
/** The pg_cron tick's only input: the project, and the run to resume (absent: admit today's run after 22:00 Prague). */
export const DneskaiCollectInput=z.strictObject({projectId:z.uuid(),runId:z.uuid().optional()});
/** One free source read. arXiv's API answered Vercel in more than 8 s on the first native night (21 October 2026). */
export const DNESKAI_FEED_TIMEOUT_MS=25_000;
/** Free reads only. Paid starts and settlement stay serial. */
export const DNESKAI_FEED_CONCURRENCY=3;
export type DneskaiCollectResponse={runId:string;status:DneskaiRun['status'];continue:boolean;retryAfterSeconds?:number};
export type DneskaiCollectionDependencies={store:DneskaiCollectionStore;env?:ProviderEnvironment;now?:()=>Date;signal?:AbortSignal;feed?:typeof collectDneskaiFeed;startInstagram?:typeof startDneskaiInstagram;pollInstagram?:typeof pollDneskaiInstagram;jev?:(...args:Parameters<typeof classifyDneskaiCandidates>)=>Promise<Pick<Awaited<ReturnType<typeof classifyDneskaiCandidates>>,'items'|'costUsd'>>};
/** Apify (the Instagram stages) has its own switch on every path, on top of the paid checks: only exactly 'true' turns it on. Jev does not read it. */
function apifyEnabled(env:ProviderEnvironment){return env.MARKETING_DNESKAI_APIFY_ENABLED==='true';}
function paidAllowed(owner:string,env:ProviderEnvironment,now:Date){if(env.MARKETING_AI_CONSENT!=='true'||env.MARKETING_DNESKAI_PAID_ENABLED!=='true')return false;try{return marketingPilotConfiguration(owner,env,now)===null;}catch{return false;}}
/** One bounded tick, awaited. Never retries a failed/ambiguous paid start. */
export async function tickDneskaiCollection(owner:string,value:unknown,dependencies:DneskaiCollectionDependencies):Promise<DneskaiCollectResponse>{
 const input=DneskaiCollectInput.parse(value),env=dependencies.env??process.env,clock=dependencies.now??(()=>new Date()),now=clock(),store=dependencies.store;
 if(env.MARKETING_DNESKAI_COLLECTION_ENABLED!=='true')throw new Error('collection-disabled');
 const date=pragueMarketingDate(now);if(!input.runId&&new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague',hour:'2-digit',hourCycle:'h23'}).format(now)<'22')throw new Error('collection-not-due');
 const original=input.runId?{id:input.runId}:await store.admit(owner,input.projectId,date,dueDneskaiSources(date));if(input.runId&&original.id!==input.runId)throw new Error('collection-run-unavailable');const fence=randomUUID(),run=await store.claim(owner,original.id,fence);
 if(!run)throw new Error('collection-run-unavailable');
 if(run.project_id!==input.projectId||run.user_id!==owner||run.collection_pilot_owner)throw new Error('collection-run-unavailable'); // A retained pilot run is never ticked.
 if(run.status!=='running'||run.fence!==fence)return{runId:run.id,status:run.status,continue:false};
 const budgetMs=45000,callEnds=Date.now()+budgetMs;
 const signal=dependencies.signal?AbortSignal.any([dependencies.signal,AbortSignal.timeout(budgetMs)]):AbortSignal.timeout(budgetMs);
 const stages=(await store.stages(owner,run.id)).sort((a,b)=>Number(b.status==='polling')-Number(a.status==='polling')); let operations=0;
 const freeHandled=new Set<string>();
 for(let stageIndex=0;stageIndex<stages.length;stageIndex++){
  const stage=stages[stageIndex];
  if(freeHandled.has(stage.source_id))continue;
  if(operations>=5||signal.aborted)break;if(!['queued','polling'].includes(stage.status)||stage.kind==='jev')continue;
  const source=DNESKAI_SOURCES.find(source=>source.id===stage.source_id);if(!source)throw new Error('collection-source-unavailable');
  // The switch holds a stage before its reservation. A started run (polling) is still read: reading is free and records its cost.
  const paid=source.kind==='instagram',apifyOff=paid&&stage.status==='queued'&&!apifyEnabled(env);
  if(!paid){
   // A contiguous free batch ends before the next paid stage; polling and paid admission keep their order.
   const batch: typeof stages=[];
   for(const next of stages.slice(stageIndex)){
    if(next.kind==='instagram'||next.kind==='jev')break;
    if(next.status==='queued')batch.push(next);
   }
   let cursor=0,admissionFailed=false;
   await Promise.all(Array.from({length:Math.min(DNESKAI_FEED_CONCURRENCY,batch.length)},async()=>{
    while(cursor<batch.length&&!admissionFailed&&operations<5&&!signal.aborted){
     if(operations>0&&callEnds-Date.now()<DNESKAI_FEED_TIMEOUT_MS)break;
     const next=batch[cursor++],freeSource=DNESKAI_SOURCES.find(row=>row.id===next.source_id);
     if(!freeSource)throw new Error('collection-source-unavailable');
     freeHandled.add(next.source_id);operations++; // Reserve the shared operation before awaiting its claim.
     let claimed;
     try{claimed=await store.claimStage(owner,run.id,fence,freeSource.id,false);}catch{admissionFailed=true;break;}
     if(!claimed){operations--;continue;}
     try{
      const result=await(dependencies.feed??collectDneskaiFeed)(freeSource,claimed.since_at,{env,signal:AbortSignal.any([signal,AbortSignal.timeout(DNESKAI_FEED_TIMEOUT_MS)]),now:clock()});
      await store.saveStage(owner,run.id,fence,freeSource.id,{status:result.complete?'ok':'partial',items:result.items,complete:result.complete,costUsd:0,errorCode:result.errorCode});
     }catch(error){await store.saveStage(owner,run.id,fence,freeSource.id,{status:'error',items:[],complete:false,costUsd:0,errorCode:error instanceof DneskaiProviderError?error.code:'collection-source-failed'});}
    }
   }));
   if(admissionFailed){await store.finish(owner,run.id,fence,'held','collection-paid-admission-blocked');return{runId:run.id,status:'held',continue:false};}
   continue;
  }
  if(paid&&(run.date!==date||apifyOff||!paidAllowed(owner,env,clock())||!env.APIFY_TOKEN||!env.MARKETING_DNESKAI_APIFY_BUILD||!env.MARKETING_DNESKAI_APIFY_ACTOR_ID)){
   const claimed=await store.claimStage(owner,run.id,fence,source.id,false);if(claimed)await store.saveStage(owner,run.id,fence,source.id,{status:'held',items:[],complete:false,costUsd:stage.reserved_usd>0?null:0,errorCode:run.date!==date?'collection-day-expired':apifyOff?'collection-apify-disabled':paidAllowed(owner,env,clock())?'collection-apify-unconfigured':'collection-paid-disabled'});continue;
  }
  const unresolved=(await store.stages(owner,run.id)).filter(row=>row.reserved_usd>0&&(row.cost_usd===null||row.cost_usd>row.reserved_usd));
  if(paid&&stage.status==='queued'&&unresolved.length){if(unresolved.some(row=>row.status==='polling'||row.status==='running'))break;const held=await store.claimStage(owner,run.id,fence,source.id,false);if(held)await store.saveStage(owner,run.id,fence,source.id,{status:'held',items:[],complete:false,costUsd:0,errorCode:'collection-cost-unresolved'});continue;}
  let claimed;
  try{claimed=await store.claimStage(owner,run.id,fence,source.id,paid&&stage.status==='queued');}catch{await store.finish(owner,run.id,fence,'held','collection-paid-admission-blocked');return{runId:run.id,status:'held',continue:false};}
  if(!claimed)continue;operations++;
  try{
   if(stage.status==='queued'){if(!apifyEnabled(env)||!paidAllowed(owner,env,clock())||run.date!==pragueMarketingDate(clock())||signal.aborted){await store.saveStage(owner,run.id,fence,source.id,{status:'held',items:[],complete:false,costUsd:0,errorCode:apifyEnabled(env)?'collection-day-or-consent-changed':'collection-apify-disabled'});continue;}const registration=await(dependencies.startInstagram??startDneskaiInstagram)(source,claimed.since_at,{env,signal});await store.saveStage(owner,run.id,fence,source.id,{status:'polling',items:[],complete:false,costUsd:null,errorCode:null,registration});}
   else{const result=await(dependencies.pollInstagram??pollDneskaiInstagram)(source,claimed.registration as DneskaiApifyRegistration,claimed.since_at,{env,signal,now:clock()});await store.saveStage(owner,run.id,fence,source.id,{status:result.running?'polling':result.complete?'ok':result.errorCode==='collection-source-item-cap'?'partial':'held',items:result.running?[]:result.items,complete:!result.running&&result.complete,costUsd:result.running?null:result.run.usageTotalUsd??null,errorCode:result.running?null:result.errorCode??null,registration:result.run});}
  }catch(error){const code=error instanceof DneskaiProviderError?error.code:paid?'collection-paid-outcome-ambiguous':'collection-source-failed';
   // A start that Apify definitely refused created no run and cost nothing: it settles at 0 so later paid work is not frozen.
   // Every other paid failure (network, timeout, 5xx, 429, a poll of a run that exists) keeps the unknown cost.
   const refused=paid&&stage.status==='queued'&&dneskaiApifyStartRefused(code);
   await store.saveStage(owner,run.id,fence,source.id,{status:paid?'held':'error',items:[],complete:false,costUsd:paid&&!refused?null:0,errorCode:code});if(paid&&!refused)break;}
 }
 let current=await store.stages(owner,run.id);
 if(current.some(stage=>stage.kind!=='jev'&&['queued','running','polling'].includes(stage.status))){const updated=await store.finish(owner,run.id,fence,'running',null);return{runId:updated.id,status:'running',continue:true,retryAfterSeconds:15};}
 const allInitial=await store.candidates(owner,input.projectId);
 let pending=pendingDneskaiCandidates(allInitial,clock());
 // Jev stages exist only for work that exists: planned once, after every source stage has settled.
 // Runs admitted before 20261021122104 already carry 16 fixed stages and are left as they are.
 if(run.jev_stage_count==null&&!current.some(stage=>stage.kind==='jev')){await store.planJev(owner,run.id,fence,dneskaiJevStageCount(pending.length));current=await store.stages(owner,run.id);}
 for(const classification of current.filter(stage=>stage.kind==='jev'&&stage.status==='queued')){
  if(signal.aborted||operations>=5)break;
  const all=await store.candidates(owner,input.projectId);pending=pendingDneskaiCandidates(all,clock());const items=pending.slice(0,8);
  const unresolved=(await store.stages(owner,run.id)).some(stage=>stage.reserved_usd>0&&(stage.cost_usd===null||stage.cost_usd>stage.reserved_usd));
  if(!items.length||!paidAllowed(owner,env,clock())||run.date!==date||!env.TYPESAFE_API_KEY||unresolved){
   const claimed=await store.claimStage(owner,run.id,fence,classification.source_id,false);
   if(claimed)await store.saveStage(owner,run.id,fence,classification.source_id,{status:'held',items:[],complete:false,costUsd:0,errorCode:!items.length?'collection-no-new-candidates':run.date!==date?'collection-day-expired':!env.TYPESAFE_API_KEY?'collection-jev-unconfigured':unresolved?'collection-cost-unresolved':'collection-paid-disabled'});
   continue;
  }
  const priorBatch=all.filter(item=>item.status==='new'&&item.category!==null&&item.reason===null).map(item=>({id:item.id,title:item.title,text:item.text}));
  const history=dneskaiJevHistory(items,[...new Map([...(await store.history(owner,input.projectId)),...priorBatch].map(item=>[item.id,item])).values()]);
  try{jevRequest(items,history);}catch{await store.finish(owner,run.id,fence,'held','collection-jev-input-limit');return{runId:run.id,status:'held',continue:false};} // Validate the plan before a paid reservation.
  let claimed;try{claimed=await store.claimStage(owner,run.id,fence,classification.source_id,true);}catch{await store.finish(owner,run.id,fence,'held','collection-paid-admission-blocked');return{runId:run.id,status:'held',continue:false};}
  if(!claimed)continue;operations++;
  if(!paidAllowed(owner,env,clock())||run.date!==pragueMarketingDate(clock())||signal.aborted){await store.saveStage(owner,run.id,fence,classification.source_id,{status:'held',items:[],complete:false,costUsd:0,errorCode:'collection-day-or-consent-changed'});continue;}
  try{const result=await(dependencies.jev??classifyDneskaiCandidates)(items,history,{env,signal});await store.saveStage(owner,run.id,fence,classification.source_id,{status:'ok',items:result.items,complete:true,costUsd:result.costUsd,errorCode:null});}
  catch(error){await store.saveStage(owner,run.id,fence,classification.source_id,{status:'held',items:[],complete:false,costUsd:null,errorCode:error instanceof DneskaiProviderError?error.code:'collection-jev-outcome-ambiguous'});break;}
 }
 current=await store.stages(owner,run.id);
 pending=pendingDneskaiCandidates(await store.candidates(owner,input.projectId),clock());
 if(current.some(stage=>stage.kind==='jev'&&stage.status==='queued')){const updated=await store.finish(owner,run.id,fence,'running',null);return{runId:updated.id,status:'running',continue:true,retryAfterSeconds:15};}
 // An Instagram stage held by its own switch (collection-apify-disabled) was switched off, not left incomplete: it keeps
 // its code on the stage and does not make the run partial (production-07). Real source errors still do.
 const covered=current.every(stage=>stage.status==='ok'||(stage.kind==='jev'&&stage.error_code==='collection-no-new-candidates')||dneskaiStageSwitchedOff(stage));
 const status=covered&&!pending.length?'complete':current.some(stage=>stage.status==='ok')?'partial':'held';
 // marketing_dneskai_finish selects events only while the run's date is still today in Prague. A run that finishes
 // after midnight selects nothing; the code says why instead of a silent zero (SEL-06). The policy is unchanged.
 const selectionDayPassed=run.date!==pragueMarketingDate(clock());
 const result=await store.finish(owner,run.id,fence,status,selectionDayPassed?'collection-selection-day-passed':pending.length?'collection-classification-pending':status==='complete'?null:'collection-review-incomplete');return{runId:result.id,status:result.status,continue:false};
}
/**
 * The comparison records one Jev call gets: the stored history (selected reports, approved and published posts),
 * then the classified open reports, most recently updated first, cut to the longest prefix jevRequest accepts. Its
 * byte limits trip well below 148 long Czech records, so the oldest open reports give way instead of the run being held.
 */
export function dneskaiJevHistory(items:readonly import('./dneskai-contracts').DneskaiCandidate[],history:readonly JevHistory[]){
 const fits=(count:number)=>{try{jevRequest(items,history.slice(0,count));return true;}catch{return false;}};
 let low=0,high=Math.min(148,history.length);if(fits(high))return history.slice(0,high);
 while(high-low>1){const middle=(low+high)>>1;if(fits(middle))low=middle;else high=middle;}
 return history.slice(0,low);
}
/**
 * Codes that prove an Instagram start created no Apify run: configuration or input refused before any request, or
 * a 4xx answer that carries Apify's own machine error type (the run was rejected, never queued). 408, 409 and 429
 * are not definite, and neither is a 4xx without Apify's machine type; those keep the cost unknown.
 */
const APIFY_REFUSED_BEFORE_REQUEST=new Set(['collection-apify-unconfigured','collection-instagram-input-invalid']);
export function dneskaiApifyStartRefused(code:string){return APIFY_REFUSED_BEFORE_REQUEST.has(code)||/^provider-http-(400|401|402|403|404|413|422)-[a-z0-9-]+$/.test(code);}
/** A stage the Apify switch held before any paid start: settled at zero cost, so nothing about it is unknown. */
export function dneskaiStageSwitchedOff(stage:Pick<import('./dneskai-store').DneskaiStage,'kind'|'status'|'error_code'|'cost_usd'>){return stage.kind==='instagram'&&stage.status==='held'&&stage.error_code==='collection-apify-disabled'&&stage.cost_usd===0;}
/** Jev classifies eight candidates per paid call; at most 16 calls per run (the former fixed stage count). */
export const DNESKAI_JEV_BATCH=8,DNESKAI_JEV_MAX_STAGES=16;
export function dneskaiJevStageCount(pending:number){return pending>0?Math.min(DNESKAI_JEV_MAX_STAGES,Math.ceil(pending/DNESKAI_JEV_BATCH)):0;}
/** Source round-robin and cheap identities precede every paid evaluation. Missing/stale date is held from paid input. */
export function pendingDneskaiCandidates(all:readonly import('./dneskai-contracts').DneskaiCandidate[],now:Date){
 const done=all.filter(item=>item.status==='selected'||item.status==='duplicate'||item.status==='rejected');const knownText=new Set(done.map(item=>dneskaiCheapIdentity(item).normalizedText));const knownUrls=new Set(done.map(item=>dneskaiCheapIdentity(item).canonicalUrl));
 const groups=new Map<string,import('./dneskai-contracts').DneskaiCandidate[]>();
 for(const item of [...all].sort((a,b)=>Date.parse(b.publishedAt??'')-Date.parse(a.publishedAt??''))){if(item.status!=='new'||item.category!==null||!item.publishedAt||Date.parse(item.publishedAt)>now.getTime()||Date.parse(item.publishedAt)<now.getTime()-30*86400000)continue;const identity=dneskaiCheapIdentity(item);if(!identity.normalizedText||knownText.has(identity.normalizedText)||knownUrls.has(identity.canonicalUrl))continue;knownText.add(identity.normalizedText);knownUrls.add(identity.canonicalUrl);const group=groups.get(item.sourceId)??[];group.push(item);groups.set(item.sourceId,group);}
 const result:import('./dneskai-contracts').DneskaiCandidate[]=[];while([...groups.values()].some(group=>group.length)){for(const group of groups.values()){const item=group.shift();if(item)result.push(item);}}return result;
}
