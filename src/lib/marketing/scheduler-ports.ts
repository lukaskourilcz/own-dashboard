import "server-only";
import { z } from "zod";
import type { createAdminClient } from "@/lib/supabase/admin";
import { tickDneskaiCollection } from "./dneskai-collection";
import { createDneskaiCollectionStore, requireDneskaiProject } from "./dneskai-store";
import { isDneskaiProject } from "./dneskai-registry";
import { collectDneskaiMedia, createDneskaiMediaLoader, pendingDneskaiMediaCandidates, purgeUnusedDneskaiMedia } from "./dneskai-media";
import { getCreateDneskaiBriefs } from "./dneskai-wiring";
import { executeMarketingJob } from "./worker-runtime";
import { refreshSource } from "./source-refresh";
import { publishDueMarketing, reconcileStoredMarketingPublication } from "./orchestrator";
import { CONTAINER_RETRY_CODE } from "./publisher";
import { listMetaTokenMetadata, refreshInstagramToken } from "./meta-credentials";
import { renewStoredRevisionAssetUrls } from "./asset-urls";
import { createMarketingSchedulerStore, type MarketingSchedulerPorts, type SchedulerCollectionRun } from "./scheduler";
import { sendDneskaiReviewReminders } from "./dneskai-reminders";
import { runDneskaiEngagementWatch } from "./dneskai-engagement-watch";
import { createDneskaiEngagementGraph, createDneskaiEngagementStore } from "./dneskai-engagement-ports";
import { scoutDneskaiTopics } from "./dneskai-scouting";
import { advanceDneskaiFactOrHype } from "./dneskai-fact-or-hype";
import { createClaudeTopicModel, dneskaiTopicModelConfiguration } from "./dneskai-topic-model";

/**
 * The real modules behind the scheduler's ports (#120). Each port calls one existing exported function or
 * one bounded read; the owners of collection (#112), media (#114), briefs (#115), generation (#116),
 * revisions (#118) and Meta tokens (#121) keep their logic, fences and failure codes.
 */
type Database = ReturnType<typeof createAdminClient>;
type Environment = Record<string, string | undefined>;
const DUE_WINDOW_MS = 15 * 60_000;
const RunRowSchema = z.object({ id: z.uuid(), date: z.iso.date(), status: z.enum(["running", "complete", "partial", "held", "failed"]), collection_pilot_owner: z.uuid().nullable().optional() })
  .transform(({ collection_pilot_owner, ...run }) => ({ ...run, pilot: Boolean(collection_pilot_owner) }));

function daysBefore(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

/** The owner's one DNESKAi project, found through the portfolio registry and checked by requireDneskaiProject. */
export async function resolveDneskaiProjectId(db: Database, owner: string): Promise<string> {
  z.uuid().parse(owner);
  const { data, error } = await db.from("projects").select("id,user_id,portfolio_key,repo_full_name,previous_repo_full_names,parent_id").eq("user_id", owner).limit(1000);
  if (error) throw new Error("dneskai-project-unavailable");
  const matches = (data ?? []).filter((row) => row.user_id === owner && isDneskaiProject(row));
  if (matches.length !== 1) throw new Error(matches.length ? "dneskai-project-ambiguous" : "dneskai-project-unavailable");
  try { await requireDneskaiProject(db, owner, matches[0].id); } catch { throw new Error("dneskai-project-unavailable"); }
  return matches[0].id as string;
}

export function createMarketingSchedulerPorts(db: Database, owner: string, env: Environment = process.env): MarketingSchedulerPorts {
  z.uuid().parse(owner);
  const publications = (columns = "id") => db.from("marketing_publications").select(`${columns},marketing_revisions!inner(brand)`).eq("user_id", owner).eq("marketing_revisions.brand", "dneskai");
  const any = async (query: PromiseLike<{ data: unknown[] | null; error: unknown }>, code: string) => {
    const { data, error } = await query;
    if (error) throw new Error(code);
    return (data ?? []).length > 0;
  };
  /** The same claimed continuation publishDueMarketing's pending query picks up. */
  const containerPending = (now: Date) =>
    any(publications().eq("status", "claimed").in("error_code", ["container-pending", CONTAINER_RETRY_CODE]).gt("lease_until", now.toISOString()).limit(1), "publication-state-unavailable");
  return {
    store: createMarketingSchedulerStore(db, owner),
    dneskaiProject: () => resolveDneskaiProjectId(db, owner),
    async collectionRuns(project, today): Promise<SchedulerCollectionRun[]> {
      const { data, error } = await db.from("marketing_dneskai_runs").select("id,date,status,collection_pilot_owner").eq("user_id", owner).eq("project_id", project)
        .gte("date", daysBefore(today, 2)).order("date", { ascending: false }).limit(5);
      if (error) throw new Error("collection-state-unavailable");
      return z.array(RunRowSchema).parse(data ?? []);
    },
    tickCollection: (project, runId, signal) =>
      tickDneskaiCollection(owner, { projectId: project, ...(runId ? { runId } : {}) }, { store: createDneskaiCollectionStore(db), signal, env }),
    pendingMedia: (project) => pendingDneskaiMediaCandidates(db, owner, project),
    collectMedia: (project, candidateIds, options) => collectDneskaiMedia(db, owner, project, candidateIds, options),
    async mediaCollectionActive() {
      return any(db.from("marketing_media_collections").select("candidate_id").eq("user_id", owner).gt("lease_until", new Date().toISOString()).limit(1), "media-state-unavailable");
    },
    purgeMedia: (days) => purgeUnusedDneskaiMedia(db, owner, days),
    createBriefs: getCreateDneskaiBriefs(db),
    async pendingBriefRuns(project, except) {
      const { data, error } = await db.from("marketing_dneskai_briefs").select("run_id").eq("user_id", owner).eq("project_id", project).eq("status", "pending")
        .order("updated_at", { ascending: false }).limit(20);
      if (error) throw new Error("briefs-state-unavailable");
      const ids = [...new Set(z.array(z.object({ run_id: z.uuid() })).parse(data ?? []).map((row) => row.run_id))].filter((id) => id !== except);
      if (!ids.length) return [];
      // A retained collection-pilot run never gets briefs from the scheduler.
      const runs = await db.from("marketing_dneskai_runs").select("id,collection_pilot_owner").eq("user_id", owner).eq("project_id", project).in("id", ids);
      if (runs.error) throw new Error("briefs-state-unavailable");
      const ordinary = new Set(z.array(z.object({ id: z.uuid(), collection_pilot_owner: z.uuid().nullable().optional() })).parse(runs.data ?? []).filter((run) => !run.collection_pilot_owner).map((run) => run.id));
      return ids.filter((id) => ordinary.has(id));
    },
    async queuedGenerationJobs(limit) {
      const { data, error } = await db.from("marketing_jobs").select("id").eq("user_id", owner).eq("status", "queued")
        .eq("request->generation->source->>brand", "dneskai").order("created_at").order("id").limit(Math.max(1, Math.min(20, limit)));
      if (error) throw new Error("job-state-unavailable");
      return z.array(z.object({ id: z.uuid() })).parse(data ?? []).map((row) => row.id);
    },
    reviewReminders: (project, now) => sendDneskaiReviewReminders(db, owner, project, now),
    engagementWatch: ({ signal, now, remainingMs }) => runDneskaiEngagementWatch({ store: createDneskaiEngagementStore(db, owner), graph: createDneskaiEngagementGraph(db, owner, env), now, signal, remainingMs }),
    scoutTopics: (project, now) => scoutDneskaiTopics(db, owner, project, now),
    factOrHype: (project, now, options) => advanceDneskaiFactOrHype(db, owner, project, now, { env, ...options,
      model: () => createClaudeTopicModel(dneskaiTopicModelConfiguration(env)) }),
    executeJob: (jobId, signal) => executeMarketingJob(db, owner, jobId, { refreshSource, loadDneskaiMedia: createDneskaiMediaLoader(db, owner), signal, env, deferRetry: true }),
    async publicationDueSoon(aheadMs) {
      const now = new Date();
      // A claimed carousel waiting for its container counts too: its 10-minute claim leaves room for
      // about one continuation, and a tick that spends its budget elsewhere loses the slot.
      const [soon, pending] = await Promise.all([
        any(publications().eq("status", "queued").gte("scheduled_at", new Date(now.getTime() - DUE_WINDOW_MS).toISOString()).lte("scheduled_at", new Date(now.getTime() + aheadMs).toISOString()).limit(1), "publication-state-unavailable"),
        containerPending(now),
      ]);
      return soon || pending;
    },
    async publicationWork() {
      const now = new Date();
      const [due, pending] = await Promise.all([
        any(publications().eq("status", "queued").gte("scheduled_at", new Date(now.getTime() - DUE_WINDOW_MS).toISOString()).lte("scheduled_at", now.toISOString()).limit(1), "publication-state-unavailable"),
        containerPending(now),
      ]);
      return due || pending;
    },
    async publishDue(dryRun, signal) {
      const result = await publishDueMarketing(db, owner, "dneskai", dryRun, signal);
      return { outcomes: result.outcomes.map((outcome) => ({ publicationId: outcome.publicationId, status: outcome.status, errorCode: outcome.errorCode ?? null })) };
    },
    async nextReconciliation(checkedBefore) {
      const oldest = async (query: ReturnType<typeof publications>) => {
        const { data, error } = await query.or(`last_checked_at.is.null,last_checked_at.lt."${checkedBefore}"`)
          .order("last_checked_at", { ascending: true, nullsFirst: true }).limit(1);
        if (error) throw new Error("reconciliation-state-unavailable");
        const row = (data ?? [])[0] as { id?: unknown } | undefined;
        return typeof row?.id === "string" ? row.id : null;
      };
      // A claim whose lease ran out (the function died mid-publish) becomes `reconciliation` only when
      // marketing_claim_due runs for another publication; until then it is read here, GET-only, as well.
      return (await oldest(publications().eq("status", "reconciliation")))
        ?? oldest(publications().eq("status", "claimed").lt("lease_until", new Date().toISOString()));
    },
    async reconcile(publicationId) {
      const { error } = await db.from("marketing_publications").update({ last_checked_at: new Date().toISOString() }).eq("user_id", owner).eq("id", publicationId);
      if (error) throw new Error("reconciliation-state-unavailable");
      const outcome = await reconcileStoredMarketingPublication(db, owner, publicationId);
      return { status: outcome.status, errorCode: outcome.errorCode ?? null };
    },
    tokenMetadata: () => listMetaTokenMetadata(db, owner),
    refreshToken: (token, signal) => refreshInstagramToken(db, owner, { id: token.accountId, user_id: owner, brand: token.brand, platform: token.platform }, { signal, env }),
    async renewableRevisions() {
      // Every brand: a devShark revision published through its own workflow needs live URLs just the same.
      const { data, error } = await db.from("marketing_revisions").select("id,status,ready,assets:revision->assets").eq("user_id", owner)
        .in("status", ["review", "approved"]).order("created_at", { ascending: false }).limit(50);
      if (error) throw new Error("revision-state-unavailable");
      return (data ?? []).flatMap((row) => {
        const record = row as { id?: unknown; status?: unknown; ready?: unknown; assets?: unknown };
        if (typeof record.id !== "string" || !(record.status === "approved" || record.ready === true) || !Array.isArray(record.assets)) return [];
        const assetUrls = record.assets.flatMap((asset) => asset && typeof asset === "object" && typeof (asset as { url?: unknown }).url === "string" ? [(asset as { url: string }).url] : []);
        return assetUrls.length ? [{ id: record.id, assetUrls }] : [];
      });
    },
    renewRevision: (revisionId) => renewStoredRevisionAssetUrls(db, owner, revisionId),
  };
}
