import 'server-only';
import { createMarketingTracer,LANGSMITH_EU_ENDPOINT } from './tracing';
export async function recordMarketingOwnerFeedback(input:{traceId:string|null;revisionId:string;revisionHash:string;decision:'approved'|'returned'|'skipped'},env:Record<string,string|undefined>=process.env):Promise<boolean>{
 if(!input.traceId||env.MARKETING_LANGSMITH_ENABLED!=='true'||!env.LANGSMITH_API_KEY||!env.LANGSMITH_PROJECT||env.LANGSMITH_ENDPOINT!==LANGSMITH_EU_ENDPOINT)return false;
 try{const tracer=await createMarketingTracer({apiKey:env.LANGSMITH_API_KEY,projectName:env.LANGSMITH_PROJECT,endpoint:env.LANGSMITH_ENDPOINT});return await tracer.recordOwnerFeedback({...input,traceId:input.traceId,qualityScore:input.decision==='approved'?1:0});}catch{return false;}
}
