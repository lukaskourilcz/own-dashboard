import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  DNESKAI_RESEARCH_CEILING_USD,DNESKAI_RESEARCH_PLAN,dneskaiResearchPlanId,researchRunInput,researchRunTargets,researchRunWorstUsd,validateDneskaiResearchPlan,
  type DneskaiResearchPlan,type ResearchItem,
} from './dneskai-apify-research-plan';
import { pragueMarketingDate } from './weekly-planning';

/**
 * The DNESKAi Apify research runner (brief §4.I). Off unless every gate holds:
 * - `MARKETING_DNESKAI_APIFY_RESEARCH_ENABLED` is exactly `true` (absent means off);
 * - `MARKETING_DNESKAI_APIFY_RESEARCH_APPROVED_PLAN` equals the sha256 of the plan in this build, which the owner
 *   records after reading the plan; any change to the plan needs a new approval;
 * - the actor's build is pinned in the plan, the Prague date is inside the item's window, and a daily item runs once
 *   per day;
 * - the research ledger admits the run's whole cap while the research total stays within $150.
 *
 * It shares nothing with the pipeline's Apify stage: not its switch (`MARKETING_DNESKAI_APIFY_ENABLED`), not its
 * actor binding, not its $0.04 per profile or $0.25 per Prague day guards, and not its ledger.
 * A dry run checks the same gates, prints what would run and the cap, and touches neither the ledger nor the network.
 * Every trace event carries codes, counts, costs and hashes only, never a target, an input or the token.
 */
export const DNESKAI_RESEARCH_SWITCH='MARKETING_DNESKAI_APIFY_RESEARCH_ENABLED';
export const DNESKAI_RESEARCH_APPROVAL='MARKETING_DNESKAI_APIFY_RESEARCH_APPROVED_PLAN';
export class DneskaiResearchError extends Error{constructor(readonly code:string){super(code);}}
export type ResearchEnvironment=Record<string,string|undefined>;

export type ResearchReservation={id:string;planId:string;itemKey:string;runIndex:number;capUsd:number;status:'reserved'|'started'|'settled'|'ambiguous';apifyRunId:string|null;costUsd:number|null};
export type ResearchReserveInput={owner:string;planId:string;itemKey:string;runIndex:number;actorId:string;build:string;capUsd:number;targetHash:string;ceilingUsd:number};
export type ResearchReserveResult={admitted:true;reservation:ResearchReservation;spentUsd:number}|{admitted:false;reason:'ceiling'|'duplicate';spentUsd:number};
/**
 * The research ledger, separate from every pipeline ledger. Spent is the sum over reservations of the settled cost,
 * or the full cap while the cost is unknown (reserved, started or ambiguous). Reserve is atomic per owner and admits
 * one (plan, item, run) once.
 */
export interface DneskaiResearchLedger{
  reserve(input:ResearchReserveInput):Promise<ResearchReserveResult>;
  mark(owner:string,reservationId:string,update:{status:'started'|'settled'|'ambiguous';apifyRunId?:string;costUsd?:number}):Promise<void>;
  spent(owner:string):Promise<number>;
}
export type ResearchTraceEvent={code:string;itemKey:string;runIndex:number;targetCount:number;targetHash:string;capUsd:number;costUsd?:number|null;spentUsd?:number};
export type ResearchRunRequest={owner:string;itemKey:string;runIndex:number;targets?:readonly string[];dryRun?:boolean};
export type ResearchDependencies={env?:ResearchEnvironment;ledger?:DneskaiResearchLedger;fetcher?:typeof fetch;now?:()=>Date;signal?:AbortSignal;plan?:DneskaiResearchPlan;trace?:(event:ResearchTraceEvent)=>void};
export type ResearchDryRun={mode:'dry-run';planId:string;itemKey:string;runIndex:number;actor:string;build:string|null;capUsd:number;worstCaseUsd:number;maxItems:number;input:Record<string,unknown>;blockedBy:string[];text:string};
export type ResearchStarted={mode:'started';planId:string;reservationId:string;apifyRunId:string;capUsd:number;spentUsd:number};

const hashTargets=(targets:readonly string[])=>createHash('sha256').update(JSON.stringify(targets),'utf8').digest('hex');
const dayIndex=(from:string,date:string)=>Math.round((Date.parse(`${date}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86_400_000);

function resolveTargets(item:ResearchItem,request:ResearchRunRequest):string[]{
  if(item.targets.kind==='fixed'){const targets=researchRunTargets(item,request.runIndex);if(!targets.length)throw new DneskaiResearchError('research-targets-invalid');return targets;}
  if(item.targets.kind==='none')return [];
  const pattern=new RegExp(item.targets.pattern),targets=[...(request.targets??[])];
  if(!targets.length||targets.length>item.targets.perRun||new Set(targets).size!==targets.length||targets.some(target=>target.length>2048||!pattern.test(target)))throw new DneskaiResearchError('research-targets-invalid');
  return targets;
}

/** Gates that hold the live run, in the order the runner checks them. Empty means it may reserve. */
function liveGates(plan:DneskaiResearchPlan,planId:string,item:ResearchItem,runIndex:number,env:ResearchEnvironment,now:Date):string[]{
  const blocked:string[]=[],build=plan.actors[item.actor].build,date=pragueMarketingDate(now);
  if(env[DNESKAI_RESEARCH_SWITCH]!=='true')blocked.push('research-disabled');
  if(env[DNESKAI_RESEARCH_APPROVAL]!==planId)blocked.push('research-plan-not-approved');
  if(!env.APIFY_TOKEN)blocked.push('research-apify-unconfigured');
  if(!build||!/^\d+\.\d+\.\d+$/.test(build))blocked.push('research-build-unpinned');
  if(date<item.window.from||date>item.window.to)blocked.push('research-outside-window');
  else if(item.wave==='daily'&&dayIndex(item.window.from,date)!==runIndex)blocked.push('research-daily-run-not-today');
  return blocked;
}

const RunSchema=z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),actId:z.string(),buildNumber:z.string(),defaultDatasetId:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),status:z.enum(['READY','RUNNING','SUCCEEDED','FAILED','TIMING-OUT','TIMED-OUT','ABORTING','ABORTED']),usageTotalUsd:z.number().nonnegative().nullable().optional()});
/** Apify refuses these before a run exists, so nothing was charged. Anything else after the request left is ambiguous. */
const REFUSED_BEFORE_START=new Set([400,401,402,403,404,422]);

async function apifyJson(url:string,init:RequestInit,fetcher:typeof fetch,signal?:AbortSignal):Promise<{ok:true;body:unknown}|{ok:false;status:number|null}>{
  let response:Response;
  try{response=await fetcher(url,{...init,redirect:'error',cache:'no-store',signal});}catch{return{ok:false,status:null};}
  if(!response.ok){await response.body?.cancel().catch(()=>undefined);return{ok:false,status:response.status};}
  try{const text=await response.text();if(text.length>1_000_000)return{ok:false,status:null};return{ok:true,body:JSON.parse(text)};}catch{return{ok:false,status:null};}
}

/** One research run: a dry run, or a reserved, capped start on the pinned build. Never retries a start. */
export async function startDneskaiResearchRun(request:ResearchRunRequest,dependencies:ResearchDependencies={}):Promise<ResearchDryRun|ResearchStarted>{
  const plan=dependencies.plan??DNESKAI_RESEARCH_PLAN,env=dependencies.env??process.env,now=(dependencies.now??(()=>new Date()))();
  if(validateDneskaiResearchPlan(plan).length)throw new DneskaiResearchError('research-plan-invalid');
  const item=plan.items.find(row=>row.key===request.itemKey);if(!item)throw new DneskaiResearchError('research-item-unknown');
  if(!Number.isInteger(request.runIndex)||request.runIndex<0||request.runIndex>=item.runs)throw new DneskaiResearchError('research-run-out-of-range');
  const planId=dneskaiResearchPlanId(plan),actor=plan.actors[item.actor],targets=resolveTargets(item,request),input=researchRunInput(item,targets);
  const event:ResearchTraceEvent={code:'',itemKey:item.key,runIndex:request.runIndex,targetCount:targets.length,targetHash:hashTargets(targets),capUsd:item.capUsd};
  const trace=(code:string,extra:Partial<ResearchTraceEvent>={})=>{try{dependencies.trace?.({...event,...extra,code});}catch{/* tracing never holds a run */}};
  const blockedBy=liveGates(plan,planId,item,request.runIndex,env,now);
  if(request.dryRun){
    const text=[`DRY RUN ${item.key} run ${request.runIndex+1}/${item.runs}: ${actor.name} build ${actor.build??'UNPINNED'}`,
      `  maxTotalChargeUsd ${item.capUsd.toFixed(2)} (worst case ${researchRunWorstUsd(item).toFixed(2)}), maxItems ${item.maxResultsPerRun}, window ${item.window.from}..${item.window.to}`,
      `  targets ${targets.length}${item.targets.kind==='fixed'?`: ${targets.join(', ')}`:''}`,
      `  live run ${blockedBy.length?`blocked by ${blockedBy.join(', ')}`:'would reserve against the research ledger'}`,
      `  plan id ${planId}`].join('\n');
    trace('research-dry-run');
    return{mode:'dry-run',planId,itemKey:item.key,runIndex:request.runIndex,actor:actor.name,build:actor.build,capUsd:item.capUsd,worstCaseUsd:researchRunWorstUsd(item),maxItems:item.maxResultsPerRun,input,blockedBy,text};
  }
  if(blockedBy.length){trace(blockedBy[0]);throw new DneskaiResearchError(blockedBy[0]);}
  const ledger=dependencies.ledger;if(!ledger)throw new DneskaiResearchError('research-ledger-unavailable');
  let decision:ResearchReserveResult;
  try{decision=await ledger.reserve({owner:request.owner,planId,itemKey:item.key,runIndex:request.runIndex,actorId:actor.id,build:actor.build!,capUsd:item.capUsd,targetHash:event.targetHash,ceilingUsd:DNESKAI_RESEARCH_CEILING_USD});}
  catch{throw new DneskaiResearchError('research-ledger-unavailable');}
  if(!decision.admitted){const code=decision.reason==='duplicate'?'research-run-already-reserved':'research-ceiling-reached';trace(code,{spentUsd:decision.spentUsd});throw new DneskaiResearchError(code);}
  const reservation=decision.reservation;
  const params=new URLSearchParams({build:actor.build!,waitForFinish:'0',timeout:'900',restartOnError:'false',maxItems:String(item.maxResultsPerRun),maxTotalChargeUsd:item.capUsd.toFixed(2)});
  const response=await apifyJson(`https://api.apify.com/v2/actors/${actor.name}/runs?${params}`,{method:'POST',headers:{Authorization:`Bearer ${env.APIFY_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(input)},dependencies.fetcher??fetch,dependencies.signal);
  if(!response.ok){
    // A refusal before start cost nothing; anything else keeps the whole cap counted until a person resolves it.
    if(response.status!==null&&REFUSED_BEFORE_START.has(response.status)){await ledger.mark(request.owner,reservation.id,{status:'settled',costUsd:0});trace(`research-apify-refused-${response.status}`,{costUsd:0});throw new DneskaiResearchError(`research-apify-refused-${response.status}`);}
    await ledger.mark(request.owner,reservation.id,{status:'ambiguous'});trace('research-start-ambiguous');throw new DneskaiResearchError('research-start-ambiguous');
  }
  const parsed=z.object({data:RunSchema}).safeParse(response.body);
  if(!parsed.success||parsed.data.data.actId!==actor.id||parsed.data.data.buildNumber!==actor.build){await ledger.mark(request.owner,reservation.id,{status:'ambiguous'});trace('research-apify-binding-invalid');throw new DneskaiResearchError('research-apify-binding-invalid');}
  await ledger.mark(request.owner,reservation.id,{status:'started',apifyRunId:parsed.data.data.id});
  trace('research-started',{spentUsd:decision.spentUsd});
  return{mode:'started',planId,reservationId:reservation.id,apifyRunId:parsed.data.data.id,capUsd:item.capUsd,spentUsd:decision.spentUsd};
}

/**
 * Reads a started run once. A finished run with a reported cost settles at that cost; a cost above the cap is recorded
 * as reported (the ledger counts what was charged) and returned as `research-cost-over-cap`. Reading is free.
 */
export async function settleDneskaiResearchRun(owner:string,reservation:ResearchReservation,dependencies:ResearchDependencies={}):Promise<{running:true}|{running:false;costUsd:number|null;code:string|null;datasetId:string|null}>{
  const plan=dependencies.plan??DNESKAI_RESEARCH_PLAN,env=dependencies.env??process.env,ledger=dependencies.ledger;
  const item=plan.items.find(row=>row.key===reservation.itemKey),actor=item?plan.actors[item.actor]:null;
  if(!ledger||!item||!actor||!reservation.apifyRunId||!env.APIFY_TOKEN)throw new DneskaiResearchError('research-settle-unavailable');
  const response=await apifyJson(`https://api.apify.com/v2/actor-runs/${encodeURIComponent(reservation.apifyRunId)}`,{headers:{Authorization:`Bearer ${env.APIFY_TOKEN}`}},dependencies.fetcher??fetch,dependencies.signal);
  if(!response.ok)throw new DneskaiResearchError('research-settle-unavailable');
  const run=z.object({data:RunSchema}).parse(response.body).data;
  if(run.id!==reservation.apifyRunId||run.actId!==actor.id)throw new DneskaiResearchError('research-apify-binding-invalid');
  if(['READY','RUNNING','TIMING-OUT','ABORTING'].includes(run.status))return{running:true};
  if(run.usageTotalUsd==null)return{running:false,costUsd:null,code:'research-cost-unknown',datasetId:null};
  await ledger.mark(owner,reservation.id,{status:'settled',costUsd:run.usageTotalUsd});
  const code=run.usageTotalUsd>reservation.capUsd+1e-9?'research-cost-over-cap':run.status==='SUCCEEDED'?null:'research-run-failed';
  try{dependencies.trace?.({code:code??'research-settled',itemKey:item.key,runIndex:reservation.runIndex,targetCount:0,targetHash:'',capUsd:reservation.capUsd,costUsd:run.usageTotalUsd});}catch{/* never holds */}
  return{running:false,costUsd:run.usageTotalUsd,code,datasetId:run.status==='SUCCEEDED'?run.defaultDatasetId:null};
}

const CTA=[['comment',/\b(comment|komentuj|napište|napiš)\b/i],['follow',/\b(follow|sleduj)/i],['save',/\b(save|ulož)/i],['share',/\b(share|send this|pošli|sdílej)/i],['link',/\b(link in bio|odkaz v bio|link v bio)\b/i]] as const;
const EMOJI=/\p{Extended_Pictographic}/gu;

/**
 * One public Instagram post or reel reduced to what the research stores: public counts, structure and derived caption
 * features. The caption text, the images, comments and every username outside the plan's public account lists are
 * dropped here, before anything is written. `accountHandle` is kept only for an account named in the approved plan.
 */
export function researchInstagramMetric(item:Record<string,unknown>,publicAccounts:ReadonlySet<string>){
  const num=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?Math.round(value):null;
  const text=typeof item.caption==='string'?item.caption:'',lines=text.split('\n').filter(line=>line.trim()),first=lines[0]??'';
  const owner=typeof item.ownerUsername==='string'&&publicAccounts.has(item.ownerUsername)?item.ownerUsername:null;
  const children=Array.isArray(item.childPosts)?item.childPosts:[];
  const music=item.musicInfo&&typeof item.musicInfo==='object'?item.musicInfo as Record<string,unknown>:null;
  const shortCode=typeof item.shortCode==='string'&&/^[A-Za-z0-9_-]{5,40}$/.test(item.shortCode)?item.shortCode:null;
  const timestamp=typeof item.timestamp==='string'&&!Number.isNaN(Date.parse(item.timestamp))?new Date(item.timestamp).toISOString():null;
  const likes=typeof item.likesCount==='number'?item.likesCount:null;
  return{
    shortCode,accountHandle:owner,postedAt:timestamp,
    type:typeof item.type==='string'?item.type.slice(0,20):null,productType:typeof item.productType==='string'?item.productType.slice(0,20):null,
    slideCount:children.length||null,videoSlideCount:children.filter(child=>child&&typeof child==='object'&&(child as {type?:unknown}).type==='Video').length,
    captionLength:text.length,captionLineCount:lines.length,firstLineLength:first.length,firstLineQuestion:/\?\s*$/.test(first),
    hashtagCount:Array.isArray(item.hashtags)?item.hashtags.length:(text.match(/#[\p{L}\p{N}_]+/gu)??[]).length,
    mentionCount:Array.isArray(item.mentions)?item.mentions.length:0,emojiCount:(text.match(EMOJI)??[]).length,
    cta:CTA.find(([,pattern])=>pattern.test(text))?.[0]??null,
    collaboratorCount:Array.isArray(item.coauthorProducers)?item.coauthorProducers.length:0,paidPartnership:item.paidPartnership===true,
    musicPresent:Boolean(music&&(music.song_name||music.audio_id)),musicOriginalAudio:music?music.uses_original_audio===true:null,
    musicAudioId:music&&typeof music.audio_id==='string'&&/^\d{1,30}$/.test(music.audio_id)?music.audio_id:null,
    likes:likes===-1?null:num(likes),likesHidden:likes===-1,comments:num(item.commentsCount),
    views:num(item.videoViewCount),plays:num(item.videoPlayCount),shares:num(item.sharesCount),
  };
}

type ResearchDatabase={rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};
/** The ledger on the migration's service-only functions (`20261022180000_dneskai_apify_research.sql`). */
export function createSupabaseResearchLedger(db:ResearchDatabase):DneskaiResearchLedger{
  const rpc=async(name:string,args:Record<string,unknown>)=>{const{data,error}=await db.rpc(name,args);if(error)throw new DneskaiResearchError('research-ledger-unavailable');return data;};
  const Reserved=z.union([
    z.object({admitted:z.literal(true),spentUsd:z.coerce.number(),reservation:z.object({id:z.uuid(),planId:z.string(),itemKey:z.string(),runIndex:z.number().int(),capUsd:z.coerce.number(),status:z.enum(['reserved','started','settled','ambiguous']),apifyRunId:z.string().nullable(),costUsd:z.coerce.number().nullable()})}),
    z.object({admitted:z.literal(false),reason:z.enum(['ceiling','duplicate']),spentUsd:z.coerce.number()}),
  ]);
  return{
    async reserve(input){return Reserved.parse(await rpc('marketing_reserve_dneskai_apify_research',{p_owner:input.owner,p_plan:input.planId,p_item:input.itemKey,p_run:input.runIndex,p_actor:input.actorId,p_build:input.build,p_cap:input.capUsd,p_target_hash:input.targetHash,p_ceiling:input.ceilingUsd}));},
    async mark(owner,reservationId,update){await rpc('marketing_mark_dneskai_apify_research',{p_owner:owner,p_reservation:reservationId,p_status:update.status,p_apify_run:update.apifyRunId??null,p_cost:update.costUsd??null});},
    async spent(owner){return z.coerce.number().parse(await rpc('marketing_dneskai_apify_research_spent',{p_owner:owner}));},
  };
}
