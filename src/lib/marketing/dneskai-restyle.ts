import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DneskaiBriefSchema, type DneskaiBriefMedia } from './dneskai-brief';
import { fetchDneskaiStockBytes, supabaseMediaObjectStore, type DneskaiMediaDatabase } from './dneskai-media';
import { inspectDneskaiImage } from './dneskai-media-image';
import { dneskaiMediaCapabilities } from './dneskai-media-plan';
import { dneskaiMediaSourceSwitches, dneskaiStockQuery, searchDneskaiStock } from './dneskai-media-sources';
import { enqueueMarketingJob } from './worker-runtime';
import { synchronizeMarketingSources } from './orchestrator';
import type { ContentRevision } from './contracts';

/**
 * Restyle (owner request, 8 November 2026): a post already in the plan is written again in the house style
 * (`docs/dneskai-style-guide.md`, `marketing-copy/8`) for its plan slot, with more pictures.
 *
 * A slot asks for it with the code `restyle-requested`. The plan step then, once per slot:
 * 1. tops up the post's brief to `DNESKAI_RESTYLE_PICTURES` pictures with licensed stock photos (Pexels, Unsplash),
 *    when the stock switch and a key are set; each is stored like a collected picture and keeps its credit in the
 *    database only;
 * 2. keeps the brief current until a day after the slot and re-reads its source packet;
 * 3. moves the brief's calendar entry to the slot and enqueues one generation job, a copy of the brief's last job with
 *    the slot's time, the restyle note and `replacesRevisionId`, through the guarded queue (`marketing_enqueue_job`)
 *    and under the daily cost ceiling like every DNESKAi job;
 * 4. returns the old version, so it cannot go out meanwhile. The finished job supersedes it (`marketing_finish_job`)
 *    and the plan takes the new version from there: render check, slot, approval, Threads twin and story.
 *    A post that was already published is written again as a new post: an education topic's slot then follows the
 *    job through its topic (`briefed`, then `generated` by the topic bridge).
 */
export const DNESKAI_RESTYLE_REQUESTED = 'restyle-requested';
export const DNESKAI_RESTYLE_QUEUED = 'restyle-queued';
/** Pictures a restyled brief should offer, so most slides can show one. */
export const DNESKAI_RESTYLE_PICTURES = 4;
/** The owner's note the regeneration carries to the model, next to the house style already in the system prompt. */
export const DNESKAI_RESTYLE_NOTE = 'Napiš příspěvek znovu v domácím stylu DNESKAi: titulek ve dvou dobách, první věta popisku říká co, kdo a kolik, druhá proč na tom záleží; vlastními slovy. Dej fotku na co nejvíc slidů: každý slide kromě nejvýš jednoho textového nese fotku.';

type Database = DneskaiMediaDatabase;
type Environment = Record<string, string | undefined>;
export type DneskaiRestyleSlot = { date: string; local_time: string; scheduledAt: string };
export type DneskaiRestyleResult = { code: string; pictures: number; jobId: string | null };

const read = <T>(result: { data: T | null; error: unknown }, code: string): T => { if (result.error) throw new Error(code); return result.data as T; };

/** One restyle per post version and slot: a repeated tick finds the same job. */
export function dneskaiRestyleJobKey(owner: string, revisionId: string, revisionHash: string, scheduledAt: string): string {
  const value = createHash('sha256').update(['dneskai-restyle/1', owner, revisionId, revisionHash, scheduledAt].join('|')).digest('hex').slice(0, 32);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-5${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20)}`;
}

/** The stock pictures a brief still needs: none once it has enough or the stock source is off. */
export function dneskaiRestyleMissingPictures(media: readonly Pick<DneskaiBriefMedia, 'assetSha256'>[], env: Environment): number {
  return dneskaiMediaSourceSwitches(env).stock ? Math.max(0, DNESKAI_RESTYLE_PICTURES - media.length) : 0;
}

async function topUpPictures(db: Database, owner: string, briefId: string, env: Environment, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<number> {
  const row = read(await db.from('marketing_dneskai_briefs').select('brief,lead_candidate_id').eq('user_id', owner).eq('id', briefId).maybeSingle(), 'restyle-brief-unavailable') as { brief: unknown; lead_candidate_id: string } | null;
  const brief = row ? DneskaiBriefSchema.safeParse(row.brief) : null;
  if (!row || !brief?.success) return 0;
  const missing = dneskaiRestyleMissingPictures(brief.data.media, env);
  if (!missing) return brief.data.media.length;
  const lead = brief.data.evidence[0]!;
  // A few more than needed: a picture that cannot be fetched or decoded is skipped.
  const entries = await searchDneskaiStock(dneskaiStockQuery({ title: lead.title, text: lead.excerpt }), Math.min(missing + 2, 5), env, { fetchImpl, signal });
  const store = supabaseMediaObjectStore(db);
  const known = new Set(brief.data.media.map((item) => item.assetSha256));
  let count = brief.data.media.length, added = 0;
  for (const [index, entry] of entries.entries()) {
    if (added >= missing || signal.aborted) break;
    const fetched = await fetchDneskaiStockBytes(entry, { fetchImpl, signal });
    if (!fetched) continue;
    let image;
    try { image = await inspectDneskaiImage(fetched.bytes); } catch { continue; }
    if (known.has(image.sha256)) continue;
    try { await store.put(`${owner}/${image.sha256}.${image.ext}`, Buffer.from(fetched.bytes), image.mime, { ownerId: owner, sha256: image.sha256 }); } catch { continue; }
    const credit = entry.credit ?? 'Foto: Pexels';
    const media: DneskaiBriefMedia = { assetSha256: image.sha256, candidateId: row.lead_candidate_id, position: 60 + index, credit, width: image.width, height: image.height, originKind: 'stock', ...dneskaiMediaCapabilities(image) };
    const { data, error } = await db.rpc('marketing_dneskai_restyle_add_picture', { p_owner: owner, p_brief: briefId,
      p_asset: { sha256: image.sha256, mime: image.mime, width: image.width, height: image.height, bytes: image.bytes, phash: image.phash, originUrl: fetched.originUrl, originKind: 'stock', credit }, p_media: media });
    if (error) continue;
    known.add(image.sha256); added++; count = typeof data === 'number' ? data : count + 1;
  }
  return count;
}

const JobRowSchema = z.object({ request: z.object({ calendarEntryId: z.uuid().nullable().optional(), generation: z.object({ source: z.unknown() }).passthrough() }).passthrough() });

/** Runs steps 1 to 4 for one slot; the plan records the returned code on the slot. */
export async function restyleDneskaiPost(db: Database, owner: string, input: { slot: DneskaiRestyleSlot; head: { id: string; status: string; content_hash: string; revision: ContentRevision }; env: Environment; signal: AbortSignal; fetchImpl?: typeof fetch }): Promise<DneskaiRestyleResult> {
  const { slot, head, env, signal } = input;
  const source = head.revision.sources[0];
  if (!source || !head.revision.deck) return { code: 'restyle-unsupported', pictures: 0, jobId: null };
  if (!['review', 'returned', 'approved', 'published'].includes(head.status)) return { code: `restyle-${head.status}`, pictures: 0, jobId: null };
  const brief = read(await db.from('marketing_dneskai_briefs').select('id').eq('user_id', owner).eq('event_id', source.sourceId).eq('member_hash', source.sourceRevision)
    .neq('status', 'skipped').order('updated_at', { ascending: false }).limit(1), 'restyle-brief-unavailable') as Array<{ id: string }>;
  if (!brief.length) return { code: 'restyle-brief-missing', pictures: 0, jobId: null };
  const pictures = await topUpPictures(db, owner, brief[0]!.id, env, signal, input.fetchImpl);

  const until = new Date(Date.parse(slot.scheduledAt) + 24 * 60 * 60_000).toISOString();
  const extended = await db.rpc('marketing_dneskai_plan_extend_brief', { p_owner: owner, p_event: source.sourceId, p_until: until });
  if (extended.error) throw new Error('restyle-brief-extension-failed');
  await synchronizeMarketingSources(db, owner, 'dneskai', [source.sourceId], undefined, signal);
  const stored = read(await db.from('marketing_sources').select('packet').eq('user_id', owner).eq('brand', 'dneskai').eq('source_id', source.sourceId).maybeSingle(), 'restyle-source-unavailable') as { packet: unknown } | null;
  if (!stored) return { code: 'restyle-source-missing', pictures, jobId: null };

  const jobs = read(await db.from('marketing_jobs').select('request').eq('user_id', owner).eq('request->generation->source->>sourceId', source.sourceId)
    .eq('request->generation->source->>kind', 'brief').order('created_at', { ascending: false }).limit(1), 'restyle-job-unavailable') as unknown[];
  const last = JobRowSchema.safeParse(jobs[0]);
  if (!last.success || !last.data.request.calendarEntryId) return { code: 'restyle-job-missing', pictures, jobId: null };
  const moved = await db.rpc('marketing_dneskai_restyle_move_entry', { p_owner: owner, p_entry: last.data.request.calendarEntryId, p_date: slot.date, p_time: slot.local_time });
  if (moved.error || typeof moved.data !== 'number') throw new Error('restyle-entry-move-failed');

  // The old version goes back first, so it cannot be approved or published while the new one is written.
  // A published post stays as it went out; the new version is a post of its own (the owner deletes the old one).
  if (head.status === 'review' || head.status === 'approved') {
    const { error } = await db.from('marketing_revisions').update({ status: 'returned', approved_hash: null, approved_at: null, feedback: DNESKAI_RESTYLE_NOTE })
      .eq('user_id', owner).eq('id', head.id).in('status', ['review', 'approved']);
    if (error) throw new Error('restyle-return-failed');
  }
  const key = dneskaiRestyleJobKey(owner, head.id, head.content_hash, slot.scheduledAt);
  const original = last.data.request as Record<string, unknown> & { generation: Record<string, unknown> };
  const request = { ...original, idempotencyKey: key, calendarEntryVersion: moved.data, generation: { ...original.generation, source: stored.packet, scheduledAt: slot.scheduledAt, revisionId: key,
    ownerNote: DNESKAI_RESTYLE_NOTE, replacesRevisionId: head.id, ...(head.revision.engagement ? { engagement: head.revision.engagement } : {}) } };
  const job = await enqueueMarketingJob(db as never, owner, request, { env });
  return { code: DNESKAI_RESTYLE_QUEUED, pictures, jobId: job.jobId };
}
