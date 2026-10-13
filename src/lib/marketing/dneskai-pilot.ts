import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
export const DNESKAI_COLLECTION_PILOT_MAX_RESERVED_USD=0.24;
export const DNESKAI_COLLECTION_PILOT_MAX_RUNS=1;
const names=['MARKETING_DNESKAI_COLLECTION_PILOT_ENABLED','MARKETING_DNESKAI_COLLECTION_PILOT_OWNER_ID','MARKETING_DNESKAI_COLLECTION_PILOT_PROJECT_ID','MARKETING_DNESKAI_COLLECTION_PILOT_STARTS_AT','MARKETING_DNESKAI_COLLECTION_PILOT_EXPIRES_AT'] as const;
const schema=z.strictObject({ownerId:z.uuid(),projectId:z.uuid(),startsAt:z.iso.datetime(),expiresAt:z.iso.datetime()});
export type DneskaiCollectionPilot=z.infer<typeof schema>;
export class DneskaiCollectionPilotError extends Error{constructor(readonly code:string){super(code);}}
/** Independent collection authority; never changes generation reservations or grants publishing authority. */
export function dneskaiCollectionPilotConfiguration(owner:string,project:string,env:Record<string,string|undefined>=process.env,now=new Date()):DneskaiCollectionPilot|null{
 if(names.every(name=>env[name]===undefined))return null;
 if(env.MARKETING_DNESKAI_COLLECTION_PILOT_ENABLED==='false'&&names.slice(1).every(name=>env[name]===undefined))return null;
 const parsed=schema.safeParse({ownerId:env[names[1]],projectId:env[names[2]],startsAt:env[names[3]],expiresAt:env[names[4]]});
 if(env.VERCEL_ENV!=='preview'||env[names[0]]!=='true'||!parsed.success||env.MARKETING_OWNER_ID!==owner)throw new DneskaiCollectionPilotError('collection-pilot-invalid');
 const pilot=parsed.data,start=Date.parse(pilot.startsAt),end=Date.parse(pilot.expiresAt);
 if(pilot.ownerId!==owner||pilot.projectId!==project||!Number.isFinite(now.getTime())||end<=start||end-start>48*3600000)throw new DneskaiCollectionPilotError('collection-pilot-invalid');
 if(now.getTime()<start||now.getTime()>=end)throw new DneskaiCollectionPilotError('collection-pilot-expired');return pilot;
}
export function authenticateDneskaiCollectionPilot(request:Request,project:string,env:Record<string,string|undefined>=process.env,now=new Date()):string|null{
 const owner=env.MARKETING_OWNER_ID??'';
 try{if(!dneskaiCollectionPilotConfiguration(owner,project,env,now))return null;}catch{return null;}
 const expected=env.MARKETING_DNESKAI_COLLECTION_SECRET,supplied=request.headers.get('authorization')?.replace(/^Bearer /,'');
 if(!expected||expected.length<32||!supplied)return null;const a=Buffer.from(expected),b=Buffer.from(supplied);return a.length===b.length&&timingSafeEqual(a,b)?owner:null;
}
