import 'server-only';
import { z } from 'zod';
import type { createAdminClient } from '@/lib/supabase/admin';
import { DneskaiCandidateSchema,DneskaiCollectionStateSchema,type DneskaiCandidate,type DneskaiSource } from './dneskai-contracts';
import { DNESKAI_SOURCES,isDneskaiProject,dneskaiCheapIdentity } from './dneskai-registry';
import { contentHash } from './hashes';
import { loadDneskaiSourceCatalog,type DneskaiSourceCatalog } from './dneskai-source-catalog';
import type { JevHistory } from './dneskai-providers';
import { previewPilotRetired } from './preview-pilot';
import { DNESKAI_FINISH_EVENT_LIMIT,dneskaiEventCategory,dneskaiFinishEvents,groupDneskaiEvents } from './dneskai-events';
import { dneskaiOtherEventViews,dneskaiSelectionEligible,readDneskaiBriefs } from './dneskai-brief-read';
import { dneskaiRecoveryCapabilities,dneskaiSelectionV2Enabled } from './dneskai-evidence-rollout';
export type DneskaiDatabase=ReturnType<typeof createAdminClient>;
export type DneskaiRun={collection_pilot_owner?:string|null;jev_stage_count?:number|null;id:string;user_id:string;project_id:string;date:string;target_date:string;status:'running'|'complete'|'partial'|'held'|'failed';fence:string|null;tick_count:number;selected_count:number;cost_usd:number|null;error_code:string|null};
export type DneskaiStage={run_id:string;source_id:string;kind:'feed'|'instagram'|'jev';status:'queued'|'running'|'polling'|'ok'|'partial'|'error'|'held';since_at:string;registration:unknown;reserved_usd:number;cost_usd:number|null;error_code:string|null};
export interface DneskaiCollectionStore{
 admit(owner:string,project:string,date:string,sources:readonly DneskaiSource[]):Promise<DneskaiRun>;
 claim(owner:string,runId:string,fence:string):Promise<DneskaiRun|null>;
 stages(owner:string,runId:string):Promise<DneskaiStage[]>;
 claimStage(owner:string,runId:string,fence:string,sourceId:string,paid:boolean):Promise<DneskaiStage|null>;
 saveStage(owner:string,runId:string,fence:string,sourceId:string,result:{status:DneskaiStage['status'];items:DneskaiCandidate[];costUsd:number|null;complete:boolean;errorCode:string|null;registration?:unknown}):Promise<void>;
 candidates(owner:string,project:string):Promise<DneskaiCandidate[]>;
 history(owner:string,project:string):Promise<JevHistory[]>;
 finish(owner:string,runId:string,fence:string,status:DneskaiRun['status'],errorCode:string|null):Promise<DneskaiRun>;
 /** Creates `count` Jev stages once per run, after the source stages; returns the planned count. */
 planJev(owner:string,runId:string,fence:string,count:number):Promise<number>;
 /** Decision 13: returns recent Jev holds to the queue once, before the Jev plan (migration 20261022180100). */
 requeueHeld?(owner:string,runId:string,fence:string):Promise<number>;
 /** Which sources exist (#174): the owner's table rows while DNESKAI_SOURCES_TABLE_ENABLED is on, else the registry file. */
 catalog?(owner:string,project:string,env:Record<string,string|undefined>):Promise<DneskaiSourceCatalog>;
}
export async function requireDneskaiProject(db:DneskaiDatabase,owner:string,projectId:string){
 z.uuid().parse(owner);z.uuid().parse(projectId);
 const {data,error}=await db.from('projects').select('id,user_id,portfolio_key,repo_full_name,previous_repo_full_names,parent_id').eq('user_id',owner).eq('id',projectId).maybeSingle();
 if(error||!data||data.user_id!==owner||data.id!==projectId||!isDneskaiProject(data))throw new Error('collection-project-unavailable');return data;
}
export function createDneskaiCollectionStore(db:DneskaiDatabase):DneskaiCollectionStore{
 const rpc=async(name:string,args:Record<string,unknown>)=>{const {data,error}=await db.rpc(name,args);if(error)throw new Error('collection-store-unavailable');return data;};
 const candidates=async(owner:string,project:string)=>{const {data,error}=await db.from('marketing_dneskai_candidates').select('candidate').eq('user_id',owner).eq('project_id',project).order('updated_at',{ascending:false}).limit(201);if(error)throw new Error('collection-store-unavailable');return(data??[]).map(row=>DneskaiCandidateSchema.parse(row.candidate));};
 return{
  admit:(owner,project,date,sources)=>rpc('marketing_dneskai_admit',{p_owner:owner,p_project:project,p_date:date,p_sources:sources}) as Promise<DneskaiRun>,
  claim:(owner,runId,fence)=>rpc('marketing_dneskai_claim',{p_owner:owner,p_run:runId,p_fence:fence}) as Promise<DneskaiRun|null>,
  async stages(owner,runId){const {data,error}=await db.from('marketing_dneskai_stages').select('*').eq('user_id',owner).eq('run_id',runId).order('source_id');if(error)throw new Error('collection-store-unavailable');return(data??[]) as DneskaiStage[];},
  claimStage:(owner,runId,fence,sourceId,paid)=>rpc('marketing_dneskai_claim_stage',{p_owner:owner,p_run:runId,p_fence:fence,p_source:sourceId,p_paid:paid}) as Promise<DneskaiStage|null>,
  async saveStage(owner,runId,fence,sourceId,result){await rpc('marketing_dneskai_save_stage',{p_owner:owner,p_run:runId,p_fence:fence,p_source:sourceId,p_result:{...result,items:result.items.map(item=>({...item,...(()=>{const identity=dneskaiCheapIdentity(item);return{canonicalUrlHash:contentHash(identity.canonicalUrl),normalizedTextHash:contentHash(identity.normalizedText)};})()}))}});},
  candidates,
  // DNESKAi revisions carry no project (marketing_save_revision copies the previous one's, null for a first draft),
  // so posts are scoped by owner and brand, as the brief coverage and marketing_private.dneskai_covering_id are.
  async history(owner,project){
   const [selected,published,approved]=await Promise.all([
    db.from('marketing_dneskai_candidates').select('candidate').eq('user_id',owner).eq('project_id',project).eq('status','selected').order('updated_at',{ascending:false}).limit(7),
    db.from('marketing_revisions').select('id,revision').eq('user_id',owner).eq('brand','dneskai').eq('status','published').order('created_at',{ascending:false}).limit(6),
    db.from('marketing_revisions').select('id,revision').eq('user_id',owner).eq('brand','dneskai').in('status',['approved','publishing']).order('created_at',{ascending:false}).limit(7),
   ]);if(selected.error||published.error||approved.error)throw new Error('collection-store-unavailable');
   const history=[...(selected.data??[]).map(row=>({id:row.candidate.id,title:row.candidate.title,text:row.candidate.text.slice(0,500)})),...(published.data??[]).map(row=>({id:row.id,title:String(row.revision.title).slice(0,500),text:String(row.revision.caption).slice(0,500)})),...(approved.data??[]).map(row=>({id:row.id,title:String(row.revision.title).slice(0,500),text:String(row.revision.caption).slice(0,500)}))];return[...new Map(history.map(item=>[item.id,item])).values()].slice(0,20);
  },
  // A finished run selects events (#115): the grouping is computed here, without a paid call, and validated in SQL.
  // A grouping that did not read every report says so on the run (collection-event-window-partial) unless the run already carries a code.
  async finish(owner,runId,fence,status,errorCode){const grouping=status==='running'?null:await finishEvents(db,owner,runId);return rpc('marketing_dneskai_finish',{p_owner:owner,p_run:runId,p_fence:fence,p_status:status,p_error:errorCode??(grouping?.partial?'collection-event-window-partial':null),...(grouping?{p_events:grouping.events}:{})}) as Promise<DneskaiRun>;},
  planJev:(owner,runId,fence,count)=>rpc('marketing_dneskai_plan_jev',{p_owner:owner,p_run:runId,p_fence:fence,p_count:count}) as Promise<number>,
  requeueHeld:(owner,runId,fence)=>rpc('marketing_dneskai_requeue_held',{p_owner:owner,p_run:runId,p_fence:fence}) as Promise<number>,
  catalog:(owner,project,env)=>loadDneskaiSourceCatalog(db as never,owner,project,env),
 };
}
/**
 * What the event grouping reads, newest first: every open report of the last 30 days, the selected reports of
 * the last 30 days (earlier coverage) and the duplicates of the last 7 days (Jev links between reports).
 */
export const DNESKAI_EVENT_READS=[{status:'new',days:30,limit:2000},{status:'selected',days:30,limit:1000},{status:'duplicate',days:7,limit:1000}] as const;
const EVENT_READ_PAGE=1000;
/**
 * The open and recently selected reports of the run's project, grouped into events for marketing_dneskai_finish.
 * Only events with an open report are sent. `partial` is true when a read or the event list reached its limit.
 */
export async function finishEvents(db:DneskaiDatabase,owner:string,runId:string){
 const {data:run,error}=await db.from('marketing_dneskai_runs').select('project_id').eq('user_id',owner).eq('id',runId).maybeSingle();if(error||!run)throw new Error('collection-store-unavailable');
 let partial=false;const rows:Array<{candidate:unknown}>=[];
 for(const read of DNESKAI_EVENT_READS){
  const since=new Date(Date.now()-read.days*86400000).toISOString();
  // Pages of a thousand (the PostgREST row cap); the last page reads one row past the limit to know it was reached.
  for(let from=0;;from+=EVENT_READ_PAGE){
   const to=Math.min(from+EVENT_READ_PAGE-1,read.limit);
   const {data,error:candidateError}=await db.from('marketing_dneskai_candidates').select('candidate').eq('user_id',owner).eq('project_id',run.project_id).eq('status',read.status).gte('updated_at',since).order('updated_at',{ascending:false}).order('id').range(from,to);
   if(candidateError)throw new Error('collection-store-unavailable');
   const page=(data??[]) as Array<{candidate:unknown}>;rows.push(...page.slice(0,read.limit-from));
   if(page.length<to-from+1)break;
   if(to>=read.limit){partial=true;break;}
  }
 }
 const candidates=rows.flatMap(row=>{const parsed=DneskaiCandidateSchema.safeParse(row.candidate);return parsed.success?[parsed.data]:[];});
 const grouped=groupDneskaiEvents(candidates).filter(event=>event.members.length>1&&event.members.some(member=>member.status==='new'));
 // SEL-10: each event names its majority category; the deployed SQL ignores it until the 20261022160000 migration.
 const now=new Date();
 return{events:dneskaiFinishEvents(grouped,undefined,event=>dneskaiEventCategory(event.members,member=>dneskaiSelectionEligible(member,now))),partial:partial||grouped.length>DNESKAI_FINISH_EVENT_LIMIT};
}
export function dneskaiCollectionBlockers(env:Record<string,string|undefined>){const result:string[]=[];if(env.MARKETING_DNESKAI_COLLECTION_ENABLED!=='true')result.push('collection-disabled');if(env.MARKETING_DNESKAI_FEED_PROVIDER&&!['bridge','native'].includes(env.MARKETING_DNESKAI_FEED_PROVIDER))result.push('collection-feed-provider-invalid');if(env.MARKETING_DNESKAI_FEED_PROVIDER!=='native'&&(!env.MARKETING_DNESKAI_SOURCE_URL||!env.MARKETING_DNESKAI_SOURCE_SECRET))result.push('collection-bridge-unconfigured');if(env.MARKETING_DNESKAI_PAID_ENABLED!=='true')result.push('collection-paid-disabled');if(!env.TYPESAFE_API_KEY)result.push('collection-jev-unconfigured');result.push('collection-transcripts-not-implemented');if(env.MARKETING_DNESKAI_APIFY_ENABLED!=='true')result.push('collection-apify-disabled');if(!env.APIFY_TOKEN||!env.MARKETING_DNESKAI_APIFY_BUILD||!env.MARKETING_DNESKAI_APIFY_ACTOR_ID)result.push('collection-apify-unconfigured');if(['MARKETING_PILOT_OWNER_ID','MARKETING_PILOT_STARTS_AT','MARKETING_PILOT_EXPIRES_AT'].some(key=>env[key]!==undefined)&&!previewPilotRetired('generation-pilot',env))result.push('collection-paid-pilot-blocked');return result;}
export async function readDneskaiCollectionState(db:DneskaiDatabase,owner:string,project:string,env:Record<string,string|undefined>=process.env){
 await requireDneskaiProject(db,owner,project);
 const [states,runs,candidates]=await Promise.all([
  db.from('marketing_dneskai_source_states').select('*').eq('user_id',owner).eq('project_id',project),
  db.from('marketing_dneskai_runs').select('*').eq('user_id',owner).eq('project_id',project).order('date',{ascending:false}).limit(14),
  createDneskaiCollectionStore(db).candidates(owner,project),
 ]);if(states.error||runs.error)throw new Error('collection-state-unavailable');
 const byId=new Map((states.data??[]).map(row=>[row.source_id,row]));
 // Events (#115): the selected ones with their briefs, then other recent ones. An unreadable brief store hides only this part.
 const briefed=await readDneskaiBriefs(db,owner,project).catch(()=>null);
 const events=briefed?[...briefed.events,...dneskaiOtherEventViews(candidates.slice(0,200),new Set(briefed.events.flatMap(event=>event.members.map(member=>member.candidateId))),undefined,undefined,dneskaiSelectionV2Enabled(env))].slice(0,60):undefined;
 return DneskaiCollectionStateSchema.parse({schemaVersion:'dneskai-collection/1',timeZone:'Europe/Prague',localTime:'22:00',dailyTarget:4,approvalRequired:true,enabled:env.MARKETING_DNESKAI_COLLECTION_ENABLED==='true',blockers:[...dneskaiCollectionBlockers(env),...(candidates.length>200?['collection-candidate-window-partial']:[]),...((states.data??[]).some(row=>row.status==='partial'&&row.error_code!=='collection-source-item-cap')?['collection-cursor-recovery-required']:[])],sources:DNESKAI_SOURCES,sourceStates:DNESKAI_SOURCES.map(source=>{const state=byId.get(source.id);return{sourceId:source.id,lastSuccessAt:state?.last_success_at??null,lastAttemptAt:state?.last_attempt_at??null,status:state?.status??'never',errorCode:state?.error_code??null,itemCount:state?.item_count??0,costUsd:state?.cost_usd??null};}),candidates:candidates.slice(0,200),runs:(runs.data??[]).map(run=>({id:run.id,date:run.date,targetDate:run.target_date,status:run.status,selectedCount:run.selected_count,costUsd:run.cost_usd,errorCode:run.error_code})),...(events?{events}:{}),recovery:dneskaiRecoveryCapabilities(env)});
}
