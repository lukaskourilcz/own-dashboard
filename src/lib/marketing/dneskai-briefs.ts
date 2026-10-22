import 'server-only';
import { dneskaiRichEvidenceEnabled } from './dneskai-evidence-rollout';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseSourcePacket, type ContentRevision, type SourcePacket } from './contracts';
import { DneskaiBriefSchema, type DneskaiBrief, type DneskaiBriefCategory, type DneskaiBriefEvidence, type DneskaiBriefMedia } from './dneskai-brief';
import { dneskaiBriefLifetimeMs, dneskaiBriefSourcePacket } from './dneskai-brief-source';
import { DneskaiCandidateSchema, type DneskaiCandidate } from './dneskai-contracts';
import { dneskaiPrimaryUrlKey, rankDneskaiEventMembers } from './dneskai-events';
import { dneskaiOfferableMediaAssets, type DneskaiMediaAssetView, type DneskaiMediaCandidateView } from './dneskai-media-contracts';
import { dneskaiCaptionOnly } from './dneskai-media-plan';
import { phashDistance } from './dneskai-media-image';
import { pendingDneskaiMediaCandidates, readDneskaiMedia } from './dneskai-media';
import { DNESKAI_SOURCES } from './dneskai-registry';
import { DNESKAI_RENDERER_VERSION } from './dneskai-render';
import type { CreateDneskaiBriefs } from './dneskai-ports';
import type { DneskaiEditPool } from './dneskai-deck-edit';
import { pragueScheduledAt } from './clock';
import { ingestSource } from './store';
import { enqueueMarketingJob, MarketingWorkerRuntimeError } from './worker-runtime';

/**
 * DNESKAi briefs (#115): after a collection run selected its events and their source media were collected
 * (#114), each event becomes one brief with its evidence, its pictures and a publishing slot, and then one
 * generation job through the guarded calendar path. No article, no Quorum call and no model call happen here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the generated database types do not cover marketing tables
export type DneskaiBriefsDatabase = SupabaseClient<any>;

/** The daily Instagram slots in Europe/Prague, filled in event rank order. */
export const DNESKAI_BRIEF_SLOTS = ['08:00', '12:30', '17:00', '20:00'] as const;
/** A slot counts as used when another DNESKAi post of the day is scheduled within this many minutes of it. */
export const DNESKAI_BRIEF_SLOT_CLEARANCE_MINUTES = 60;
/** A slot this close to now is skipped: generation and the owner's review need time before it. */
export const DNESKAI_BRIEF_MIN_LEAD_MINUTES = 30;
export const DNESKAI_BRIEF_MEDIA_LIMIT = 20;
/** A primary report shorter than this, with at most one usable picture, is suggested as a single-image post. */
export const DNESKAI_BRIEF_SINGLE_TEXT_LIMIT = 400;
export const DNESKAI_REPEAT_WINDOW_DAYS = 14;
/**
 * Two pictures are the same photograph when their pHash differs in at most this many bits. Stricter than the
 * collector's near-duplicate marker (6): distinct carousel slides built on one template measure 4–6 bits apart.
 */
export const DNESKAI_REPEAT_PHASH_MAX_DISTANCE = 3;
/**
 * A picture that at least this many different articles of one site carry is a site-wide card (a logo or the
 * site's default share image), not a photograph of one event, so it never makes a brief a repeat.
 */
export const DNESKAI_SITEWIDE_PICTURE_ARTICLES = 3;
/** Revisions that count as prepared or published for the repetition check. */
export const DNESKAI_COVERING_REVISION_STATUSES = ['review', 'approved', 'publishing', 'published', 'reconciliation', 'returned', 'skipped'] as const;

const MINUTE = 60000;

/** The four slot instants of a Prague day, DST-correct (25 October 2026 has 25 hours). */
export function dneskaiBriefSlots(targetDate: string): string[] {
  return DNESKAI_BRIEF_SLOTS.map((time) => pragueScheduledAt(targetDate, time));
}

/**
 * The free slots of one target day. A slot is free when no other post or brief of the day is scheduled within an
 * hour of it and it is at least 30 minutes away; `take` marks a slot used.
 */
export function dneskaiSlotAllocator(targetDate: string, taken: readonly string[], now: Date) {
  const used = [...taken];
  const free = (slot: string) => Date.parse(slot) >= now.getTime() + DNESKAI_BRIEF_MIN_LEAD_MINUTES * MINUTE
    && !used.some((value) => Math.abs(Date.parse(value) - Date.parse(slot)) < DNESKAI_BRIEF_SLOT_CLEARANCE_MINUTES * MINUTE);
  return {
    peek: (): string | null => dneskaiBriefSlots(targetDate).find(free) ?? null,
    take(slot: string) { used.push(slot); },
  };
}

/**
 * Assigns slots in rank order. A brief that already holds a slot keeps it; every other open brief takes the
 * first free slot of the day that is not within an hour of another post and not closer than 30 minutes to now.
 * Briefs still waiting for media are assigned too, so a later-ranked brief never takes a better-ranked slot.
 */
export function assignDneskaiBriefSlots(briefs: ReadonlyArray<{ id: string; rank: number; scheduledAt: string | null }>, targetDate: string, taken: readonly string[], now: Date): Map<string, string | null> {
  const slots = dneskaiSlotAllocator(targetDate, [...taken, ...briefs.flatMap((brief) => brief.scheduledAt ? [brief.scheduledAt] : [])], now);
  const result = new Map<string, string | null>();
  for (const brief of [...briefs].sort((a, b) => a.rank - b.rank)) {
    if (brief.scheduledAt) { result.set(brief.id, brief.scheduledAt); continue; }
    const slot = slots.peek();
    if (slot) slots.take(slot);
    result.set(brief.id, slot);
  }
  return result;
}

export type DneskaiBriefMember = { candidate: DneskaiCandidate; media: readonly DneskaiMediaAssetView[]; articleText?:string };
const httpsUrl = z.url({ protocol: /^https$/ }).max(2048);
const sourceName = (sourceId: string) => DNESKAI_SOURCES.find((source) => source.id === sourceId)?.name ?? sourceId;
function firstLine(value: string) { return (value.trim().split(/\r?\n/, 1)[0] ?? '').trim(); }
function evidenceTitle(candidate: DneskaiCandidate) { return (candidate.title.trim() || firstLine(candidate.text) || sourceName(candidate.sourceId)).slice(0, 500); }
function safeEvidenceUrl(value: string) { const parsed = httpsUrl.safeParse(value); if (!parsed.success) return null; const url = new URL(parsed.data); return url.username || url.password ? null : url.href; }
/** Usable on a slide: framed (≥ 600 px wide) or full-bleed (shorter side ≥ 900 px). */
export const dneskaiUsablePicture = (media: Pick<DneskaiBriefMedia, 'fullBleedCapable' | 'insetCapable'>) => media.fullBleedCapable || media.insetCapable;

/**
 * Builds a brief from an event's selected reports and their offerable pictures. Evidence starts with the chosen
 * primary report (publisher before newsroom before aggregator, more pictures, newer); media keep the original
 * order of each report, primary first, without repeats, at most twenty. Reports without an https URL cannot be
 * cited and are left out; an event with none is `brief-evidence-unavailable`.
 */
export function buildDneskaiBrief(input: { eventId: string; memberHash: string; targetDate: string; category: DneskaiBriefCategory; scheduledAt: string; observedAt: Date; members: readonly DneskaiBriefMember[]; richEvidence?: boolean }): { brief: DneskaiBrief } | { code: string } {
  const pictures = new Map(input.members.map((member) => [member.candidate.id, member.media.filter((asset) => !asset.purged && asset.width <= 20000 && asset.height <= 20000)]));
  const usable = (id: string) => (pictures.get(id) ?? []).filter(dneskaiUsablePicture).length;
  const ranked = rankDneskaiEventMembers(input.members.map((member) => member.candidate), usable).filter((candidate) => safeEvidenceUrl(candidate.url)).slice(0, 30);
  if (!ranked.length) return { code: 'brief-evidence-unavailable' };
  const evidence: DneskaiBriefEvidence[] = ranked.map((candidate) => ({
    candidateId: candidate.id, sourceId: candidate.sourceId, url: safeEvidenceUrl(candidate.url)!, title: evidenceTitle(candidate), excerpt: candidate.text.slice(0, 4000),
    ...(input.richEvidence !== false && !dneskaiCaptionOnly(candidate)&&input.members.find(m=>m.candidate.id===candidate.id)?.articleText?{articleText:input.members.find(m=>m.candidate.id===candidate.id)!.articleText}:{}),
    publishedAt: candidate.publishedAt, dateEstimated: candidate.dateEstimated === true, captionOnly: dneskaiCaptionOnly(candidate),
  }));
  const seen = new Set<string>();
  const media: DneskaiBriefMedia[] = ranked.flatMap((candidate) => [...(pictures.get(candidate.id) ?? [])].sort((a, b) => a.position - b.position).flatMap((asset) => {
    if (seen.has(asset.sha256)) return [];
    seen.add(asset.sha256);
    return [{ assetSha256: asset.sha256, candidateId: candidate.id, position: asset.position, credit: asset.credit, width: asset.width, height: asset.height,
      ...(input.richEvidence !== false && asset.sourceAltText?{sourceAltText:asset.sourceAltText}:{}),
      originKind: asset.originKind, fullBleedCapable: asset.fullBleedCapable, insetCapable: asset.insetCapable }];
  })).slice(0, DNESKAI_BRIEF_MEDIA_LIMIT);
  const primary = ranked[0]!;
  const singleImage = Math.max(primary.text.trim().length, (input.richEvidence === false || dneskaiCaptionOnly(primary))?0:(input.members.find(m=>m.candidate.id===primary.id)?.articleText?.length??0)) < DNESKAI_BRIEF_SINGLE_TEXT_LIMIT && media.filter(dneskaiUsablePicture).length <= 1;
  const observedAt = input.observedAt.toISOString();
  const parsed = DneskaiBriefSchema.safeParse({
    schemaVersion: input.richEvidence === false ? 'dneskai-brief/1' : 'dneskai-brief/2', eventId: input.eventId, memberHash: input.memberHash, targetDate: input.targetDate, category: input.category,
    title: evidence[0]!.title.slice(0, 300), evidence, media, suggestedFormat: singleImage ? 'single-image' : 'carousel',
    scheduledAt: input.scheduledAt, timeZone: 'Europe/Prague', observedAt, expiresAt: new Date(input.observedAt.getTime() + dneskaiBriefLifetimeMs(input.category)).toISOString(),
  });
  return parsed.success ? { brief: parsed.data } : { code: 'brief-invalid' };
}

/** What a recent prepared or published post (or an admitted brief of another day) covered. */
export type DneskaiCoverage = { id: string; duplicateOf: string; urls: readonly string[]; assetSha256s: readonly string[] };
/**
 * A brief repeats recent coverage when one of its evidence URLs (canonicalized) was a source or evidence URL of
 * the coverage, or when one of its pictures is a picture the coverage drew: the same bytes, or the same
 * photograph recompressed (pHash distance ≤ 3). Pictures in `ignore` (site-wide cards) are not compared.
 */
export function dneskaiBriefRepeat(brief: Pick<DneskaiBrief, 'evidence' | 'media'>, coverage: readonly DneskaiCoverage[], phashes: ReadonlyMap<string, string | null>, ignore: ReadonlySet<string> = new Set()): { coverage: DneskaiCoverage; by: 'url' | 'media' } | null {
  const urls = new Set(brief.evidence.flatMap((item) => dneskaiPrimaryUrlKey(item.url) ?? []));
  const pictures = brief.media.map((item) => item.assetSha256).filter((sha) => !ignore.has(sha));
  const near = (left: string, right: string) => {
    if (left === right) return true;
    const a = phashes.get(left), b = phashes.get(right);
    if (!a || !b) return false;
    try { return phashDistance(a, b) <= DNESKAI_REPEAT_PHASH_MAX_DISTANCE; } catch { return false; }
  };
  for (const item of coverage) {
    if (item.urls.some((url) => { const key = dneskaiPrimaryUrlKey(url); return key !== null && urls.has(key); })) return { coverage: item, by: 'url' };
  }
  for (const item of coverage) {
    if (pictures.some((sha) => item.assetSha256s.some((other) => near(sha, other)))) return { coverage: item, by: 'media' };
  }
  return null;
}

/**
 * The pictures that at least three different articles of one site carry (`DNESKAI_SITEWIDE_PICTURE_ARTICLES`),
 * from the article URLs of the reports that carry each picture.
 */
export function dneskaiSitewidePictures(articles: ReadonlyArray<{ sha256: string; url: string }>): Set<string> {
  const byPicture = new Map<string, Map<string, Set<string>>>();
  for (const article of articles) {
    const key = dneskaiPrimaryUrlKey(article.url);
    if (!key) continue;
    const host = key.split('/', 1)[0]!;
    const hosts = byPicture.get(article.sha256) ?? new Map<string, Set<string>>();
    byPicture.set(article.sha256, hosts);
    hosts.set(host, (hosts.get(host) ?? new Set()).add(key));
  }
  return new Set([...byPicture].filter(([, hosts]) => [...hosts.values()].some((keys) => keys.size >= DNESKAI_SITEWIDE_PICTURE_ARTICLES)).map(([sha]) => sha));
}

export type DneskaiBriefRow = {
  id: string; user_id: string; project_id: string; run_id: string; event_id: string; target_date: string; rank: number; category: DneskaiBriefCategory;
  member_ids: string[]; lead_candidate_id: string; member_hash: string; status: 'pending' | 'ready' | 'queued' | 'skipped'; code: string | null;
  brief: unknown; scheduled_at: string | null; calendar_entry_id: string | null; job_id: string | null; created_at: string; updated_at: string;
};
export type DneskaiBriefMemberRow = { id: string; status: DneskaiCandidate['status']; target_date: string | null; content_hash: string; candidate: DneskaiCandidate };
/** `jobId` is set when the entry already has this brief's job (a retry after `queued` failed). */
type Admitted = { campaignId: string; entryId: string; entryVersion: number; jobId?: string };
type JobAdmission = { jobId: string; status: string; duplicate: boolean };

/** Every read and write the brief creation needs, so its decisions can be tested without a database. */
export interface DneskaiBriefStore {
  richEvidence?: boolean;
  run(owner: string, project: string, runId: string): Promise<{ id: string; date: string; target_date: string; status: string } | null>;
  briefs(owner: string, project: string, runId: string): Promise<DneskaiBriefRow[]>;
  members(owner: string, project: string, ids: readonly string[]): Promise<DneskaiBriefMemberRow[]>;
  /** Members whose media collection has not started or is still pending. */
  owedMedia(owner: string, project: string, ids: readonly string[]): Promise<Set<string>>;
  media(owner: string, project: string, candidateId: string): Promise<DneskaiMediaCandidateView | null>;
  coverage(owner: string, project: string, since: Date, runId: string): Promise<DneskaiCoverage[]>;
  phashes(owner: string, sha256s: readonly string[]): Promise<Map<string, string | null>>;
  /** The article URLs of the reports (other than `exclude`) whose collected media include each picture. */
  pictureArticles(owner: string, project: string, sha256s: readonly string[], exclude: readonly string[]): Promise<Array<{ sha256: string; url: string }>>;
  /** Scheduled instants of other DNESKAi posts and briefs on that Prague day (not this run's briefs). */
  takenSlots(owner: string, project: string, targetDate: string, runId: string): Promise<string[]>;
  account(owner: string): Promise<{ remote_account_id: string; handle: string } | null>;
  prepare(owner: string, briefId: string, brief: DneskaiBrief | null, scheduledAt: string | null, status: 'pending' | 'ready', code: string | null): Promise<void>;
  skip(owner: string, briefId: string, code: string, duplicateOf?: string | null): Promise<void>;
  ingest(owner: string, packet: SourcePacket): Promise<{ id: string }>;
  admit(owner: string, briefId: string, sourceUuid: string): Promise<Admitted>;
  enqueue(owner: string, request: unknown): Promise<JobAdmission>;
  queued(owner: string, briefId: string, jobId: string): Promise<void>;
}

export class DneskaiBriefError extends Error { constructor(readonly code: string) { super(code); this.name = 'DneskaiBriefError'; } }
const rpcCode = (message: string) => {
  for (const [needle, code] of [['daily job budget exhausted', 'job-budget-exhausted'], ['calendar entry unavailable', 'calendar-entry-unavailable'], ['brief campaign conflict', 'campaign-conflict'],
    ['brief slot passed', 'brief-slot-passed'], ['brief source unavailable', 'brief-source-unavailable'], ['brief members changed', 'brief-members-changed'], ['marketing_dneskai_brief_slot', 'brief-slot-taken'],
    ['brief entry changed', 'brief-entry-changed'], ['brief closed', 'brief-closed'], ['brief not ready', 'brief-not-ready']] as const) if (message.includes(needle)) return code;
  return 'brief-store-unavailable';
};

/** A DNESKAi brief job's idempotency key and revision id: one per event, target day and calendar entry version. */
export function dneskaiBriefJobKey(owner: string, eventId: string, targetDate: string, entryVersion: number): string {
  const value = createHash('sha256').update(['dneskai-brief-job/1', owner, eventId, targetDate, String(entryVersion)].join('|')).digest('hex').slice(0, 32);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-5${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20)}`;
}

/**
 * The generation request of a brief job (`marketing-job/1`): the brief SourcePacket, the verified account and the
 * brief's slot. A DNESKAi deck job renders through the carousel studio, so it carries no devShark single-layout
 * template (`templateVersion` names the studio renderer) and no presentation knowledge (#116).
 */
export function dneskaiBriefGenerationRequest(input: { owner: string; packet: SourcePacket; account: { remote_account_id: string; handle: string }; admitted: Admitted }) {
  const brief = input.packet.brief;
  if (!brief) throw new DneskaiBriefError('brief-invalid');
  const key = dneskaiBriefJobKey(input.owner, brief.eventId, brief.targetDate, input.admitted.entryVersion);
  return {
    schemaVersion: 'marketing-job/1' as const, idempotencyKey: key, calendarEntryId: input.admitted.entryId, calendarEntryVersion: input.admitted.entryVersion,
    generation: {
      source: input.packet, account: { id: input.account.remote_account_id, platform: 'instagram' as const, handle: input.account.handle }, scheduledAt: brief.scheduledAt,
      templateVersion: DNESKAI_RENDERER_VERSION, knowledge: [], consent: true, revisionId: key,
    },
  };
}

/**
 * Admits one ready brief: ingests its SourcePacket as the source head, ensures the "DNESKAi daily" campaign and the
 * brief's calendar entry, enqueues the job through `marketing_enqueue_job` (calendar current, 8 jobs per 24 h) and
 * records the job on the brief. Idempotent: a repeated call returns the same job, and a brief whose job exists
 * but was never recorded (the last step failed) records that job instead of creating another.
 */
export async function enqueueBriefJob(store: DneskaiBriefStore, owner: string, row: Pick<DneskaiBriefRow, 'id'>, brief: DneskaiBrief, account: { remote_account_id: string; handle: string }): Promise<JobAdmission> {
  const packet = dneskaiBriefSourcePacket(brief);
  const source = await store.ingest(owner, packet);
  const admitted = await store.admit(owner, row.id, source.id);
  if (admitted.jobId) { await store.queued(owner, row.id, admitted.jobId); return { jobId: admitted.jobId, status: 'recorded', duplicate: true }; }
  const request = dneskaiBriefGenerationRequest({ owner, packet, account, admitted });
  const job = await store.enqueue(owner, request);
  await store.queued(owner, row.id, job.jobId);
  return job;
}

const memberHash = (members: ReadonlyArray<{ id: string; content_hash: string }>) =>
  createHash('sha256').update(`dneskai-event-members/1\n${members.map((member) => `${member.id}:${member.content_hash}`).sort().join('\n')}`).digest('hex');
/**
 * Admission failures the same brief can get past later in its day: the rolling job budget frees up, the owner
 * records consent or verifies the account again, or a store or queue failure passes.
 */
export const DNESKAI_BRIEF_RETRYABLE_CODES: ReadonlySet<string> = new Set(['job-budget-exhausted', 'marketing-consent-required', 'job-enqueue-failed', 'marketing-account-unavailable', 'brief-store-unavailable', 'brief-source-save-failed']);

/**
 * Creates the briefs of a finished collection run (`CreateDneskaiBriefs`, called by the scheduler #120 after
 * media collection). For each selected event in rank order: wait while a member still owes media; skip a repeat
 * of the last 14 days (its reports become duplicates, `collection-already-covered`); build the brief with a slot;
 * then admit it as a job, or hold it as `account-unavailable` when no verified @dneskai account exists.
 * `pending` stays true while a brief waits for media, for the account, or for a retryable store write or admission.
 * A held brief stops waiting once its slot is under 30 minutes away, and the target-day check below once the day
 * has no slot left.
 */
export async function createDneskaiBriefsWithStore(store: DneskaiBriefStore, input: Parameters<CreateDneskaiBriefs>[0], options: { now?: () => Date } = {}): ReturnType<CreateDneskaiBriefs> {
  z.uuid().parse(input.owner); z.uuid().parse(input.project); z.uuid().parse(input.runId);
  const clock = options.now ?? (() => new Date());
  const result: Awaited<ReturnType<CreateDneskaiBriefs>> = { created: [], skipped: [], pending: false };
  const run = await store.run(input.owner, input.project, input.runId);
  if (!run) throw new DneskaiBriefError('brief-run-unavailable');
  if (run.status === 'running') return { ...result, pending: true };
  const rows = (await store.briefs(input.owner, input.project, input.runId)).sort((a, b) => a.rank - b.rank);
  const open = rows.filter((row) => row.status === 'pending' || row.status === 'ready');
  if (!open.length) return result;
  const skip = async (row: DneskaiBriefRow, code: string, duplicateOf: string | null = null) => {
    await store.skip(input.owner, row.id, code, duplicateOf); result.skipped.push({ eventId: row.event_id, code });
  };
  // A target day whose last slot has passed is closed: nothing waits for its media any more. A brief that was built
  // holds a slot of that day, so it lapses as brief-slot-passed like every earlier held brief; only a brief never
  // built (still waiting for media) closes as brief-target-date-passed (briefs-10).
  if (!dneskaiBriefSlots(run.target_date).some((slot) => Date.parse(slot) >= clock().getTime() + DNESKAI_BRIEF_MIN_LEAD_MINUTES * MINUTE)) {
    for (const row of open) await skip(row, row.brief ? 'brief-slot-passed' : 'brief-target-date-passed');
    return result;
  }
  let account: Promise<{ remote_account_id: string; handle: string } | null> | null = null;
  // Every open brief is already built and none can be admitted without a verified account: only the lapse checks
  // below can change anything, so the media, slot and coverage reads are skipped (production-04).
  if (open.every((row) => row.brief) && !(await (account ??= store.account(input.owner)))) {
    for (const row of open) {
      if (input.signal?.aborted) { result.pending = true; break; }
      const stored = DneskaiBriefSchema.safeParse(row.brief);
      if (!stored.success) { await skip(row, 'brief-invalid'); continue; }
      if (Date.parse(stored.data.scheduledAt) < clock().getTime() + DNESKAI_BRIEF_MIN_LEAD_MINUTES * MINUTE) { await skip(row, 'brief-slot-passed'); continue; }
      if (Date.parse(stored.data.expiresAt) <= clock().getTime()) { await skip(row, 'brief-expired'); continue; }
      result.pending = true;
    }
    return result;
  }
  const owed = await store.owedMedia(input.owner, input.project, [...new Set(open.flatMap((row) => row.member_ids))]);
  // Slots go in rank order: a brief still waiting for media reserves the next free one for this call, and a brief
  // takes its slot only once it is built, so a repeat or an unusable event leaves its slot to the next one.
  const slots = dneskaiSlotAllocator(run.target_date, [...await store.takenSlots(input.owner, input.project, run.target_date, input.runId),
    ...rows.flatMap((row) => row.status !== 'skipped' && row.scheduled_at ? [row.scheduled_at] : [])], clock());
  let coverage: Promise<DneskaiCoverage[]> | null = null;
  for (const row of open) {
    if (input.signal?.aborted) { result.pending = true; break; }
    const verified = await (account ??= store.account(input.owner));
    let brief: DneskaiBrief;
    if (row.brief) {
      const stored = DneskaiBriefSchema.safeParse(row.brief);
      if (!stored.success) { await skip(row, 'brief-invalid'); continue; }
      brief = stored.data;
      // A held or retried brief keeps the lead a new one gets: generation and the owner's review need the time.
      if (Date.parse(brief.scheduledAt) < clock().getTime() + DNESKAI_BRIEF_MIN_LEAD_MINUTES * MINUTE) { await skip(row, 'brief-slot-passed'); continue; }
      if (Date.parse(brief.expiresAt) <= clock().getTime()) { await skip(row, 'brief-expired'); continue; }
      // Still held as account-unavailable: nothing new to report, but the next call admits it once the account is verified.
      if (!verified) { result.pending = true; continue; }
      if (row.status === 'pending') await store.prepare(input.owner, row.id, null, null, 'ready', null);
    } else {
      if (row.member_ids.some((id) => owed.has(id))) { const reserved = slots.peek(); if (reserved) slots.take(reserved); result.pending = true; continue; }
      const members = await store.members(input.owner, input.project, row.member_ids);
      if (members.length !== row.member_ids.length || members.some((member) => member.status !== 'selected' || member.target_date !== row.target_date) || memberHash(members) !== row.member_hash) {
        await skip(row, 'brief-members-changed'); continue;
      }
      const slot = slots.peek();
      if (!slot) { await skip(row, 'brief-slot-unavailable'); continue; }
      const withMedia = await Promise.all(members.map(async (member) => {
        const view = await store.media(input.owner, input.project, member.id);
        return { candidate: member.candidate, articleText:view?.articleText, media: view ? dneskaiOfferableMediaAssets(view) : [] };
      }));
      const outcome = buildDneskaiBrief({ eventId: row.event_id, memberHash: row.member_hash, targetDate: row.target_date, category: row.category, scheduledAt: slot, observedAt: clock(), members: withMedia, richEvidence: store.richEvidence });
      if ('code' in outcome) { await skip(row, outcome.code); continue; }
      const recent = await (coverage ??= store.coverage(input.owner, input.project, new Date(clock().getTime() - DNESKAI_REPEAT_WINDOW_DAYS * 86400000), input.runId));
      const phashes = await store.phashes(input.owner, [...new Set([...outcome.brief.media.map((item) => item.assetSha256), ...recent.flatMap((item) => item.assetSha256s)])]);
      let repeat = dneskaiBriefRepeat(outcome.brief, recent, phashes);
      // A site-wide card (a publisher's logo or default share image) is not the same photograph of the same event.
      if (repeat?.by === 'media') {
        const sitewide = dneskaiSitewidePictures(await store.pictureArticles(input.owner, input.project, outcome.brief.media.map((item) => item.assetSha256), row.member_ids));
        if (sitewide.size) repeat = dneskaiBriefRepeat(outcome.brief, recent, phashes, sitewide);
      }
      if (repeat) { await skip(row, 'collection-already-covered', repeat.coverage.duplicateOf); continue; }
      slots.take(slot);
      try { await store.prepare(input.owner, row.id, outcome.brief, slot, verified ? 'ready' : 'pending', verified ? null : 'account-unavailable'); }
      catch (error) {
        const code = error instanceof DneskaiBriefError ? error.code : 'brief-store-unavailable';
        // Another brief took the slot meanwhile, or the store failed: the next call builds it again with the next free slot.
        if (code === 'brief-slot-taken' || DNESKAI_BRIEF_RETRYABLE_CODES.has(code)) result.pending = true;
        result.skipped.push({ eventId: row.event_id, code }); continue;
      }
      brief = outcome.brief;
      // No verified @dneskai account: the brief exists and waits; no job is created.
      if (!verified) { result.created.push({ briefId: row.id, eventId: row.event_id, jobId: null }); result.pending = true; continue; }
    }
    try {
      const job = await enqueueBriefJob(store, input.owner, row, brief, verified);
      result.created.push({ briefId: row.id, eventId: row.event_id, jobId: job.jobId });
    } catch (error) {
      const code = error instanceof DneskaiBriefError || error instanceof MarketingWorkerRuntimeError ? error.code : error instanceof z.ZodError ? 'job-request-invalid' : 'job-enqueue-failed';
      // The brief stays ready and says why; the next call retries the same admission when the failure can pass.
      await store.prepare(input.owner, row.id, null, null, 'ready', code).catch(() => undefined);
      if (DNESKAI_BRIEF_RETRYABLE_CODES.has(code)) result.pending = true;
      result.skipped.push({ eventId: row.event_id, code });
    }
  }
  return result;
}

const chunks = <T,>(values: readonly T[], size: number) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, index * size + size));
const RevisionRowSchema = z.object({ id: z.uuid(), status: z.string(), revision: z.unknown(), created_at: z.string() });
/** Only what a stored revision covered: its sources and the pictures its deck draws. Older shapes still count. */
const CoveringRevisionSchema = z.object({
  sources: z.array(z.object({ sourceId: z.string() })).max(20),
  deck: z.object({ slides: z.array(z.object({ images: z.array(z.object({ assetSha256: z.string().regex(/^[a-f0-9]{64}$/) })).max(4).default([]) })).max(10) }).optional(),
});

/** The Supabase-backed brief store: service-role reads and the guarded SQL functions of 20261020150000. */
export function createDneskaiBriefStore(db: DneskaiBriefsDatabase, options: { enqueue?: (owner: string, request: unknown) => Promise<JobAdmission> } = {}): DneskaiBriefStore {
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await db.rpc(name, args);
    if (error) throw new DneskaiBriefError(rpcCode(String(error.message ?? '')));
    return data;
  };
  const read = async <T,>(query: PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> => { const { data, error } = await query; if (error) throw new DneskaiBriefError('brief-store-unavailable'); return data; };
  return {
    richEvidence: dneskaiRichEvidenceEnabled(),
    async run(owner, project, runId) {
      return read(db.from('marketing_dneskai_runs').select('id,date,target_date,status').eq('user_id', owner).eq('project_id', project).eq('id', runId).maybeSingle());
    },
    async briefs(owner, project, runId) {
      return (await read(db.from('marketing_dneskai_briefs').select('*').eq('user_id', owner).eq('project_id', project).eq('run_id', runId).order('rank'))) as DneskaiBriefRow[] ?? [];
    },
    async members(owner, project, ids) {
      if (!ids.length) return [];
      const rows = (await read(db.from('marketing_dneskai_candidates').select('id,status,target_date,content_hash,candidate').eq('user_id', owner).eq('project_id', project).in('id', [...ids]))) as DneskaiBriefMemberRow[] ?? [];
      return rows.flatMap((row) => { const parsed = DneskaiCandidateSchema.safeParse(row.candidate); return parsed.success && parsed.data.id === row.id ? [{ ...row, candidate: parsed.data }] : []; });
    },
    async owedMedia(owner, project, ids) {
      const owed = new Set((await pendingDneskaiMediaCandidates(db, owner, project)).filter((id) => ids.includes(id)));
      if (!ids.length) return owed;
      const rows = (await read(db.from('marketing_media_collections').select('candidate_id,status').eq('user_id', owner).eq('project_id', project).in('candidate_id', [...ids]))) as Array<{ candidate_id: string; status: string }> ?? [];
      const finished = new Set(rows.filter((row) => row.status !== 'pending').map((row) => row.candidate_id));
      for (const id of ids) if (!finished.has(id)) owed.add(id);
      return owed;
    },
    async media(owner, project, candidateId) {
      return (await readDneskaiMedia(db, owner, project, { candidateId, sign: false })).candidates[0] ?? null;
    },
    async coverage(owner, project, since, runId) {
      const revisions = z.array(RevisionRowSchema).parse(await read(db.from('marketing_revisions').select('id,status,revision,created_at').eq('user_id', owner).eq('brand', 'dneskai')
        .in('status', [...DNESKAI_COVERING_REVISION_STATUSES]).gte('created_at', since.toISOString()).order('created_at', { ascending: false }).limit(200)) ?? []);
      const parsed = revisions.flatMap((row) => { const revision = CoveringRevisionSchema.safeParse(row.revision); return revision.success ? [{ id: row.id, revision: revision.data }] : []; });
      const sourceIds = [...new Set(parsed.flatMap((row) => row.revision.sources.map((source) => source.sourceId)))];
      const packets = new Map<string, SourcePacket>();
      for (const part of chunks(sourceIds, 100)) {
        const rows = (await read(db.from('marketing_sources').select('source_id,packet').eq('user_id', owner).eq('brand', 'dneskai').in('source_id', part))) as Array<{ source_id: string; packet: unknown }> ?? [];
        for (const row of rows) { try { packets.set(row.source_id, parseSourcePacket(row.packet)); } catch { /* an unreadable head covers nothing */ } }
      }
      const fromRevisions: DneskaiCoverage[] = parsed.map(({ id, revision }) => ({
        id, duplicateOf: id,
        urls: revision.sources.flatMap((source) => { const packet = packets.get(source.sourceId); return packet ? [packet.canonicalUrl, ...packet.content.evidence.map((item) => item.url)] : []; }),
        assetSha256s: [...new Set((revision.deck?.slides ?? []).flatMap((slide) => slide.images.map((image) => image.assetSha256)))],
      }));
      const briefs = (await read(db.from('marketing_dneskai_briefs').select('id,run_id,lead_candidate_id,brief').eq('user_id', owner).eq('project_id', project).in('status', ['ready', 'queued'])
        .gte('created_at', since.toISOString()).neq('run_id', runId).limit(100))) as Array<{ id: string; lead_candidate_id: string; brief: unknown }> ?? [];
      const fromBriefs: DneskaiCoverage[] = briefs.flatMap((row) => {
        const brief = DneskaiBriefSchema.safeParse(row.brief);
        return brief.success ? [{ id: row.id, duplicateOf: row.lead_candidate_id, urls: brief.data.evidence.map((item) => item.url), assetSha256s: brief.data.media.map((item) => item.assetSha256) }] : [];
      });
      return [...fromRevisions, ...fromBriefs];
    },
    async phashes(owner, sha256s) {
      const result = new Map<string, string | null>();
      for (const part of chunks(sha256s, 100)) {
        const rows = (await read(db.from('marketing_media_assets').select('sha256,phash').eq('user_id', owner).in('sha256', [...part]))) as Array<{ sha256: string; phash: string | null }> ?? [];
        for (const row of rows) result.set(row.sha256, row.phash);
      }
      return result;
    },
    async pictureArticles(owner, project, sha256s, exclude) {
      if (!sha256s.length) return [];
      const assets = (await read(db.from('marketing_media_assets').select('id,sha256').eq('user_id', owner).eq('project_id', project).in('sha256', [...sha256s]).limit(200))) as Array<{ id: string; sha256: string }> ?? [];
      if (!assets.length) return [];
      const shaById = new Map(assets.map((asset) => [asset.id, asset.sha256]));
      const links = (await read(db.from('marketing_media_asset_links').select('asset_id,candidate_id').eq('user_id', owner).eq('project_id', project).in('asset_id', [...shaById.keys()]).limit(1000))) as Array<{ asset_id: string; candidate_id: string }> ?? [];
      const skip = new Set(exclude);
      const ids = [...new Set(links.map((link) => link.candidate_id).filter((id) => !skip.has(id)))].slice(0, 200);
      const urls = new Map<string, string>();
      for (const part of chunks(ids, 100)) {
        const rows = (await read(db.from('marketing_dneskai_candidates').select('id,candidate').eq('user_id', owner).eq('project_id', project).in('id', part))) as Array<{ id: string; candidate: unknown }> ?? [];
        for (const row of rows) { const parsed = DneskaiCandidateSchema.safeParse(row.candidate); if (parsed.success) urls.set(row.id, parsed.data.url); }
      }
      return links.flatMap((link) => { const url = urls.get(link.candidate_id), sha256 = shaById.get(link.asset_id); return url && sha256 ? [{ sha256, url }] : []; });
    },
    async takenSlots(owner, project, targetDate, runId) {
      const start = pragueScheduledAt(targetDate, '00:00');
      const end = pragueScheduledAt(new Date(Date.parse(`${targetDate}T12:00:00Z`) + 86400000).toISOString().slice(0, 10), '00:00');
      const within = (value: unknown) => typeof value === 'string' && Date.parse(value) >= Date.parse(start) && Date.parse(value) < Date.parse(end);
      const [publications, revisions, briefs] = await Promise.all([
        read(db.from('marketing_publications').select('scheduled_at,marketing_revisions!inner(brand)').eq('user_id', owner).eq('marketing_revisions.brand', 'dneskai')
          .in('status', ['queued', 'claimed', 'published', 'reconciliation']).gte('scheduled_at', start).lt('scheduled_at', end).limit(50)),
        read(db.from('marketing_revisions').select('revision').eq('user_id', owner).eq('brand', 'dneskai').in('status', ['review', 'approved', 'publishing', 'published', 'reconciliation', 'returned'])
          .gte('created_at', new Date(Date.parse(start) - 7 * 86400000).toISOString()).limit(200)),
        read(db.from('marketing_dneskai_briefs').select('scheduled_at').eq('user_id', owner).eq('project_id', project).eq('target_date', targetDate).neq('status', 'skipped').neq('run_id', runId).not('scheduled_at', 'is', null)),
      ]);
      return [...((publications ?? []) as Array<{ scheduled_at: string }>).map((row) => row.scheduled_at),
        ...((revisions ?? []) as Array<{ revision: { scheduledAt?: unknown } }>).map((row) => row.revision?.scheduledAt).filter(within) as string[],
        ...((briefs ?? []) as Array<{ scheduled_at: string }>).map((row) => row.scheduled_at)].filter(within);
    },
    async account(owner) {
      return read(db.from('marketing_accounts').select('remote_account_id,handle').eq('user_id', owner).eq('brand', 'dneskai').eq('platform', 'instagram').not('verified_at', 'is', null).maybeSingle());
    },
    async prepare(owner, briefId, brief, scheduledAt, status, code) { await rpc('marketing_dneskai_prepare_brief', { p_owner: owner, p_brief: briefId, p_value: brief, p_scheduled_at: scheduledAt, p_status: status, p_code: code }); },
    async skip(owner, briefId, code, duplicateOf = null) { await rpc('marketing_dneskai_skip_brief', { p_owner: owner, p_brief: briefId, p_code: code, p_duplicate_of: duplicateOf }); },
    async ingest(owner, packet) {
      try { const stored = await ingestSource(db, owner, packet, 'dneskai'); return { id: z.uuid().parse(stored.id) }; } catch { throw new DneskaiBriefError('brief-source-save-failed'); }
    },
    async admit(owner, briefId, sourceUuid) {
      return z.object({ campaignId: z.uuid(), entryId: z.uuid(), entryVersion: z.number().int().positive(), jobId: z.uuid().optional() }).parse(await rpc('marketing_dneskai_admit_brief', { p_owner: owner, p_brief: briefId, p_source: sourceUuid }));
    },
    enqueue: options.enqueue ?? ((owner, request) => enqueueMarketingJob(db, owner, request)),
    async queued(owner, briefId, jobId) { await rpc('marketing_dneskai_brief_queued', { p_owner: owner, p_brief: briefId, p_job: jobId }); },
  };
}

/** `CreateDneskaiBriefs` over the service-role client. */
export function createDneskaiBriefs(db: DneskaiBriefsDatabase, options: { now?: () => Date; enqueue?: (owner: string, request: unknown) => Promise<JobAdmission> } = {}): CreateDneskaiBriefs {
  const store = createDneskaiBriefStore(db, options);
  return (input) => createDneskaiBriefsWithStore(store, input, options);
}

/**
 * The brief's pictures with their capability flags and its primary source (review-10), for an owner edit that moves
 * a picture slide to another type or inserts a slide. The same brief rows as `listDneskaiBriefAssetHashes`; an
 * empty pool when the revision names no brief.
 */
export async function listDneskaiBriefPool(db: Pick<DneskaiBriefsDatabase, 'from'>, owner: string, revision: Pick<ContentRevision, 'sources'>): Promise<DneskaiEditPool> {
  const source = revision.sources[0];
  if (!source || !/^[a-f0-9]{64}$/.test(source.sourceId)) return { media: [], primaryCandidateId: null };
  const { data, error } = await db.from('marketing_dneskai_briefs').select('brief').eq('user_id', owner).eq('event_id', source.sourceId).eq('member_hash', source.sourceRevision).neq('status', 'skipped').limit(4);
  if (error) throw new DneskaiBriefError('brief-store-unavailable');
  const briefs = (data ?? []).flatMap((row: { brief: unknown }) => { const brief = DneskaiBriefSchema.safeParse(row.brief); return brief.success ? [brief.data] : []; });
  const media = briefs.flatMap((brief) => brief.media.map(({ assetSha256, candidateId, credit, fullBleedCapable, insetCapable }) => ({ assetSha256, candidateId, credit, fullBleedCapable, insetCapable })));
  return { media: media.filter((item, index) => media.findIndex((other) => other.assetSha256 === item.assetSha256) === index), primaryCandidateId: briefs[0]?.evidence[0]?.candidateId ?? null };
}

/**
 * The media pool an owner edit may draw from (#118): the pictures of the brief the revision was generated from
 * (`sources[0]`: eventId and memberHash), plus the pictures the deck already places. A revision without a brief
 * keeps only its own pictures, never another brief's.
 */
export async function listDneskaiBriefAssetHashes(db: Pick<DneskaiBriefsDatabase, 'from'>, owner: string, revision: Pick<ContentRevision, 'sources' | 'deck'>): Promise<string[]> {
  const own = revision.deck ? revision.deck.slides.flatMap((slide) => slide.images.map((image) => image.assetSha256)) : [];
  const source = revision.sources[0];
  if (!source || !/^[a-f0-9]{64}$/.test(source.sourceId)) return [...new Set(own)];
  const { data, error } = await db.from('marketing_dneskai_briefs').select('brief').eq('user_id', owner).eq('event_id', source.sourceId).eq('member_hash', source.sourceRevision).neq('status', 'skipped').limit(4);
  if (error) throw new DneskaiBriefError('brief-store-unavailable');
  const pool = (data ?? []).flatMap((row: { brief: unknown }) => { const brief = DneskaiBriefSchema.safeParse(row.brief); return brief.success ? brief.data.media.map((item) => item.assetSha256) : []; });
  return [...new Set([...pool, ...own])];
}
