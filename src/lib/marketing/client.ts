import type { MarketingRevisionRow, PublicationRow, SourcePacket } from './contracts';
import { MARKETING_JOB_HEALTH_LIMIT, MarketingJobHealthSchema, type MarketingJobHealth } from './job-health';
export type MarketingState={
 revisions:Array<MarketingRevisionRow & {ready:boolean;offline_import_receipt?:{schemaVersion?:string;holdCode?:string}|null}>;
 campaigns:Array<{id:string;brand:string;name:string;starts_on:string;ends_on:string;source_hash:string;status:string}>;
 entries:Array<{id:string;campaign_id:string;date:string;local_time:string|null;bound_source_id:string|null;brand?:string;title:string;kind:string;platform:string;status:string;needs_review:boolean}>;
 publications:Array<PublicationRow & {revision_id:string}>;
 accounts:Array<{brand:string;platform:string;remote_account_id:string;handle:string;enabled:boolean;verified_at:string|null}>;
 sources:Array<{id:string;brand:string;source_id:string;packet:SourcePacket;eligible:boolean}>;
 sourceHistory:SourcePacket[];
 jobs:Array<{id:string;status:string;errorCode:string|null;createdAt:string;brand:string|null;costUsd:number|null}>;
 jobHealth?:MarketingJobHealth[];
 diagnostics:{sampleSize:number;firstApprovalRate:number|null};
};
export const EMPTY_MARKETING_STATE:MarketingState={revisions:[],campaigns:[],entries:[],publications:[],accounts:[],sources:[],sourceHistory:[],jobs:[],jobHealth:[],diagnostics:{sampleSize:0,firstApprovalRate:null}};
export async function loadMarketingState(signal?:AbortSignal):Promise<MarketingState>{
 const response=await fetch('/api/marketing/state',{cache:'no-store',signal});
 if(!response.ok)throw new Error('marketing-unavailable');
 const state=await response.json() as MarketingState;
 return {...state,jobHealth:Array.isArray(state.jobHealth)?state.jobHealth.slice(0,MARKETING_JOB_HEALTH_LIMIT).flatMap(value=>{const parsed=MarketingJobHealthSchema.safeParse(value);return parsed.success?[parsed.data]:[];}):[]};
}
export async function marketingDecision(input:unknown){
 const response=await fetch('/api/marketing/revisions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
 if(!response.ok)throw new Error('decision-failed');
 return response.json();
}
