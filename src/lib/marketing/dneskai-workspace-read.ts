import 'server-only';
import { z } from 'zod';
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the generated database types do not cover marketing tables
type Database = Pick<SupabaseClient<any>, 'from' | 'rpc'>;

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
const rows = <T>(result: { data: T[] | null; error: unknown }, failure: string): T[] => { if (result.error) throw new Error(failure); return result.data ?? []; };

type RevisionRow = { id: string; replaces_id: string | null; status: string; ready: boolean; content_hash: string; created_at: string; approved_at: string | null; feedback: string | null; revision: unknown; render_report: unknown };
type PublicationRow = { id: string; revision_id: string; status: string; scheduled_at: string; remote_url: string | null; error_code: string | null; last_checked_at: string | null };
type BriefRow = { id: string; event_id: string; member_hash: string; brief: unknown };
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
export async function readDneskaiWorkspace(db: Database, owner: string, now: Date, today = pragueMarketingDate(now), options: { capabilities?: DneskaiWorkspaceRead['capabilities']; engagement?: boolean; topicTitles?: boolean; decisionsBefore?: DneskaiDecisionCursor } = {}): Promise<DneskaiWorkspaceRead> {
  z.uuid().parse(owner); z.iso.date().parse(today);
  const windowStart = Date.parse(pragueScheduledAt(pragueDayAfter(today, -30), '00:00'));
  const windowEnd = Date.parse(pragueScheduledAt(pragueDayAfter(today, 7), '00:00'));
  const cursor = options.decisionsBefore ? DneskaiDecisionCursorSchema.parse(options.decisionsBefore) : null;
  let decisions = db.from('marketing_revisions').select(REVISION_COLUMNS).eq('user_id', owner).eq('brand', 'dneskai')
    .in('status', ['review', 'returned']).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(DECISION_PAGE_SIZE + 1);
  if (cursor) decisions = decisions.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
  const [decisionResult, revisionResult, accountResult, jobResult, waitingResult] = await Promise.all([
    decisions,
    db.from('marketing_revisions').select(REVISION_COLUMNS)
      .eq('user_id', owner).eq('brand', 'dneskai').neq('status', 'superseded').not('status', 'in', '(review,returned)').order('created_at', { ascending: false }).limit(REVISION_READ_LIMIT),
    db.from('marketing_accounts').select('id,remote_account_id,handle,verified_at,enabled').eq('user_id', owner).eq('brand', 'dneskai').eq('platform', 'instagram').limit(4),
    db.from('marketing_jobs').select('id,status,error_code,created_at,title:request->generation->source->content->>title,scheduled_at:request->generation->>scheduledAt,revision_id:request->generation->>revisionId,brand:request->generation->source->>brand')
      .eq('user_id', owner).eq('request->generation->source->>brand', 'dneskai').in('status', ['queued', 'running', 'failed', 'reconciliation']).gte('created_at', new Date(now.getTime() - 3 * 86_400_000).toISOString()).order('created_at', { ascending: false }).limit(60),
    // Owner decision 9: built briefs of today and tomorrow that wait for the scheduler, with no job yet.
    db.from('marketing_dneskai_briefs').select('id,status,code,job_id,scheduled_at,title:brief->>title').eq('user_id', owner).in('status', ['pending', 'ready'])
      .in('target_date', [today, pragueDayAfter(today, 1)]).order('scheduled_at').limit(16),
  ]);
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
  const [publicationResult, eventResult, briefResult, topicResult] = await Promise.all([
    ids.length ? db.from('marketing_publications').select('id,revision_id,status,scheduled_at,remote_url,error_code,last_checked_at').eq('user_id', owner).in('revision_id', ids).limit(POST_LIMIT * 2) : Promise.resolve({ data: [], error: null }),
    ids.length ? db.from('marketing_events').select('revision_id,created_at').eq('user_id', owner).eq('kind', 'published').in('revision_id', ids).limit(POST_LIMIT * 2) : Promise.resolve({ data: [], error: null }),
    eventIds.length ? db.from('marketing_dneskai_briefs').select('id,event_id,member_hash,brief').eq('user_id', owner).in('event_id', eventIds).neq('status', 'skipped').limit(POST_LIMIT * 2) : Promise.resolve({ data: [], error: null }),
    // #211: only with the topic bridge on, because marketing_dneskai_topics exists only after 20261023100000.
    options.topicTitles ? db.from('marketing_dneskai_topics').select('brief_id,title_cs,job_id:evidence->>jobId').eq('user_id', owner).in('status', ['enriching', 'briefed', 'generated'])
      .not('brief_id', 'is', null).order('updated_at', { ascending: false }).limit(POST_LIMIT * 2) : Promise.resolve({ data: [], error: null }),
  ]);
  const topicTitles = dneskaiTopicTitles(topicResult.error ? [] : (topicResult.data ?? []) as TopicTitleRow[]);
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
  const engagementSummary = options.engagement ? await attachEngagementReceipts(db, owner, posts, now) : undefined;
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
  const waiting = waitingResult.error ? undefined : ((waitingResult.data ?? []) as Array<Record<string, unknown>>).flatMap((row) => {
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
async function attachEngagementReceipts(db: Database, owner: string, posts: DneskaiWorkspacePost[], now: Date) {
  z.uuid().parse(owner);
  const watched = posts.filter(post => post.engagement && post.publication?.status === 'published');
  const { data, error } = await db.rpc('marketing_dneskai_engagement_receipts', {
    p_publication_ids: watched.map(post => post.publication!.id),
    p_since: new Date(now.getTime() - ENGAGEMENT_SUMMARY_MS).toISOString(), p_until: now.toISOString(),
  });
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

/** The cost ranges GET /api/marketing/dneskai/costs accepts: one to seven Prague days, today included. */
export const DNESKAI_COST_RANGES = ['1d', '2d', '3d', '4d', '5d', '6d', '7d'] as const;
export type DneskaiCostRange = (typeof DNESKAI_COST_RANGES)[number];

/**
 * Errors and costs: the last 14 collection runs with their cost and code, DNESKAi jobs of the range that failed or are
 * uncertain, failed and uncertain publications, the scheduler ticks of the last 24 hours and the 24-hour generation
 * spend. `range` sets how many Prague days the cost table and the job list cover (default seven).
 */
export async function readDneskaiCosts(db: Database, owner: string, project: string, now: Date, generation: DneskaiCostsRead['generation'], range: DneskaiCostRange = '7d',
  options: { requeueEnabled?: boolean } = {}): Promise<DneskaiCostsRead> {
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
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  const [runResult, jobResult, publicationResult, tickResult] = await Promise.all([
    db.from('marketing_dneskai_runs').select('id,date,target_date,status,cost_usd,error_code,created_at').eq('user_id', owner).eq('project_id', project).order('date', { ascending: false }).limit(14),
    db.from('marketing_jobs').select('id,status,error_code,created_at,cost_usd:result->usage->>estimatedCostUsd,title:request->generation->source->content->>title,scheduled_at:request->generation->>scheduledAt,brand:request->generation->source->>brand')
      .eq('user_id', owner).eq('request->generation->source->>brand', 'dneskai').gte('created_at', weekStart).order('created_at', { ascending: false }).limit(100),
    db.from('marketing_publications').select('id,revision_id,status,error_code,scheduled_at,last_checked_at,remote_container_id,remote_media_id,remote_url,lease_until,marketing_revisions!inner(brand,title:revision->>title)')
      .eq('user_id', owner).eq('marketing_revisions.brand', 'dneskai').in('status', ['failed', 'reconciliation', 'claimed']).order('scheduled_at', { ascending: false }).limit(20),
    db.from('marketing_ticks').select('id,kind,started_at,finished_at,did,errors').eq('user_id', owner).gte('started_at', dayAgo).order('started_at', { ascending: false }).limit(1500),
  ]);
  const runs = keep(shape.runs.element, rows(runResult as { data: Array<Record<string, unknown>> | null; error: unknown }, 'dneskai-costs-unavailable').map((row) => ({
    // A running run's cost column is a placeholder 0 until finish settles it: not recorded yet, never a measured zero.
    id: row.id, date: row.date, targetDate: row.target_date, status: row.status, costUsd: row.status === 'running' ? null : money(row.cost_usd), errorCode: safeCode(row.error_code), createdAt: iso(row.created_at),
  })));
  const allJobs = rows(jobResult as { data: Array<Record<string, unknown>> | null; error: unknown }, 'dneskai-costs-unavailable').filter((row) => row.brand === 'dneskai');
  const jobs = keep(shape.jobs.element, allJobs.filter((row) => row.status === 'failed' || row.status === 'reconciliation').slice(0, 30).map((row) => ({
    id: row.id, status: row.status, errorCode: marketingJobErrorCode(row.error_code), createdAt: iso(row.created_at), costUsd: money(row.cost_usd),
    title: typeof row.title === 'string' ? row.title.slice(0, 300) : '', scheduledAt: iso(row.scheduled_at),
  })));
  const days = Array.from({ length: dayCount }, (_, index) => pragueDayAfter(today, -index)).map((date) => {
    const dayRuns = runs.filter((run) => run.date === date);
    const dayJobs = allJobs.filter((row) => typeof row.created_at === 'string' && pragueMarketingDate(new Date(row.created_at)) === date && row.status !== 'queued');
    // Measured: a job that produced a draft recorded the provider's own usage for every call. Booked: a failed job's
    // figure, which is its reserved maximum when a call's billing was ambiguous (cost-16).
    const jobCosts = dayJobs.map((row) => ({ settled: row.status === 'review', cost: money(row.cost_usd) }));
    const runCosts = dayRuns.map((run) => run.costUsd);
    const sum = (values: ReadonlyArray<number | null>) => values.reduce<number>((total, cost) => total + (cost ?? 0), 0);
    return { date, collectionUsd: sum(runCosts), generationUsd: sum(jobCosts.filter((job) => job.settled).map((job) => job.cost)),
      generationBookedUsd: sum(jobCosts.filter((job) => !job.settled).map((job) => job.cost)),
      unknown: [...runCosts, ...jobCosts.map((job) => job.cost)].filter((cost) => cost === null).length };
  });
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
  const ticks = keep(shape.ticks.shape.recent.element, rows(tickResult as { data: Array<Record<string, unknown>> | null; error: unknown }, 'dneskai-costs-unavailable').map((row) => {
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
    ticks: { total: ticks.length, withErrors: ticks.filter((tick) => tick.errors.length).length, generationDeferred: ticks.filter(generationDeferred).length, lastStartedAt: ticks[0]?.startedAt ?? null, recent },
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
