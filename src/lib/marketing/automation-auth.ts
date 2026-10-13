import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MarketingBrand } from './contracts';
import { z } from 'zod';

export type AutomationPrincipal = { ownerId: string; brand: MarketingBrand | null; role: 'source' | 'worker' | 'publisher' };
export function authenticateAutomation(request: Request, body: string, env: Record<string,string|undefined> = process.env, now=Date.now()): AutomationPrincipal | null {
 const ownerId=env.MARKETING_OWNER_ID;
 if(!ownerId||!z.uuid().safeParse(ownerId).success) return null;
 const token=request.headers.get('authorization')?.replace(/^Bearer /,'');
 const time=request.headers.get('x-marketing-timestamp');
 const signature=request.headers.get('x-marketing-signature');
 if(!token || !time || !/^\d{10}$/.test(time) || !signature || !/^[a-f0-9]{64}$/.test(signature)) return null;
 if(Math.abs(now-Number(time)*1000)>300000) return null;
 const configs: Array<[string|undefined,MarketingBrand|null,AutomationPrincipal['role']]>=[
  [env.MARKETING_DNESKAI_SECRET,'dneskai','source'],[env.MARKETING_DEVSHARK_SECRET,'devshark','source'],
  [env.MARKETING_WORKER_SECRET,null,'worker'],[env.MARKETING_PUBLISH_SECRET,null,'publisher'],
 ];
 for(const [secret,brand,role] of configs){
  if(!secret || secret.length<32) continue;
  const received=Buffer.from(token),configured=Buffer.from(secret);
  if(received.length!==configured.length||!timingSafeEqual(received,configured))continue;
  const expected=createHmac('sha256',secret).update(`${time}.${body}`).digest('hex');
  if(timingSafeEqual(Buffer.from(expected),Buffer.from(signature))) return {ownerId,brand,role};
 }
 return null;
}
export function signAutomationBody(body:string,secret:string,now=Date.now()) {
 const timestamp=String(Math.floor(now/1000));
 return {Authorization:`Bearer ${secret}`,'Content-Type':'application/json','X-Marketing-Timestamp':timestamp,'X-Marketing-Signature':createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex')};
}
