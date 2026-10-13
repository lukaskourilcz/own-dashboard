import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { dueDneskaiSources,DNESKAI_SOURCES,dneskaiCheapIdentity } from './dneskai-registry';
import { collectDneskaiFeed,startDneskaiInstagram,pollDneskaiInstagram,classifyDneskaiCandidates,jevRequest,DneskaiProviderError,type DneskaiApifyRegistration,type ProviderEnvironment } from './dneskai-providers';
import { pragueMarketingDate } from './weekly-planning';
import { marketingPilotConfiguration } from './pilot';
import { dneskaiCollectionPilotConfiguration } from './dneskai-pilot';
import type { DneskaiCollectionStore,DneskaiRun } from './dneskai-store';
export const DneskaiCollectInput=z.strictObject({projectId:z.uuid(),runId:z.uuid().optional(),pilot:z.literal(true).optional()});
export type DneskaiCollectResponse={runId:string;status:DneskaiRun['status'];continue:boolean;retryAfterSeconds?:number};
export type DneskaiCollectionDependencies={store:DneskaiCollectionStore;env?:ProviderEnvironment;now?:()=>Date;signal?:AbortSignal;feed?:typeof collectDneskaiFeed;startInstagram?:typeof startDneskaiInstagram;pollInstagram?:typeof pollDneskaiInstagram;jev?:typeof classifyDneskaiCandidates};
function paidAllowed(owner:string,env:ProviderEnvironment,now:Date,project:string,pilotMode:boolean){if(env.MARKETING_DNESKAI_PAID_ENABLED!=='true'||env.MARKETING_AI_CONSENT!=='true')return false;try{return pilotMode?dneskaiCollectionPilotConfiguration(owner,project,env,now)!==null:marketingPilotConfiguration(owner,env,now)===null;}catch{return false;}}
/** One bounded tick, awaited. Never retries a failed/ambiguous paid start. */
export async function tickDneskaiCollection(owner:string,value:unknown,dependencies:DneskaiCollectionDependencies):Promise<DneskaiCollectResponse>{
 const input=DneskaiCollectInput.parse(value),env=dependencies.env??process.env,clock=dependencies.now??(()=>new Date()),now=clock(),store=dependencies.store;
 const pilot=input.pilot?dneskaiCollectionPilotConfiguration(owner,input.projectId,env,now):null;
 if(input.pilot&&!pilot)throw new Error('collection-pilot-invalid');
 if(!pilot&&env.MARKETING_DNESKAI_COLLECTION_ENABLED!=='true')throw new Error('collection-disabled');
 const date=pragueMarketingDate(now);if(!pilot&&!input.runId&&new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague',hour:'2-digit',hourCycle:'h23'}).format(now)<'22')throw new Error('collection-not-due');
 const original=pilot?await store.admit(owner,input.projectId,date,dueDneskaiSources(date),pilot):input.runId?{id:input.runId}:await store.admit(owner,input.projectId,date,dueDneskaiSources(date));if(input.runId&&original.id!==input.runId)throw new Error('collection-run-unavailable');const fence=randomUUID(),run=await store.claim(owner,original.id,fence);
 if(!run)throw new Error('collection-run-unavailable');
 if(run.project_id!==input.projectId||run.user_id!==owner||Boolean(run.collection_pilot_owner)!==Boolean(pilot))throw new Error('collection-run-unavailable');
 if(run.status!=='running'||run.fence!==fence)return{runId:run.id,status:run.status,continue:false};
 const signal=dependencies.signal?AbortSignal.any([dependencies.signal,AbortSignal.timeout(pilot?Math.max(1,Math.min(45000,Date.parse(pilot.expiresAt)-clock().getTime())):45000)]):AbortSignal.timeout(pilot?Math.max(1,Math.min(45000,Date.parse(pilot.expiresAt)-clock().getTime())):45000);
 const stages=(await store.stages(owner,run.id)).sort((a,b)=>Number(b.status==='polling')-Number(a.status==='polling')); let operations=0;
 for(const stage of stages){
  if(operations>=5||signal.aborted)break;if(!['queued','polling'].includes(stage.status)||stage.kind==='jev')continue;
  const source=DNESKAI_SOURCES.find(source=>source.id===stage.source_id);if(!source)throw new Error('collection-source-unavailable');
  const paid=source.kind==='instagram';
  if(paid&&(run.date!==date||!paidAllowed(owner,env,clock(),input.projectId,Boolean(pilot))||!env.APIFY_TOKEN||!env.MARKETING_DNESKAI_APIFY_BUILD||!env.MARKETING_DNESKAI_APIFY_ACTOR_ID)){
   const claimed=await store.claimStage(owner,run.id,fence,source.id,false);if(claimed)await store.saveStage(owner,run.id,fence,source.id,{status:'held',items:[],complete:false,costUsd:stage.reserved_usd>0?null:0,errorCode:run.date!==date?'collection-day-expired':paidAllowed(owner,env,clock(),input.projectId,Boolean(pilot))?'collection-apify-unconfigured':'collection-paid-disabled'});continue;
  }
  const unresolved=(await store.stages(owner,run.id)).filter(row=>row.reserved_usd>0&&(row.cost_usd===null||row.cost_usd>row.reserved_usd));
  if(paid&&stage.status==='queued'&&unresolved.length){if(unresolved.some(row=>row.status==='polling'||row.status==='running'))break;const held=await store.claimStage(owner,run.id,fence,source.id,false);if(held)await store.saveStage(owner,run.id,fence,source.id,{status:'held',items:[],complete:false,costUsd:0,errorCode:'collection-cost-unresolved'});continue;}
  let claimed;
  try{claimed=await store.claimStage(owner,run.id,fence,source.id,paid&&stage.status==='queued');}catch{await store.finish(owner,run.id,fence,'held','collection-paid-admission-blocked');return{runId:run.id,status:'held',continue:false};}
  if(!claimed)continue;operations++;
  try{
   if(!paid){const result=await(dependencies.feed??collectDneskaiFeed)(source,claimed.since_at,{env,signal:AbortSignal.any([signal,AbortSignal.timeout(8000)]),now:clock(),...(pilot?{collectionPilot:{owner,project:input.projectId}}:{})});await store.saveStage(owner,run.id,fence,source.id,{status:result.complete?'ok':'partial',items:result.items,complete:result.complete,costUsd:0,errorCode:result.errorCode});}
   else if(stage.status==='queued'){if(!paidAllowed(owner,env,clock(),input.projectId,Boolean(pilot))||run.date!==pragueMarketingDate(clock())||signal.aborted){await store.saveStage(owner,run.id,fence,source.id,{status:'held',items:[],complete:false,costUsd:0,errorCode:'collection-day-or-consent-changed'});continue;}const registration=await(dependencies.startInstagram??startDneskaiInstagram)(source,claimed.since_at,{env,signal});await store.saveStage(owner,run.id,fence,source.id,{status:'polling',items:[],complete:false,costUsd:null,errorCode:null,registration});}
   else{const result=await(dependencies.pollInstagram??pollDneskaiInstagram)(source,claimed.registration as DneskaiApifyRegistration,claimed.since_at,{env,signal,now:clock()});await store.saveStage(owner,run.id,fence,source.id,{status:result.running?'polling':result.complete?'ok':'held',items:result.running?[]:result.items,complete:!result.running&&result.complete,costUsd:result.running?null:result.run.usageTotalUsd??null,errorCode:result.running?null:result.errorCode??null,registration:result.run});}
  }catch(error){const code=error instanceof DneskaiProviderError?error.code:paid?'collection-paid-outcome-ambiguous':'collection-source-failed';await store.saveStage(owner,run.id,fence,source.id,{status:paid?'held':'error',items:[],complete:false,costUsd:paid?null:0,errorCode:code});if(paid)break;}
 }
 let current=await store.stages(owner,run.id);
 if(current.some(stage=>stage.kind!=='jev'&&['queued','running','polling'].includes(stage.status))){const updated=await store.finish(owner,run.id,fence,'running',null);return{runId:updated.id,status:'running',continue:true,retryAfterSeconds:15};}
 const allInitial=await store.candidates(owner,input.projectId);
 let pending=pendingDneskaiCandidates(allInitial,clock());
 for(const classification of current.filter(stage=>stage.kind==='jev'&&stage.status==='queued')){
  if(signal.aborted||operations>=5)break;
  const all=await store.candidates(owner,input.projectId);pending=pendingDneskaiCandidates(all,clock());const items=pending.slice(0,8);
  const unresolved=(await store.stages(owner,run.id)).some(stage=>stage.reserved_usd>0&&(stage.cost_usd===null||stage.cost_usd>stage.reserved_usd));
  if(!items.length||!paidAllowed(owner,env,clock(),input.projectId,Boolean(pilot))||run.date!==date||!env.TYPESAFE_API_KEY||unresolved){
   const claimed=await store.claimStage(owner,run.id,fence,classification.source_id,false);
   if(claimed)await store.saveStage(owner,run.id,fence,classification.source_id,{status:'held',items:[],complete:false,costUsd:0,errorCode:!items.length?'collection-no-new-candidates':run.date!==date?'collection-day-expired':!env.TYPESAFE_API_KEY?'collection-jev-unconfigured':unresolved?'collection-cost-unresolved':'collection-paid-disabled'});
   continue;
  }
  const priorBatch=all.filter(item=>item.status==='new'&&item.category!==null&&item.reason===null).map(item=>({id:item.id,title:item.title,text:item.text}));
  const history=[...new Map([...(await store.history(owner,input.projectId)),...priorBatch].map(item=>[item.id,item])).values()].slice(0,148);
  try{jevRequest(items,history);}catch{await store.finish(owner,run.id,fence,'held','collection-jev-input-limit');return{runId:run.id,status:'held',continue:false};} // Validate the plan before a paid reservation.
  let claimed;try{claimed=await store.claimStage(owner,run.id,fence,classification.source_id,true);}catch{await store.finish(owner,run.id,fence,'held','collection-paid-admission-blocked');return{runId:run.id,status:'held',continue:false};}
  if(!claimed)continue;operations++;
  if(!paidAllowed(owner,env,clock(),input.projectId,Boolean(pilot))||run.date!==pragueMarketingDate(clock())||signal.aborted){await store.saveStage(owner,run.id,fence,classification.source_id,{status:'held',items:[],complete:false,costUsd:0,errorCode:'collection-day-or-consent-changed'});continue;}
  try{const result=await(dependencies.jev??classifyDneskaiCandidates)(items,history,{env,signal});await store.saveStage(owner,run.id,fence,classification.source_id,{status:'ok',items:result.items,complete:true,costUsd:result.costUsd,errorCode:null});}
  catch(error){await store.saveStage(owner,run.id,fence,classification.source_id,{status:'held',items:[],complete:false,costUsd:null,errorCode:error instanceof DneskaiProviderError?error.code:'collection-jev-outcome-ambiguous'});break;}
 }
 current=await store.stages(owner,run.id);
 pending=pendingDneskaiCandidates(await store.candidates(owner,input.projectId),clock());
 if(current.some(stage=>stage.kind==='jev'&&stage.status==='queued')){const updated=await store.finish(owner,run.id,fence,'running',null);return{runId:updated.id,status:'running',continue:true,retryAfterSeconds:15};}
 const covered=current.every(stage=>stage.status==='ok'||(stage.kind==='jev'&&stage.error_code==='collection-no-new-candidates'));
 const status=covered&&!pending.length?'complete':current.some(stage=>stage.status==='ok')?'partial':'held';
 const result=await store.finish(owner,run.id,fence,status,pending.length?'collection-classification-pending':status==='complete'?null:'collection-review-incomplete');return{runId:result.id,status:result.status,continue:false};
}
/** Source round-robin and cheap identities precede every paid evaluation. Missing/stale date is held from paid input. */
export function pendingDneskaiCandidates(all:readonly import('./dneskai-contracts').DneskaiCandidate[],now:Date){
 const done=all.filter(item=>item.status==='selected'||item.status==='duplicate'||item.status==='rejected');const knownText=new Set(done.map(item=>dneskaiCheapIdentity(item).normalizedText));const knownUrls=new Set(done.map(item=>dneskaiCheapIdentity(item).canonicalUrl));
 const groups=new Map<string,import('./dneskai-contracts').DneskaiCandidate[]>();
 for(const item of [...all].sort((a,b)=>Date.parse(b.publishedAt??'')-Date.parse(a.publishedAt??''))){if(item.status!=='new'||item.category!==null||!item.publishedAt||Date.parse(item.publishedAt)>now.getTime()||Date.parse(item.publishedAt)<now.getTime()-30*86400000)continue;const identity=dneskaiCheapIdentity(item);if(!identity.normalizedText||knownText.has(identity.normalizedText)||knownUrls.has(identity.canonicalUrl))continue;knownText.add(identity.normalizedText);knownUrls.add(identity.canonicalUrl);const group=groups.get(item.sourceId)??[];group.push(item);groups.set(item.sourceId,group);}
 const result:import('./dneskai-contracts').DneskaiCandidate[]=[];while([...groups.values()].some(group=>group.length)){for(const group of groups.values()){const item=group.shift();if(item)result.push(item);}}return result;
}
