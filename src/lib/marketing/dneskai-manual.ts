import 'server-only';
import { z } from 'zod';

const scopeSchema=z.strictObject({
 version:z.literal('dneskai-manual/1'),ownerId:z.uuid(),projectId:z.uuid(),runId:z.uuid(),
 startsAt:z.iso.datetime(),expiresAt:z.iso.datetime(),
});

/** A production check can resume only a pre-registered run; it never grants daily admission. */
export function manualCollectionExpiry(owner:string,project:string,runId:string|undefined,env:Record<string,string|undefined>,now:Date):number|null{
 if(env.VERCEL_ENV!=='production'||env.MARKETING_OWNER_ID!==owner||!env.MARKETING_DNESKAI_MANUAL_RUN||!runId)return null;
 try{
  const scope=scopeSchema.parse(JSON.parse(env.MARKETING_DNESKAI_MANUAL_RUN));
  const start=Date.parse(scope.startsAt),end=Date.parse(scope.expiresAt),at=now.getTime();
  if(scope.ownerId!==owner||scope.projectId!==project||scope.runId!==runId||!Number.isFinite(at)||end<=start||end-start>2*3600000||at<start||at>=end)return null;
  return end;
 }catch{return null;}
}
