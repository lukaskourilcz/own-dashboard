import 'server-only';
import { z } from 'zod';
import { createMarketingTracer,LANGSMITH_EU_ENDPOINT,type OwnerFeedback } from './tracing';
import { parseContentRevision } from './contracts';
import { revisionContentHash } from './hashes';
import type { createAdminClient } from '@/lib/supabase/admin';

export type MarketingOwnerFeedbackScope={db:ReturnType<typeof createAdminClient>;ownerId:string};
const Input=z.strictObject({traceId:z.uuid().nullable(),revisionId:z.uuid(),revisionHash:z.string().regex(/^[a-f0-9]{64}$/),decision:z.enum(['approved','returned','skipped','edited'])});
/** Call only after an owned action succeeds. The optional scope proves stored edit lineage. */
export async function recordMarketingOwnerFeedback(value:z.infer<typeof Input>,env:Record<string,string|undefined>=process.env,scope?:MarketingOwnerFeedbackScope):Promise<boolean>{
 if(!value.traceId||env.MARKETING_LANGSMITH_ENABLED!=='true'||!env.LANGSMITH_API_KEY||!env.LANGSMITH_PROJECT||env.LANGSMITH_ENDPOINT!==LANGSMITH_EU_ENDPOINT)return false;
 try{
  const input=Input.parse(value);
  const feedback:OwnerFeedback={...input,traceId:input.traceId!,qualityScore:input.decision==='approved'?1:0};
  if(scope){
   const owner=z.uuid().parse(scope.ownerId);
   const {data:reviewed,error:reviewedError}=await scope.db.from('marketing_revisions').select('id,content_hash,revision').eq('user_id',owner).eq('id',input.revisionId).maybeSingle();
   if(reviewedError||!reviewed||reviewed.id!==input.revisionId||reviewed.content_hash!==input.revisionHash)return false;
   const reviewedRevision=parseContentRevision(reviewed.revision);
   if(reviewedRevision.traceId!==input.traceId||revisionContentHash(reviewedRevision)!==input.revisionHash)return false;
   const {data:generated,error:generatedError}=await scope.db.from('marketing_revisions').select('id,content_hash,revision').eq('user_id',owner).eq('revision->>traceId',input.traceId).order('created_at',{ascending:true}).limit(1).maybeSingle();
   if(generatedError||!generated)return false;
   const generatedRevision=parseContentRevision(generated.revision);
   if(generatedRevision.traceId!==input.traceId||revisionContentHash(generatedRevision)!==generated.content_hash)return false;
   feedback.generatedRevisionId=z.uuid().parse(generated.id);
   feedback.generatedRevisionHash=z.string().regex(/^[a-f0-9]{64}$/).parse(generated.content_hash);
  }
  const tracer=await createMarketingTracer({apiKey:env.LANGSMITH_API_KEY,projectName:env.LANGSMITH_PROJECT,endpoint:env.LANGSMITH_ENDPOINT});
  return await tracer.recordOwnerFeedback(feedback);
 }catch{return false;}
}
