import { dneskaiRetagCaption } from './dneskai-generation';
import 'server-only';
import { z } from 'zod';
import type { createAdminClient } from '@/lib/supabase/admin';
import { parseContentRevision, renderReportBlocks, type ContentRevision } from './contracts';
import { pragueScheduledAt } from './clock';
import { pragueMarketingDate } from './weekly-planning';
import { pragueDayAfter } from './dneskai-workspace';
import { DNESKAI_GENERATION_KITS, dneskaiGenerationKit, dneskaiKitOf } from './dneskai-slides';
import { dneskaiEmphasisFor } from './dneskai-palette';
import { dneskaiClosingSlide, isDneskaiClosingSlide } from './dneskai-closing';
import { DNESKAI_RESTYLE_ATTEMPTS, DNESKAI_RESTYLE_FAILED, DNESKAI_RESTYLE_QUEUED, DNESKAI_RESTYLE_REQUESTED, dneskaiRestyleJobKey, restyleDneskaiPost } from './dneskai-restyle';
import { DNESKAI_PLAN_DAYS, DNESKAI_PLAN_INSTAGRAM_TIMES, DNESKAI_PLAN_TIMES, type DneskaiPlanKind, type DneskaiPlanStatus } from './dneskai-plan-view';
import { dneskaiThreadsTwin, type DneskaiThreadsAccount } from './dneskai-threads';
import { prepareDneskaiRevisionEdit, renderAndAttachDneskaiRevision, reusableDneskaiRender } from './dneskai-revision-edit';
import { getBriefAssetHashLister, getBriefPoolLoader, getDneskaiMediaLoader, getRenderDneskaiDeck } from './dneskai-wiring';
import { refreshMarketingAssetUrls } from './asset-urls';
import { saveRevision } from './store';
import { createHash } from 'node:crypto';
import { createDneskaiSlideStorage } from './worker-runtime';
import { STORY_HEIGHT, STORY_WIDTH, composeStoryFromCover, storyRenderKey } from './story-image';
import { renderDneskaiStoryJpeg } from './dneskai-render';
import { synchronizeMarketingSources } from './orchestrator';
import { illustrateDneskaiPost } from './dneskai-illustrate';
import { DNESKAI_SERIES_START, dneskaiSeriesAssignment, dneskaiSeriesCaption, dneskaiSeriesDeck, dneskaiSeriesHeading, dneskaiSeriesNumbers, dneskaiSeriesOf, dneskaiSeriesSlot, type DneskaiSeries } from './dneskai-series';

/**
 * The DNESKAi publishing plan step (owner decision, 7 November 2026). The owner approved every education topic and
 * the last week's news into a rolling 30-day plan: three Instagram posts a day, the same three on Threads and one
 * evening Threads post. On each minute tick, behind DNESKAI_PLAN_ENABLED, this step:
 *
 * 1. fills empty slots from tomorrow to the 30th day with approved education topics that are not planned yet, and
 *    writes each topic's slot into its evidence, so the topic bridge briefs it for exactly that day and time;
 * 2. works the slots of today and the next `DNESKAI_PLAN_HORIZON_DAYS` days, one decision per slot: render the post in
 *    Spotlight, move it to the slot's time, turn a Threads-only post into a Threads revision, approve the exact
 *    version, and derive and approve the Threads twin of an approved Instagram post.
 *
 * The owner keeps the last word. A revision the owner saved in the Design Lab after the plan's own (`written_revision_id`
 * differs) keeps its kit and time; returned or skipped posts leave the plan as skipped. At most one render runs per
 * tick, because a render takes most of one.
 */
type Database = ReturnType<typeof createAdminClient>;

/** Days after today whose slots the step prepares; the topic bridge generates them as soon as they enter it. */
export const DNESKAI_PLAN_HORIZON_DAYS = 2;
/** A render starts only with this much of the tick left; the renderer stops at the tick's hard budget. */
const RENDER_MINIMUM_MS = 18_000;
const RERENDER_BACKOFF_MS = 30 * 60_000;
/** A post is approved only while its slot is at least this far away. */
const APPROVAL_LEAD_MS = 2 * 60_000;
/** A news brief stays current until this long after its planned slot. */
const NEWS_EXTENSION_MS = 24 * 60 * 60_000;
const FILL_LIMIT = 40;

export { dneskaiPlanEnabled } from './dneskai-evidence-rollout';

export type DneskaiPlanRow = {
  id: string; user_id: string; project_id: string; date: string; local_time: string; instagram: boolean; threads: boolean; kind: DneskaiPlanKind;
  revision_id: string | null; topic_id: string | null; head_revision_id: string | null; threads_revision_id: string | null;
  written_revision_id: string | null; threads_base_revision_id: string | null; status: DneskaiPlanStatus; code: string | null;
  /** The slot's Instagram story and the post it was made from (owner decision, 7 November 2026). */
  story_revision_id?: string | null; story_base_revision_id?: string | null;
};
export type DneskaiPlanHead = { id: string; status: string; ready: boolean; content_hash: string; revision: ContentRevision; render_report: unknown };
export type DneskaiPlanTwin = { id: string; status: string; ready: boolean; content_hash: string };

export type DneskaiPlanAction =
  | { kind: 'wait'; status: DneskaiPlanStatus; code: string | null }
  | { kind: 'spotlight' | 'rerender' | 'move' | 'redraw' | 'retag' | 'series' | 'to-threads' | 'approve' | 'twin' | 'approve-twin' | 'story' | 'approve-story'; status: DneskaiPlanStatus }
  /** The post has no photo on its first slide: retired and the slot freed for another post (8 November 2026). */
  | { kind: 'drop'; status: 'skipped'; code: 'plan-photo-missing' | 'plan-photos-short' }
  /** A carousel with too few photo slides is written again with more pictures, once (8 November 2026). */
  | { kind: 'restyle'; status: 'planned' };

/** A drafted DNESKAi deck whose first slide shows no picture. A revision without a deck (rendered assets) passes. */
export const dneskaiDeckLacksPhoto = (revision: Pick<ContentRevision, 'deck'>) => !!revision.deck && !(revision.deck.slides[0]?.images.length);
/**
 * Slides drawn before this instant predate the icy blue, the new logo and the two remaining styles (owner, 8 November
 * 2026). The plan draws an unpublished post rendered earlier again, under `DNESKAI_RENDER_POLICY` (dneskai-render/5: the strong cover vignette of 9 November 2026).
 */
export const DNESKAI_RENDERS_CURRENT_SINCE = '2026-11-09T02:20:00.000Z';
export function dneskaiRenderStale(report: unknown): boolean {
  const at = report && typeof report === 'object' ? (report as { renderedAt?: unknown }).renderedAt : undefined;
  return typeof at === 'string' && Date.parse(at) < Date.parse(DNESKAI_RENDERS_CURRENT_SINCE);
}
/** The owner's slide rule (photo, photo, optional text, photo, closing): a carousel needs this many photo slides. */
export const DNESKAI_MIN_PHOTO_SLIDES = 3;
/** Photo slides of a carousel, the closing slide not counted; null for a post that is not a drafted carousel. */
export const dneskaiPhotoSlides = (revision: Pick<ContentRevision, 'deck'>): number | null =>
  revision.deck?.format === 'carousel' ? revision.deck.slides.filter((slide) => slide.images.length > 0 && !isDneskaiClosingSlide(slide)).length : null;
/** Topic bridge codes that mean the topic's post can never carry a photo. */
const PHOTO_MISSING_CODES = new Set(['media-photo-missing']);

/** A slot's story goes out this long after its Instagram post. */
export const DNESKAI_STORY_DELAY_MS = 10 * 60_000;

/** A series post is renumbered only while its slot is at least this far away, so the new version can be drawn and approved. */
const SERIES_RENUMBER_LEAD_MS = 30 * 60_000;

/** True when the post does not carry `heading` (its series label and number) on its cover and its first caption line. */
export function dneskaiSeriesOutOfDate(revision: Pick<ContentRevision, 'deck' | 'caption'>, heading: string): boolean {
  const cover = revision.deck?.slides[0];
  if (cover?.type === 'cover-photo' && cover.series !== heading) return true;
  return revision.caption.replace(/^\s+/, '').split('\n')[0]?.trim() !== heading;
}

/** The slot's instant in Prague time. */
export const dneskaiPlanSlotAt = (slot: Pick<DneskaiPlanRow, 'date' | 'local_time'>) => pragueScheduledAt(slot.date, slot.local_time);

/**
 * The one thing a slot needs next. Pure: the executor reads the head, its Threads twin and the Threads account, asks
 * this, does that one step and records the returned status and code on the slot.
 */
export function dneskaiPlanAction(slot: DneskaiPlanRow, head: DneskaiPlanHead | null, twin: DneskaiPlanTwin | null, threadsAccount: boolean, now: Date, story: DneskaiPlanTwin | null = null, heading: string | null = null): DneskaiPlanAction {
  if (!head) return slot.topic_id ? { kind: 'wait', status: 'generating', code: null } : { kind: 'wait', status: 'failed', code: 'plan-post-missing' };
  const slotAt = Date.parse(dneskaiPlanSlotAt(slot));
  if (head.status === 'published') return { kind: 'wait', status: 'published', code: null };
  if (head.status === 'returned' || head.status === 'skipped') return { kind: 'wait', status: 'skipped', code: `owner-${head.status}` };
  if (head.status === 'superseded') return { kind: 'wait', status: 'failed', code: 'plan-post-superseded' };
  if (head.status === 'failed') return { kind: 'wait', status: 'failed', code: 'publish-failed' };
  if (head.status === 'publishing' || head.status === 'reconciliation') return { kind: 'wait', status: 'approved', code: null };
  // Every post shows a photo (owner decision, 8 November 2026): one without leaves the plan, silently.
  if ((head.status === 'review' || head.status === 'approved') && dneskaiDeckLacksPhoto(head.revision)) return { kind: 'drop', status: 'skipped', code: 'plan-photo-missing' };
  // At least three photo slides (owner decision, 8 November 2026). A post from before the house style is written
  // again once, with the brief topped up with pictures; a house-style post that still falls short leaves the plan.
  const photos = head.status === 'review' || head.status === 'approved' ? dneskaiPhotoSlides(head.revision) : null;
  if (photos !== null && photos < DNESKAI_MIN_PHOTO_SLIDES) {
    const restyled = head.revision.promptVersion.startsWith('marketing-copy/8') || slot.code === DNESKAI_RESTYLE_FAILED;
    return restyled ? { kind: 'drop', status: 'skipped', code: 'plan-photos-short' } : { kind: 'restyle', status: 'planned' };
  }
  const ownerEdit = !!slot.written_revision_id && head.id !== slot.written_revision_id;
  // The hashtags of an Instagram post follow the current rule (owner, 8 November 2026) while its slot is ahead.
  if ((head.status === 'review' || head.status === 'approved') && head.ready && head.revision.account.platform === 'instagram'
    && dneskaiRetagCaption(head.revision.caption) !== head.revision.caption && slotAt > now.getTime() + APPROVAL_LEAD_MS) return { kind: 'retag', status: 'ready' };
  if (head.status === 'review') {
    if (!head.ready || renderReportBlocks(head.render_report)) {
      // The plan's own render that was cut off or failed is drawn again; a render that refused the text waits for the owner.
      const report = head.render_report as { status?: unknown; renderedAt?: unknown } | null;
      // A render that failed waits half an hour before the next try, so one failing post never takes every tick's
      // single render from the posts behind it (9 November 2026).
      const failedAt = report?.status === 'failed' && typeof report.renderedAt === 'string' ? Date.parse(report.renderedAt) : Number.NaN;
      if (Number.isFinite(failedAt) && now.getTime() - failedAt < RERENDER_BACKOFF_MS) return { kind: 'wait', status: 'failed', code: 'render-retry-later' };
      if (slot.written_revision_id === head.id && report?.status !== 'refused' && head.revision.deck && !head.revision.assets.length) return { kind: 'rerender', status: 'ready' };
      return { kind: 'wait', status: 'failed', code: 'render-blocked' };
    }
    // A deck in a retired kit (Video-first included) is redrawn in one of the rotating styles; Spotlight and Plakát stay as drawn.
    if (!ownerEdit && head.revision.deck && !DNESKAI_GENERATION_KITS.includes(dneskaiKitOf(head.revision.deck))) return { kind: 'spotlight', status: 'ready' };
    if (!ownerEdit && Date.parse(head.revision.scheduledAt) !== slotAt) return { kind: 'move', status: 'ready' };
    if (head.revision.deck && dneskaiRenderStale(head.render_report) && slotAt > now.getTime() + APPROVAL_LEAD_MS) return { kind: 'redraw', status: 'ready' };
    // A series post carries its label and running number, the owner's edit included (8 November 2026).
    if (heading && head.revision.deck && dneskaiSeriesOutOfDate(head.revision, heading)) return { kind: 'series', status: 'ready' };
    // The key words take the colour of the slot (owner request, 8 November 2026); a post moved here is redrawn in it.
    if (!ownerEdit && head.revision.deck && head.revision.deck.emphasis !== dneskaiEmphasisFor(dneskaiPlanSlotAt(slot))) return { kind: 'move', status: 'ready' };
    if (!slot.instagram && head.revision.account.platform === 'instagram') {
      return threadsAccount ? { kind: 'to-threads', status: 'ready' } : { kind: 'wait', status: 'ready', code: 'threads-account-missing' };
    }
    if (Date.parse(head.revision.scheduledAt) <= now.getTime() + APPROVAL_LEAD_MS) return { kind: 'wait', status: 'failed', code: 'slot-passed' };
    return { kind: 'approve', status: 'approved' };
  }
  // An approved series post whose number changed (an earlier one was skipped) is renumbered while there is time.
  if (head.status === 'approved' && heading && head.revision.deck && dneskaiSeriesOutOfDate(head.revision, heading) && Date.parse(head.revision.scheduledAt) > now.getTime() + SERIES_RENUMBER_LEAD_MS) {
    return { kind: 'series', status: 'ready' };
  }
  // An approved post drawn in the retired look is drawn again and approved again while its slot is ahead.
  if (head.status === 'approved' && head.revision.deck && dneskaiRenderStale(head.render_report) && slotAt > now.getTime() + APPROVAL_LEAD_MS) return { kind: 'redraw', status: 'ready' };
  // An approved post whose slot moved (19:00 and 21:00 since 8 November 2026) follows it while the slot is ahead.
  if (head.status === 'approved' && head.revision.deck && Date.parse(head.revision.scheduledAt) !== slotAt && slotAt > now.getTime() + APPROVAL_LEAD_MS) return { kind: 'move', status: 'ready' };
  if (head.status === 'approved' && slot.instagram && head.revision.account.platform === 'instagram') {
    const gone = ['skipped', 'superseded', 'returned', 'failed'];
    const posted = Date.parse(head.revision.scheduledAt);
    let code: string | null = null;
    if (slot.threads) {
      if (!threadsAccount) code = 'threads-account-missing';
      else if (posted <= now.getTime() + APPROVAL_LEAD_MS) code = twin?.status === 'approved' ? null : 'threads-slot-passed';
      else if (!twin || slot.threads_base_revision_id !== head.id || gone.includes(twin.status)) return { kind: 'twin', status: 'approved' };
      else if (twin.status === 'review') { if (twin.ready) return { kind: 'approve-twin', status: 'approved' }; code = 'threads-twin-not-ready'; }
    }
    // The story from the post's cover goes out ten minutes after the post.
    if (posted + DNESKAI_STORY_DELAY_MS > now.getTime() + APPROVAL_LEAD_MS) {
      if (!story || slot.story_base_revision_id !== head.id || gone.includes(story.status)) return { kind: 'story', status: 'approved' };
      if (story.status === 'review') { if (story.ready) return { kind: 'approve-story', status: 'approved' }; code ??= 'story-not-ready'; }
    }
    return { kind: 'wait', status: 'approved', code };
  }
  return { kind: 'wait', status: 'approved', code: null };
}

/** The empty slots from `from` through `until`: Instagram and Threads at the three day times, Threads alone at 21:00. */
export function dneskaiPlanEmptySlots(taken: ReadonlyArray<Pick<DneskaiPlanRow, 'date' | 'local_time'>>, from: string, until: string, skip: readonly string[] = []): Array<{ date: string; time: string; instagram: boolean }> {
  const used = new Set(taken.map((slot) => `${slot.date} ${slot.local_time}`));
  const result: Array<{ date: string; time: string; instagram: boolean }> = [];
  for (let date = from; date <= until; date = pragueDayAfter(date, 1)) {
    for (const time of DNESKAI_PLAN_TIMES) if (!skip.includes(time) && !used.has(`${date} ${time}`)) result.push({ date, time, instagram: (DNESKAI_PLAN_INSTAGRAM_TIMES as readonly string[]).includes(time) });
  }
  return result;
}

/**
 * The times the night's news takes (owner decision, 7 November 2026): with new topics on, education fills only the
 * other times ahead, the plan approves the night's news topics into these and education takes what is still free on
 * the day itself from `DNESKAI_NEWS_FALLBACK_HOUR`.
 */
export const DNESKAI_PLAN_NEWS_TIMES = ['08:00', '19:00', '21:00'] as const;
export const DNESKAI_NEWS_FALLBACK_HOUR = 5;
/** News is placed and the fallback filled only while the slot is at least this far away, so it can be generated. */
const NEWS_LEAD_MS = 90 * 60_000;

/** Pairs the night's news topics, best rank first, with the free news times of their day that are still far enough away. */
export function dneskaiNewsPlacement(topics: ReadonlyArray<{ id: string; date: string; rank: number }>, taken: ReadonlyArray<Pick<DneskaiPlanRow, 'date' | 'local_time'>>, now: Date): Array<{ topicId: string; date: string; time: string; instagram: boolean }> {
  const used = new Set(taken.map((slot) => `${slot.date} ${slot.local_time}`));
  const result: Array<{ topicId: string; date: string; time: string; instagram: boolean }> = [];
  for (const topic of [...topics].sort((a, b) => a.date.localeCompare(b.date) || a.rank - b.rank)) {
    // A series slot (19:00 Monday to Saturday from 16 November 2026) belongs to its series, not to the news.
    const time = DNESKAI_PLAN_NEWS_TIMES.find((candidate) => !used.has(`${topic.date} ${candidate}`) && !dneskaiSeriesSlot(topic.date, candidate) && Date.parse(pragueScheduledAt(topic.date, candidate)) >= now.getTime() + NEWS_LEAD_MS);
    if (!time) continue;
    used.add(`${topic.date} ${time}`);
    result.push({ topicId: topic.id, date: topic.date, time, instagram: time !== '21:00' });
  }
  return result;
}

export type DneskaiPlanResult = { filled: number; news?: number; worked: number; rendered: number; approved: number; twins: number; codes: Record<string, number> };

const read = <T>(result: { data: T | null; error: unknown }, code: string): T => { if (result.error) throw new Error(code); return result.data as T; };
const SLOT_COLUMNS = 'id,user_id,project_id,date,local_time,instagram,threads,kind,revision_id,topic_id,head_revision_id,threads_revision_id,written_revision_id,threads_base_revision_id,story_revision_id,story_base_revision_id,status,code';

/**
 * Fills empty slots with approved, unplanned education topics, oldest approval first. A series slot (8 November 2026)
 * takes the next topic of its series, in the series' order, even at a news time; without one it stays free until the
 * plan prepares that day, then an ordinary topic takes it (`dneskaiSeriesAssignment`).
 */
async function fillPlan(db: Database, owner: string, project: string, today: string, options: { news: boolean; now: Date } = { news: false, now: new Date() }): Promise<number> {
  const from = pragueDayAfter(today, 1), until = pragueDayAfter(today, DNESKAI_PLAN_DAYS - 1);
  const taken = read(await db.from('marketing_dneskai_plan').select('date,local_time').eq('user_id', owner).eq('project_id', project).gte('date', today).lte('date', until).limit(400), 'plan-unavailable') as Array<{ date: string; local_time: string }>;
  // With the night's news on, the news times stay free ahead; on the day itself, from 05:00, education takes what is left.
  const ahead = dneskaiPlanEmptySlots(taken, from, until).filter((slot) => !options.news || !(DNESKAI_PLAN_NEWS_TIMES as readonly string[]).includes(slot.time) || !!dneskaiSeriesSlot(slot.date, slot.time));
  const fallback = options.news && pragueHourOf(options.now) >= DNESKAI_NEWS_FALLBACK_HOUR
    ? dneskaiPlanEmptySlots(taken, today, today).filter((slot) => Date.parse(pragueScheduledAt(slot.date, slot.time)) >= options.now.getTime() + NEWS_LEAD_MS) : [];
  const empty = [...fallback, ...ahead].slice(0, FILL_LIMIT);
  if (!empty.length) return 0;
  type Topic = { id: string; evidence: Record<string, unknown> | null };
  const plain = read(await db.from('marketing_dneskai_topics').select('id,evidence').eq('user_id', owner).eq('project_id', project).eq('kind', 'education').eq('status', 'approved')
    .is('evidence->>planDate', null).is('evidence->>series', null).order('approved_at', { ascending: true }).order('created_at', { ascending: true }).limit(empty.length), 'plan-topics-unavailable') as Topic[];
  const series = read(await db.from('marketing_dneskai_topics').select('id,evidence').eq('user_id', owner).eq('project_id', project).eq('kind', 'education').eq('status', 'approved')
    .is('evidence->>planDate', null).not('evidence->>series', 'is', null).order('approved_at', { ascending: true }).order('created_at', { ascending: true }).limit(200), 'plan-topics-unavailable') as Topic[];
  const order = (topic: Topic) => typeof topic.evidence?.seriesOrder === 'number' ? topic.evidence.seriesOrder : Number.MAX_SAFE_INTEGER;
  const pairs = dneskaiSeriesAssignment(empty, [...[...series].sort((a, b) => order(a) - order(b)), ...plain], pragueDayAfter(today, DNESKAI_PLAN_HORIZON_DAYS));
  let filled = 0;
  for (const { slot, topic } of pairs) {
    const inserted = await db.from('marketing_dneskai_plan').insert({ user_id: owner, project_id: project, date: slot.date, local_time: slot.time, instagram: slot.instagram, threads: true, kind: 'education', topic_id: topic.id }).select('id');
    if (inserted.error) continue; // A slot taken meanwhile or a topic planned by another tick: the next pass sees it.
    const { error } = await db.from('marketing_dneskai_topics').update({ evidence: { ...(topic.evidence ?? {}), planDate: slot.date, planTime: slot.time }, updated_at: new Date().toISOString() }).eq('user_id', owner).eq('id', topic.id);
    if (error) throw new Error('plan-topic-write-failed');
    filled++;
  }
  return filled;
}

const RevisionRowSchema = z.object({ id: z.uuid(), status: z.string(), ready: z.boolean(), content_hash: z.string(), revision: z.unknown(), render_report: z.unknown().optional(), slides: z.unknown().optional() });
async function topicLacksPhoto(db: Database, owner: string, topicId: string): Promise<boolean> {
  const topic = read(await db.from('marketing_dneskai_topics').select('evidence').eq('user_id', owner).eq('id', topicId).maybeSingle(), 'plan-topic-unavailable') as { evidence: Record<string, unknown> | null } | null;
  if (typeof topic?.evidence?.bridgeCode === 'string' && PHOTO_MISSING_CODES.has(topic.evidence.bridgeCode)) return true;
  // Generation refuses a brief without a usable photo before any model call; its job fails with that code.
  const jobId = typeof topic?.evidence?.jobId === 'string' ? topic.evidence.jobId : null;
  if (!jobId) return false;
  const job = read(await db.from('marketing_jobs').select('status,error_code').eq('user_id', owner).eq('id', jobId).maybeSingle(), 'plan-topic-unavailable') as { status: string; error_code: string | null } | null;
  return job?.status === 'failed' && !!job.error_code && PHOTO_MISSING_CODES.has(job.error_code);
}

async function revisionRow(db: Database, owner: string, id: string) {
  const row = read(await db.from('marketing_revisions').select('id,status,ready,content_hash,revision,render_report,slides').eq('user_id', owner).eq('id', id).maybeSingle(), 'plan-revision-unavailable');
  return row ? RevisionRowSchema.parse(row) : null;
}

/** The newest revision of the post: the slot's head (or first revision, or the topic's draft) and its successors. */
async function resolveHead(db: Database, owner: string, slot: DneskaiPlanRow): Promise<DneskaiPlanHead | null> {
  let id = slot.head_revision_id ?? slot.revision_id;
  if (!id && slot.topic_id) {
    const topic = read(await db.from('marketing_dneskai_topics').select('status,evidence').eq('user_id', owner).eq('id', slot.topic_id).maybeSingle(), 'plan-topic-unavailable') as { status: string; evidence: Record<string, unknown> | null } | null;
    id = topic?.status === 'generated' && typeof topic.evidence?.revisionId === 'string' ? topic.evidence.revisionId : null;
  }
  if (!id) return null;
  for (let step = 0; step < 30; step++) {
    const next = read(await db.from('marketing_revisions').select('id').eq('user_id', owner).eq('replaces_id', id).order('created_at', { ascending: false }).limit(1), 'plan-revision-unavailable') as Array<{ id: string }>;
    if (!next.length) break;
    id = next[0]!.id;
  }
  const row = await revisionRow(db, owner, id);
  if (!row) return null;
  try { return { id: row.id, status: row.status, ready: row.ready, content_hash: row.content_hash, revision: parseContentRevision(row.revision), render_report: row.render_report ?? null }; }
  catch { return null; }
}

type Wiring = { render: ReturnType<typeof getRenderDneskaiDeck>; loadMedia: ReturnType<typeof getDneskaiMediaLoader>; listBriefAssetHashes: ReturnType<typeof getBriefAssetHashLister>; loadBriefPool: ReturnType<typeof getBriefPoolLoader> };

/** A news post goes out after its 48 hours: its brief stays current until a day after the slot, and its source packet is re-read. */
async function keepNewsCurrent(db: Database, owner: string, slot: DneskaiPlanRow, revision: ContentRevision, signal: AbortSignal) {
  if (slot.kind !== 'news') return;
  const until = new Date(Date.parse(dneskaiPlanSlotAt(slot)) + NEWS_EXTENSION_MS).toISOString();
  for (const source of revision.sources) {
    const { error } = await db.rpc('marketing_dneskai_plan_extend_brief', { p_owner: owner, p_event: source.sourceId, p_until: until });
    if (error) throw new Error('plan-brief-extension-failed');
    // The brief is the local producer: re-reading it stores the packet with the new expiry (same content hash).
    await synchronizeMarketingSources(db, owner, 'dneskai', [source.sourceId], undefined, signal);
  }
}

/** Saves the plan's own edit of the head (Spotlight and/or the slot's time) and renders it, reusing the JPEGs when the deck is unchanged. */
function renderRefusedForResolution(report: unknown): boolean {
  const problems = (report as { problems?: Array<{ code?: unknown; blocking?: unknown }> } | null)?.problems ?? [];
  return problems.some((problem) => problem.code === 'image-low-resolution' && problem.blocking === true);
}

async function illustrationChecked(db: Database, revisionId: string): Promise<boolean> {
  const { data, error } = await db.from('dneskai_illustration_checks').select('revision_id').eq('revision_id', revisionId).maybeSingle();
  if (error) return true;
  return !!data;
}
async function markIllustrationChecked(db: Database, revisionId: string, code: string): Promise<void> {
  await db.from('dneskai_illustration_checks').upsert({ revision_id: revisionId, code: code.slice(0, 60) }, { onConflict: 'revision_id' });
}

async function saveEdit(db: Database, owner: string, head: DneskaiPlanHead, edit: { kit: boolean; scheduledAt: string; fresh?: boolean; caption?: string }, wiring: Wiring, signal: AbortSignal) {
  const deck = head.revision.deck;
  const kit = deck ? dneskaiGenerationKit([head.revision.title, ...deck.slides.map((slide) => slide.headline ?? '')].join('\n')) : null;
  const deckEdit = edit.kit && deck && kit ? { kit, slides: deck.slides.map((_, from) => ({ from })) } : undefined;
  const prepared = await prepareDneskaiRevisionEdit(head.revision, { caption: edit.caption ?? head.revision.caption, scheduledAt: edit.scheduledAt, ...(deckEdit ? { deck: deckEdit } : {}) }, wiring.listBriefAssetHashes, wiring.loadBriefPool);
  const revision = prepared.deck ? { ...prepared, deck: { ...prepared.deck, emphasis: dneskaiEmphasisFor(edit.scheduledAt) } } : prepared;
  // A redraw never reuses the old pixels: that is the point of it.
  let reuse = edit.fresh ? null : reusableDneskaiRender(head.revision, head.render_report, revision);
  if (reuse) { try { reuse = { ...reuse, assets: await refreshMarketingAssetUrls(db, owner, reuse.assets) }; } catch { reuse = null; } }
  const saved = await saveRevision(db, owner, revision, { replacesId: head.id, slides: [] });
  const rendered = await renderAndAttachDneskaiRevision(db, owner, { revisionId: saved.id, revision }, { render: wiring.render, loadMedia: wiring.loadMedia, signal, reuse });
  return { id: saved.id, rendered: !rendered.reused, ready: rendered.ready };
}

/**
 * The story of an approved Instagram post (owner decision, 7 November 2026): its cover slide in a 1080 x 1920 frame,
 * stored once per cover in the slide store, ten minutes after the post. The cover's bytes must match its sha256.
 */
async function saveStory(db: Database, owner: string, post: ContentRevision, loadMedia: Wiring['loadMedia'], signal: AbortSignal) {
  const cover = post.assets[0];
  if (!cover || cover.mimeType !== 'image/jpeg') throw new Error('story-cover-missing');
  const storage = createDneskaiSlideStorage(db, owner, { signal });
  // A native 1080x1920 story re-lays the cover's photo and headline for 9:16, full-bleed, no bars (owner rule, 8 Nov
  // 2026). It needs the deck (the cover slide's photo and words); an older post that carries only rendered assets
  // falls back to the padded cover under the original key.
  const coverSlide = post.deck?.slides[0];
  const native = !!post.deck && !!coverSlide && coverSlide.images.length > 0;
  const renderKey = storyRenderKey(cover.sha256, native ? 'dneskai-story/3' : 'marketing-story/1');
  let stored = await storage.find(renderKey);
  if (!stored && native) {
    const story = await renderDneskaiStoryJpeg(coverSlide!, loadMedia, dneskaiKitOf(post.deck!), post.deck!.emphasis, signal);
    stored = await storage.put({ renderKey, bytes: story.jpeg, sha256: story.sha256, metadata: { kind: 'dneskai-story', coverSha256: cover.sha256 } });
  }
  if (!stored) {
    const response = await fetch(cover.url, { signal, redirect: 'error' }).catch(() => null);
    if (!response?.ok) throw new Error('story-cover-unavailable');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== cover.sha256) throw new Error('story-cover-changed');
    const story = await composeStoryFromCover(bytes);
    stored = await storage.put({ renderKey, bytes: story.jpeg, sha256: story.sha256, metadata: { kind: 'dneskai-story', coverSha256: cover.sha256 } });
  }
  const revision = parseContentRevision({
    schemaVersion: 'marketing-content/1', brand: post.brand, title: post.title, caption: `Story: ${post.title}`.slice(0, 2200), format: 'story',
    sources: post.sources, knowledgeIds: post.knowledgeIds,
    assets: [{ url: stored.url, sha256: stored.sha256, mimeType: 'image/jpeg', width: STORY_WIDTH, height: STORY_HEIGHT, alt: cover.alt || post.title }],
    account: post.account, scheduledAt: new Date(Date.parse(post.scheduledAt) + DNESKAI_STORY_DELAY_MS).toISOString(), timeZone: post.timeZone,
    templateVersion: post.templateVersion, promptVersion: post.promptVersion, model: post.model, traceId: post.traceId,
  });
  return saveRevision(db, owner, revision, {});
}

async function threadsAccountOf(db: Database, owner: string): Promise<DneskaiThreadsAccount | null> {
  return read(await db.from('marketing_accounts').select('remote_account_id,handle').eq('user_id', owner).eq('brand', 'dneskai').eq('platform', 'threads').not('verified_at', 'is', null).maybeSingle(), 'plan-account-unavailable') as DneskaiThreadsAccount | null;
}

async function approve(db: Database, owner: string, id: string, hash: string) {
  const { error } = await db.rpc('marketing_dneskai_plan_approve', { p_owner: owner, p_revision_id: id, p_expected_hash: hash });
  if (error) throw new Error(`plan-approval-${(error.message ?? 'failed').replace(/[^a-z]+/gi, '-').toLowerCase().replace(/^-|-$/g, '').slice(0, 60) || 'failed'}`);
}

/**
 * The night's news topics into the plan (owner decision, 7 November 2026: the plan approves news itself). Proposed
 * news topics for today or later take the free news times of their day, best brief rank first; the topic is approved
 * for the owner and the topic bridge briefs it for exactly that slot.
 */
async function placeNews(db: Database, owner: string, project: string, now: Date): Promise<number> {
  const today = pragueMarketingDate(now);
  const topics = read(await db.from('marketing_dneskai_topics').select('id,brief_id,evidence').eq('user_id', owner).eq('project_id', project).eq('kind', 'news').eq('status', 'proposed')
    .gte('evidence->>targetDate', today).not('brief_id', 'is', null).order('created_at', { ascending: false }).limit(24), 'plan-news-unavailable') as Array<{ id: string; brief_id: string; evidence: Record<string, unknown> | null }>;
  if (!topics.length) return 0;
  const briefs = read(await db.from('marketing_dneskai_briefs').select('id,rank,target_date').eq('user_id', owner).in('id', topics.map((topic) => topic.brief_id)).limit(24), 'plan-news-unavailable') as Array<{ id: string; rank: number; target_date: string }>;
  const candidates = topics.flatMap((topic) => { const brief = briefs.find((item) => item.id === topic.brief_id); return brief ? [{ id: topic.id, date: brief.target_date, rank: brief.rank }] : []; });
  const dates = [...new Set(candidates.map((topic) => topic.date))];
  const taken = read(await db.from('marketing_dneskai_plan').select('date,local_time').eq('user_id', owner).eq('project_id', project).in('date', dates).limit(100), 'plan-unavailable') as Array<{ date: string; local_time: string }>;
  let placed = 0;
  for (const slot of dneskaiNewsPlacement(candidates, taken, now)) {
    const inserted = await db.from('marketing_dneskai_plan').insert({ user_id: owner, project_id: project, date: slot.date, local_time: slot.time, instagram: slot.instagram, threads: true, kind: 'news', topic_id: slot.topicId }).select('id');
    if (inserted.error) continue;
    const topic = topics.find((item) => item.id === slot.topicId)!;
    const { error } = await db.from('marketing_dneskai_topics').update({ status: 'approved', approved_at: now.toISOString(), updated_at: now.toISOString(),
      evidence: { ...(topic.evidence ?? {}), planDate: slot.date, planTime: slot.time, approvedBy: 'dneskai-plan' } }).eq('user_id', owner).eq('id', slot.topicId).eq('status', 'proposed');
    if (error) throw new Error('plan-topic-write-failed');
    placed++;
  }
  return placed;
}

/**
 * Each series slot's heading, "Slovník AI #3" (owner decision, 8 November 2026): the running number counts the
 * series' published posts first, then the ones still to come in slot order; a skipped or failed one is not counted.
 */
async function seriesHeadings(db: Database, owner: string, project: string): Promise<Map<string, string>> {
  const rows = read(await db.from('marketing_dneskai_plan').select('id,date,local_time,status,topic_id').eq('user_id', owner).eq('project_id', project).eq('kind', 'education')
    .gte('date', DNESKAI_SERIES_START).not('topic_id', 'is', null).order('date').limit(1000), 'plan-unavailable') as Array<{ id: string; date: string; local_time: string; status: string; topic_id: string }>;
  if (!rows.length) return new Map();
  const topics = read(await db.from('marketing_dneskai_topics').select('id,evidence').eq('user_id', owner).in('id', rows.map((row) => row.topic_id)).not('evidence->>series', 'is', null).limit(1000), 'plan-topics-unavailable') as Array<{ id: string; evidence: Record<string, unknown> | null }>;
  const seriesOf = new Map(topics.flatMap((topic) => { const series = dneskaiSeriesOf(topic.evidence); return series ? [[topic.id, series] as const] : []; }));
  const slots = rows.flatMap((row) => { const series = seriesOf.get(row.topic_id); return series ? [{ ...row, series }] : []; });
  const numbers = dneskaiSeriesNumbers(slots);
  const series = new Map<string, DneskaiSeries>(slots.map((slot) => [slot.id, slot.series]));
  return new Map([...numbers].map(([id, number]) => [id, dneskaiSeriesHeading(series.get(id)!, number)]));
}

/** Saves the post with its series heading on the cover and the first caption line, and draws it; unchanged slides keep their JPEGs. */
async function saveSeriesHeading(db: Database, owner: string, head: DneskaiPlanHead, heading: string, wiring: Wiring, signal: AbortSignal) {
  const deck = head.revision.deck!;
  const revision = parseContentRevision({ ...head.revision, caption: dneskaiSeriesCaption(head.revision.caption, heading), deck: dneskaiSeriesDeck(deck, heading), assets: [] });
  const saved = await saveRevision(db, owner, revision, { replacesId: head.id, slides: [] });
  const rendered = await renderAndAttachDneskaiRevision(db, owner, { revisionId: saved.id, revision }, { render: wiring.render, loadMedia: wiring.loadMedia, signal });
  return { id: saved.id, ready: rendered.ready };
}

const pragueHourOf = (now: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', hour: '2-digit', hourCycle: 'h23' }).format(now));

export async function advanceDneskaiPlan(db: Database, owner: string, project: string, input: { now: Date; signal: AbortSignal; remainingMs: () => number; news?: boolean; env?: Record<string, string | undefined> }): Promise<DneskaiPlanResult> {
  z.uuid().parse(owner); z.uuid().parse(project);
  const result: DneskaiPlanResult = { filled: 0, worked: 0, rendered: 0, approved: 0, twins: 0, codes: {} };
  const today = pragueMarketingDate(input.now);
  if (input.news) result.news = await placeNews(db, owner, project, input.now);
  result.filled = await fillPlan(db, owner, project, today, { news: !!input.news, now: input.now });
  const slots = read(await db.from('marketing_dneskai_plan').select(SLOT_COLUMNS).eq('user_id', owner).eq('project_id', project).gte('date', today)
    .lte('date', pragueDayAfter(today, DNESKAI_PLAN_HORIZON_DAYS)).not('status', 'in', '(published,skipped)').order('date').order('local_time').limit(20), 'plan-unavailable') as DneskaiPlanRow[];
  const account = await threadsAccountOf(db, owner);
  const headings = await seriesHeadings(db, owner, project);
  let wiring: Wiring | null = null;
  // The closing slide's switch, read once a pass; off when the row is missing or unreadable.
  let closing: Promise<boolean> | null = null;
  const closingEnabled = () => (closing ??= Promise.resolve(db.from('marketing_dneskai_closing').select('enabled').eq('user_id', owner).maybeSingle()).then((row) => !row.error && row.data?.enabled === true, () => false));
  const wired = () => (wiring ??= { render: getRenderDneskaiDeck(db), loadMedia: getDneskaiMediaLoader(db, owner), listBriefAssetHashes: getBriefAssetHashLister(db, owner), loadBriefPool: getBriefPoolLoader(db, owner) });
  const record = async (slot: DneskaiPlanRow, patch: Partial<DneskaiPlanRow>) => {
    const changed = Object.entries(patch).some(([key, value]) => slot[key as keyof DneskaiPlanRow] !== value);
    if (!changed) return;
    const { error } = await db.from('marketing_dneskai_plan').update(patch).eq('user_id', owner).eq('id', slot.id);
    if (error) throw new Error('plan-write-failed');
  };
  for (const slot of slots) {
    if (input.remainingMs() < 8_000 || input.signal.aborted) break;
    try {
      // Up to four steps per slot in one pass (move, approve, twin, approve twin); a render ends the slot's pass.
      for (let pass = 0; pass < 4; pass++) {
        if (input.remainingMs() < 8_000) break;
        const head = await resolveHead(db, owner, slot);
        // Restyle (owner request, 8 November 2026): regenerate the post for this slot, then wait for the new version.
        if (slot.code === DNESKAI_RESTYLE_REQUESTED && head) {
          if (result.rendered >= 1 || input.remainingMs() < RENDER_MINIMUM_MS) break;
          const restyled = await restyleDneskaiPost(db, owner, { slot: { date: slot.date, local_time: slot.local_time, scheduledAt: dneskaiPlanSlotAt(slot) }, head, env: input.env ?? process.env, signal: input.signal });
          result.rendered++;
          // The slot keeps the version the restyle started from: the job key is derived from it (`dneskaiRestyleJobKey`).
          const patch: Partial<DneskaiPlanRow> = { head_revision_id: head.id, written_revision_id: null, status: 'generating', code: restyled.code };
          await record(slot, patch); Object.assign(slot, patch);
          result.codes[restyled.code] = (result.codes[restyled.code] ?? 0) + 1;
          break;
        }
        if (slot.code === DNESKAI_RESTYLE_QUEUED && head && (head.status === 'returned' || head.status === 'published')) {
          // The restyle job of this version: a failure is shown on the slot; a published post's new version is a new post the slot takes over.
          // The latest attempt that exists is the one this slot waits for.
          let key = dneskaiRestyleJobKey(owner, head.id, head.content_hash, dneskaiPlanSlotAt(slot));
          let job: { status: string } | null = null;
          for (let attempt = 0; attempt < DNESKAI_RESTYLE_ATTEMPTS; attempt++) {
            const candidate = dneskaiRestyleJobKey(owner, head.id, head.content_hash, dneskaiPlanSlotAt(slot), attempt);
            const found = read(await db.from('marketing_jobs').select('status').eq('user_id', owner).eq('idempotency_key', candidate).maybeSingle(), 'plan-job-unavailable') as { status: string } | null;
            if (!found) break;
            key = candidate; job = found;
          }
          if (job?.status === 'failed') { const patch = { status: 'failed' as const, code: DNESKAI_RESTYLE_FAILED }; await record(slot, patch); Object.assign(slot, patch); break; }
          if (head.status === 'published' && job?.status === 'review' && await revisionRow(db, owner, key)) {
            const patch: Partial<DneskaiPlanRow> = { head_revision_id: key, written_revision_id: null, threads_revision_id: null, threads_base_revision_id: null, story_revision_id: null, story_base_revision_id: null, status: 'ready', code: null };
            await record(slot, patch); Object.assign(slot, patch);
            continue;
          }
          await record(slot, { status: 'generating' }); break;
        }
        // Fitting photographs on every slide (owner request, 9 November 2026): once per post version, behind
        // DNESKAI_ILLUSTRATE_ENABLED, a ready Instagram post whose slot is ahead is checked and its photo-less or
        // off-topic slides take library pictures; the new version is drawn at once and approved on the next pass.
        const env = input.env ?? process.env;
        // A version the render refused for a too-small picture is checked again, so the picture is replaced.
        const lowResolution = !!head && head.status === 'review' && !head.ready && renderRefusedForResolution(head.render_report);
        if (head && env.DNESKAI_ILLUSTRATE_ENABLED === 'true' && (head.status === 'review' || head.status === 'approved') && (head.ready || lowResolution) && head.revision.deck
          && head.revision.account.platform === 'instagram' && Date.parse(dneskaiPlanSlotAt(slot)) > input.now.getTime() + 10 * 60_000 && (lowResolution || !(await illustrationChecked(db, head.id)))) {
          if (result.rendered >= 1 || input.remainingMs() < RENDER_MINIMUM_MS + 15_000) { await record(slot, { code: 'plan-render-waiting' }); break; }
          let code = 'illustrate-error';
          try {
            const outcome = await illustrateDneskaiPost(db, owner, { revision: head.revision, revisionKey: head.id, loadMedia: wired().loadMedia, env, signal: input.signal });
            code = outcome.code;
            if (outcome.deck) {
              const revision = parseContentRevision({ ...head.revision, deck: outcome.deck, assets: [] });
              const saved = await saveRevision(db, owner, revision, { replacesId: head.id, slides: [] });
              await markIllustrationChecked(db, saved.id, 'illustrate-result');
              const rendered = await renderAndAttachDneskaiRevision(db, owner, { revisionId: saved.id, revision }, { render: wired().render, loadMedia: wired().loadMedia, signal: input.signal });
              result.rendered++;
              const patch: Partial<DneskaiPlanRow> = { head_revision_id: saved.id, written_revision_id: saved.id, status: rendered.ready ? 'ready' : 'failed', code: rendered.ready ? null : 'render-blocked' };
              await markIllustrationChecked(db, head.id, code);
              await record(slot, patch); Object.assign(slot, patch);
              result.codes[code] = (result.codes[code] ?? 0) + 1;
              break;
            }
          } catch { code = 'illustrate-error'; }
          await markIllustrationChecked(db, head.id, code);
          result.codes[code] = (result.codes[code] ?? 0) + 1;
          continue;
        }
        // The closing slide follows its switch in the Design Lab (owner, 9 November 2026; off until the owner turns it
        // on): a planned carousel gets it or loses it while its slot is ahead, drawn again at once.
        if (head && (head.status === 'review' || head.status === 'approved') && head.ready && head.revision.deck?.format === 'carousel'
          && head.revision.account.platform === 'instagram' && Date.parse(dneskaiPlanSlotAt(slot)) > input.now.getTime() + 10 * 60_000) {
          const closingOn = await closingEnabled();
          const slides = head.revision.deck.slides;
          const has = slides.some((item) => isDneskaiClosingSlide(item));
          const next = closingOn ? [...slides, dneskaiClosingSlide()] : slides.filter((item) => !isDneskaiClosingSlide(item));
          if (has !== closingOn && next.length >= 2 && next.length <= 10) {
            if (result.rendered >= 1 || input.remainingMs() < RENDER_MINIMUM_MS) { await record(slot, { code: 'plan-render-waiting' }); break; }
            const revision = parseContentRevision({ ...head.revision, deck: { ...head.revision.deck, slides: next }, assets: [] });
            const saved = await saveRevision(db, owner, revision, { replacesId: head.id, slides: [] });
            const rendered = await renderAndAttachDneskaiRevision(db, owner, { revisionId: saved.id, revision }, { render: wired().render, loadMedia: wired().loadMedia, signal: input.signal });
            result.rendered++;
            const ownerEdit = !!slot.written_revision_id && head.id !== slot.written_revision_id;
            const patch: Partial<DneskaiPlanRow> = { head_revision_id: saved.id, written_revision_id: ownerEdit ? slot.written_revision_id : saved.id, status: rendered.ready ? 'ready' : 'failed', code: rendered.ready ? null : 'render-blocked' };
            await record(slot, patch); Object.assign(slot, patch);
            const code = closingOn ? 'plan-closing-added' : 'plan-closing-removed';
            result.codes[code] = (result.codes[code] ?? 0) + 1;
            break;
          }
        }
        const twin = slot.threads_revision_id ? await revisionRow(db, owner, slot.threads_revision_id) : null;
        const story = slot.story_revision_id ? await revisionRow(db, owner, slot.story_revision_id) : null;
        const action = !head && slot.topic_id && await topicLacksPhoto(db, owner, slot.topic_id) ? { kind: 'drop' as const, status: 'skipped' as const, code: 'plan-photo-missing' as const } : dneskaiPlanAction(slot, head, twin, !!account, input.now, story, headings.get(slot.id) ?? null);
        if (action.kind === 'restyle') {
          const patch: Partial<DneskaiPlanRow> = { status: 'planned', code: DNESKAI_RESTYLE_REQUESTED };
          await record(slot, patch); Object.assign(slot, patch);
          result.codes['plan-photos-restyle'] = (result.codes['plan-photos-restyle'] ?? 0) + 1;
          break;
        }
        if (action.kind === 'drop') {
          for (const id of [head?.id, slot.threads_revision_id, slot.story_revision_id]) if (id) await db.rpc('marketing_dneskai_plan_retire', { p_owner: owner, p_revision_id: id });
          // The freed time is filled with another post on the next pass.
          const { error } = await db.from('marketing_dneskai_plan').delete().eq('user_id', owner).eq('id', slot.id);
          if (error) throw new Error('plan-write-failed');
          result.codes[action.code] = (result.codes[action.code] ?? 0) + 1;
          break;
        }
        const base: Partial<DneskaiPlanRow> = { head_revision_id: head?.id ?? slot.head_revision_id, status: action.status, code: action.kind === 'wait' ? action.code : null };
        if (action.kind === 'wait') { await record(slot, base); Object.assign(slot, base); break; }
        result.worked++;
        const current = head!;
        // The approval function only takes a revision the plan names, so the slot records its head before any step.
        if (slot.head_revision_id !== current.id) { await record(slot, { head_revision_id: current.id }); slot.head_revision_id = current.id; }
        if (action.kind === 'rerender') {
          if (result.rendered >= 1 || input.remainingMs() < RENDER_MINIMUM_MS) { await record(slot, { ...base, code: 'plan-render-waiting' }); break; }
          const wiring = wired();
          const rendered = await renderAndAttachDneskaiRevision(db, owner, { revisionId: current.id, revision: current.revision }, { render: wiring.render, loadMedia: wiring.loadMedia, signal: input.signal });
          result.rendered++;
          const patch = { ...base, status: rendered.ready ? 'ready' as const : 'failed' as const, code: rendered.ready ? null : 'render-blocked' };
          await record(slot, patch); Object.assign(slot, patch);
          break;
        }
        if (action.kind === 'series') {
          if (result.rendered >= 1 || input.remainingMs() < RENDER_MINIMUM_MS) { await record(slot, { ...base, code: 'plan-render-waiting' }); break; }
          const saved = await saveSeriesHeading(db, owner, current, headings.get(slot.id)!, wired(), input.signal);
          result.rendered++;
          const patch = { ...base, head_revision_id: saved.id, written_revision_id: saved.id, status: saved.ready ? 'ready' as const : 'failed' as const, code: saved.ready ? null : 'render-blocked' };
          await record(slot, patch); Object.assign(slot, patch);
          break;
        }
        if (action.kind === 'retag') {
          // Only the caption changes: the slides are reused, and the next pass approves the post again.
          const saved = await saveEdit(db, owner, current, { kit: false, scheduledAt: dneskaiPlanSlotAt(slot), caption: dneskaiRetagCaption(current.revision.caption) }, wired(), input.signal);
          if (saved.rendered) result.rendered++;
          const patch = { ...base, head_revision_id: saved.id, written_revision_id: saved.id, status: saved.ready ? 'ready' as const : 'failed' as const, code: saved.ready ? null : 'render-blocked' };
          await record(slot, patch); Object.assign(slot, patch);
          if (saved.rendered) break;
          continue;
        }
        if (action.kind === 'spotlight' || action.kind === 'move' || action.kind === 'redraw') {
          if (action.kind !== 'move' && (result.rendered >= 1 || input.remainingMs() < RENDER_MINIMUM_MS)) { await record(slot, { ...base, code: 'plan-render-waiting' }); break; }
          await keepNewsCurrent(db, owner, slot, current.revision, input.signal);
          const saved = await saveEdit(db, owner, current, { kit: action.kind === 'spotlight', scheduledAt: dneskaiPlanSlotAt(slot), fresh: action.kind === 'redraw' }, wired(), input.signal);
          if (saved.rendered) result.rendered++;
          const patch = { ...base, head_revision_id: saved.id, written_revision_id: saved.id, status: saved.ready ? 'ready' as const : 'failed' as const, code: saved.ready ? null : 'render-blocked' };
          await record(slot, patch); Object.assign(slot, patch);
          if (saved.rendered) break;
          continue;
        }
        if (action.kind === 'to-threads') {
          await keepNewsCurrent(db, owner, slot, current.revision, input.signal);
          const twinRevision = dneskaiThreadsTwin(current.revision, account!, dneskaiPlanSlotAt(slot));
          const saved = await saveRevision(db, owner, { ...twinRevision, assets: await refreshMarketingAssetUrls(db, owner, twinRevision.assets) }, { replacesId: current.id, slides: [] });
          const patch = { ...base, head_revision_id: saved.id, written_revision_id: saved.id, status: saved.ready ? 'ready' as const : 'failed' as const, code: saved.ready ? null : 'threads-twin-not-ready' };
          await record(slot, patch); Object.assign(slot, patch);
          continue;
        }
        if (action.kind === 'approve') {
          await keepNewsCurrent(db, owner, slot, current.revision, input.signal);
          await approve(db, owner, current.id, current.content_hash);
          result.approved++;
          const patch = { ...base, written_revision_id: slot.written_revision_id ?? current.id };
          await record(slot, patch); Object.assign(slot, patch);
          continue;
        }
        if (action.kind === 'twin') {
          if (slot.threads_revision_id) await db.rpc('marketing_dneskai_plan_retire', { p_owner: owner, p_revision_id: slot.threads_revision_id });
          const twinRevision = dneskaiThreadsTwin(current.revision, account!);
          const saved = await saveRevision(db, owner, { ...twinRevision, assets: await refreshMarketingAssetUrls(db, owner, twinRevision.assets) }, {});
          result.twins++;
          const patch = { ...base, threads_revision_id: saved.id, threads_base_revision_id: current.id };
          await record(slot, patch); Object.assign(slot, patch);
          continue;
        }
        if (action.kind === 'story') {
          if (slot.story_revision_id) await db.rpc('marketing_dneskai_plan_retire', { p_owner: owner, p_revision_id: slot.story_revision_id });
          const saved = await saveStory(db, owner, current.revision, wired().loadMedia, input.signal);
          const patch = { ...base, story_revision_id: saved.id, story_base_revision_id: current.id };
          await record(slot, patch); Object.assign(slot, patch);
          continue;
        }
        if (action.kind === 'approve-story') {
          await approve(db, owner, story!.id, story!.content_hash);
          result.approved++;
          await record(slot, base); Object.assign(slot, base);
          continue;
        }
        // approve-twin
        await approve(db, owner, twin!.id, twin!.content_hash);
        result.approved++;
        await record(slot, base); Object.assign(slot, base);
      }
    } catch (error) {
      const code = error instanceof Error && /^[a-z][a-z0-9-]{1,99}$/.test(error.message) ? error.message : 'plan-step-failed';
      result.codes[code] = (result.codes[code] ?? 0) + 1;
      await record(slot, { code }).catch(() => undefined);
    }
  }
  return result;
}
