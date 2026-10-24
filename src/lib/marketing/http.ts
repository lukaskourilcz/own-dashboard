import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { marketingPilotConfiguration } from './pilot';
import { awaitWithSignal } from '@/lib/abortable';
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
export async function boundedRequestText(request: Request, maximum = 200000): Promise<string> {
 if (!Number.isSafeInteger(maximum) || maximum < 1) throw new MarketingRequestBodyError('invalid-body');
 if (request.signal.aborted) throw new MarketingRequestBodyError('request-body-aborted');
 const reader = request.body?.getReader();
 if (!reader) throw new MarketingRequestBodyError('missing-body');
 const deadline = new AbortController();
 const timeout = setTimeout(() => deadline.abort(), MARKETING_BODY_TIMEOUT_MS);
 const signal = AbortSignal.any([request.signal, deadline.signal]);
 let complete = false, size = 0;
 const chunks: Uint8Array[] = [];
 try {
  for (;;) {
   const { done, value } = await awaitWithSignal(reader.read(), signal);
   if (done) break;
   size += value.byteLength;
   if (size > maximum) throw new MarketingRequestBodyError('payload-too-large');
   chunks.push(value);
  }
  // Reject malformed bytes rather than authenticating a replacement-character version of a signed body.
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks, size));
  complete = true;
  return text;
 } catch (error) {
  if (request.signal.aborted) throw new MarketingRequestBodyError('request-body-aborted');
  if (deadline.signal.aborted) throw new MarketingRequestBodyError('request-body-timeout');
  throw error instanceof MarketingRequestBodyError ? error : new MarketingRequestBodyError('invalid-body');
 } finally {
  clearTimeout(timeout);
  // A producer's cancel hook can itself stall. Do not hold the response open for it.
  if (!complete) void reader.cancel().catch(() => undefined);
  reader.releaseLock();
 }
}
