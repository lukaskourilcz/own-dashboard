import 'server-only';
import { z } from 'zod';
import { createMarketingTracer,LANGSMITH_EU_ENDPOINT,type OwnerFeedback } from './tracing';
import { parseContentRevision,type ContentRevision } from './contracts';
import { revisionContentHash } from './hashes';
import { ownerEditChainKinds,ownerEditKinds,ownerFeedbackScore,type OwnerEditCounts } from './owner-edits';
import type { createAdminClient } from '@/lib/supabase/admin';

export type MarketingOwnerFeedbackScope={db:ReturnType<typeof createAdminClient>;ownerId:string};
const Input=z.strictObject({traceId:z.uuid().nullable(),revisionId:z.uuid(),revisionHash:z.string().regex(/^[a-f0-9]{64}$/),decision:z.enum(['approved','returned','skipped','edited'])});
/** Longer chains are refused rather than walked: twenty saves of one post is far past any review. */
export const MARKETING_EDIT_CHAIN_LIMIT=20;
type ChainEntry={id:string;hash:string;revision:ContentRevision};
type ChainRow={id:string;content_hash:string;revision:unknown;replaces_id:string|null};

/**
 * The stored revisions of one generated post, from the generated revision to `reviewed`, following `replaces_id`
 * while the trace stays the same (a regenerated post starts a new trace). Every row must be the owner's and match
 * its stored hash; anything else is `null`.
 */
async function editChain(scope:MarketingOwnerFeedbackScope,reviewed:{traceId:string;revisionId:string;revisionHash:string}):Promise<ChainEntry[]|null>{
 const owner=z.uuid().parse(scope.ownerId);
 const chain:ChainEntry[]=[];
 let id:string|null=reviewed.revisionId;
 while(id){
  if(chain.length>=MARKETING_EDIT_CHAIN_LIMIT||chain.some(entry=>entry.id===id))return null;
  const {data,error}:{data:ChainRow|null;error:unknown}=await scope.db.from('marketing_revisions').select('id,content_hash,revision,replaces_id').eq('user_id',owner).eq('id',id).maybeSingle();
  if(error||!data||data.id!==id)return null;
  // An earlier generation ends this post's chain; it is never parsed or counted.
  if(chain.length&&(data.revision as {traceId?:unknown}|null)?.traceId!==reviewed.traceId)break;
  const revision=parseContentRevision(data.revision);
  if(revision.traceId!==reviewed.traceId||revisionContentHash(revision)!==data.content_hash)return null;
  chain.unshift({id:data.id,hash:data.content_hash,revision});
  id=data.replaces_id;
 }
 return chain.at(-1)?.hash===reviewed.revisionHash?chain:null;
}

/**
 * Call only after an owned action succeeds. With the scope, the feedback binds the exact reviewed revision and the
 * generated one its trace names, and carries the edit kinds of the `replaces_id` chain: all saves for a decision,
 * the last save for an edit. Scores: approved as generated 1, approved after edits 0.5, returned 0, skipped 0
 * (reason `skip`); an edit is recorded as `owner-edit` without a score. Diagnostics only: the result never gates
 * the action, and LangSmith is never the record of an approval (`marketing_revisions.approved_hash` is).
 */
export async function recordMarketingOwnerFeedback(value:z.infer<typeof Input>,env:Record<string,string|undefined>=process.env,scope?:MarketingOwnerFeedbackScope):Promise<boolean>{
 if(!value.traceId||env.MARKETING_LANGSMITH_ENABLED!=='true'||!env.LANGSMITH_API_KEY||!env.LANGSMITH_PROJECT||env.LANGSMITH_ENDPOINT!==LANGSMITH_EU_ENDPOINT)return false;
 try{
  const input=Input.parse(value);
  const traceId=input.traceId!;
  let edits:OwnerEditCounts|undefined;
  let generated:ChainEntry|undefined;
  if(scope){
   const chain=await editChain(scope,{traceId,revisionId:input.revisionId,revisionHash:input.revisionHash});
   if(!chain)return false;
   generated=chain[0]!;
   edits=input.decision==='edited'
    ?chain.length>1?ownerEditKinds(chain.at(-2)!.revision,chain.at(-1)!.revision):{}
    :ownerEditChainKinds(chain.map(entry=>entry.revision));
  }
  const score=ownerFeedbackScore(input.decision,edits??{});
  const feedback:OwnerFeedback={traceId,revisionId:input.revisionId,revisionHash:input.revisionHash,decision:input.decision,
   ...(score===null?{}:{qualityScore:score}),...(edits?{editKinds:edits}:{}),
   ...(generated?{generatedRevisionId:generated.id,generatedRevisionHash:generated.hash}:{})};
  const tracer=await createMarketingTracer({apiKey:env.LANGSMITH_API_KEY,projectName:env.LANGSMITH_PROJECT,endpoint:env.LANGSMITH_ENDPOINT});
  return await tracer.recordOwnerFeedback(feedback);
 }catch{return false;}
}
