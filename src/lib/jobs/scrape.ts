import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { awaitWithSignal } from "@/lib/abortable";
import { JOB_SOURCES } from "./sources";
import { JOB_SOURCE_META, isCzechJobSource } from "./meta";
import { selectDeadUrls } from "./prune";
import { isJobUrl } from "./availability";
import { isCareerRelevant, isOsloRelevant } from "./filter";
import type { ScrapeSummary, SourceOutcome } from "./types";

const instant = z.iso.datetime({ offset: true });
const text = z.string().max(500).nullable();
const sourceId = z.string().min(1).max(140).regex(/^[A-Za-z0-9][A-Za-z0-9~_-]*$/);
const candidate = z.object({ source: sourceId, externalId: z.string().min(1).max(2048), title: z.string().trim().min(1).max(300), company: text,
 url: z.string().max(2048).refine(isJobUrl), location: text, role: z.enum(["frontend", "fullstack", "software"]), remote: z.boolean(), salary: text,
 tags: z.array(z.string().max(100)).max(50), seniority: z.string().max(200).nullable(), description: z.string().max(12000).nullable(),
 postedAt: z.union([instant, z.iso.date()]).nullable(), observedAt: instant.optional() });
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const snapshotReceipt = z.strictObject({ source: sourceId, observedAt: instant, status: z.enum(["applied", "duplicate", "stale", "conflict"]), received: count.max(1000), inserted: count.max(1000), refreshed: count.max(1000), pruned: count });
const version = z.strictObject({ id: z.uuid(), source: sourceId, url: z.string().min(1).max(2048), last_seen_at: instant });
const filterVersion = version.extend({ title: z.string().max(300), tags: z.array(z.string().max(100)).max(50), description: z.string().max(12000).nullable(), location: text, remote: z.boolean(), seniority: z.string().max(200).nullable() });
const versionColumns = "id,source,url,last_seen_at";
const filterColumns = `${versionColumns},title,tags,description,location,remote,seniority`;
const unavailable = () => new Error("career-scrape-unavailable");

/** On-demand public discovery only. Source writes and absence proof are atomic;
 * exact version cleanup cannot erase a newer observation or owner tombstone. */
export async function runJobScrape(
 // Existing Supabase client uses ungenerated table types.
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 admin: SupabaseClient<any>, options: { includeCzech?: boolean; signal?: AbortSignal } = {},
): Promise<ScrapeSummary> {
 const includeCzech = options.includeCzech === true, parent = options.signal, lifetime = new AbortController();
 const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(45_000), ...(parent ? [parent] : [])]);
 const phase = (ms: number) => AbortSignal.any([signal, AbortSignal.timeout(ms)]);
 const active = () => { signal.throwIfAborted(); };
 async function query<T>(work: (part: AbortSignal) => PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  active(); const part = phase(8_000); const result = await awaitWithSignal(work(part), part); part.throwIfAborted();
  if (result.error) throw unavailable(); return result.data;
 }
 const sources: Record<string, SourceOutcome> = Object.create(null);
 let inserted = 0, refreshed = 0, pruned = 0, confirmed = 0, persistenceFailed = false;
 try {
  active(); const start = Date.now(); if (!Number.isFinite(start)) throw unavailable();
  const startedAt = new Date(start).toISOString(), runId = crypto.randomUUID();
  // Copy identity/callback before waiting; a later registry mutation cannot
  // redirect one already admitted pass to another source.
  const registry = JOB_SOURCES.filter(source => includeCzech || !isCzechJobSource(source.id)).map(source => ({ id: source.id, fetch: source.fetch.bind(source) }));
  if (!registry.length || registry.length > 30 || registry.some(source => !sourceId.safeParse(source.id).success) || new Set(registry.map(source => source.id)).size !== registry.length) throw unavailable();
  const settled = await awaitWithSignal(Promise.allSettled(registry.map(async source => {
   const part = phase(30_000); part.throwIfAborted();
   const result = await awaitWithSignal(Promise.resolve().then(() => { part.throwIfAborted(); return source.fetch(part); }), part); part.throwIfAborted();
   const completed = Date.now(); if (!Number.isFinite(completed) || completed < start) throw unavailable();
   const envelope = Array.isArray(result) ? null : z.strictObject({ jobs: z.array(candidate).max(1000), observedAt: instant }).parse(result);
   const jobs = envelope?.jobs ?? z.array(candidate).max(1000).parse(result);
   if (jobs.some(job => job.source !== source.id)) throw unavailable();
   const times = new Set(jobs.map(job => job.observedAt));
   if (times.size > 1) throw unavailable();
   const observedAt = envelope?.observedAt ?? jobs[0]?.observedAt ?? new Date(completed).toISOString();
   if (jobs.some(job => job.observedAt && Date.parse(job.observedAt) !== Date.parse(observedAt))) throw unavailable();
   if (Date.parse(observedAt) > completed || completed - Date.parse(observedAt) > 86_400_000) throw unavailable();
   // These are copied normalized rows. Overlapping public role searches keep
   // their established last occurrence, counted once per source identity.
   const unique = new Map(jobs.filter(job => isCareerRelevant(job) && (includeCzech || isOsloRelevant(job))).map(job => [job.externalId, job]));
   const rows = [...unique.values()].map(job => ({ external_id: job.externalId, title: job.title, company: job.company, url: job.url, location: job.location, role: job.role, remote: job.remote, salary: job.salary, tags: job.tags, seniority: job.seniority, description: job.description, posted_at: job.postedAt ? new Date(job.postedAt).toISOString() : null }));
   return { source: source.id, observedAt, rows };
  })), signal);
  active(); const applied: Array<{ source: string; observedAt: string }> = [];
  for (let index = 0; index < settled.length; index++) {
   active(); const source = registry[index].id, outcome = settled[index];
   if (outcome.status === "rejected") { sources[source] = { count: 0, error: "source-unavailable" }; continue; }
   const snapshot = outcome.value;
   try {
    const data = await query(part => admin.rpc("career_apply_source_snapshot", { p_source: source, p_observed_at: snapshot.observedAt, p_rows: snapshot.rows, p_complete: JOB_SOURCE_META[source]?.complete === true }).retry(false).abortSignal(part));
    const receipt = snapshotReceipt.parse(data);
    if (receipt.source !== source || Date.parse(receipt.observedAt) !== Date.parse(snapshot.observedAt) || receipt.received !== snapshot.rows.length
     || receipt.inserted + receipt.refreshed > receipt.received || (receipt.status !== "applied" && (receipt.inserted || receipt.refreshed || receipt.pruned))) throw unavailable();
    if (receipt.status === "stale" || receipt.status === "conflict") { sources[source] = { count: 0, error: "snapshot-unconfirmed" }; continue; }
    sources[source] = { count: receipt.received, ...(receipt.pruned ? { pruned: receipt.pruned } : {}) };
    inserted += receipt.inserted; refreshed += receipt.refreshed; pruned += receipt.pruned; confirmed++;
    applied.push({ source, observedAt: snapshot.observedAt });
   } catch { active(); persistenceFailed = true; sources[source] = { count: 0, error: "snapshot-unconfirmed" }; }
  }
  const readVersions = <T extends z.ZodType>(schema: T, data: unknown, allowed: ReadonlySet<string>, maximum: number): z.infer<T>[] => {
   const rows = z.array(schema).max(maximum).parse(data) as Array<z.infer<T> & { id: string; source: string }>;
   if (new Set(rows.map(row => row.id)).size !== rows.length || rows.some(row => !allowed.has(row.source))) throw unavailable(); return rows;
  };
  async function remove(rows: z.infer<typeof version>[]) {
   if (!rows.length) return 0;
   const data = await query(part => admin.rpc("career_delete_listing_versions", { p_rows: rows }).retry(false).abortSignal(part));
   const removed = count.max(rows.length).parse(data); active(); return removed;
  }
  if (confirmed && !persistenceFailed) {
   try {
    for (const snapshot of applied) {
     active(); if (!sources[snapshot.source].count || JOB_SOURCE_META[snapshot.source]?.complete) continue;
     const data = await query(part => admin.from("job_listings").select(versionColumns).eq("source", snapshot.source).lt("last_seen_at", snapshot.observedAt).order("last_seen_at").order("id").limit(5).retry(false).abortSignal(part));
     const rows = readVersions(version, data, new Set([snapshot.source]), 5);
     if (rows.some(row => Date.parse(row.last_seen_at) >= Date.parse(snapshot.observedAt))) throw unavailable();
     if (!rows.length) continue;
     const dead = await awaitWithSignal(selectDeadUrls(rows.map(row => row.url), { budgetMs: 1000, maxChecks: 5, signal }), signal); active();
     if (!(dead instanceof Set) || [...dead].some(url => !rows.some(row => row.url === url))) throw unavailable();
     const removed = await remove(rows.filter(row => dead.has(row.url)));
     sources[snapshot.source].pruned = (sources[snapshot.source].pruned ?? 0) + removed; pruned += removed;
    }
    const ids = registry.map(source => source.id);
    // Preserve 45-day cache retention; the function protects permanent owner
    // deletion markers and returns a full aggregate beyond REST's row cap.
    pruned += count.parse(await query(part => admin.rpc("career_prune_stale_listings", { p_sources: ids }).retry(false).abortSignal(part)));
    const data = await query(part => admin.from("job_listings").select(filterColumns).in("source", ids).order("last_seen_at").order("id").limit(1000).retry(false).abortSignal(part));
    const rows = readVersions(filterVersion, data, new Set(ids), 1000);
    // Explicit bounded maintenance window, not evidence of a complete board.
    const irrelevant = rows.filter(row => !isCareerRelevant(row)).map(row => version.parse({ id: row.id, source: row.source, url: row.url, last_seen_at: row.last_seen_at }));
    pruned += await remove(irrelevant);
   } catch { active(); persistenceFailed = true; sources._db = { count: 0, error: "cleanup-unconfirmed" }; }
  }
  active(); const finished = Date.now(); if (!Number.isFinite(finished) || finished < start) throw unavailable();
  const summary: ScrapeSummary = { startedAt, finishedAt: new Date(finished).toISOString(), ok: confirmed > 0 && !persistenceFailed, inserted, refreshed, pruned, sources };
  try {
   const data = await query(part => admin.from("job_scrape_runs").insert({ id: runId, started_at: summary.startedAt, finished_at: summary.finishedAt, ok: summary.ok, inserted, refreshed, pruned, sources }).select("id").retry(false).abortSignal(part).single());
   if (z.strictObject({ id: z.uuid() }).parse(data).id !== runId) throw unavailable();
  } catch { active(); return { ...summary, ok: false, sources: { ...sources, _db: { count: 0, error: "run-log-unconfirmed" } } }; }
  active(); return summary;
 } catch { if (parent?.aborted) throw new DOMException("Request aborted", "AbortError"); throw unavailable(); }
 finally { lifetime.abort(); }
}
