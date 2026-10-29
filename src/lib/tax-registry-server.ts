import 'server-only';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { rejectCrossOrigin } from '@/lib/csrf';
import { rateLimit } from '@/lib/rate-limit';
import { awaitWithSignal } from '@/lib/abortable';
import { boundedResponseText } from '@/lib/bounded-response';
import { ARES_SUBJECT_ENDPOINT, AresLookupSchema, VIES_CHECK_ENDPOINT, ViesLookupSchema, EU_VAT_COUNTRIES, isValidIco, normalizeIco, parseVatId, mapAresSubject, mapViesResult } from '@/lib/tax-registry';

const headers = { 'cache-control': 'private, no-store', Vary: 'Cookie' };
const inputs = { ares: z.object({ ico: z.string().max(64) }).strict(), vies: z.object({ vatId: z.string().max(64) }).strict() };
const viesProvider = z.object({ countryCode: z.string().regex(/^[A-Z]{2}$/), vatNumber: z.string().min(2).max(64), valid: z.boolean(), userError: z.string().max(128).nullish(), name: z.string().max(2000).nullish(), address: z.string().max(4096).nullish() });
const aresProvider = z.object({ ico: z.string().regex(/^\d{8}$/), obchodniJmeno: z.string().max(2000).optional(), dic: z.string().max(64).optional(), sidlo: z.object({
 nazevUlice: z.string().max(48).optional(), nazevCastiObce: z.string().max(48).optional(), nazevObce: z.string().max(48).optional(), nazevStatu: z.string().max(32).optional(),
 textovaAdresa: z.string().max(1500).optional(), psc: z.number().int().min(0).max(99999).optional(), cisloDomovni: z.number().int().min(0).max(9999).optional(),
 cisloOrientacni: z.number().int().min(0).max(999).optional(), cisloOrientacniPismeno: z.string().max(1).optional(),
}).optional() });
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers });
const fail = (status: number, error: string) => reply({ error }, status);

/** Shared admission for two credential-free public registries. Never persists a
 * verdict or turns an unavailable member-state service into invalid evidence. */
export async function registryLookup(request: Request, kind: 'ares' | 'vies'): Promise<Response> {
 const csrf = rejectCrossOrigin(request);
 if (csrf) { csrf.headers.set('cache-control', headers['cache-control']); csrf.headers.set('Vary', headers.Vary); return csrf; }
 const stop = new AbortController(), signal = AbortSignal.any([request.signal, stop.signal, AbortSignal.timeout(25_000)]);
 try {
  signal.throwIfAborted();
  let raw: unknown;
  const uploadSignal = AbortSignal.any([signal, AbortSignal.timeout(5_000)]);
  try { raw = JSON.parse(await boundedResponseText(request, 1024, uploadSignal)); }
  catch { return fail(uploadSignal.aborted ? 408 : 400, 'invalid-body'); }
  const input = inputs[kind].safeParse(raw);
  if (!input.success) return fail(400, kind === 'ares' ? 'invalid-ico' : 'not-eu-vat-id');
  const ico = normalizeIco('ico' in input.data ? input.data.ico : null), vat = parseVatId('vatId' in input.data ? input.data.vatId : null);
  if (kind === 'ares' ? !isValidIco(ico) : !vat || !EU_VAT_COUNTRIES.has(vat.countryCode)) return fail(400, kind === 'ares' ? 'invalid-ico' : 'not-eu-vat-id');
  const authSignal = AbortSignal.any([signal, AbortSignal.timeout(8_000)]);
  const db = await awaitWithSignal(createClient(authSignal), authSignal), auth = await awaitWithSignal(db.auth.getUser(), authSignal);
  if (auth.error) return fail([400,401,403].includes(auth.error.status ?? 0) ? 401 : 503, 'registry-unavailable');
  if (!auth.data.user) return fail(401, 'unauthorized');
  const ownerId = z.uuid().parse(auth.data.user.id), captured = request.headers.get('x-own-dashboard-owner');
  if (captured !== null && captured !== ownerId) return fail(403, 'registry-unavailable');
  const limited = await awaitWithSignal(rateLimit(ownerId, { key: `registry-${kind}`, limit: 20, windowSec: 60 }), AbortSignal.any([signal, AbortSignal.timeout(2_000)]));
  if (!limited.ok) return fail(429, 'rate-limited');
  signal.throwIfAborted();
  const unavailable = () => reply(ViesLookupSchema.parse({ ownerId, status: 'unavailable', name: '', address: '', vatId: `${vat!.countryCode}${vat!.number}`, checkedAt: new Date().toISOString() }));
  try {
   const budget = AbortSignal.any([signal, AbortSignal.timeout(kind === 'ares' ? 10_000 : 15_000)]);
   const pending = fetch(kind === 'ares' ? `${ARES_SUBJECT_ENDPOINT}/${ico}` : VIES_CHECK_ENDPOINT, {
    method: kind === 'ares' ? 'GET' : 'POST', redirect: 'error', cache: 'no-store', signal: budget,
    headers: kind === 'ares' ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
    ...(kind === 'vies' ? { body: JSON.stringify({ countryCode: vat!.countryCode, vatNumber: vat!.number }) } : {}),
   });
   void pending.then(response => { if (budget.aborted && response.body && !response.body.locked) void response.body.cancel().catch(() => undefined); }, () => undefined);
   const response = await awaitWithSignal(pending, budget);
   if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    if (kind === 'ares' && response.status === 404) return fail(404, 'not-found');
    throw Error();
   }
   const payload: unknown = JSON.parse(await boundedResponseText(response, kind === 'ares' ? 256 * 1024 : 64 * 1024, budget));
   budget.throwIfAborted();
   const checkedAt = new Date().toISOString();
   if (kind === 'ares') {
    const subject = mapAresSubject(aresProvider.parse(payload));
    if (!subject || subject.ico !== ico) throw Error();
    return reply(AresLookupSchema.parse({ ...subject, ownerId, checkedAt }));
   }
   const evidence = viesProvider.parse(payload);
   if (evidence.countryCode !== vat!.countryCode || evidence.vatNumber !== vat!.number) throw Error();
   return reply(ViesLookupSchema.parse({ ...mapViesResult(evidence), ownerId, vatId: `${vat!.countryCode}${vat!.number}`, checkedAt }));
  } catch { return kind === 'ares' ? fail(502, 'ares-unavailable') : unavailable(); }
 } catch { return fail(503, 'registry-unavailable'); }
 finally { stop.abort(); }
}
