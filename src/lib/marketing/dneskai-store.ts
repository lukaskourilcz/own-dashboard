import 'server-only';
import { z } from 'zod';
import type { createAdminClient } from '@/lib/supabase/admin';
import { DneskaiCandidateSchema,DneskaiCollectionStateSchema,type DneskaiCandidate,type DneskaiSource } from './dneskai-contracts';
import { DNESKAI_SOURCES,isDneskaiProject,dneskaiCheapIdentity } from './dneskai-registry';
import { contentHash } from './hashes';
import type { JevHistory } from './dneskai-providers';
import type { DneskaiCollectionPilot } from './dneskai-pilot';
export type DneskaiDatabase=ReturnType<typeof createAdminClient>;
export type DneskaiRun={collection_pilot_owner?:string|null;id:string;user_id:string;project_id:string;date:string;target_date:string;status:'running'|'complete'|'partial'|'held'|'failed';fence:string|null;tick_count:number;selected_count:number;cost_usd:number|null;error_code:string|null};
export type DneskaiStage={run_id:string;source_id:string;kind:'feed'|'instagram'|'jev';status:'queued'|'running'|'polling'|'ok'|'partial'|'error'|'held';since_at:string;registration:unknown;reserved_usd:number;cost_usd:number|null;error_code:string|null};
export interface DneskaiCollectionStore{
 admit(owner:string,project:string,date:string,sources:readonly DneskaiSource[],pilot?:DneskaiCollectionPilot):Promise<DneskaiRun>;
 claim(owner:string,runId:string,fence:string):Promise<DneskaiRun|null>;
 stages(owner:string,runId:string):Promise<DneskaiStage[]>;
 claimStage(owner:string,runId:string,fence:string,sourceId:string,paid:boolean):Promise<DneskaiStage|null>;
 saveStage(owner:string,runId:string,fence:string,sourceId:string,result:{status:DneskaiStage['status'];items:DneskaiCandidate[];costUsd:number|null;complete:boolean;errorCode:string|null;registration?:unknown}):Promise<void>;
 candidates(owner:string,project:string):Promise<DneskaiCandidate[]>;
 history(owner:string,project:string):Promise<JevHistory[]>;
 finish(owner:string,runId:string,fence:string,status:DneskaiRun['status'],errorCode:string|null):Promise<DneskaiRun>;
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
  admit:(owner,project,date,sources,pilot)=>rpc(pilot?'marketing_dneskai_admit_pilot':'marketing_dneskai_admit',{p_owner:owner,p_project:project,p_date:date,p_sources:sources,...(pilot?{p_pilot:pilot}:{})}) as Promise<DneskaiRun>,
  claim:(owner,runId,fence)=>rpc('marketing_dneskai_claim',{p_owner:owner,p_run:runId,p_fence:fence}) as Promise<DneskaiRun|null>,
  async stages(owner,runId){const {data,error}=await db.from('marketing_dneskai_stages').select('*').eq('user_id',owner).eq('run_id',runId).order('source_id');if(error)throw new Error('collection-store-unavailable');return(data??[]) as DneskaiStage[];},
  claimStage:(owner,runId,fence,sourceId,paid)=>rpc('marketing_dneskai_claim_stage',{p_owner:owner,p_run:runId,p_fence:fence,p_source:sourceId,p_paid:paid}) as Promise<DneskaiStage|null>,
  async saveStage(owner,runId,fence,sourceId,result){await rpc('marketing_dneskai_save_stage',{p_owner:owner,p_run:runId,p_fence:fence,p_source:sourceId,p_result:{...result,items:result.items.map(item=>({...item,...(()=>{const identity=dneskaiCheapIdentity(item);return{canonicalUrlHash:contentHash(identity.canonicalUrl),normalizedTextHash:contentHash(identity.normalizedText)};})()}))}});},
  candidates,
  async history(owner,project){
   const [selected,published,approved]=await Promise.all([
    db.from('marketing_dneskai_candidates').select('candidate').eq('user_id',owner).eq('project_id',project).eq('status','selected').order('updated_at',{ascending:false}).limit(7),
    db.from('marketing_revisions').select('id,revision').eq('user_id',owner).eq('project_id',project).eq('brand','dneskai').eq('status','published').order('created_at',{ascending:false}).limit(6),
    db.from('marketing_revisions').select('id,revision').eq('user_id',owner).eq('project_id',project).eq('brand','dneskai').in('status',['approved','publishing']).order('created_at',{ascending:false}).limit(7),
   ]);if(selected.error||published.error||approved.error)throw new Error('collection-store-unavailable');
   const history=[...(selected.data??[]).map(row=>({id:row.candidate.id,title:row.candidate.title,text:row.candidate.text.slice(0,500)})),...(published.data??[]).map(row=>({id:row.id,title:String(row.revision.title).slice(0,500),text:String(row.revision.caption).slice(0,500)})),...(approved.data??[]).map(row=>({id:row.id,title:String(row.revision.title).slice(0,500),text:String(row.revision.caption).slice(0,500)}))];return[...new Map(history.map(item=>[item.id,item])).values()].slice(0,20);
  },
  finish:(owner,runId,fence,status,errorCode)=>rpc('marketing_dneskai_finish',{p_owner:owner,p_run:runId,p_fence:fence,p_status:status,p_error:errorCode}) as Promise<DneskaiRun>,
 };
}
export function dneskaiCollectionBlockers(env:Record<string,string|undefined>){const result:string[]=[];if(env.MARKETING_DNESKAI_COLLECTION_ENABLED!=='true')result.push('collection-disabled');if(!env.MARKETING_DNESKAI_SOURCE_URL||!env.MARKETING_DNESKAI_SOURCE_SECRET)result.push('collection-bridge-unconfigured');if(env.MARKETING_DNESKAI_PAID_ENABLED!=='true')result.push('collection-paid-disabled');if(!env.TYPESAFE_API_KEY)result.push('collection-jev-unconfigured');result.push('collection-transcripts-not-implemented');if(!env.APIFY_TOKEN||!env.MARKETING_DNESKAI_APIFY_BUILD||!env.MARKETING_DNESKAI_APIFY_ACTOR_ID)result.push('collection-apify-unconfigured');if(['MARKETING_PILOT_OWNER_ID','MARKETING_PILOT_STARTS_AT','MARKETING_PILOT_EXPIRES_AT'].some(key=>env[key]!==undefined))result.push('collection-paid-pilot-blocked');return result;}
export async function readDneskaiCollectionState(db:DneskaiDatabase,owner:string,project:string,env:Record<string,string|undefined>=process.env){
 await requireDneskaiProject(db,owner,project);
 const [states,runs,candidates]=await Promise.all([
  db.from('marketing_dneskai_source_states').select('*').eq('user_id',owner).eq('project_id',project),
  db.from('marketing_dneskai_runs').select('*').eq('user_id',owner).eq('project_id',project).order('date',{ascending:false}).limit(14),
  createDneskaiCollectionStore(db).candidates(owner,project),
 ]);if(states.error||runs.error)throw new Error('collection-state-unavailable');
 const byId=new Map((states.data??[]).map(row=>[row.source_id,row]));
 return DneskaiCollectionStateSchema.parse({schemaVersion:'dneskai-collection/1',timeZone:'Europe/Prague',localTime:'22:00',dailyTarget:4,approvalRequired:true,enabled:env.MARKETING_DNESKAI_COLLECTION_ENABLED==='true',blockers:[...dneskaiCollectionBlockers(env),...(candidates.length>200?['collection-candidate-window-partial']:[]),...((states.data??[]).some(row=>row.status==='partial')?['collection-cursor-recovery-required']:[])],sources:DNESKAI_SOURCES,sourceStates:DNESKAI_SOURCES.map(source=>{const state=byId.get(source.id);return{sourceId:source.id,lastSuccessAt:state?.last_success_at??null,lastAttemptAt:state?.last_attempt_at??null,status:state?.status??'never',errorCode:state?.error_code??null,itemCount:state?.item_count??0,costUsd:state?.cost_usd??null};}),candidates:candidates.slice(0,200),runs:(runs.data??[]).map(run=>({id:run.id,date:run.date,targetDate:run.target_date,status:run.status,selectedCount:run.selected_count,costUsd:run.cost_usd,errorCode:run.error_code}))});
}
