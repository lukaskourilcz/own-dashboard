import 'server-only';
import { awaitWithSignal } from '@/lib/abortable';
import { z } from 'zod';
import type { DneskaiReadDatabase } from './dneskai-read-database.generated';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DneskaiRenderReportSchema, parseContentRevision, type ContentRevision } from './contracts';
import { DneskaiBriefSchema, type DneskaiBrief } from './dneskai-brief';
import { DNESKAI_BRIEF_SLOTS } from './dneskai-briefs';
import { dneskaiSlideFieldLimits } from './dneskai-slide-layout';
import { marketingJobErrorCode } from './job-health';
import { marketingPublicationRequeueable } from './publication-requeue';
import { pragueScheduledAt } from './clock';
import { pragueMarketingDate } from './weekly-planning';
import {
  DneskaiDecisionCursorSchema, type DneskaiDecisionCursor, DNESKAI_COSTS_VERSION, DNESKAI_WORKSPACE_VERSION, DneskaiCostsReadSchema, DneskaiEngagementReceiptSchema, DneskaiWorkspaceJobSchema, DneskaiWorkspacePostSchema,
  DneskaiWorkspaceReadSchema, DneskaiWorkspaceWaitingSchema, pragueDayAfter, type DneskaiCostsRead, type DneskaiWorkspaceJob, type DneskaiWorkspacePost, type DneskaiWorkspaceRead,
} from './dneskai-workspace';
import { DNESKAI_TOPIC_ARCHIVED_STATUSES, DNESKAI_TOPIC_OWNER_CODES, DNESKAI_TOPICS_VERSION, type DneskaiTopicOwnerCode, DneskaiTopicSchema, DneskaiTopicsReadSchema, emptyDneskaiTopicGroups, type DneskaiTopic, type DneskaiTopicsRead } from './dneskai-topics';

/**
 * Server read of the DNESKAi workspace (#119). Every query runs through the owner's session client and filters on
 * `user_id`, so own-only RLS decides what is visible; the one service-role call (the 24-hour generation spend, a
 * function `authenticated` cannot execute) is made by the route for the authenticated owner only. Results are bounded
 * and validated against the browser schemas; a row that does not parse is counted, not shown.
 */
type Database = Pick<SupabaseClient<DneskaiReadDatabase>, 'from' | 'rpc'>;

const POST_LIMIT = 60;
const REVISION_READ_LIMIT = 150;
const DECISION_PAGE_SIZE = 30;
const REVISION_COLUMNS = 'id,replaces_id,status,ready,content_hash,created_at,approved_at,feedback,revision,render_report';

/** The written fields a slide's template draws, with the most characters its layer holds (browser-safe in `dneskai-slide-layout.ts`). */
export { dneskaiSlideFieldLimits };

const iso = (value: unknown): string | null => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const money = (value: unknown): number | null => {
  const amount = typeof value === 'number' ? value : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : Number.NaN;
  return Number.isFinite(amount) && amount >= 0 && amount <= 10000 ? amount : null;
};
const safeCode = (value: unknown): string | null => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,99}$/.test(value) ? value : null;
const rows = <T>(result: { data: T[] | null; error: unknown }, failure: string): T[] => { if (result.error || !Array.isArray(result.data)) throw new Error(failure); return result.data; };

type Tables = DneskaiReadDatabase['public']['Tables'];
type RevisionRow = Pick<Tables['marketing_revisions']['Row'], 'id' | 'replaces_id' | 'status' | 'ready' | 'content_hash' | 'created_at' | 'approved_at' | 'feedback' | 'revision' | 'render_report'>;
type PublicationRow = Pick<Tables['marketing_publications']['Row'], 'id' | 'revision_id' | 'status' | 'scheduled_at' | 'remote_url' | 'error_code' | 'last_checked_at'>;
type BriefRow = Pick<Tables['marketing_dneskai_briefs']['Row'], 'id' | 'event_id' | 'member_hash' | 'brief'>;
type TopicTitleRow = { brief_id: string | null; title_cs: string; job_id: string | null };

/**
 * #211: the Czech working titles the owner approved in Náměty, by brief row id and by job id. A post, a queued job
 * or a waiting brief made from a topic shows this title instead of the source's. Topics that never reached a brief
 * are left out; a read that fails returns no titles, and the cards keep the source title.
 */
export function dneskaiTopicTitles(rows: readonly TopicTitleRow[]): { byBrief: ReadonlyMap<string, string>; byJob: ReadonlyMap<string, string> } {
  const byBrief = new Map<string, string>(), byJob = new Map<string, string>();
  for (const row of rows) {
    const title = typeof row.title_cs === 'string' ? row.title_cs.trim().slice(0, 300) : '';
    if (!title) continue;
    if (typeof row.brief_id === 'string' && !byBrief.has(row.brief_id)) byBrief.set(row.brief_id, title);
    if (typeof row.job_id === 'string' && !byJob.has(row.job_id)) byJob.set(row.job_id, title);
  }
  return { byBrief, byJob };
}

function postView(row: RevisionRow, revision: ContentRevision, brief: DneskaiBrief | null, publication: PublicationRow | null, publishedAt: string | null, topicTitle?: string): DneskaiWorkspacePost {
  const report = DneskaiRenderReportSchema.safeParse(row.render_report);
  return {
    id: row.id, replacesId: row.replaces_id, status: row.status as DneskaiWorkspacePost['status'], ready: row.ready, contentHash: row.content_hash,
    createdAt: iso(row.created_at)!, approvedAt: iso(row.approved_at), feedback: row.feedback ? row.feedback.slice(0, 2000) : null,
    title: topicTitle ?? revision.title, caption: revision.caption, format: revision.format, scheduledAt: new Date(revision.scheduledAt).toISOString(),
    account: { id: revision.account.id, handle: revision.account.handle, platform: revision.account.platform },
    templateVersion: revision.templateVersion, traceId: revision.traceId, deck: revision.deck ?? null,
    ...(revision.audio ? { audio: revision.audio } : {}),
    fields: (revision.deck?.slides ?? []).map(dneskaiSlideFieldLimits),
    assets: revision.assets.map(({ url, sha256, width, height, alt }) => ({ url, sha256, width, height, alt })),
    renderReport: report.success ? report.data : null,
    engagement: revision.engagement ?? null,
    brief: brief ? { eventId: brief.eventId, title: brief.title, targetDate: brief.targetDate,
      evidence: brief.evidence.map(({ candidateId, sourceId, url, title }) => ({ candidateId, sourceId, url, title })), media: brief.media } : null,
    publication: publication ? { id: publication.id, status: publication.status as NonNullable<DneskaiWorkspacePost['publication']>['status'], scheduledAt: iso(publication.scheduled_at)!,
      remoteUrl: publication.remote_url, errorCode: safeCode(publication.error_code), lastCheckedAt: iso(publication.last_checked_at), publishedAt } : null,
  };
}

/** Read 30 undecided revisions per cursor page, then fill the 60-post budget from recent history.
 * Decisions have their own owner/brand/status-filtered SQL read and can never be evicted by newer receipts.
 * Recent calendar/history context remains bounded to the newest 150 other revisions and the existing date window.
 */
export async function readDneskaiWorkspace(db: Database, owner: string, now: Date, today = pragueMarketingDate(now), options: { capabilities?: DneskaiWorkspaceRead['capabilities']; engagement?: boolean; topicTitles?: boolean; decisionsBefore?: DneskaiDecisionCursor; signal?: AbortSignal } = {}): Promise<DneskaiWorkspaceRead> {
  z.uuid().parse(owner); z.iso.date().parse(today);
  const signal = AbortSignal.any([AbortSignal.timeout(15_000), ...(options.signal ? [options.signal] : [])]);
  signal.throwIfAborted();
  const windowStart = Date.parse(pragueScheduledAt(pragueDayAfter(today, -30), '00:00'));
  const windowEnd = Date.parse(pragueScheduledAt(pragueDayAfter(today, 7), '00:00'));
  const cursor = options.decisionsBefore ? DneskaiDecisionCursorSchema.parse(options.decisionsBefore) : null;
  let decisions = db.from('marketing_revisions').select(REVISION_COLUMNS).eq('user_id', owner).eq('brand', 'dneskai')
    .in('status', ['review', 'returned']).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(DECISION_PAGE_SIZE + 1);
  if (cursor) decisions = decisions.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
  const [decisionResult, revisionResult, accountResult, jobResult, waitingResult] = await awaitWithSignal(Promise.all([
    decisions.retry(false).abortSignal(signal),
    db.from('marketing_revisions').select(REVISION_COLUMNS)
      .eq('user_id', owner).eq('brand', 'dneskai').neq('status', 'superseded').not('status', 'in', '(review,returned)').order('created_at', { ascending: false }).limit(REVISION_READ_LIMIT).retry(false).abortSignal(signal),
    db.from('marketing_accounts').select('id,remote_account_id,handle,verified_at,enabled').eq('user_id', owner).eq('brand', 'dneskai').eq('platform', 'instagram').limit(4).retry(false).abortSignal(signal),
    db.from('marketing_jobs').select('id,status,error_code,created_at,title:request->generation->source->content->>title,scheduled_at:request->generation->>scheduledAt,revision_id:request->generation->>revisionId,brand:request->generation->source->>brand')
      .eq('user_id', owner).eq('request->generation->source->>brand', 'dneskai').in('status', ['queued', 'running', 'failed', 'reconciliation']).gte('created_at', new Date(now.getTime() - 3 * 86_400_000).toISOString()).order('created_at', { ascending: false }).limit(60).retry(false).abortSignal(signal),
    // Owner decision 9: built briefs of today and tomorrow that wait for the scheduler, with no job yet.
    db.from('marketing_dneskai_briefs').select('id,status,code,job_id,scheduled_at,title:brief->>title').eq('user_id', owner).in('status', ['pending', 'ready'])
      .in('target_date', [today, pragueDayAfter(today, 1)]).order('scheduled_at').limit(16).retry(false).abortSignal(signal),
  ]), signal);
  signal.throwIfAborted();
  const decisionRows = rows(decisionResult as { data: RevisionRow[] | null; error: unknown }, 'dneskai-workspace-unavailable');
  const page = decisionRows.slice(0, DECISION_PAGE_SIZE);
  const last = page.at(-1);
  const nextCursor = decisionRows.length > DECISION_PAGE_SIZE && last ? DneskaiDecisionCursorSchema.parse({ createdAt: last.created_at, id: last.id }) : null;
  let unreadable = 0;
  const parsed: Array<{ row: RevisionRow; revision: ContentRevision }> = [];
  for (const row of [...page, ...rows(revisionResult as { data: RevisionRow[] | null; error: unknown }, 'dneskai-workspace-unavailable')]) {
    try {
      const revision = parseContentRevision(row.revision);
      if (revision.brand !== 'dneskai') continue;
      const at = Date.parse(revision.scheduledAt);
      const undecided = row.status === 'review' || row.status === 'returned';
      if (undecided || (at >= windowStart && at < windowEnd)) parsed.push({ row, revision });
    } catch { unreadable += 1; }
  }
  // Undecided first, then the coming days, then past receipts: the 60-post bound drops the oldest history first.
  const todayStart = Date.parse(pragueScheduledAt(today, '00:00'));
  const rank = ({ row, revision }: { row: RevisionRow; revision: ContentRevision }) => row.status === 'review' || row.status === 'returned' ? 0 : Date.parse(revision.scheduledAt) >= todayStart ? 1 : 2;
  const selected = [0, 1, 2].flatMap((tier) => parsed.filter((item) => rank(item) === tier)).slice(0, POST_LIMIT);
  const ids = selected.map((item) => item.row.id);
  const eventIds = [...new Set(selected.flatMap((item) => item.revision.sources[0]?.sourceId ?? []).filter((id) => /^[a-f0-9]{64}$/.test(id)))];
  signal.throwIfAborted();
  const [publicationResult, eventResult, briefResult, topicResult] = await awaitWithSignal(Promise.all([
    ids.length ? db.from('marketing_publications').select('id,revision_id,status,scheduled_at,remote_url,error_code,last_checked_at').eq('user_id', owner).in('revision_id', ids).limit(POST_LIMIT * 2).retry(false).abortSignal(signal) : Promise.resolve({ data: [], error: null }),
    ids.length ? db.from('marketing_events').select('revision_id,created_at').eq('user_id', owner).eq('kind', 'published').in('revision_id', ids).limit(POST_LIMIT * 2).retry(false).abortSignal(signal) : Promise.resolve({ data: [], error: null }),
    eventIds.length ? db.from('marketing_dneskai_briefs').select('id,event_id,member_hash,brief').eq('user_id', owner).in('event_id', eventIds).neq('status', 'skipped').limit(POST_LIMIT * 2).retry(false).abortSignal(signal) : Promise.resolve({ data: [], error: null }),
    // #211: only with the topic bridge on, because marketing_dneskai_topics exists only after 20261023100000.
    options.topicTitles ? db.from('marketing_dneskai_topics').select('brief_id,title_cs,job_id:evidence->>jobId').eq('user_id', owner).in('status', ['enriching', 'briefed', 'generated'])
      .not('brief_id', 'is', null).order('updated_at', { ascending: false }).limit(POST_LIMIT * 2).retry(false).abortSignal(signal) : Promise.resolve({ data: [], error: null }),
  ]), signal);
  signal.throwIfAborted();
  const topicTitles = dneskaiTopicTitles(topicResult.error || !Array.isArray(topicResult.data) ? [] : topicResult.data as TopicTitleRow[]);
  const publications = rows(publicationResult as { data: PublicationRow[] | null; error: unknown }, 'dneskai-workspace-unavailable');
  const published = new Map(rows(eventResult as { data: Array<{ revision_id: string; created_at: string }> | null; error: unknown }, 'dneskai-workspace-unavailable').map((event) => [event.revision_id, iso(event.created_at)]));
  const briefs = rows(briefResult as { data: BriefRow[] | null; error: unknown }, 'dneskai-workspace-unavailable').flatMap((row) => {
    const brief = DneskaiBriefSchema.safeParse(row.brief);
    return brief.success && brief.data.eventId === row.event_id && brief.data.memberHash === row.member_hash ? [{ rowId: row.id, brief: brief.data }] : [];
  });
  const posts = selected.flatMap(({ row, revision }) => {
    const source = revision.sources[0];
    const match = briefs.find((item) => item.brief.eventId === source?.sourceId && item.brief.memberHash === source?.sourceRevision) ?? null;
    const publication = publications.find((item) => item.revision_id === row.id && item.status !== 'cancelled') ?? null;
    const view = DneskaiWorkspacePostSchema.safeParse(postView(row, revision, match?.brief ?? null, publication, published.get(row.id) ?? null, match ? topicTitles.byBrief.get(match.rowId) : undefined));
    if (!view.success) { unreadable += 1; return []; }
    return [view.data];
  });
  // #162: only with the watcher on, because its tables exist only after 20261023120000. A failed read leaves them out.
  const engagementSummary = options.engagement ? await attachEngagementReceipts(db, owner, posts, now, signal) : undefined;
  signal.throwIfAborted();
  const known = new Set(posts.map((post) => post.id));
  const jobs = rows(jobResult as { data: Array<Record<string, unknown>> | null; error: unknown }, 'dneskai-workspace-unavailable').flatMap((row): DneskaiWorkspaceJob[] => {
    if (row.brand !== 'dneskai' || (typeof row.revision_id === 'string' && known.has(row.revision_id))) return [];
    const scheduledAt = iso(row.scheduled_at);
    // A failed draft for a slot that already passed is history, not work for today.
    if (row.status === 'failed' && scheduledAt && Date.parse(scheduledAt) < Date.parse(pragueScheduledAt(today, '00:00'))) return [];
    const job = DneskaiWorkspaceJobSchema.safeParse({ id: row.id, status: row.status, errorCode: marketingJobErrorCode(row.error_code), createdAt: iso(row.created_at),
      title: (typeof row.id === 'string' ? topicTitles.byJob.get(row.id) : undefined) ?? (typeof row.title === 'string' ? row.title.slice(0, 300) : ''), scheduledAt });
    return job.success ? [job.data] : [];
  }).slice(0, 20);
  // One account row that does not parse is counted as unreadable, not a failed read.
  const accounts = rows(accountResult as { data: Array<{ id: string; remote_account_id: string; handle: string; verified_at: string | null; enabled: boolean }> | null; error: unknown }, 'dneskai-workspace-unavailable')
    .flatMap((account) => {
      const parsed = DneskaiWorkspaceReadSchema.shape.accounts.element.safeParse({ id: account.id, remoteId: account.remote_account_id, handle: String(account.handle ?? '').replace(/^@/, ''), verified: !!account.verified_at, enabled: !!account.enabled });
      if (parsed.success) return [parsed.data];
      unreadable += 1; return [];
    });
  // A waiting brief is optional context: a read that fails leaves the list out rather than the whole workspace.
  const waiting = waitingResult.error || !Array.isArray(waitingResult.data) ? undefined : (waitingResult.data as Array<Record<string, unknown>>).flatMap((row) => {
    const topicTitle = typeof row.id === 'string' ? topicTitles.byBrief.get(row.id) : undefined;
    const brief = DneskaiWorkspaceWaitingSchema.safeParse({ briefId: row.id, title: topicTitle ?? (typeof row.title === 'string' && row.title.trim() ? row.title.slice(0, 300) : '—'), scheduledAt: iso(row.scheduled_at), status: row.status, code: safeCode(row.code) });
    return !row.job_id && brief.success && Date.parse(brief.data.scheduledAt) > now.getTime() ? [brief.data] : [];
  }).slice(0, 8);
  return DneskaiWorkspaceReadSchema.parse({ schemaVersion: DNESKAI_WORKSPACE_VERSION, today, generatedAt: now.toISOString(), slots: [...DNESKAI_BRIEF_SLOTS], accounts, posts, jobs, decisionPage: { nextCursor },
    ...(waiting ? { waiting } : {}), ...(options.capabilities ? { capabilities: options.capabilities } : {}), ...(engagementSummary ? { engagementSummary } : {}), ...(options.engagement ? { engagementStatus: engagementSummary ? 'complete' : 'unavailable' } : {}), unreadable });
}

const ENGAGEMENT_SUMMARY_MS = 7 * 86_400_000;
const EngagementReadSchema = z.strictObject({
  receipts: z.array(DneskaiEngagementReceiptSchema.extend({ publicationId: z.uuid() })).max(60),
  summary: DneskaiWorkspaceReadSchema.shape.engagementSummary.unwrap(),
});
/** One owner/RLS-scoped aggregate: no raw-reply cap, no per-post scans and no dependency on the selected page. */
async function attachEngagementReceipts(db: Database, owner: string, posts: DneskaiWorkspacePost[], now: Date, signal: AbortSignal) {
  z.uuid().parse(owner);
  const watched = posts.filter(post => post.engagement && post.publication?.status === 'published');
  signal.throwIfAborted();
  const { data, error } = await awaitWithSignal(db.rpc('marketing_dneskai_engagement_receipts', {
    p_publication_ids: watched.map(post => post.publication!.id),
    p_since: new Date(now.getTime() - ENGAGEMENT_SUMMARY_MS).toISOString(), p_until: now.toISOString(),
  }).retry(false).abortSignal(signal), signal);
  signal.throwIfAborted();
  if (error) return undefined; // Includes a migration not yet applied; never present partial data as zero.
  const parsed = EngagementReadSchema.safeParse(data);
  if (!parsed.success) return undefined;
  const receipts = new Map(parsed.data.receipts.map(({ publicationId, ...receipt }) => [publicationId, receipt]));
  if (receipts.size !== parsed.data.receipts.length || watched.some(post => !receipts.has(post.publication!.id))) return undefined;
  for (const post of watched) {
    post.engagementReceipt = receipts.get(post.publication!.id)!;
  }
  return parsed.data.summary;
}

const TickStepSchema = z.object({ category: z.string(), status: z.string(), code: z.string().optional() });
const TickErrorSchema = z.object({ category: z.string(), code: z.string() });

/** The aggregate stamps its source/window; a partial or mismatched result is unavailable, never zero. */
const CostTotalsSchema = z.strictObject({
  ownerId: z.uuid(), projectId: z.uuid(), dayCount: z.number().int().min(1).max(7), asOf: DneskaiCostsReadSchema.shape.generatedAt,
  days: DneskaiCostsReadSchema.shape.days,
  ticks: DneskaiCostsReadSchema.shape.ticks.omit({ recent: true }).extend({ meaningfulCount: z.number().int().nonnegative(), recent: z.array(z.record(z.string(), z.unknown())).max(20) }),
});

/** The cost ranges GET /api/marketing/dneskai/costs accepts: one to seven Prague days, today included. */
export const DNESKAI_COST_RANGES = ['1d', '2d', '3d', '4d', '5d', '6d', '7d'] as const;
export type DneskaiCostRange = (typeof DNESKAI_COST_RANGES)[number];

/**
 * Errors and costs: the last 14 collection runs with their cost and code, DNESKAi jobs of the range that failed or are
 * uncertain, failed and uncertain publications, the scheduler ticks of the last 24 hours and the 24-hour generation
 * spend. `range` sets how many Prague days the cost table and the job list cover (default seven).
 */
export async function readDneskaiCosts(db: Database, owner: string, project: string, now: Date, generation: DneskaiCostsRead['generation'], range: DneskaiCostRange = '7d',
  options: { requeueEnabled?: boolean; signal?: AbortSignal } = {}): Promise<DneskaiCostsRead> {
  z.uuid().parse(owner); z.uuid().parse(project);
  // Rows are checked one at a time: a malformed run, job, publication or tick is counted, never a failed read.
  let unreadable = 0;
  const keep = <T>(schema: z.ZodType<T>, items: unknown[]): T[] => items.flatMap((item) => {
    const parsed = schema.safeParse(item);
    if (parsed.success) return [parsed.data];
    unreadable += 1; return [];
  });
  const shape = DneskaiCostsReadSchema.shape;
  const dayCount = DNESKAI_COST_RANGES.indexOf(z.enum(DNESKAI_COST_RANGES).parse(range)) + 1;
  const today = pragueMarketingDate(now);
  const weekStart = pragueScheduledAt(pragueDayAfter(today, 1 - dayCount), '00:00');
  const signal = AbortSignal.any([AbortSignal.timeout(15_000), ...(options.signal ? [options.signal] : [])]); signal.throwIfAborted();
  const [runResult, jobResult, publicationResult, totalsResult] = await awaitWithSignal(Promise.all([
    db.from('marketing_dneskai_runs').select('id,date,target_date,status,cost_usd,error_code,created_at').eq('user_id', owner).eq('project_id', project).order('date', { ascending: false }).limit(14).retry(false).abortSignal(signal),
    db.from('marketing_jobs').select('id,status,error_code,created_at,cost_usd:result->usage->>estimatedCostUsd,title:request->generation->source->content->>title,scheduled_at:request->generation->>scheduledAt,brand:request->generation->source->>brand')
      .eq('user_id', owner).eq('request->generation->source->>brand', 'dneskai').in('status', ['failed', 'reconciliation']).gte('created_at', weekStart).lte('created_at', now.toISOString()).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(30).retry(false).abortSignal(signal),
    db.from('marketing_publications').select('id,revision_id,status,error_code,scheduled_at,last_checked_at,remote_container_id,remote_media_id,remote_url,lease_until,marketing_revisions!inner(brand,title:revision->>title)')
      .eq('user_id', owner).eq('marketing_revisions.brand', 'dneskai').in('status', ['failed', 'reconciliation', 'claimed']).order('scheduled_at', { ascending: false }).limit(20).retry(false).abortSignal(signal),
    db.rpc('marketing_dneskai_cost_totals', { p_project: project, p_days: dayCount, p_now: now.toISOString() }).retry(false).abortSignal(signal),
  ]), signal);
  signal.throwIfAborted();
  const parsedTotals = CostTotalsSchema.safeParse(totalsResult.data);
  if (totalsResult.error || !parsedTotals.success) throw new Error('dneskai-costs-unavailable');
  const totals = parsedTotals.data;
  const expectedDays = Array.from({ length: dayCount }, (_, index) => pragueDayAfter(today, -index));
  if (totals.ownerId !== owner || totals.projectId !== project || totals.dayCount !== dayCount || iso(totals.asOf) !== now.toISOString()
    || JSON.stringify(totals.days.map(day => day.date)) !== JSON.stringify(expectedDays)
    || totals.ticks.withErrors > totals.ticks.total || totals.ticks.generationDeferred > totals.ticks.total
    || totals.ticks.meaningfulCount > totals.ticks.total || totals.ticks.recent.length !== Math.min(20, totals.ticks.meaningfulCount) || (totals.ticks.total === 0) !== (totals.ticks.lastStartedAt === null)
    || (totals.ticks.lastStartedAt !== null && (Date.parse(totals.ticks.lastStartedAt) > now.getTime() || Date.parse(totals.ticks.lastStartedAt) < now.getTime() - 86_400_000))
    || new Set(totals.ticks.recent.map(tick => tick.id)).size !== totals.ticks.recent.length) throw new Error('dneskai-costs-unavailable');
  const runs = keep(shape.runs.element, rows(runResult as { data: Array<Record<string, unknown>> | null; error: unknown }, 'dneskai-costs-unavailable').map((row) => ({
    // A running run's cost column is a placeholder 0 until finish settles it: not recorded yet, never a measured zero.
    id: row.id, date: row.date, targetDate: row.target_date, status: row.status, costUsd: row.status === 'running' ? null : money(row.cost_usd), errorCode: safeCode(row.error_code), createdAt: iso(row.created_at),
  })));
  const allJobs = rows(jobResult as { data: Array<Record<string, unknown>> | null; error: unknown }, 'dneskai-costs-unavailable').filter((row) => row.brand === 'dneskai');
  const jobs = keep(shape.jobs.element, allJobs.filter((row) => row.status === 'failed' || row.status === 'reconciliation').slice(0, 30).map((row) => ({
    id: row.id, status: row.status, errorCode: marketingJobErrorCode(row.error_code), createdAt: iso(row.created_at), costUsd: money(row.cost_usd),
    title: typeof row.title === 'string' ? row.title.slice(0, 300) : '', scheduledAt: iso(row.scheduled_at),
  })));
  const days = totals.days;
  const text = (value: unknown) => typeof value === 'string' ? value : null;
  const publications = keep(shape.publications.element, rows(publicationResult as { data: Array<Record<string, unknown>> | null; error: unknown }, 'dneskai-costs-unavailable').flatMap((row) => {
    const revision = (Array.isArray(row.marketing_revisions) ? row.marketing_revisions[0] : row.marketing_revisions) as { title?: unknown } | undefined;
    // A live claim is still being published. One whose lease ran out is shown as marketing_claim_due will record it.
    const lease = Date.parse(text(row.lease_until) ?? '');
    if (row.status === 'claimed' && !(lease < now.getTime())) return [];
    const expired = row.status === 'claimed';
    const requeueable = options.requeueEnabled === true && marketingPublicationRequeueable({ status: String(row.status), remoteContainerId: text(row.remote_container_id),
      remoteMediaId: text(row.remote_media_id), remoteUrl: text(row.remote_url), errorCode: text(row.error_code), leaseUntil: text(row.lease_until) }, now);
    return [{ id: row.id, revisionId: row.revision_id, status: expired ? 'reconciliation' : row.status, errorCode: expired ? 'lease-expired' : safeCode(row.error_code), scheduledAt: iso(row.scheduled_at),
      lastCheckedAt: iso(row.last_checked_at), title: typeof revision?.title === 'string' ? revision.title.slice(0, 300) : '', ...(requeueable ? { requeueable } : {}) }];
  }));
  const ticks = keep(shape.ticks.shape.recent.element, totals.ticks.recent.map((row) => {
    const did = z.array(TickStepSchema).safeParse(row.did); const errors = z.array(TickErrorSchema).safeParse(row.errors);
    return {
      id: row.id, kind: row.kind, startedAt: iso(row.started_at), finishedAt: iso(row.finished_at),
      did: (did.success ? did.data : []).slice(0, 20).filter((step) => /^[a-z]{1,20}$/.test(step.category)).map((step) => ({ category: step.category,
        status: (['done', 'noop', 'skipped', 'busy', 'backoff', 'deferred', 'error'] as const).find((status) => status === step.status) ?? 'error', code: safeCode(step.code) })),
      errors: (errors.success ? errors.data : []).slice(0, 20).flatMap((error) => /^[a-z]{1,20}$/.test(error.category) ? [{ category: error.category, code: safeCode(error.code) ?? `${error.category}-failed` }] : []),
    };
  }));
  const generationDeferred = (tick: (typeof ticks)[number]) => tick.did.some((step) => step.category === 'generation' && step.status === 'deferred');
  // The recent list shows ticks that did something, failed or deferred a draft; the minute ticks that found nothing to do are counted only.
  const recent = ticks.filter((tick) => tick.errors.length || generationDeferred(tick) || tick.did.some((step) => step.status === 'done' || step.status === 'error')).slice(0, 20);
  return DneskaiCostsReadSchema.parse({
    schemaVersion: DNESKAI_COSTS_VERSION, generatedAt: now.toISOString(), generation, days, runs, jobs, publications, unreadable,
    ticks: { total: totals.ticks.total, withErrors: totals.ticks.withErrors, generationDeferred: totals.ticks.generationDeferred, lastStartedAt: totals.ticks.lastStartedAt, recent },
  });
}

const TOPIC_ACTIVE_LIMIT = 120;
const TOPIC_ARCHIVE_LIMIT = 40;
type TopicRow = { id: string; kind: string; source_kind: string; title_cs: string; summary: string | null; keyword: string | null; verdict: string | null; evidence: unknown;
  status: string; proposed_for: string; approved_at: string | null; created_at: string; updated_at: string };

/** A topic's source as the list shows it: the domain of its first URL, or the Instagram handle the evidence names. */
/** #210: the bridge's code on an approved topic, when it is one the owner can act on. */
function topicCode(evidence: unknown): DneskaiTopicOwnerCode | null {
  const code = evidence && typeof evidence === 'object' ? (evidence as { bridgeCode?: unknown }).bridgeCode : null;
  return typeof code === 'string' && (DNESKAI_TOPIC_OWNER_CODES as readonly string[]).includes(code) ? code as DneskaiTopicOwnerCode : null;
}

function topicSource(evidence: unknown): DneskaiTopic['source'] {
  const value = evidence && typeof evidence === 'object' ? evidence as { urls?: unknown; handle?: unknown } : {};
  const url = Array.isArray(value.urls) ? value.urls.find((item): item is string => typeof item === 'string' && /^https:\/\//.test(item) && item.length <= 2048) ?? null : null;
  const handle = typeof value.handle === 'string' && /^@?[A-Za-z0-9._]{1,30}$/.test(value.handle) ? `@${value.handle.replace(/^@/, '')}` : null;
  let host: string | null = null;
  try { host = url ? new URL(url).hostname.replace(/^www\./, '').slice(0, 120) : null; } catch { host = null; }
  return { label: handle ?? host, url: host ? url : null };
}

/**
 * Topics (náměty, #150) of one DNESKAi project, grouped by kind and status: every open topic (proposed, approved and
 * in progress, the newest 120) and the rejected or expired ones of the last 14 days (the newest 40). Returns null
 * when DNESKAI_TOPICS_ENABLED is off, so nothing reads a table that may not exist yet.
 */
export async function readDneskaiTopics(db: Database, owner: string, project: string, now: Date, options: { enabled: boolean }): Promise<DneskaiTopicsRead | null> {
  if (!options.enabled) return null;
  z.uuid().parse(owner); z.uuid().parse(project);
  const columns = 'id,kind,source_kind,title_cs,summary,keyword,verdict,evidence,status,proposed_for,approved_at,created_at,updated_at';
  const [activeResult, archiveResult, latestResult] = await Promise.all([
    db.from('marketing_dneskai_topics').select(columns).eq('user_id', owner).eq('project_id', project).not('status', 'in', `(${DNESKAI_TOPIC_ARCHIVED_STATUSES.join(',')})`)
      .order('proposed_for', { ascending: false }).order('created_at', { ascending: false }).limit(TOPIC_ACTIVE_LIMIT),
    db.from('marketing_dneskai_topics').select(columns).eq('user_id', owner).eq('project_id', project).in('status', [...DNESKAI_TOPIC_ARCHIVED_STATUSES])
      .gte('updated_at', new Date(now.getTime() - 14 * 86_400_000).toISOString()).order('updated_at', { ascending: false }).limit(TOPIC_ARCHIVE_LIMIT),
    db.from('marketing_dneskai_topics').select('created_at').eq('user_id', owner).eq('project_id', project).neq('source_kind', 'manual').order('created_at', { ascending: false }).limit(1),
  ]);
  const all = [...rows(activeResult as { data: TopicRow[] | null; error: unknown }, 'dneskai-topics-unavailable'), ...rows(archiveResult as { data: TopicRow[] | null; error: unknown }, 'dneskai-topics-unavailable')];
  const groups = { news: emptyDneskaiTopicGroups(), education: emptyDneskaiTopicGroups() };
  let unreadable = 0;
  for (const row of all) {
    const topic = DneskaiTopicSchema.safeParse({ id: row.id, kind: row.kind, sourceKind: row.source_kind, source: topicSource(row.evidence), title: row.title_cs, summary: row.summary,
      keyword: row.keyword, verdict: row.verdict, status: row.status, proposedFor: row.proposed_for, approvedAt: iso(row.approved_at), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
      ...(topicCode(row.evidence) ? { code: topicCode(row.evidence) } : {}) });
    if (!topic.success) { unreadable += 1; continue; }
    groups[topic.data.kind][topic.data.status].push(topic.data);
  }
  const latest = rows(latestResult as { data: Array<{ created_at: string }> | null; error: unknown }, 'dneskai-topics-unavailable')[0];
  return DneskaiTopicsReadSchema.parse({ schemaVersion: DNESKAI_TOPICS_VERSION, generatedAt: now.toISOString(), groups, lastProposedAt: latest ? iso(latest.created_at) : null, unreadable });
}
