import type { SupabaseClient } from "@supabase/supabase-js";
import { JOB_SOURCES } from "./sources";
import { JOB_SOURCE_META, isCzechJobSource } from "./meta";
import { selectDeadUrls } from "./prune";
import { isCareerRelevant, isOsloRelevant } from "./filter";
import type { ScrapedJob, ScrapeSummary, SourceOutcome } from "./types";

/**
 * One full scrape: run every source in parallel, upsert the survivors into
 * `job_listings`, drop listings the boards no longer carry, and log the run
 * into `job_scrape_runs`. Callers pass the service-role client (writes bypass
 * RLS); a failing source degrades to an error entry in the summary instead of
 * failing the run.
 *
 * Removal runs per source and only for a source that answered with results, so
 * one board's outage or markup change can never delete another board's rows.
 * Whether absence is enough to delete depends on the board — see `prune.ts`.
 */

// Backstop for sources that stop answering entirely: once a source has been
// failing long enough that nothing refreshes its rows, they age out. The
// per-source sweep below handles the normal case far sooner.
// Applications keep their own snapshot columns, so pruning never loses tracked
// history (listing_id just nulls out).
const STALE_DAYS = 45;

// A board that answers successfully but returns nothing is far more likely to
// have changed its markup than to have zero matching offers, and deleting on
// that signal would empty the section. Only prune a source that returned at
// least this many listings in the run.
const PRUNE_MIN_RESULTS = 1;

const UPSERT_CHUNK = 100;

type ListingRow = {
  source: string;
  external_id: string;
  title: string;
  company: string | null;
  url: string;
  location: string | null;
  role: string;
  remote: boolean;
  salary: string | null;
  tags: string[];
  seniority: string | null;
  description: string | null;
  posted_at: string | null;
  last_seen_at: string;
};

function toRow(job: ScrapedJob, seenAt: string): ListingRow {
  return {
    source: job.source,
    external_id: job.externalId,
    title: job.title.slice(0, 300),
    company: job.company,
    url: job.url,
    location: job.location,
    role: job.role,
    remote: job.remote,
    salary: job.salary,
    tags: job.tags,
    seniority: job.seniority,
    description: job.description ? job.description.slice(0, 12000) : null,
    posted_at: job.postedAt,
    // NOTE: first_seen_at is intentionally absent — the insert default
    // stamps it once, and the conflict-update path must not reset it.
    last_seen_at: job.observedAt ?? seenAt,
  };
}

export async function runJobScrape(
  // Existing Supabase client uses ungenerated table types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any>,
  options: { includeCzech?: boolean } = {},
): Promise<ScrapeSummary> {
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + 45_000;
  const sources: Record<string, SourceOutcome> = {};

  const activeSources = JOB_SOURCES.filter(s => options.includeCzech || !isCzechJobSource(s.id));
  const activeIds = activeSources.map(s => s.id);
  const includeJob = (job: ScrapedJob) => isCareerRelevant(job) && (options.includeCzech || isOsloRelevant(job));
  const settled = await Promise.allSettled(activeSources.map((s) => s.fetch()));

  // Dedupe on (source, external_id) — the CZ boards return overlapping
  // result sets for the different role queries.
  const byKey = new Map<string, ScrapedJob>();
  settled.forEach((result, i) => {
    const id = activeSources[i].id;
    if (result.status === "fulfilled") {
      for (const job of result.value.filter(includeJob)) {
        byKey.set(`${job.source}\u0000${job.externalId}`, job);
      }
      sources[id] = { count: result.value.filter(includeJob).length };
    } else {
      sources[id] = {
        count: 0,
        error: String(
          result.reason instanceof Error
            ? result.reason.message
            : result.reason,
        ).slice(0, 300),
      };
    }
  });

  const okSources = Object.values(sources).filter((s) => !s.error).length;
  const jobs = [...byKey.values()];
  const seenAt = new Date().toISOString();

  // Which of the scraped keys already exist? Needed only for the
  // inserted/refreshed split in the summary; the upsert itself is atomic
  // on the (source, external_id) unique constraint.
  const existing = new Set<string>();
  for (let i = 0; i < jobs.length; i += UPSERT_CHUNK) {
    const chunk = jobs.slice(i, i + UPSERT_CHUNK);
    const { data } = await admin
      .from("job_listings")
      .select("source, external_id")
      .in(
        "external_id",
        chunk.map((j) => j.externalId),
      );
    for (const row of data ?? []) {
      existing.add(`${row.source}\u0000${row.external_id}`);
    }
  }

  let inserted = 0;
  let refreshed = 0;
  let upsertError: string | null = null;
  for (let i = 0; i < jobs.length; i += UPSERT_CHUNK) {
    const chunk = jobs.slice(i, i + UPSERT_CHUNK);
    const { error } = await admin.from("job_listings").upsert(
      chunk.map((j) => toRow(j, seenAt)),
      {
        onConflict: "source,external_id",
      },
    );
    if (error) {
      upsertError = error.message;
      continue;
    }
    for (const j of chunk) {
      if (existing.has(`${j.source}\u0000${j.externalId}`)) refreshed++;
      else inserted++;
    }
  }

  // Prune stale listings — but only after a run that actually reached
  // sources, so a fully-failed scrape can never start eating the table.
  let pruned = 0;
  if (okSources > 0 && !upsertError) {
    // Immediate per-source sweep: a listing this source used to return and no
    // longer does has been filled or withdrawn, so drop it now rather than
    // showing a dead link for weeks. Scoped per source and skipped for any
    // source that failed or came back suspiciously empty, so one board's
    // outage or markup change never deletes another board's listings.
    for (const { id } of activeSources) {
      if (Date.now() > deadline - 5000) break;
      const outcome = sources[id];
      if (!outcome || outcome.error) continue;
      if (outcome.count < PRUNE_MIN_RESULTS) continue;

      const { data: missing } = await admin
        .from("job_listings")
        .select("id, url")
        .eq("source", id)
        .lt("last_seen_at", seenAt);
      const candidates = missing ?? [];
      if (candidates.length === 0) continue;

      // A complete feed answers with the board's whole current set, so absence
      // is proof. A paginated or query-limited source has to be asked.
      let doomed: string[];
      if (JOB_SOURCE_META[id]?.complete) {
        doomed = candidates.map((row) => row.id as string);
      } else {
        const dead = await selectDeadUrls(
          candidates.map((row) => row.url as string),
          { budgetMs: 1000, maxChecks: 5 },
        );
        doomed = candidates
          .filter((row) => dead.has(row.url as string))
          .map((row) => row.id as string);
      }

      for (let i = 0; i < doomed.length; i += UPSERT_CHUNK) {
        const { data: gone } = await admin
          .from("job_listings")
          .delete()
          .in("id", doomed.slice(i, i + UPSERT_CHUNK))
          .select("id");
        const count = gone?.length ?? 0;
        outcome.pruned = (outcome.pruned ?? 0) + count;
        pruned += count;
      }
    }

    const cutoff = new Date(
      Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { data: prunedRows } = await admin
      .from("job_listings")
      .delete()
      .in("source", activeIds)
      .lt("last_seen_at", cutoff)
      .select("id");
    pruned += prunedRows?.length ?? 0;

    // Purge previously-stored listings that no longer pass the role filter —
    // e.g. foreign-language roles (Python/C++/C#/PHP/…) accepted before the
    // filter was tightened. Re-evaluate each row's title+tags; drop the ones
    // that now classify as null. Idempotent: a clean table finds nothing.
    const { data: existingRows } = await admin
      .from("job_listings")
      .select("id, title, tags, description, location, remote, seniority")
      .in("source", activeIds);
    const irrelevant = (existingRows ?? [])
      .filter((r) => !isCareerRelevant(r))
      .map((r) => r.id as string);
    for (let i = 0; i < irrelevant.length; i += UPSERT_CHUNK) {
      const chunk = irrelevant.slice(i, i + UPSERT_CHUNK);
      const { data: del } = await admin
        .from("job_listings")
        .delete()
        .in("id", chunk)
        .select("id");
      pruned += del?.length ?? 0;
    }
  }

  const summary: ScrapeSummary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    ok: okSources > 0 && !upsertError,
    inserted,
    refreshed,
    pruned,
    sources: upsertError
      ? { ...sources, _db: { count: 0, error: upsertError } }
      : sources,
  };

  // Best-effort run log — the summary is still returned if this insert
  // fails (e.g. before the schema migration ran).
  await admin.from("job_scrape_runs").insert({
    started_at: summary.startedAt,
    finished_at: summary.finishedAt,
    ok: summary.ok,
    inserted: summary.inserted,
    refreshed: summary.refreshed,
    pruned: summary.pruned,
    sources: summary.sources,
  });

  return summary;
}
