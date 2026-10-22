import 'server-only';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DneskaiRenderReportSchema, parseContentRevision, type ContentRevision } from './contracts';
import { DneskaiBriefSchema, type DneskaiBrief } from './dneskai-brief';
import type { DneskaiSlide } from './dneskai-slides';
import { DNESKAI_BRIEF_SLOTS } from './dneskai-briefs';
import { DNESKAI_PLACED_FIELDS } from './dneskai-render';
import { DNESKAI_TEXT_LIMITS, dneskaiTemplateId } from './dneskai-generation';
import { marketingJobErrorCode } from './job-health';
import { pragueScheduledAt } from './clock';
import { pragueMarketingDate } from './weekly-planning';
import {
  DNESKAI_COSTS_VERSION, DNESKAI_EDITABLE_TEXT_FIELDS, DNESKAI_WORKSPACE_VERSION, DneskaiCostsReadSchema, DneskaiWorkspaceJobSchema, DneskaiWorkspacePostSchema,
  DneskaiWorkspaceReadSchema, pragueDayAfter, type DneskaiCostsRead, type DneskaiFieldLimit, type DneskaiWorkspaceJob, type DneskaiWorkspacePost, type DneskaiWorkspaceRead,
} from './dneskai-workspace';

/**
 * Server read of the DNESKAi workspace (#119). Every query runs through the owner's session client and filters on
 * `user_id`, so own-only RLS decides what is visible; the one service-role call (the 24-hour generation spend, a
 * function `authenticated` cannot execute) is made by the route for the authenticated owner only. Results are bounded
 * and validated against the browser schemas; a row that does not parse is counted, not shown.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the generated database types do not cover marketing tables
type Database = Pick<SupabaseClient<any>, 'from'>;

const SCHEMA_LIMITS: Record<(typeof DNESKAI_EDITABLE_TEXT_FIELDS)[number], number> = { headline: 200, body: 700, kicker: 80, credit: 120 };
const POST_LIMIT = 60;
const REVISION_READ_LIMIT = 150;

/** The written fields a slide's template draws, with the most characters its layer holds. Sources lines are code-owned. */
export function dneskaiSlideFieldLimits(slide: DneskaiSlide): DneskaiFieldLimit[] {
  const placed: readonly string[] = DNESKAI_PLACED_FIELDS[slide.type];
  if (slide.type === 'sources') return [];
  const limits: Partial<Record<string, number>> = DNESKAI_TEXT_LIMITS[dneskaiTemplateId(slide as Parameters<typeof dneskaiTemplateId>[0])];
  return DNESKAI_EDITABLE_TEXT_FIELDS.filter((field) => placed.includes(field)).map((field) => ({ field, max: limits[field] ?? SCHEMA_LIMITS[field] }));
}

const iso = (value: unknown): string | null => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const money = (value: unknown): number | null => {
  const amount = typeof value === 'number' ? value : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : Number.NaN;
  return Number.isFinite(amount) && amount >= 0 && amount <= 10000 ? amount : null;
};
const safeCode = (value: unknown): string | null => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,99}$/.test(value) ? value : null;
const rows = <T>(result: { data: T[] | null; error: unknown }, failure: string): T[] => { if (result.error) throw new Error(failure); return result.data ?? []; };

type RevisionRow = { id: string; replaces_id: string | null; status: string; ready: boolean; content_hash: string; created_at: string; approved_at: string | null; feedback: string | null; revision: unknown; render_report: unknown };
type PublicationRow = { id: string; revision_id: string; status: string; scheduled_at: string; remote_url: string | null; error_code: string | null; last_checked_at: string | null };
type BriefRow = { event_id: string; member_hash: string; brief: unknown };

function postView(row: RevisionRow, revision: ContentRevision, brief: DneskaiBrief | null, publication: PublicationRow | null, publishedAt: string | null): DneskaiWorkspacePost {
  const report = DneskaiRenderReportSchema.safeParse(row.render_report);
  return {
    id: row.id, replacesId: row.replaces_id, status: row.status as DneskaiWorkspacePost['status'], ready: row.ready, contentHash: row.content_hash,
    createdAt: iso(row.created_at)!, approvedAt: iso(row.approved_at), feedback: row.feedback ? row.feedback.slice(0, 2000) : null,
    title: revision.title, caption: revision.caption, format: revision.format, scheduledAt: new Date(revision.scheduledAt).toISOString(),
    account: { id: revision.account.id, handle: revision.account.handle, platform: revision.account.platform },
    templateVersion: revision.templateVersion, traceId: revision.traceId, deck: revision.deck ?? null,
    fields: (revision.deck?.slides ?? []).map(dneskaiSlideFieldLimits),
    assets: revision.assets.map(({ url, sha256, width, height, alt }) => ({ url, sha256, width, height, alt })),
    renderReport: report.success ? report.data : null,
    brief: brief ? { eventId: brief.eventId, title: brief.title, targetDate: brief.targetDate,
      evidence: brief.evidence.map(({ candidateId, sourceId, url, title }) => ({ candidateId, sourceId, url, title })), media: brief.media } : null,
    publication: publication ? { id: publication.id, status: publication.status as NonNullable<DneskaiWorkspacePost['publication']>['status'], scheduledAt: iso(publication.scheduled_at)!,
      remoteUrl: publication.remote_url, errorCode: safeCode(publication.error_code), lastCheckedAt: iso(publication.last_checked_at), publishedAt } : null,
  };
}

/**
 * The workspace read for one Prague day, from the 150 newest DNESKAi revisions that are not superseded: posts still
 * waiting for a decision, then posts planned from today through the next seven days, then receipts of the last 30
 * days, newest first, up to 60 posts in all. At four posts a day that keeps every undecided post and the coming week
 * and leaves room for roughly the last week of receipts; older receipts drop off first.
 */
export async function readDneskaiWorkspace(db: Database, owner: string, now: Date, today = pragueMarketingDate(now)): Promise<DneskaiWorkspaceRead> {
  z.uuid().parse(owner); z.iso.date().parse(today);
  const windowStart = Date.parse(pragueScheduledAt(pragueDayAfter(today, -30), '00:00'));
  const windowEnd = Date.parse(pragueScheduledAt(pragueDayAfter(today, 7), '00:00'));
  const [revisionResult, accountResult, jobResult] = await Promise.all([
    db.from('marketing_revisions').select('id,replaces_id,status,ready,content_hash,created_at,approved_at,feedback,revision,render_report')
      .eq('user_id', owner).eq('brand', 'dneskai').neq('status', 'superseded').order('created_at', { ascending: false }).limit(REVISION_READ_LIMIT),
    db.from('marketing_accounts').select('id,remote_account_id,handle,verified_at,enabled').eq('user_id', owner).eq('brand', 'dneskai').eq('platform', 'instagram').limit(4),
    db.from('marketing_jobs').select('id,status,error_code,created_at,title:request->generation->source->content->>title,scheduled_at:request->generation->>scheduledAt,revision_id:request->generation->>revisionId,brand:request->generation->source->>brand')
      .eq('user_id', owner).in('status', ['queued', 'running', 'failed', 'reconciliation']).gte('created_at', new Date(now.getTime() - 3 * 86_400_000).toISOString()).order('created_at', { ascending: false }).limit(60),
  ]);
  let unreadable = 0;
  const parsed: Array<{ row: RevisionRow; revision: ContentRevision }> = [];
  for (const row of rows(revisionResult as { data: RevisionRow[] | null; error: unknown }, 'dneskai-workspace-unavailable')) {
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
  const [publicationResult, eventResult, briefResult] = await Promise.all([
    ids.length ? db.from('marketing_publications').select('id,revision_id,status,scheduled_at,remote_url,error_code,last_checked_at').eq('user_id', owner).in('revision_id', ids).limit(POST_LIMIT * 2) : Promise.resolve({ data: [], error: null }),
    ids.length ? db.from('marketing_events').select('revision_id,created_at').eq('user_id', owner).eq('kind', 'published').in('revision_id', ids).limit(POST_LIMIT * 2) : Promise.resolve({ data: [], error: null }),
    eventIds.length ? db.from('marketing_dneskai_briefs').select('event_id,member_hash,brief').eq('user_id', owner).in('event_id', eventIds).neq('status', 'skipped').limit(POST_LIMIT * 2) : Promise.resolve({ data: [], error: null }),
  ]);
  const publications = rows(publicationResult as { data: PublicationRow[] | null; error: unknown }, 'dneskai-workspace-unavailable');
  const published = new Map(rows(eventResult as { data: Array<{ revision_id: string; created_at: string }> | null; error: unknown }, 'dneskai-workspace-unavailable').map((event) => [event.revision_id, iso(event.created_at)]));
  const briefs = rows(briefResult as { data: BriefRow[] | null; error: unknown }, 'dneskai-workspace-unavailable').flatMap((row) => {
    const brief = DneskaiBriefSchema.safeParse(row.brief);
    return brief.success && brief.data.eventId === row.event_id && brief.data.memberHash === row.member_hash ? [brief.data] : [];
  });
  const posts = selected.flatMap(({ row, revision }) => {
    const source = revision.sources[0];
    const brief = briefs.find((item) => item.eventId === source?.sourceId && item.memberHash === source?.sourceRevision) ?? null;
    const publication = publications.find((item) => item.revision_id === row.id && item.status !== 'cancelled') ?? null;
    const view = DneskaiWorkspacePostSchema.safeParse(postView(row, revision, brief, publication, published.get(row.id) ?? null));
    if (!view.success) { unreadable += 1; return []; }
    return [view.data];
  });
  const known = new Set(posts.map((post) => post.id));
  const jobs = rows(jobResult as { data: Array<Record<string, unknown>> | null; error: unknown }, 'dneskai-workspace-unavailable').flatMap((row): DneskaiWorkspaceJob[] => {
    if (row.brand !== 'dneskai' || (typeof row.revision_id === 'string' && known.has(row.revision_id))) return [];
    const scheduledAt = iso(row.scheduled_at);
    // A failed draft for a slot that already passed is history, not work for today.
    if (row.status === 'failed' && scheduledAt && Date.parse(scheduledAt) < Date.parse(pragueScheduledAt(today, '00:00'))) return [];
    const job = DneskaiWorkspaceJobSchema.safeParse({ id: row.id, status: row.status, errorCode: marketingJobErrorCode(row.error_code), createdAt: iso(row.created_at),
      title: typeof row.title === 'string' ? row.title.slice(0, 300) : '', scheduledAt });
    return job.success ? [job.data] : [];
  }).slice(0, 20);
  // One account row that does not parse is counted as unreadable, not a failed read.
  const accounts = rows(accountResult as { data: Array<{ id: string; remote_account_id: string; handle: string; verified_at: string | null; enabled: boolean }> | null; error: unknown }, 'dneskai-workspace-unavailable')
    .flatMap((account) => {
      const parsed = DneskaiWorkspaceReadSchema.shape.accounts.element.safeParse({ id: account.id, remoteId: account.remote_account_id, handle: String(account.handle ?? '').replace(/^@/, ''), verified: !!account.verified_at, enabled: !!account.enabled });
      if (parsed.success) return [parsed.data];
      unreadable += 1; return [];
    });
  return DneskaiWorkspaceReadSchema.parse({ schemaVersion: DNESKAI_WORKSPACE_VERSION, today, generatedAt: now.toISOString(), slots: [...DNESKAI_BRIEF_SLOTS], accounts, posts, jobs, unreadable });
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
export async function readDneskaiCosts(db: Database, owner: string, project: string, now: Date, generation: DneskaiCostsRead['generation'], range: DneskaiCostRange = '7d'): Promise<DneskaiCostsRead> {
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
      .eq('user_id', owner).gte('created_at', weekStart).order('created_at', { ascending: false }).limit(100),
    db.from('marketing_publications').select('id,revision_id,status,error_code,scheduled_at,last_checked_at,marketing_revisions!inner(brand,title:revision->>title)')
      .eq('user_id', owner).eq('marketing_revisions.brand', 'dneskai').in('status', ['failed', 'reconciliation']).order('scheduled_at', { ascending: false }).limit(20),
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
  const publications = keep(shape.publications.element, rows(publicationResult as { data: Array<Record<string, unknown>> | null; error: unknown }, 'dneskai-costs-unavailable').map((row) => {
    const revision = (Array.isArray(row.marketing_revisions) ? row.marketing_revisions[0] : row.marketing_revisions) as { title?: unknown } | undefined;
    return { id: row.id, revisionId: row.revision_id, status: row.status, errorCode: safeCode(row.error_code), scheduledAt: iso(row.scheduled_at), lastCheckedAt: iso(row.last_checked_at),
      title: typeof revision?.title === 'string' ? revision.title.slice(0, 300) : '' };
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
  // The recent list shows ticks that did something or failed; the minute ticks that found nothing to do are counted only.
  const recent = ticks.filter((tick) => tick.errors.length || tick.did.some((step) => step.status === 'done' || step.status === 'error')).slice(0, 20);
  return DneskaiCostsReadSchema.parse({
    schemaVersion: DNESKAI_COSTS_VERSION, generatedAt: now.toISOString(), generation, days, runs, jobs, publications, unreadable,
    ticks: { total: ticks.length, withErrors: ticks.filter((tick) => tick.errors.length).length, lastStartedAt: ticks[0]?.startedAt ?? null, recent },
  });
}
