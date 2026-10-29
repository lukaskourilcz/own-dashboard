import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { rejectCrossOrigin } from '@/lib/csrf';
import { rateLimit } from '@/lib/rate-limit';
import { careerEnrichmentReceiptSchema, jobPageTitleFields, normalizeJobUrl } from '@/lib/jobs/enrich';
import { awaitWithSignal } from '@/lib/abortable';
import { boundedResponseText } from '@/lib/bounded-response';

export const maxDuration = 30;
const headers = { 'Cache-Control': 'private, no-store' };
const fail = (status: number) => NextResponse.json({ error: status === 400 ? 'invalid-request' : status === 401 ? 'unauthorized' : status === 409 ? 'owner-changed' : 'job-enrichment-unavailable' }, { status, headers });
const inputSchema = z.strictObject({ url: z.string().max(2048) });
// Jina adds usage/timing metadata; select known fields without returning it.
const pageSchema = z.object({ data: z.object({ title: z.string().max(8192),
  description: z.string().max(1024 * 1024).optional(), content: z.string().max(1024 * 1024).optional(),
  url: z.string().max(2048).optional(),
}) });

/** Read only the explicitly submitted URL. No profile, draft or model call. */
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const expectedOwner = request.headers.get('x-own-dashboard-owner');
  if (expectedOwner !== null && !z.uuid().safeParse(expectedOwner).success) return fail(400);
  const lifetime = new AbortController(), signal = AbortSignal.any([request.signal, lifetime.signal, AbortSignal.timeout(25_000)]);
  const phase = (ms: number) => AbortSignal.any([signal, AbortSignal.timeout(ms)]);
  let received: Response | undefined;
  try {
    signal.throwIfAborted(); let input: z.infer<typeof inputSchema>;
    try {
      if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '')) return fail(400);
      input = inputSchema.parse(JSON.parse(await boundedResponseText(request, 16 * 1024, phase(3_000))));
    } catch { return fail(signal.aborted ? 503 : 400); }
    const url = normalizeJobUrl(input.url); if (!url) return fail(400);
    signal.throwIfAborted(); const authSignal = phase(5_000);
    const db = await awaitWithSignal(createClient(signal), authSignal);
    authSignal.throwIfAborted(); const auth = await awaitWithSignal(db.auth.getUser(), authSignal);
    authSignal.throwIfAborted();
    if (auth.error) return fail([400, 401, 403].includes(auth.error.status ?? 0) ? 401 : 503);
    const ownerId = auth.data.user?.id; if (typeof ownerId !== 'string' || !z.uuid().safeParse(ownerId).success) return fail(401);
    if (expectedOwner !== null && expectedOwner !== ownerId) return fail(409);
    const quotaSignal = phase(3_000);
    const quota = await awaitWithSignal(rateLimit(ownerId, { key: 'job-enrich', limit: 20, windowSec: 60 }), quotaSignal);
    quotaSignal.throwIfAborted(); if (!quota.ok) return fail(429);
    const providerSignal = phase(15_000);
    const pending = fetch(`https://r.jina.ai/${url}`, { headers: {
      Accept: 'application/json', 'X-Respond-With': 'markdown',
      ...(process.env.JINA_API_KEY ? { Authorization: `Bearer ${process.env.JINA_API_KEY}` } : {}),
    }, signal: providerSignal });
    // Dispose an uncooperative transport's body if it arrives after retirement.
    void pending.then(response => { if (providerSignal.aborted) void response.body?.cancel().catch(() => undefined); }, () => undefined);
    const response = received = await awaitWithSignal(pending, providerSignal); providerSignal.throwIfAborted();
    if (!response.ok) { void response.body?.cancel().catch(() => undefined); return fail(502); }
    const page = pageSchema.parse(JSON.parse(await boundedResponseText(response, 1024 * 1024, providerSignal)));
    providerSignal.throwIfAborted(); const fields = jobPageTitleFields(page.data.title);
    const receipt = careerEnrichmentReceiptSchema.parse({ ownerId, inputUrl: url,
      url: page.data.url === undefined ? url : normalizeJobUrl(page.data.url), ...fields,
      description: (page.data.content || page.data.description || '').trim().slice(0, 30_000),
    });
    signal.throwIfAborted(); return NextResponse.json(receipt, { headers });
  } catch { return fail(signal.aborted ? 503 : 502); }
  finally {
    lifetime.abort();
    if (received && !received.bodyUsed && !received.body?.locked) void received.body?.cancel().catch(() => undefined);
  }
}
