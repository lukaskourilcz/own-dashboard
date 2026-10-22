import { z } from 'zod';
import { DneskaiRenderReportSchema, type DneskaiRenderReport } from './contracts';
import { DneskaiBriefMediaSchema } from './dneskai-brief';
import { DneskaiDeckSchema } from './dneskai-slides';
import { pragueScheduledAt } from './clock';
import { pragueMarketingDate } from './weekly-planning';

/**
 * The owner's read model of the DNESKAi workspace (#119): posts to review, the seven-day calendar and the published
 * receipts, served by GET /api/marketing/dneskai/review and rendered in the DNESKAi project's tabs. Browser-safe: the
 * server builds it (dneskai-workspace-read.ts) and the client validates it with these schemas before rendering.
 *
 * A post is one marketing revision: its exact deck, the rendered JPEGs behind signed links, the render report, the
 * brief it was drafted from (with the topic's media pool) and its publication. A job that is still drafting a topic
 * has no revision yet; it appears as a preparing slot.
 */
export const DNESKAI_WORKSPACE_VERSION = 'dneskai-workspace/1';

const uuid = z.uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.iso.datetime({ offset: true });
const code = z.string().regex(/^[a-z][a-z0-9_-]{0,99}$/);
/** A signed https link from the private bucket, or a same-origin path in the deterministic preview. */
const imageUrl = z.string().max(4096).refine((value) => value.startsWith('https://') || /^\/[A-Za-z0-9/_.-]+$/.test(value), 'image url');
const httpsUrl = z.url({ protocol: /^https$/ }).max(2048);

export const DNESKAI_EDITABLE_TEXT_FIELDS = ['headline', 'body', 'kicker', 'credit'] as const;
export type DneskaiEditableTextField = (typeof DNESKAI_EDITABLE_TEXT_FIELDS)[number];
/** One written field a slide draws, and the most characters its template layer holds. */
export const DneskaiFieldLimitSchema = z.strictObject({ field: z.enum(DNESKAI_EDITABLE_TEXT_FIELDS), max: z.number().int().positive().max(700) });
export type DneskaiFieldLimit = z.infer<typeof DneskaiFieldLimitSchema>;

export const DNESKAI_REVISION_STATUSES = ['review', 'approved', 'publishing', 'published', 'failed', 'reconciliation', 'returned', 'skipped', 'superseded'] as const;
export const DNESKAI_PUBLICATION_STATUSES = ['queued', 'claimed', 'published', 'failed', 'reconciliation', 'cancelled'] as const;

export const DneskaiWorkspacePostSchema = z.strictObject({
  id: uuid,
  replacesId: uuid.nullable(),
  status: z.enum(DNESKAI_REVISION_STATUSES),
  ready: z.boolean(),
  contentHash: sha256,
  createdAt: timestamp,
  approvedAt: timestamp.nullable(),
  feedback: z.string().max(2000).nullable(),
  title: z.string().min(1).max(300),
  caption: z.string().min(1).max(2200),
  format: z.enum(['carousel', 'post', 'reel', 'thread', 'story']),
  scheduledAt: timestamp,
  account: z.strictObject({ id: z.string().min(1).max(200), handle: z.string().min(1).max(100), platform: z.enum(['instagram', 'threads']) }),
  templateVersion: z.string().min(1).max(200),
  traceId: uuid.nullable(),
  deck: DneskaiDeckSchema.nullable(),
  /** Per deck slide, the written fields its template draws and their limits. The owner edits only these. */
  fields: z.array(z.array(DneskaiFieldLimitSchema).max(4)).max(10),
  assets: z.array(z.strictObject({ url: imageUrl, sha256, width: z.number().int().positive(), height: z.number().int().positive(), alt: z.string().max(1000) })).max(10),
  renderReport: DneskaiRenderReportSchema.nullable(),
  brief: z.strictObject({
    eventId: z.string().min(1).max(200),
    title: z.string().min(1).max(300),
    targetDate: z.iso.date(),
    evidence: z.array(z.strictObject({ candidateId: z.string().min(1).max(200), sourceId: z.string().min(1).max(200), url: httpsUrl, title: z.string().min(1).max(500) })).max(30),
    media: z.array(DneskaiBriefMediaSchema).max(30),
  }).nullable(),
  publication: z.strictObject({
    id: uuid,
    status: z.enum(DNESKAI_PUBLICATION_STATUSES),
    scheduledAt: timestamp,
    remoteUrl: httpsUrl.nullable(),
    errorCode: code.nullable(),
    lastCheckedAt: timestamp.nullable(),
    publishedAt: timestamp.nullable(),
  }).nullable(),
});
export type DneskaiWorkspacePost = z.infer<typeof DneskaiWorkspacePostSchema>;

/** A drafting job for a topic that has no revision yet. */
export const DneskaiWorkspaceJobSchema = z.strictObject({
  id: uuid,
  status: z.enum(['queued', 'running', 'failed', 'reconciliation']),
  errorCode: code.nullable(),
  createdAt: timestamp,
  title: z.string().max(300),
  scheduledAt: timestamp.nullable(),
});
export type DneskaiWorkspaceJob = z.infer<typeof DneskaiWorkspaceJobSchema>;

/** A built brief waiting for the scheduler to admit it: no job exists, nothing has been spent on it. */
export const DneskaiWorkspaceWaitingSchema = z.strictObject({
  briefId: uuid,
  title: z.string().min(1).max(300),
  scheduledAt: timestamp,
  status: z.enum(['pending', 'ready']),
  code: code.nullable(),
});
export type DneskaiWorkspaceWaiting = z.infer<typeof DneskaiWorkspaceWaitingSchema>;

export const DneskaiWorkspaceReadSchema = z.strictObject({
  schemaVersion: z.literal(DNESKAI_WORKSPACE_VERSION),
  /** Prague date the read was built for; the calendar starts here. */
  today: z.iso.date(),
  generatedAt: timestamp,
  /** The daily Instagram slots in Europe/Prague. */
  slots: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).max(8),
  accounts: z.array(z.strictObject({ id: uuid, remoteId: z.string().min(1).max(200), handle: z.string().min(1).max(100), verified: z.boolean(), enabled: z.boolean() })).max(4),
  posts: z.array(DneskaiWorkspacePostSchema).max(60),
  jobs: z.array(DneskaiWorkspaceJobSchema).max(20),
  /**
   * Topics of today and tomorrow whose brief waits for the scheduler: pending or ready, with no drafting job yet
   * (owner decision 9, „Generate now“). Absent from older responses.
   */
  waiting: z.array(DneskaiWorkspaceWaitingSchema).max(8).optional(),
  /** Which paid owner actions this deployment offers. Absent from older responses: neither. */
  capabilities: z.strictObject({ regenerate: z.boolean(), generateNow: z.boolean() }).optional(),
  /** Stored rows (revisions, accounts) that could not be read; shown as a count, never silently dropped. */
  unreadable: z.number().int().nonnegative(),
});
export type DneskaiWorkspaceRead = z.infer<typeof DneskaiWorkspaceReadSchema>;

/** What the owner sees for a post or slot, always as colour and text together. */
export const DNESKAI_POST_STATES = ['preparing', 'review', 'returned', 'approved', 'scheduled', 'published', 'problem', 'skipped'] as const;
export type DneskaiPostState = (typeof DNESKAI_POST_STATES)[number];
export const DNESKAI_STATE_TONES: Record<DneskaiPostState, 'neutral' | 'information' | 'success' | 'warning' | 'risk'> = {
  preparing: 'neutral', review: 'warning', returned: 'warning', approved: 'information', scheduled: 'information', published: 'success', problem: 'risk', skipped: 'neutral',
};

/** A render that blocks approval: anything but a clean `rendered` report. No report (legacy) is clear. */
export function renderBlocking(report: DneskaiRenderReport | null): boolean {
  return report !== null && (report.status !== 'rendered' || report.problems.some((problem) => problem.blocking));
}

export type DneskaiPostStateDetail = { state: DneskaiPostState; code: string | null; publishing: boolean };

/**
 * How long an edited version may wait for its render before it reads as failed. POST /api/marketing/revisions saves
 * the new version unready, then renders and attaches it within its 60 s limit; nothing renders it later.
 */
export const DNESKAI_RENDER_ATTACH_GRACE_MS = 2 * 60_000;

/**
 * What a post's state depends on besides the post: the instant the read was built (`generatedAt`), and the versions
 * this browser session saw fail to attach (the edit answered 502 render-attach-failed with the saved id).
 */
export type DneskaiStateContext = { now: number; renderFailed?: ReadonlySet<string> };
export const dneskaiStateContext = (read: Pick<DneskaiWorkspaceRead, 'generatedAt'>, renderFailed?: ReadonlySet<string>): DneskaiStateContext =>
  ({ now: Date.parse(read.generatedAt), renderFailed });

type StatePost = Pick<DneskaiWorkspacePost, 'id' | 'status' | 'ready' | 'renderReport' | 'publication' | 'deck' | 'assets' | 'createdAt'>;
/**
 * An edited deck version whose render never attached: unready, with no render report and no slides, and either known
 * to have failed or older than the grace period. The attach call failed or the route ran out of time after saving it.
 */
export function dneskaiRenderAttachFailed(post: StatePost, context: DneskaiStateContext): boolean {
  if (post.status !== 'review' || post.ready || !post.deck || post.renderReport !== null || post.assets.length > 0) return false;
  return !!context.renderFailed?.has(post.id) || context.now - Date.parse(post.createdAt) >= DNESKAI_RENDER_ATTACH_GRACE_MS;
}

/** Whether a post's slides failed to render: a refused or failed stored render report, or a render that never attached. */
export const dneskaiRenderFailed = (post: StatePost, context: DneskaiStateContext) => renderBlocking(post.renderReport) || dneskaiRenderAttachFailed(post, context);

/**
 * The state of one post, from its revision, render and publication. A deck still waiting for its render is
 * preparing until the grace period ends; a render that never attached, a refused or failed render, a failed job and
 * an uncertain publication are a problem with a code.
 */
export function dneskaiPostState(post: StatePost, context: DneskaiStateContext): DneskaiPostStateDetail {
  const publication = post.publication;
  const problemCode = publication?.errorCode ?? null;
  if (post.status === 'published' || publication?.status === 'published') return { state: 'published', code: null, publishing: false };
  if (post.status === 'failed' || post.status === 'reconciliation' || publication?.status === 'failed' || publication?.status === 'reconciliation') {
    return { state: 'problem', code: problemCode ?? (post.status === 'reconciliation' || publication?.status === 'reconciliation' ? 'read-only-reconciliation' : 'publishing-failed'), publishing: false };
  }
  if (post.status === 'publishing' || publication?.status === 'claimed') return { state: 'scheduled', code: null, publishing: true };
  if (post.status === 'approved') return publication?.status === 'queued' ? { state: 'scheduled', code: null, publishing: false } : { state: 'approved', code: null, publishing: false };
  if (post.status === 'skipped' || post.status === 'superseded') return { state: 'skipped', code: null, publishing: false };
  if (post.status === 'returned') return { state: 'returned', code: null, publishing: false };
  // In review: a deck without a finished render is still being prepared; a refused render needs an edit.
  if (renderBlocking(post.renderReport)) {
    const blocking = post.renderReport!.problems.find((problem) => problem.blocking);
    return { state: 'problem', code: blocking?.code ?? (post.renderReport!.status === 'failed' ? 'render-unavailable' : 'render-refused'), publishing: false };
  }
  if (dneskaiRenderAttachFailed(post, context)) return { state: 'problem', code: 'render-attach-failed', publishing: false };
  if (!post.ready) return { state: post.deck ? 'preparing' : 'problem', code: post.deck ? null : 'revision-not-ready', publishing: false };
  return { state: 'review', code: null, publishing: false };
}

/** A drafting job in the same vocabulary. */
export function dneskaiJobState(job: Pick<DneskaiWorkspaceJob, 'status' | 'errorCode'>): DneskaiPostStateDetail {
  if (job.status === 'queued' || job.status === 'running') return { state: 'preparing', code: null, publishing: false };
  return { state: 'problem', code: job.errorCode ?? (job.status === 'reconciliation' ? 'worker-lease-expired' : 'generation-failed'), publishing: false };
}

/** Whether a post in the read still waits for its render; the review reads again until each attaches or reads as failed. */
export function dneskaiAwaitingRender(read: Pick<DneskaiWorkspaceRead, 'posts' | 'generatedAt'>): boolean {
  const context = dneskaiStateContext(read);
  return read.posts.some((post) => dneskaiPostState(post, context).state === 'preparing');
}

/** Whether the owner can act on a post in Today for review: everything not yet decided. */
export function dneskaiNeedsReview(post: DneskaiWorkspacePost): boolean {
  return post.status === 'review' || post.status === 'returned';
}

/** Prague date of an instant. */
export const pragueDate = (iso: string) => pragueMarketingDate(new Date(iso));
/** The Prague calendar day `offset` days after `date` (noon arithmetic, so DST never moves a day). */
export function pragueDayAfter(date: string, offset: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

/** Whether the Prague day is 23 or 25 hours long: the clocks change that night (for example 2026-10-25). */
export function pragueDstDay(date: string): boolean {
  return Date.parse(pragueScheduledAt(pragueDayAfter(date, 1), '00:00')) - Date.parse(pragueScheduledAt(date, '00:00')) !== 86_400_000;
}

export type DneskaiCalendarEntry =
  | { kind: 'post'; at: string; time: string; post: DneskaiWorkspacePost; state: DneskaiPostStateDetail }
  | { kind: 'job'; at: string; time: string; job: DneskaiWorkspaceJob; state: DneskaiPostStateDetail }
  | { kind: 'free'; at: string; time: string };
export type DneskaiCalendarDay = { date: string; entries: DneskaiCalendarEntry[] };

const pragueTime = (iso: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

/**
 * Seven Prague days from `today`, each with its standard slots and every post or drafting job planned that day, in
 * time order. A slot holds the post scheduled at it; posts at other times (an owner-edited time) keep their own row.
 * Superseded revisions never appear; a skipped one frees its slot.
 */
export function dneskaiCalendarDays(input: { today: string; generatedAt: string; slots: readonly string[]; posts: readonly DneskaiWorkspacePost[]; jobs: readonly DneskaiWorkspaceJob[] }, renderFailed?: ReadonlySet<string>): DneskaiCalendarDay[] {
  const days = Array.from({ length: 7 }, (_, index) => pragueDayAfter(input.today, index));
  const context = dneskaiStateContext(input, renderFailed);
  const visible = input.posts.filter((post) => post.status !== 'superseded' && post.status !== 'skipped');
  return days.map((date) => {
    const entries: DneskaiCalendarEntry[] = [];
    for (const post of visible) {
      const at = post.publication?.scheduledAt ?? post.scheduledAt;
      if (pragueDate(at) === date) entries.push({ kind: 'post', at, time: pragueTime(at), post, state: dneskaiPostState(post, context) });
    }
    for (const job of input.jobs) {
      if (job.scheduledAt && pragueDate(job.scheduledAt) === date && !entries.some((entry) => entry.at === job.scheduledAt)) {
        entries.push({ kind: 'job', at: job.scheduledAt, time: pragueTime(job.scheduledAt), job, state: dneskaiJobState(job) });
      }
    }
    for (const slot of input.slots) {
      let at: string;
      try { at = pragueScheduledAt(date, slot); } catch { continue; }
      if (!entries.some((entry) => entry.at === at)) entries.push({ kind: 'free', at, time: slot });
    }
    return { date, entries: entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)) };
  });
}

/** Today for review: undecided posts first by time, then drafting jobs for today and the next days. */
export function dneskaiReviewQueue(read: Pick<DneskaiWorkspaceRead, 'posts' | 'jobs' | 'today'> & { generatedAt?: string }): { posts: DneskaiWorkspacePost[]; jobs: DneskaiWorkspaceJob[] } {
  // A post whose time passed before the read follows the ones that can still be approved (owner decision 6: it is moved).
  const now = read.generatedAt ? Date.parse(read.generatedAt) : Number.NEGATIVE_INFINITY;
  const passed = (post: DneskaiWorkspacePost) => Number(Date.parse(post.scheduledAt) <= now);
  const posts = read.posts.filter(dneskaiNeedsReview).sort((a, b) => passed(a) - passed(b) || Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
  const jobs = read.jobs.filter((job) => !job.scheduledAt || pragueDate(job.scheduledAt) >= read.today)
    .sort((a, b) => Date.parse(a.scheduledAt ?? a.createdAt) - Date.parse(b.scheduledAt ?? b.createdAt));
  return { posts, jobs };
}

/** Published receipts, newest first. */
export function dneskaiPublished(read: Pick<DneskaiWorkspaceRead, 'posts'>): DneskaiWorkspacePost[] {
  return read.posts.filter((post) => post.publication?.status === 'published' || post.status === 'published')
    .sort((a, b) => Date.parse(b.publication?.publishedAt ?? b.scheduledAt) - Date.parse(a.publication?.publishedAt ?? a.scheduledAt));
}

/** Errors and costs (#119): runs, held jobs and uncertain publications, scheduler ticks and the generation budget. */
export const DNESKAI_COSTS_VERSION = 'dneskai-costs/1';
const usd = z.number().nonnegative().max(10000);
export const DNESKAI_TICK_STEP_STATUSES = ['done', 'noop', 'skipped', 'busy', 'backoff', 'deferred', 'error'] as const;
export const DneskaiCostsReadSchema = z.strictObject({
  schemaVersion: z.literal(DNESKAI_COSTS_VERSION),
  generatedAt: timestamp,
  generation: z.strictObject({
    /** DNESKAi generation spend of the last 24 hours (`marketing_dneskai_generation_spent`), null when unreadable. */
    spentUsd: usd.nullable(),
    /** MARKETING_DNESKAI_DAILY_GENERATION_USD (default 1.00), null when the server value is malformed. */
    ceilingUsd: usd.nullable(),
    code: code.nullable(),
  }),
  /**
   * The last seven Prague days, newest first (cost-16). `collectionUsd` is the measured cost of finished collection
   * runs (Apify, Jev); `generationUsd` the measured provider usage of drafting jobs that produced a draft (Claude);
   * `generationBookedUsd` what failed drafting jobs recorded, which is the job's reserved maximum when billing was
   * ambiguous, so it may exceed what was billed. `unknown` counts runs and jobs with no figure yet (running,
   * uncertain or unmeasured); they are never added as zero.
   */
  days: z.array(z.strictObject({ date: z.iso.date(), collectionUsd: usd, generationUsd: usd, generationBookedUsd: usd, unknown: z.number().int().nonnegative() })).max(7),
  runs: z.array(z.strictObject({ id: uuid, date: z.iso.date(), targetDate: z.iso.date(), status: z.enum(['running', 'complete', 'partial', 'held', 'failed']), costUsd: usd.nullable(), errorCode: code.nullable(), createdAt: timestamp })).max(14),
  jobs: z.array(z.strictObject({ id: uuid, status: z.enum(['queued', 'running', 'review', 'failed', 'reconciliation']), errorCode: code.nullable(), createdAt: timestamp, costUsd: usd.nullable(), title: z.string().max(300), scheduledAt: timestamp.nullable() })).max(30),
  /**
   * Failed, reconciliation and lease-expired publications. `requeueable` (approval-04) is true only when the server
   * offers the owner's "give up and re-queue" and the row provably published nothing; absent means not offered.
   */
  publications: z.array(z.strictObject({ id: uuid, revisionId: uuid, status: z.enum(DNESKAI_PUBLICATION_STATUSES), errorCode: code.nullable(), scheduledAt: timestamp, lastCheckedAt: timestamp.nullable(), title: z.string().max(300),
    requeueable: z.boolean().optional() })).max(20),
  /** Stored rows (runs, jobs, publications, ticks) that could not be read; shown as a count, never a failed read. */
  unreadable: z.number().int().nonnegative(),
  ticks: z.strictObject({
    total: z.number().int().nonnegative(),
    withErrors: z.number().int().nonnegative(),
    /** Ticks whose generation step was deferred (tick budget, publication yield): a queued draft waited five minutes. */
    generationDeferred: z.number().int().nonnegative(),
    lastStartedAt: timestamp.nullable(),
    recent: z.array(z.strictObject({
      id: uuid, kind: z.enum(['minute', 'daily']), startedAt: timestamp, finishedAt: timestamp.nullable(),
      did: z.array(z.strictObject({ category: z.string().regex(/^[a-z]{1,20}$/), status: z.enum(DNESKAI_TICK_STEP_STATUSES), code: code.nullable() })).max(20),
      errors: z.array(z.strictObject({ category: z.string().regex(/^[a-z]{1,20}$/), code })).max(20),
    })).max(20),
  }),
});
export type DneskaiCostsRead = z.infer<typeof DneskaiCostsReadSchema>;
/** Topics (náměty, #150): the schemas live in dneskai-topics.ts and are part of this read model. */
export * from './dneskai-topics';
