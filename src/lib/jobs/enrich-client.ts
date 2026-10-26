import { z } from 'zod';
import type { CareerScope } from '@/lib/career-records';
import { careerEnrichmentReceiptSchema, normalizeJobUrl } from '@/lib/jobs/enrich';
import { awaitWithSignal } from '@/lib/abortable';
import { boundedResponseText } from '@/lib/bounded-response';

export class CareerEnrichmentError extends Error {
  constructor() { super('Position import unavailable'); }
}
/** Bind imported fields to the original owner and submitted URL, including body reads. */
export async function enrichCareerUrl(scope: CareerScope, rawUrl: string) {
  const { ownerId, signal: parent } = scope, url = normalizeJobUrl(rawUrl), lifetime = new AbortController();
  const signal = AbortSignal.any([parent, lifetime.signal, AbortSignal.timeout(30_000)]);
  let received: Response | undefined;
  try {
    signal.throwIfAborted(); z.uuid().parse(ownerId); if (!url) throw new CareerEnrichmentError();
    const pending = fetch('/api/jobs/enrich', { method: 'POST', headers: {
      'Content-Type': 'application/json', 'x-own-dashboard-owner': ownerId,
    }, body: JSON.stringify({ url }), signal });
    void pending.then(response => { if (signal.aborted) void response.body?.cancel().catch(() => undefined); }, () => undefined);
    const response = received = await awaitWithSignal(pending, signal); signal.throwIfAborted();
    if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw new CareerEnrichmentError(); }
    const receipt = careerEnrichmentReceiptSchema.parse(JSON.parse(await boundedResponseText(response, 256 * 1024, signal)));
    signal.throwIfAborted(); if (receipt.ownerId !== ownerId || receipt.inputUrl !== url) throw new CareerEnrichmentError();
    return receipt;
  } catch {
    if (parent.aborted) throw new DOMException('Request aborted', 'AbortError');
    throw new CareerEnrichmentError();
  } finally {
    lifetime.abort();
    if (received && !received.bodyUsed && !received.body?.locked) void received.body?.cancel().catch(() => undefined);
  }
}
