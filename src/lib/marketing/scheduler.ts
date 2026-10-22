import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DneskaiCollectResponse } from "./dneskai-collection";
import type { DneskaiMediaOutcome } from "./dneskai-media";
import type { CreateDneskaiBriefs } from "./dneskai-ports";
import { instagramTokenRefreshDue, type InstagramTokenRefreshOutcome, type MetaTokenMetadata } from "./meta-credentials";
import { pragueMarketingDate } from "./weekly-planning";
import type { DneskaiScoutingResult } from "./dneskai-scouting";
import { dneskaiScoutingEnabled } from "./dneskai-evidence-rollout";

/**
 * The marketing scheduler (#120). pg_cron calls POST /api/marketing/tick every five minutes and once a day
 * (owner decision 4 of #110: no n8n timers); each call runs `runMarketingTick` once.
 *
 * A minute tick runs at most one unit of each category, one after another, in this order: collection, media,
 * briefs, generation, publishing, reconciliation, token. Generation is the one category that needs most of a
 * tick (43 s), so a tick with a runnable queued job starts with generation, unless collection has work and it
 * is collection's turn: during a collection run the two alternate by five-minute slot, so neither starves
 * (production-03). A daily tick runs only the
 * daily duties: signed-URL renewal, media retention and tick retention. Every unit is wrapped, so one
 * failure never stops the next one. Each category has a lease in `marketing_scheduler_state`, so a second
 * tick running at the same time skips what the first one holds, and the tick id is recorded once in
 * `marketing_ticks`, so a replayed tick does nothing. A paused category is a recorded skip and costs $0.
 *
 * The work itself stays in the modules that own it; this file only decides what runs and records it.
 */
type Environment = Record<string, string | undefined>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Database = SupabaseClient<any>;

export const MARKETING_TICK_KINDS = ["minute", "daily"] as const;
export type MarketingTickKind = (typeof MARKETING_TICK_KINDS)[number];
export const MarketingTickInputSchema = z.strictObject({ tick: z.uuid(), kind: z.enum(MARKETING_TICK_KINDS) });
export type MarketingTickInput = z.infer<typeof MarketingTickInputSchema>;

/** Minute-tick categories in their usual execution order; a runnable generation job may move generation first. */
export const MARKETING_TICK_CATEGORIES = ["collection", "media", "briefs", "generation", "publishing", "reconciliation", "token"] as const;
/** Daily-tick duties in execution order. */
export const MARKETING_DAILY_DUTIES = ["renewal", "purge", "retention"] as const;
/**
 * Owner decision 7: the review reminder runs last in a minute tick, after the categories above, and only when the
 * ports wire it. It holds no lease; its notifications are keyed per day and per slot.
 */
export const MARKETING_TICK_REMINDER = "reminder" as const;
/**
 * Scouting (#151) runs right after collection, only while DNESKAI_SCOUTING_ENABLED is on and the ports wire it. It
 * holds no lease: it reads stored reports and library links and inserts topics idempotently, so two ticks at once
 * insert each topic once. It runs in the first five-minute slot of each hour between 22:00 and 08:00 Prague.
 */
export const MARKETING_TICK_SCOUTING = "scouting" as const;
export type MarketingTickCategory = (typeof MARKETING_TICK_CATEGORIES)[number] | (typeof MARKETING_DAILY_DUTIES)[number] | typeof MARKETING_TICK_REMINDER | typeof MARKETING_TICK_SCOUTING;
/** Lease names in `marketing_scheduler_state`. Media retention shares the media lease: it never runs during collection. */
export type MarketingSchedulerLease = "collection" | "media" | "briefs" | "generation" | "publishing" | "reconciliation" | "token" | "renewal";
export type MarketingTickStatus = "done" | "noop" | "skipped" | "busy" | "backoff" | "deferred" | "error";
export type MarketingTickDetail = Record<string, string | number | boolean | null>;
export type MarketingTickStep = { category: MarketingTickCategory; status: MarketingTickStatus; code?: string; pending?: boolean; ms: number; detail?: MarketingTickDetail };
export type MarketingTickError = { category: MarketingTickCategory; code: string };
export type MarketingTickResult = {
  tick: string; kind: MarketingTickKind; duplicate: boolean; recorded: boolean;
  did: MarketingTickStep[]; errors: MarketingTickError[];
  /** Categories that still have work; the next tick continues them. */
  next: { pending: MarketingTickCategory[] };
};

/** No category starts once this much of the tick has passed. */
export const MARKETING_TICK_SOFT_BUDGET_MS = 48_000;
/** Every abort signal fires here. The route may run 60 s; pg_net waits 55 s for the answer. */
export const MARKETING_TICK_HARD_BUDGET_MS = 53_000;
/** Longer than the route's maxDuration, so a lease of a tick that died expires before the next tick. */
export const MARKETING_TICK_LEASE_SECONDS = 90;
export const MARKETING_TICK_MEDIA_BUDGET_MS = 40_000;
export const MARKETING_TICK_RETENTION_DAYS = 14;
/** The pg_cron cadence of the minute tick (20261021124628_marketing_scheduler_cron.sql). */
export const MARKETING_TICK_INTERVAL_MS = 5 * 60_000;
/**
 * True in the five-minute slots where collection keeps its place ahead of a queued generation job: the
 * even slots counted from the epoch. In the odd slots generation goes first. Stateless, so a lost tick
 * record or a failed release never hands one category every turn.
 */
export function marketingCollectionTurn(at: Date | number): boolean {
  return Math.floor((typeof at === "number" ? at : at.getTime()) / MARKETING_TICK_INTERVAL_MS) % 2 === 0;
}
export const MARKETING_MEDIA_RETENTION_DAYS = 30;
/**
 * A live publication due this soon (or already in its 15-minute window), or a claimed one waiting for its
 * container, makes collection, media, briefs and generation wait for that tick.
 */
export const MARKETING_PUBLICATION_YIELD_MS = 5 * 60_000;
/**
 * A live publish starts only with this much of the soft budget left (35 s before every signal aborts). A
 * publish cut off before its publish intent only costs a container retry inside the ten-minute claim; one
 * cut off after it ends in reconciliation, so it is better to wait five minutes than to start short. A dry
 * run writes nothing.
 */
export const MARKETING_LIVE_PUBLISH_MINIMUM_START_MS = 30_000;
/** A publication left in `reconciliation` is read again at most this often. */
export const MARKETING_RECONCILIATION_INTERVAL_MS = 30 * 60_000;
/** Signed asset URLs that expire within this window are renewed by the daily tick. */
export const MARKETING_URL_RENEWAL_WINDOW_MS = 48 * 60 * 60_000;
const MINIMUM_START_MS: Record<MarketingTickCategory, number> = {
  collection: 20_000, media: 25_000, briefs: 5_000, generation: 43_000, publishing: 15_000, reconciliation: 5_000, token: 16_000,
  renewal: 15_000, purge: 10_000, retention: 1_000, reminder: 2_000, scouting: 5_000,
};
/** A candidate busy in another media pass holds a 120 s claim. */
const MEDIA_BUSY_BACKOFF_MS = 125_000;
const MEDIA_FAILURE_BACKOFF_MS = 10 * 60_000;
const JOB_BLOCK_MS = 60 * 60_000;
const MAX_BLOCKED_JOBS = 10;
const TOKEN_FAILED_BACKOFF_MS = 24 * 60 * 60_000;
const TOKEN_HELD_BACKOFF_MS = 60 * 60_000;
const RENEWALS_PER_TICK = 10;
const RENEWAL_RESERVE_MS = 10_000;
/** Codes that say a revision can never be renewed (for example one stored before #118); it waits a week. */
const PERMANENT_RENEWAL_CODES = new Set(["revision-identity-mismatch", "revision-not-renewable", "revision-unavailable", "asset-input-invalid"]);
const RENEWAL_SET_ASIDE_MS = 7 * 24 * 60 * 60_000;
const MAX_SET_ASIDE_REVISIONS = 50;

export type SchedulerLeaseResult =
  | { acquired: true; until: string; state: Record<string, unknown> }
  | { acquired: false; reason: "busy" | "backoff"; until: string | null };

export interface MarketingSchedulerStore {
  /** False when this tick id was recorded before: the tick does nothing. */
  beginTick(tick: string, kind: MarketingTickKind): Promise<boolean>;
  finishTick(tick: string, did: MarketingTickStep[], errors: MarketingTickError[]): Promise<boolean>;
  acquire(lease: MarketingSchedulerLease, holder: string, seconds: number): Promise<SchedulerLeaseResult>;
  /** `state` omitted keeps the stored state; `nextAllowedAt` null clears a backoff. */
  release(lease: MarketingSchedulerLease, holder: string, update: { nextAllowedAt: string | null; state?: Record<string, unknown> }): Promise<boolean>;
  /** Replaces the state while `holder` still holds the live lease; false when it no longer does. */
  saveState(lease: MarketingSchedulerLease, holder: string, state: Record<string, unknown>): Promise<boolean>;
  pruneTicks(days: number): Promise<number>;
}

/** `pilot` marks a retained collection-pilot run: it occupies its date, and the scheduler never ticks it or makes briefs from it. */
export type SchedulerCollectionRun = { id: string; date: string; status: "running" | "complete" | "partial" | "held" | "failed"; pilot: boolean };
export type SchedulerPublishOutcome = { publicationId: string; status: string; errorCode: string | null };

/** Everything a tick touches. `createMarketingSchedulerPorts` wires the real modules; tests pass fakes. */
export interface MarketingSchedulerPorts {
  store: MarketingSchedulerStore;
  /** The owner's single DNESKAi project (isDneskaiProject + requireDneskaiProject). */
  dneskaiProject(): Promise<string>;
  /** Collection runs of the last two Prague days, newest first, pilot runs flagged. */
  collectionRuns(project: string, today: string): Promise<SchedulerCollectionRun[]>;
  /** One tickDneskaiCollection: admits today's run when `runId` is absent. */
  tickCollection(project: string, runId: string | undefined, signal: AbortSignal): Promise<DneskaiCollectResponse>;
  pendingMedia(project: string): Promise<string[]>;
  collectMedia(project: string, candidateIds: string[], options: { signal: AbortSignal; budgetMs: number }): Promise<{ complete: boolean; candidates: DneskaiMediaOutcome[] }>;
  /** True while any media candidate of the owner is claimed by a collection pass. */
  mediaCollectionActive(): Promise<boolean>;
  purgeMedia(olderThanDays: number): Promise<{ purged: number; errorCode: string | null }>;
  createBriefs: CreateDneskaiBriefs;
  /**
   * Ordinary (non-pilot) runs, other than `except`, with a pending brief: briefs the owner reopened with retry or
   * reslot (briefs-07), which may belong to an older run than the newest finished one. Optional for older wiring.
   */
  pendingBriefRuns?(project: string, except: string): Promise<string[]>;
  /** Oldest first, queued DNESKAi generation jobs. */
  queuedGenerationJobs(limit: number): Promise<string[]>;
  executeJob(jobId: string, signal: AbortSignal): Promise<unknown>;
  /** A queued DNESKAi publication whose slot is in its 15-minute window or starts within `aheadMs`, or a claimed one waiting for its container. */
  publicationDueSoon(aheadMs: number): Promise<boolean>;
  /** A queued DNESKAi publication in its window, or a claimed one waiting for its container. */
  publicationWork(): Promise<boolean>;
  publishDue(dryRun: boolean, signal: AbortSignal): Promise<{ outcomes: SchedulerPublishOutcome[] }>;
  /**
   * The DNESKAi publication in `reconciliation` checked longest ago, if not checked since `checkedBefore`;
   * when there is none, a claimed one whose lease expired.
   */
  nextReconciliation(checkedBefore: string): Promise<string | null>;
  /** Stamps last_checked_at and runs the read-only reconciliation. */
  reconcile(publicationId: string): Promise<{ status: string; errorCode: string | null }>;
  tokenMetadata(): Promise<MetaTokenMetadata[]>;
  refreshToken(token: MetaTokenMetadata, signal: AbortSignal): Promise<InstagramTokenRefreshOutcome>;
  /** Approved and ready-for-review revisions of the owner (newest 50) with the signed URLs of their assets. */
  renewableRevisions(): Promise<Array<{ id: string; assetUrls: string[] }>>;
  renewRevision(revisionId: string): Promise<{ renewed: number }>;
  /**
   * Owner decision 7: writes the in-app review reminders that are due and were not sent before
   * (`sendDneskaiReviewReminders`). Optional: without it the minute tick has no reminder step.
   */
  reviewReminders?(project: string, now: Date): Promise<{ due: number; sent: number }>;
  /** #151: turns the night's education reports and highly rated library links into proposed topics (`scoutDneskaiTopics`). */
  scoutTopics?(project: string, now: Date): Promise<DneskaiScoutingResult>;
}

export interface MarketingSchedulerDependencies {
  owner: string;
  env: Environment;
  ports: MarketingSchedulerPorts;
  now?: () => Date;
  /** Aborts the tick earlier than its 53 s hard budget (tests). */
  signal?: AbortSignal;
}

type StepOutcome = {
  status: MarketingTickStatus; code?: string; pending?: boolean; detail?: MarketingTickDetail;
  /** Written on release: the earliest time the category may run again (null clears it). */
  nextAllowedAt?: string | null;
  /** Written on release when present; otherwise the stored state stays. */
  state?: Record<string, unknown>;
  /** Leaves the lease to expire on its own: work cut off by the tick signal may still be running. */
  keepLease?: boolean;
};
type StepContext = {
  state: Record<string, unknown>; signal: AbortSignal; remainingMs: () => number; now: () => Date;
  /** Stores state under the held lease before the step finishes; false when it could not. */
  saveState: (state: Record<string, unknown>) => Promise<boolean>;
};
type Step = {
  category: MarketingTickCategory;
  lease: MarketingSchedulerLease | null;
  /** Cheap reads that decide, without a lease, that there is nothing to do or that the category is paused. */
  precheck?: () => Promise<StepOutcome | null>;
  /** Overrides MINIMUM_START_MS for this tick. */
  minimumStartMs?: number;
  run: (context: StepContext) => Promise<StepOutcome>;
};

/** Publishing goes live only when both switches are on; otherwise the publisher runs as a dry run. */
export function marketingPublishingLive(env: Environment): boolean {
  return env.MARKETING_PUBLISH_ENABLED === "true" && env.MARKETING_DNESKAI_PUBLISH_ENABLED === "true";
}

/** A stable code for the tick record: an error's own code when it is one, otherwise `<category>-failed`. */
export function schedulerFailureCode(error: unknown, category: MarketingTickCategory): string {
  const candidate = error instanceof Error ? ("code" in error && typeof error.code === "string" ? error.code : error.message) : "";
  return /^[a-z][a-z0-9-]{1,79}$/.test(candidate) ? candidate : `${category}-failed`;
}

/** Expiry (ms) of a Supabase signed storage URL, read from its token's `exp`; null when it cannot be read. */
export function signedUrlExpiresAt(url: string): number | null {
  try {
    const token = new URL(url).searchParams.get("token");
    const payload = token?.split(".")[1];
    if (!payload) return null;
    const exp = (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown }).exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch { return null; }
}

function pragueHour(now: Date): number {
  return Number(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague", hour: "2-digit", hourCycle: "h23" }).format(now));
}
const iso = (ms: number) => new Date(ms).toISOString();
const stringRecord = (value: unknown): Record<string, string> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : {};
const liveUntil = (value: unknown, now: number) => Object.fromEntries(Object.entries(stringRecord(value)).filter(([, until]) => Date.parse(until) > now));
class TickCutOff extends Error { constructor(readonly code: string) { super(code); } }
/** Settles when `work` does or when the tick signal fires, whichever is first, so the tick record is always written. */
function untilCutOff<T>(work: Promise<T>, signal: AbortSignal, code: string): Promise<T> {
  if (signal.aborted) return Promise.reject(new TickCutOff(code));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new TickCutOff(code));
    signal.addEventListener("abort", abort, { once: true });
    work.then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error: unknown) => { signal.removeEventListener("abort", abort); reject(error); },
    );
  });
}

export async function runMarketingTick(deps: MarketingSchedulerDependencies, value: unknown): Promise<MarketingTickResult> {
  const input = MarketingTickInputSchema.parse(value);
  const { ports, env, owner } = deps;
  const clock = deps.now ?? (() => new Date());
  const started = clock().getTime();
  const remaining = () => MARKETING_TICK_SOFT_BUDGET_MS - (clock().getTime() - started);
  const hard = AbortSignal.timeout(MARKETING_TICK_HARD_BUDGET_MS);
  const signal = deps.signal ? AbortSignal.any([deps.signal, hard]) : hard;
  if (!(await ports.store.beginTick(input.tick, input.kind))) {
    return { tick: input.tick, kind: input.kind, duplicate: true, recorded: false, did: [], errors: [], next: { pending: [] } };
  }

  // Per-tick memos. The run list is read again after the collection step changed it.
  let projectRead: Promise<string> | null = null;
  const project = () => (projectRead ??= ports.dneskaiProject());
  let runsRead: Promise<SchedulerCollectionRun[]> | null = null;
  const runs = () => (runsRead ??= project().then((id) => ports.collectionRuns(id, pragueMarketingDate(clock()))));
  const ordinaryRuns = async () => (await runs()).filter((run) => !run.pilot);
  let yieldRead: Promise<boolean> | null = null;
  const yieldToPublication = () => (yieldRead ??= marketingPublishingLive(env) ? ports.publicationDueSoon(MARKETING_PUBLICATION_YIELD_MS) : Promise.resolve(false));
  const intakePaused = (): StepOutcome | null => env.MARKETING_DNESKAI_COLLECTION_ENABLED === "true" ? null : { status: "skipped", code: "collection-disabled" };
  const yielded: StepOutcome = { status: "deferred", code: "yield-to-publication", pending: true };

  let mediaPending: string[] = [];
  let briefRun: SchedulerCollectionRun | null = null;
  let queuedJobs: string[] = [];
  let reconciliationId: string | null = null;
  let dueTokens: MetaTokenMetadata[] = [];

  const minuteSteps: Step[] = [
    {
      category: "collection", lease: "collection",
      async precheck(): Promise<StepOutcome | null> {
        const paused = intakePaused(); if (paused) return paused;
        // The hour cannot be tested before the run list: a run admitted at 22:00 continues past midnight and is
        // found only there. The list is read once per tick and reused by the briefs step, so a slow read is not
        // repeated; its duration is recorded on the no-op so a stall can be attributed (production-13).
        const yieldStarted = clock().getTime();
        if (await yieldToPublication()) return yielded;
        const runsStarted = clock().getTime();
        const list = await runs(), today = pragueMarketingDate(clock());
        const detail = { yieldMs: Math.max(0, runsStarted - yieldStarted), runsMs: Math.max(0, clock().getTime() - runsStarted) };
        if (list.some((run) => !run.pilot && run.status === "running")) return null;
        if (list.some((run) => !run.pilot && run.date === today)) return { status: "noop", code: "collection-finished", detail };
        // Admission refuses a date a pilot run holds; asking would only record the same error each tick.
        if (list.some((run) => run.pilot && run.date === today)) return { status: "noop", code: "collection-pilot-today", detail };
        if (pragueHour(clock()) < 22) return { status: "noop", code: "collection-not-due", detail };
        return null;
      },
      async run({ signal: abort, now }): Promise<StepOutcome> {
        const running = (await ordinaryRuns()).find((run) => run.status === "running");
        let response: DneskaiCollectResponse;
        try { response = await ports.tickCollection(await project(), running?.id, abort); }
        catch (error) {
          if (error instanceof Error && error.message === "collection-not-due") return { status: "noop", code: "collection-not-due" };
          throw error;
        } finally { runsRead = null; }
        const retry = response.continue && response.retryAfterSeconds ? Math.min(300, Math.max(0, response.retryAfterSeconds)) : 0;
        return {
          status: "done", pending: response.continue,
          detail: { runId: response.runId, runStatus: response.status, continue: response.continue, admitted: !running },
          nextAllowedAt: retry ? iso(now().getTime() + retry * 1000) : null,
        };
      },
    },
    {
      category: "media", lease: "media",
      async precheck(): Promise<StepOutcome | null> {
        const paused = intakePaused(); if (paused) return paused;
        mediaPending = await ports.pendingMedia(await project());
        if (!mediaPending.length) return { status: "noop" };
        if (await yieldToPublication()) return yielded;
        return null;
      },
      async run({ signal: abort, remainingMs, now }): Promise<StepOutcome> {
        const budgetMs = Math.max(0, Math.min(MARKETING_TICK_MEDIA_BUDGET_MS, remainingMs() - 3_000));
        try {
          const result = await ports.collectMedia(await project(), mediaPending, { signal: abort, budgetMs });
          const busy = result.candidates.filter((candidate) => candidate.status === "busy").length;
          return {
            status: "done", pending: !result.complete,
            detail: { candidates: result.candidates.length, complete: result.complete, downloaded: result.candidates.reduce((sum, item) => sum + item.downloaded, 0), busy },
            nextAllowedAt: busy ? iso(now().getTime() + MEDIA_BUSY_BACKOFF_MS) : null,
          };
        } catch (error) {
          // A transient failure (store, storage, network) waits ten minutes before the next pass.
          return { status: "error", code: schedulerFailureCode(error, "media"), pending: true, nextAllowedAt: iso(now().getTime() + MEDIA_FAILURE_BACKOFF_MS) };
        }
      },
    },
    {
      category: "briefs", lease: "briefs",
      async precheck(): Promise<StepOutcome | null> {
        const paused = intakePaused(); if (paused) return paused;
        briefRun = (await ordinaryRuns()).find((run) => run.status !== "running") ?? null;
        if (!briefRun) return { status: "noop", code: "briefs-no-finished-run" };
        if (await yieldToPublication()) return yielded;
        return null;
      },
      async run({ state, signal: abort }): Promise<StepOutcome> {
        const run = briefRun!;
        const current = state.runId === run.id && state.pending === false;
        try {
          // An owner retry or reslot reopens a brief as pending, possibly in the newest run after it went current or
          // in an older run; those runs get the same createBriefs call, so admission rules stay the ordinary ones.
          const reopened = ports.pendingBriefRuns ? (await ports.pendingBriefRuns(await project(), current ? "" : run.id)).slice(0, 3) : [];
          const runIds = [...new Set([...(current ? [] : [run.id]), ...reopened])];
          if (!runIds.length) return { status: "noop", code: "briefs-current" };
          let created = 0, jobs = 0, skipped = 0, pending = false, newest: boolean | null = current ? false : null;
          for (const runId of runIds) {
            if (abort.aborted) { pending = true; break; }
            const result = await ports.createBriefs({ owner, project: await project(), runId, signal: abort });
            created += result.created.length; jobs += result.created.filter((item) => item.jobId).length; skipped += result.skipped.length;
            pending ||= result.pending;
            if (runId === run.id) newest = result.pending;
          }
          return {
            status: created ? "done" : "noop", pending,
            detail: { runId: run.id, created, jobs, skipped, ...(reopened.length ? { reopenedRuns: reopened.length } : {}) },
            state: { runId: run.id, pending: newest ?? true },
          };
        } catch (error) {
          // #115 wires brief creation; until then the step is a recorded skip.
          if (error instanceof Error && error.message === "briefs-unwired") return { status: "skipped", code: "briefs-unwired" };
          return { status: "error", code: schedulerFailureCode(error, "briefs") };
        }
      },
    },
    {
      category: "generation", lease: "generation",
      async precheck(): Promise<StepOutcome | null> {
        if (env.MARKETING_AI_CONSENT !== "true") return { status: "skipped", code: "generation-consent-required" };
        queuedJobs = await ports.queuedGenerationJobs(5);
        if (!queuedJobs.length) return { status: "noop" };
        if (await yieldToPublication()) return yielded;
        return null;
      },
      async run({ state, signal: abort, now }): Promise<StepOutcome> {
        const blocked = liveUntil(state.blocked, now().getTime());
        const jobId = queuedJobs.find((id) => !blocked[id]);
        if (!jobId) return { status: "skipped", code: "generation-jobs-blocked", pending: true, detail: { blocked: Object.keys(blocked).length }, state: { blocked } };
        try {
          const result = await ports.executeJob(jobId, abort) as { claimed?: unknown; status?: unknown; job?: { status?: unknown } | null } | null;
          const jobStatus = typeof result?.status === "string" ? result.status : typeof result?.job?.status === "string" ? result.job.status : null;
          return {
            // A job queued again for its deferred retry (GEN-14) makes its second attempt on the next tick.
            status: "done", pending: queuedJobs.length > 1 || jobStatus === "queued",
            detail: { jobId, claimed: result?.claimed === true, jobStatus },
            state: { blocked },
          };
        } catch (error) {
          // A job that throws before it is claimed stays queued; it waits an hour so younger jobs still run.
          const next = Object.fromEntries([...Object.entries(blocked), [jobId, iso(now().getTime() + JOB_BLOCK_MS)]].slice(-MAX_BLOCKED_JOBS));
          return { status: "error", code: schedulerFailureCode(error, "generation"), pending: true, detail: { jobId }, state: { blocked: next } };
        }
      },
    },
    {
      category: "publishing", lease: "publishing",
      minimumStartMs: marketingPublishingLive(env) ? MARKETING_LIVE_PUBLISH_MINIMUM_START_MS : MINIMUM_START_MS.publishing,
      async precheck(): Promise<StepOutcome | null> { return (await ports.publicationWork()) ? null : { status: "noop" }; },
      async run({ signal: abort }): Promise<StepOutcome> {
        const dryRun = !marketingPublishingLive(env);
        const { outcomes } = await ports.publishDue(dryRun, abort);
        const count = (status: string) => outcomes.filter((outcome) => outcome.status === status).length;
        return {
          status: "done", pending: outcomes.some((outcome) => outcome.status === "pending"),
          detail: { dryRun, outcomes: outcomes.length, published: count("published"), pending: count("pending"), held: count("held"), failed: count("failed"), reconciliation: count("reconciliation"), dryRuns: count("dry-run") },
        };
      },
    },
    {
      category: "reconciliation", lease: "reconciliation",
      async precheck(): Promise<StepOutcome | null> {
        reconciliationId = await ports.nextReconciliation(iso(clock().getTime() - MARKETING_RECONCILIATION_INTERVAL_MS));
        return reconciliationId ? null : { status: "noop" };
      },
      async run(): Promise<StepOutcome> {
        // Read-only: Graph GET requests and, when the media is found, the receipt.
        const outcome = await ports.reconcile(reconciliationId!);
        return { status: "done", detail: { publicationId: reconciliationId, outcome: outcome.status, errorCode: outcome.errorCode } };
      },
    },
    {
      category: "token", lease: "token",
      async precheck(): Promise<StepOutcome | null> {
        dueTokens = (await ports.tokenMetadata()).filter((token) => token.platform === "instagram" && instagramTokenRefreshDue(token, clock()));
        return dueTokens.length ? null : { status: "noop" };
      },
      async run({ state, signal: abort, now, saveState }): Promise<StepOutcome> {
        const at = now().getTime();
        // An uncertain refresh is never retried for the same stored token; a new token (account verification) lifts it.
        const uncertain = Object.fromEntries(Object.entries(stringRecord(state.uncertain)).filter(([account, refreshedAt]) => dueTokens.some((token) => token.accountId === account && token.refreshedAt === refreshedAt)));
        const backoff = liveUntil(state.backoff, at);
        const token = dueTokens.find((item) => uncertain[item.accountId] === undefined && backoff[item.accountId] === undefined);
        if (!token) {
          return { status: "skipped", code: Object.keys(uncertain).length ? "token-refresh-uncertain" : "token-refresh-backoff", state: { uncertain, backoff } };
        }
        const detail = { accountId: token.accountId };
        // The refresh is marked uncertain before it is sent: if its answer, or the release below, is
        // lost, the next tick still finds the mark and never sends a second refresh for this token.
        const marked = { ...uncertain, [token.accountId]: token.refreshedAt };
        if (!(await saveState({ uncertain: marked, backoff }).catch(() => false))) return { status: "error", code: "scheduler-state-unavailable", detail };
        let outcome: InstagramTokenRefreshOutcome;
        try { outcome = await ports.refreshToken(token, abort); }
        catch { outcome = { status: "uncertain", accountId: token.accountId, code: "refresh-request-uncertain" }; }
        if (outcome.status === "refreshed") {
          delete backoff[token.accountId];
          return { status: "done", detail: { ...detail, expiresAt: outcome.expiresAt }, state: { uncertain, backoff } };
        }
        if (outcome.status === "uncertain") return { status: "error", code: outcome.code, detail, state: { uncertain: marked, backoff } };
        const wait = outcome.status === "failed" ? TOKEN_FAILED_BACKOFF_MS : TOKEN_HELD_BACKOFF_MS;
        return { status: outcome.status === "failed" ? "error" : "skipped", code: outcome.code, detail, state: { uncertain, backoff: { ...backoff, [token.accountId]: iso(at + wait) } } };
      },
    },
  ];

  const scoutTopics = ports.scoutTopics;
  if (scoutTopics && dneskaiScoutingEnabled(env)) minuteSteps.splice(1, 0, {
    category: MARKETING_TICK_SCOUTING, lease: null,
    async precheck(): Promise<StepOutcome | null> {
      const hour = pragueHour(clock());
      if (hour >= 8 && hour < 22) return { status: "noop", code: "scouting-not-due" };
      if (Math.floor(clock().getTime() / MARKETING_TICK_INTERVAL_MS) % 12 !== 0) return { status: "noop", code: "scouting-not-this-slot" };
      if (await yieldToPublication()) return yielded;
      return null;
    },
    async run({ now }): Promise<StepOutcome> {
      const result = await scoutTopics(await project(), now());
      return { status: result.inserted ? "done" : "noop", detail: { reports: result.reports, library: result.library, inserted: result.inserted, skipped: result.skipped } };
    },
  });

  // Off only when the owner sets DNESKAI_REVIEW_REMINDERS_ENABLED=false; nothing but in-app notifications is written.
  const reviewReminders = ports.reviewReminders;
  if (reviewReminders) minuteSteps.push({
    category: MARKETING_TICK_REMINDER, lease: null,
    async precheck(): Promise<StepOutcome | null> {
      return env.DNESKAI_REVIEW_REMINDERS_ENABLED === "false" ? { status: "skipped", code: "reminders-disabled" } : null;
    },
    async run({ now }): Promise<StepOutcome> {
      const result = await reviewReminders(await project(), now());
      return { status: result.sent ? "done" : "noop", detail: { due: result.due, sent: result.sent } };
    },
  });

  const dailySteps: Step[] = [
    {
      category: "renewal", lease: "renewal",
      async run({ state, signal: abort, remainingMs, now }): Promise<StepOutcome> {
        const at = now().getTime();
        const revisions = await ports.renewableRevisions();
        const horizon = at + MARKETING_URL_RENEWAL_WINDOW_MS;
        const expiring = revisions.filter((revision) => revision.assetUrls.some((url) => { const expires = signedUrlExpiresAt(url); return expires === null || expires < horizon; }));
        // A revision that can never be renewed would otherwise take a slot and record an error every day.
        const setAside = liveUntil(state.setAside, at);
        const due = expiring.filter((revision) => !setAside[revision.id]);
        let renewed = 0, failed = 0, code: string | undefined, cutOff = false;
        for (const revision of due.slice(0, RENEWALS_PER_TICK)) {
          if (remainingMs() < RENEWAL_RESERVE_MS) break;
          try { await untilCutOff(ports.renewRevision(revision.id), abort, "renewal-cut-off"); renewed++; }
          catch (error) {
            failed++;
            const failure = schedulerFailureCode(error, "renewal");
            code ??= failure;
            if (error instanceof TickCutOff) { cutOff = true; break; }
            if (PERMANENT_RENEWAL_CODES.has(failure)) setAside[revision.id] = iso(at + RENEWAL_SET_ASIDE_MS);
          }
        }
        const listed = new Set(revisions.map((revision) => revision.id));
        return {
          status: failed ? "error" : renewed ? "done" : "noop", ...(code ? { code } : {}), pending: due.length > renewed + failed,
          detail: { checked: revisions.length, expiring: expiring.length, renewed, failed, setAside: expiring.length - due.length },
          state: { setAside: Object.fromEntries(Object.entries(setAside).filter(([id]) => listed.has(id)).slice(-MAX_SET_ASIDE_REVISIONS)) },
          ...(cutOff ? { keepLease: true } : {}),
        };
      },
    },
    {
      category: "purge", lease: "media",
      async run({ signal: abort }): Promise<StepOutcome> {
        if (await ports.mediaCollectionActive()) return { status: "skipped", code: "media-collection-in-progress", pending: true };
        let result: { purged: number; errorCode: string | null };
        try { result = await untilCutOff(ports.purgeMedia(MARKETING_MEDIA_RETENTION_DAYS), abort, "purge-cut-off"); }
        catch (error) {
          // A purge still running must keep media collection out until its lease expires after the function has stopped.
          if (error instanceof TickCutOff) return { status: "error", code: error.code, keepLease: true };
          throw error;
        }
        return { status: result.errorCode ? "error" : result.purged ? "done" : "noop", ...(result.errorCode ? { code: result.errorCode } : {}), detail: { purged: result.purged } };
      },
    },
    {
      category: "retention", lease: null,
      async run(): Promise<StepOutcome> {
        const removed = await ports.store.pruneTicks(MARKETING_TICK_RETENTION_DAYS);
        return { status: removed ? "done" : "noop", detail: { removed } };
      },
    },
  ];

  const did: MarketingTickStep[] = [];
  for (const step of input.kind === "minute" ? await minuteOrder(minuteSteps.map(memoizedPrecheck), started) : dailySteps) {
    did.push(await runStep(step, { store: ports.store, holder: input.tick, clock, remaining, signal }));
  }
  const errors = did.filter((step) => step.status === "error").map((step) => ({ category: step.category, code: step.code ?? `${step.category}-failed` }));
  let recorded = false;
  try { recorded = await ports.store.finishTick(input.tick, did, errors); } catch { recorded = false; }
  return { tick: input.tick, kind: input.kind, duplicate: false, recorded, did, errors, next: { pending: did.filter((step) => step.pending).map((step) => step.category) } };
}

/** The precheck runs at most once per tick: the order is chosen from it before the step itself reuses it. */
function memoizedPrecheck(step: Step): Step {
  const precheck = step.precheck;
  if (!precheck) return step;
  let read: Promise<StepOutcome | null> | null = null;
  return { ...step, precheck: () => (read ??= precheck()) };
}

/**
 * Generation first when a queued job is runnable (its precheck passed: consent, a queued job, no publication
 * to yield to), except in collection's slot while collection has work. A precheck that fails keeps the usual
 * order; runStep records the failure as before.
 */
async function minuteOrder(steps: Step[], started: number): Promise<Step[]> {
  const generation = steps.find((step) => step.category === "generation");
  const collection = steps.find((step) => step.category === "collection");
  if (!generation?.precheck) return steps;
  const runnable = (step: Step | undefined) => step?.precheck ? step.precheck().then((outcome) => outcome === null, () => false) : Promise.resolve(false);
  if (!(await runnable(generation))) return steps;
  if (marketingCollectionTurn(started) && await runnable(collection)) return steps;
  return [generation, ...steps.filter((step) => step !== generation)];
}

async function runStep(step: Step, context: { store: MarketingSchedulerStore; holder: string; clock: () => Date; remaining: () => number; signal: AbortSignal }): Promise<MarketingTickStep> {
  const { store, holder, clock, remaining, signal } = context;
  const begun = clock().getTime();
  const record = (outcome: StepOutcome): MarketingTickStep => ({
    category: step.category, status: outcome.status, ...(outcome.code ? { code: outcome.code } : {}), ...(outcome.pending ? { pending: true } : {}),
    ms: Math.max(0, clock().getTime() - begun), ...(outcome.detail ? { detail: outcome.detail } : {}),
  });
  const budgetSpent: StepOutcome = { status: "deferred", code: "tick-budget-exhausted", pending: true };
  if (remaining() < 1_000 || signal.aborted) return record(budgetSpent);
  try {
    const early = await step.precheck?.();
    if (early) return record(early);
  } catch (error) { return record({ status: "error", code: schedulerFailureCode(error, step.category) }); }
  if (remaining() < (step.minimumStartMs ?? MINIMUM_START_MS[step.category])) return record(budgetSpent);
  let lease: SchedulerLeaseResult | null = null;
  if (step.lease) {
    try { lease = await store.acquire(step.lease, holder, MARKETING_TICK_LEASE_SECONDS); }
    catch { return record({ status: "error", code: "scheduler-state-unavailable" }); }
    if (!lease.acquired) return record({ status: lease.reason, code: lease.reason === "busy" ? "lease-held" : "backoff-active", pending: true, detail: { until: lease.until } });
  }
  let outcome: StepOutcome;
  const held = step.lease && lease?.acquired ? step.lease : null;
  const saveState = (state: Record<string, unknown>) => held ? store.saveState(held, holder, state) : Promise.resolve(false);
  try { outcome = await step.run({ state: lease?.acquired ? lease.state : {}, signal, remainingMs: remaining, now: clock, saveState }); }
  catch (error) { outcome = { status: "error", code: schedulerFailureCode(error, step.category) }; }
  if (step.lease && lease?.acquired && !outcome.keepLease) {
    // A failed release leaves the lease to expire on its own (90 s); the next tick is five minutes away.
    try { await store.release(step.lease, holder, { nextAllowedAt: outcome.nextAllowedAt ?? null, ...(outcome.state ? { state: outcome.state } : {}) }); }
    catch { /* recorded below as it happened */ }
  }
  return record(outcome);
}

const LeaseSchema = z.union([
  z.object({ acquired: z.literal(true), until: z.string(), state: z.record(z.string(), z.unknown()) }),
  z.object({ acquired: z.literal(false), reason: z.enum(["busy", "backoff"]), until: z.string().nullable() }),
]);

/** The scheduler state through the service-role functions of 20261021124438_marketing_scheduler_functions.sql and
 * 20261022000000_marketing_scheduler_retention.sql. */
export function createMarketingSchedulerStore(db: Database, owner: string): MarketingSchedulerStore {
  z.uuid().parse(owner);
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await db.rpc(name, args);
    if (error) throw new Error("scheduler-state-unavailable");
    return data as unknown;
  };
  return {
    async beginTick(tick, kind) { return (await rpc("marketing_scheduler_begin_tick", { p_owner: owner, p_tick: tick, p_kind: kind })) === true; },
    async finishTick(tick, did, errors) { return (await rpc("marketing_scheduler_finish_tick", { p_owner: owner, p_tick: tick, p_did: did, p_errors: errors })) === true; },
    async acquire(lease, holder, seconds) {
      const parsed = LeaseSchema.safeParse(await rpc("marketing_scheduler_acquire", { p_owner: owner, p_category: lease, p_holder: holder, p_seconds: seconds }));
      if (!parsed.success) throw new Error("scheduler-state-unavailable");
      return parsed.data;
    },
    async release(lease, holder, update) {
      return (await rpc("marketing_scheduler_release", { p_owner: owner, p_category: lease, p_holder: holder, p_next_allowed_at: update.nextAllowedAt, p_state: update.state ?? null })) === true;
    },
    async saveState(lease, holder, state) {
      return (await rpc("marketing_scheduler_save_state", { p_owner: owner, p_category: lease, p_holder: holder, p_state: state })) === true;
    },
    async pruneTicks(days) {
      const removed = await rpc("marketing_scheduler_prune_ticks", { p_owner: owner, p_days: days });
      return typeof removed === "number" ? removed : 0;
    },
  };
}
