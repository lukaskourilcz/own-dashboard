import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { marketingPilotConfiguration } from './pilot';
export function authenticateN8n(request:Request,env:Record<string,string|undefined>=process.env,now=new Date()):string|null {
 const owner=z.uuid().safeParse(env.MARKETING_OWNER_ID);const expected=env.MARKETING_N8N_SECRET;
 if(!owner.success||!Number.isFinite(now.getTime()))return null;
 // An absent pilot tuple preserves ordinary admission; a partial one throws.
 try{marketingPilotConfiguration(owner.data,env,now);}catch{return null;}
 const supplied=request.headers.get('authorization')?.replace(/^Bearer /,'');
 if(!expected||expected.length<32||!supplied)return null;
 const a=Buffer.from(expected),b=Buffer.from(supplied);
 return a.length===b.length&&timingSafeEqual(a,b)?owner.data:null;
}
export async function boundedRequestText(request:Request,maximum=200000):Promise<string>{
 const reader=request.body?.getReader();if(!reader)throw new Error('missing-body');
 let size=0;const chunks:Uint8Array[]=[];
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maximum){await reader.cancel();throw new Error('payload-too-large');}chunks.push(value);}
 return Buffer.concat(chunks).toString('utf8');
}
