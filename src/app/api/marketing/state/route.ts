import { NextResponse } from 'next/server';
import { z } from 'zod';
import { awaitWithSignal } from '@/lib/abortable';
import { readVerifiedServerContext } from '@/lib/supabase/server-owner';
import { marketingJobHealth, safeMarketingJobs } from '@/lib/marketing/job-health';
import { marketingSourceSummary } from '@/lib/marketing/source-summary';
import { MARKETING_STATE_MAX_BYTES, MarketingStateEnvelopeSchema } from '@/lib/marketing/state-contracts';

export const maxDuration = 30;
const revisionFields = 'id,user_id,project_id,campaign_id,revision,content_hash,ready,status,approved_at,approved_hash,feedback,created_at,render_report,offline_import_receipt';
const campaignFields = 'id,brand,name,starts_on,ends_on,source_hash,status';
const entryFields = 'id,campaign_id,date,local_time,bound_source_id,title,kind,platform,status,needs_review';
const publicationFields = 'id,revision_id,platform,status,remote_container_id,remote_media_id,remote_url,error_code';
const accountFields = 'brand,platform,remote_account_id,handle,enabled,verified_at';
const names = ['revisions','campaigns','entries','publications','accounts','sources','jobs','events','sourceHistory'] as const;
const limits = [100, 10, 10000, 100, 4, 100, 100, 100, 200];
function project(rows: Record<string, unknown>[], fields: string) {
 const keys = fields.split(',');
 return rows.map(row => Object.fromEntries(keys.map(key => [key, row[key]])));
}
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function GET(request: Request) {
 const retirement = new AbortController();
 const signal = AbortSignal.any([request.signal, retirement.signal, AbortSignal.timeout(30_000)]);
 try {
 signal.throwIfAborted();
 const expectedOwner = request.headers.get('x-own-dashboard-owner');
 if (expectedOwner !== null && !z.uuid().safeParse(expectedOwner).success) return reply({ error: 'marketing-owner-invalid' }, 400);
 const context = await readVerifiedServerContext(signal);
 if (!context) return reply({ error: 'unauthorized' }, 401);
 signal.throwIfAborted();
 const { ownerId, db } = context;
 if (expectedOwner !== null && expectedOwner !== ownerId) return reply({ error: 'marketing-owner-changed' }, 409);
 const querySignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
 const result=await awaitWithSignal<{data:unknown;error:unknown}>(db.rpc('marketing_workspace_snapshot').retry(false).abortSignal(querySignal),querySignal);
 signal.throwIfAborted();
 if(result.error)throw new Error('state-unavailable');
 const snapshot=z.strictObject({ownerId:z.literal(ownerId),entriesComplete:z.literal(true),revisions:z.unknown(),campaigns:z.unknown(),entries:z.unknown(),publications:z.unknown(),accounts:z.unknown(),sources:z.unknown(),jobs:z.unknown(),events:z.unknown(),sourceHistory:z.unknown()}).parse(result.data);
 const ownedRow = z.object({ user_id: z.literal(ownerId) }).passthrough();
 const rows = names.map((name,index)=>z.array(ownedRow).max(limits[index]).parse(snapshot[name]));
 const jobs=safeMarketingJobs(rows[6]);
 const events = z.array(z.object({ revision_id: z.uuid().nullable(), kind: z.enum(['approved', 'returned', 'skipped']) })).parse(rows[7]);
 const first=new Map<string,string>();for(const event of [...events].reverse()){if(event.revision_id&&!first.has(event.revision_id))first.set(event.revision_id,event.kind);}
 const reviewed=[...first.values()].filter(kind=>kind!=='skipped');
 const diagnostics={sampleSize:reviewed.length,firstApprovalRate:reviewed.length?reviewed.filter(kind=>kind==='approved').length/reviewed.length:null};
 const sources = rows[5].map(row => {
  const packet = marketingSourceSummary(row);
  if (row.brand !== packet.brand || row.source_id !== packet.sourceId || row.source_revision !== packet.sourceRevision || row.content_hash !== packet.contentHash) throw new Error('source-identity-unavailable');
  return { id: z.uuid().parse(row.id), brand: packet.brand, source_id: packet.sourceId, eligible: z.boolean().parse(row.eligible), packet };
 });
 const value = MarketingStateEnvelopeSchema.parse({ownerId,revisions:project(rows[0],revisionFields),campaigns:project(rows[1],campaignFields),entries:project(rows[2],entryFields),publications:project(rows[3],publicationFields),accounts:project(rows[4],accountFields),sources,sourceHistory:rows[8].map(marketingSourceSummary),jobs,jobHealth:marketingJobHealth(jobs),diagnostics});
 signal.throwIfAborted();
 const body = JSON.stringify(value);
 if (Buffer.byteLength(body) > MARKETING_STATE_MAX_BYTES) throw new Error('state-too-large');
 return new NextResponse(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });
 } catch { return reply({ error: 'marketing-unavailable' }, 503); }
 finally { retirement.abort(); }
}
