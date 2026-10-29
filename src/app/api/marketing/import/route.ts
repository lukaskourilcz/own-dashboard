import { NextResponse } from 'next/server';
import { z } from 'zod';
import { awaitWithSignal } from '@/lib/abortable';
import { readVerifiedServerContext } from '@/lib/supabase/server-owner';
import { createAdminClient } from '@/lib/supabase/admin';
import { rejectCrossOrigin } from '@/lib/csrf';
import { MARKETING_CALENDAR_IMPORT_TIMEOUT_MS, readFullMarketingCalendar } from '@/lib/marketing/calendar-source';
import { createGitHubFetcher } from '@/lib/github-token';
import { BrandSchema } from '@/lib/marketing/contracts';
import { planCampaignImport } from '@/lib/marketing/campaign-import';
import { readKnowledgeBody } from '@/lib/marketing/knowledge-body';
import { contentHash } from '@/lib/marketing/hashes';
import { CalendarImportStartSchema } from '@/lib/marketing/calendar-import-contracts';

export const maxDuration = 60;
const Input = z.union([
 z.strictObject({ plan: z.unknown(), startsOn: CalendarImportStartSchema, apply: z.boolean() }),
 z.strictObject({ source: z.literal('repository'), brand: BrandSchema, startsOn: CalendarImportStartSchema, apply: z.boolean(), expectedHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), expectedImportHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }),
]);
const ideaSchema = z.strictObject({ id: z.uuid(), user_id: z.uuid(), title: z.string().max(10_000) });
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function POST(request: Request) {
 const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
 const retirement = new AbortController();
 const signal = AbortSignal.any([request.signal, retirement.signal, AbortSignal.timeout(60_000)]);
 let writing = false;
 try {
  signal.throwIfAborted();
  const expectedOwner = request.headers.get('x-own-dashboard-owner');
  if (expectedOwner !== null && !z.uuid().safeParse(expectedOwner).success) return reply({ error: 'calendar-import-owner-invalid' }, 400);
  const context = await readVerifiedServerContext(signal);
  if (!context) return reply({ error: 'unauthorized' }, 401);
  const { ownerId, db } = context;
  signal.throwIfAborted();
  if (expectedOwner !== null && expectedOwner !== ownerId) return reply({ error: 'calendar-import-owner-changed' }, 409);
  let input: z.infer<typeof Input>;
  try { input = Input.parse(JSON.parse(await readKnowledgeBody(request, 1_100_000, signal))); }
  catch (error) {
   if (signal.aborted) throw error;
   const status = error instanceof Error && error.message === 'capture-too-large' ? 413 : error instanceof Error && error.name === 'AbortError' ? 408 : 400;
   return reply({ error: 'calendar-import-input-invalid' }, status);
  }
  signal.throwIfAborted();
  const knowledgeSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
  const knowledge = await awaitWithSignal(db.from('ai_links').select('id,user_id,title', { count: 'exact' }).eq('user_id', ownerId).eq('record_type', 'idea').limit(1000).retry(false).abortSignal(knowledgeSignal), knowledgeSignal);
  signal.throwIfAborted();
  if (knowledge.error || !Array.isArray(knowledge.data) || !Number.isSafeInteger(knowledge.count) || knowledge.count === null || knowledge.count < 0 || knowledge.count > 1000 || knowledge.count !== knowledge.data.length) throw new Error('knowledge-unavailable');
  const rows = z.array(ideaSchema).max(1000).parse(knowledge.data);
  if (rows.some(row => row.user_id !== ownerId) || new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('knowledge-unavailable');
  let plan: unknown;
  if ('plan' in input) plan = input.plan;
  else {
   const sourceRetirement = new AbortController();
   const sourceSignal = AbortSignal.any([signal, sourceRetirement.signal, AbortSignal.timeout(MARKETING_CALENDAR_IMPORT_TIMEOUT_MS)]);
   try {
    sourceSignal.throwIfAborted();
    plan = await readFullMarketingCalendar(createGitHubFetcher(ownerId, sourceSignal), input.brand, sourceSignal);
   } finally { sourceRetirement.abort(); }
  }
  signal.throwIfAborted();
  let prepared: ReturnType<typeof planCampaignImport>;
  try { prepared = planCampaignImport(plan, input.startsOn, rows.filter(row => row.title.trim().length > 0)); }
  catch { return reply({ error: 'calendar-import-plan-invalid' }, 400); }
  signal.throwIfAborted();
  if ('source' in input && input.apply && input.expectedHash !== prepared.campaign.source_hash) return reply({ error: 'calendar-source-changed' }, 409);
  const importHash = contentHash({ ownerId, ...prepared });
  if ('source' in input && input.apply && input.expectedImportHash !== importHash) return reply({ error: 'calendar-import-preview-changed' }, 409);
  if (!input.apply) {
   const { brand, starts_on, ends_on, source_hash } = prepared.campaign;
   return reply({ ownerId, importHash, campaign: { brand, starts_on, ends_on, source_hash }, report: prepared.report });
  }
  const admin = createAdminClient(signal);
  const writeSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
  writeSignal.throwIfAborted(); writing = true;
  const saved = await awaitWithSignal(admin.rpc('marketing_import_campaign', { p_owner: ownerId, p_campaign: prepared.campaign, p_entries: prepared.entries }).retry(false).abortSignal(writeSignal), writeSignal);
  signal.throwIfAborted();
  const id = z.uuid().safeParse(saved.data);
  if (saved.error || !id.success) throw new Error('import-unconfirmed');
  return reply({ id: id.data, ownerId, importHash, sourceHash: prepared.campaign.source_hash, report: prepared.report });
 } catch {
  return reply({ error: writing ? 'calendar-import-unconfirmed' : 'calendar-import-unavailable' }, 503);
 } finally { retirement.abort(); }
}
