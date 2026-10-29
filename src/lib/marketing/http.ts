import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { marketingPilotConfiguration } from './pilot';
import { boundedStreamBytes, BoundedStreamError } from '@/lib/bounded-response';
export function authenticateN8n(request:Request,env:Record<string,string|undefined>=process.env,now=new Date()):string|null {
 const owner=z.uuid().safeParse(env.MARKETING_OWNER_ID);const expected=env.MARKETING_N8N_SECRET;
 if(!owner.success||!Number.isFinite(now.getTime()))return null;
 // An absent pilot tuple preserves ordinary admission; in Preview a partial one throws. Elsewhere it is retired and ignored.
 try{marketingPilotConfiguration(owner.data,env,now);}catch{return null;}
 const supplied=request.headers.get('authorization')?.replace(/^Bearer /,'');
 if(!expected||expected.length<32||!supplied)return null;
 const a=Buffer.from(expected),b=Buffer.from(supplied);
 return a.length===b.length&&timingSafeEqual(a,b)?owner.data:null;
}
export const MARKETING_BODY_TIMEOUT_MS = 5_000;
type BodyFailure = 'missing-body' | 'payload-too-large' | 'request-body-timeout' | 'request-body-aborted' | 'invalid-body';
export class MarketingRequestBodyError extends Error {
 constructor(readonly code: BodyFailure) { super(code); this.name = 'MarketingRequestBodyError'; }
}
/** Bound the whole upload, not each chunk. A refused body never reaches authentication or work admission. */
export async function boundedRequestText(request: Request, maximum = 200000, parent?: AbortSignal): Promise<string> {
 if (!Number.isSafeInteger(maximum) || maximum < 1) throw new MarketingRequestBodyError('invalid-body');
 if (request.signal.aborted || parent?.aborted) throw new MarketingRequestBodyError('request-body-aborted');
 if (!request.body) throw new MarketingRequestBodyError('missing-body');
 if (request.bodyUsed || request.body.locked) throw new MarketingRequestBodyError('invalid-body');
 const deadline = new AbortController();
 const timeout = setTimeout(() => deadline.abort(), MARKETING_BODY_TIMEOUT_MS);
 const signal = AbortSignal.any([request.signal, deadline.signal, ...(parent ? [parent] : [])]);
 try {
  const bytes = await boundedStreamBytes(request.body, maximum, signal);
  // Preserve the exact signed UTF-8 text, including its BOM, without mutable producer-owned chunks.
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
 } catch (error) {
  if (request.signal.aborted || parent?.aborted) throw new MarketingRequestBodyError('request-body-aborted');
  if (deadline.signal.aborted) throw new MarketingRequestBodyError('request-body-timeout');
  throw new MarketingRequestBodyError(error instanceof BoundedStreamError && error.reason === 'size' ? 'payload-too-large' : 'invalid-body');
 } finally {
  clearTimeout(timeout);
 }
}
