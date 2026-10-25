import "server-only";
import { z } from "zod";
import { isCareerRelevant, matchRole } from "./filter";
import { isJobUrl } from "./availability";
import type { ScrapedJob, ScrapedJobSnapshot } from "./types";

import { awaitWithSignal } from "@/lib/abortable";
import { readTextPrefix } from "@/lib/bounded-text";
const TASK_ID = /^[a-zA-Z0-9_-]{1,128}(?:~[a-zA-Z0-9_-]{1,128})?$/;
const STORAGE_ID = /^[a-zA-Z0-9]{1,128}$/;
const instant = z.iso.datetime({ offset: true });
const publicationDate = z.union([instant, z.iso.date()]);
const unavailable = () => new Error("career-apify-unavailable");

/** Read only an already completed recent saved task. No Actor start endpoint. */
export async function fetchApifyTaskSnapshot(taskId: string, parent?: AbortSignal): Promise<ScrapedJobSnapshot> {
  const token = process.env.APIFY_TOKEN, lifetime = new AbortController();
  const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(15_000), ...(parent ? [parent] : [])]);
  const get = async (path: string, maxCharacters: number) => {
    const phase = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
    let response: Response | undefined;
    const release = () => { if (response?.body && !response.body.locked) void response.body.cancel().catch(() => undefined); };
    try {
      phase.throwIfAborted();
      const pending = fetch(`https://api.apify.com/v2/${path}`, {
        method: "GET", redirect: "error", headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: phase,
      }).then(value => { response = value; if (phase.aborted) release(); return value; });
      const result = await awaitWithSignal(pending, phase); phase.throwIfAborted();
      if (!result.ok) throw unavailable();
      const prefix = await awaitWithSignal(readTextPrefix(result, maxCharacters, phase), phase); phase.throwIfAborted();
      if (prefix.truncated) throw unavailable();
      return { value: JSON.parse(prefix.text) as unknown, headers: result.headers };
    } finally { release(); }
  };
  try {
    signal.throwIfAborted();
    if (!token || !TASK_ID.test(taskId) || taskId.length > 128) throw unavailable();
    const started = Date.now(); if (!Number.isFinite(started)) throw unavailable();
    const metadata = await get(`actor-tasks/${encodeURIComponent(taskId)}/runs/last?status=SUCCEEDED`, 65_536);
    signal.throwIfAborted();
    const envelope = metadata.value;
    if (!envelope || typeof envelope !== "object" || !("data" in envelope) || !envelope.data || typeof envelope.data !== "object") throw unavailable();
    const run = envelope.data as Record<string, unknown>;
    const finished = instant.safeParse(run.finishedAt).success ? Date.parse(run.finishedAt as string) : NaN;
    const began = instant.safeParse(run.startedAt).success ? Date.parse(run.startedAt as string) : NaN;
    const now = Date.now();
    if (run.status !== "SUCCEEDED" || typeof run.id !== "string" || !STORAGE_ID.test(run.id)
      || typeof run.actorTaskId !== "string" || !STORAGE_ID.test(run.actorTaskId)
      || (!taskId.includes("~") && run.actorTaskId !== taskId)
      || typeof run.defaultDatasetId !== "string" || !STORAGE_ID.test(run.defaultDatasetId)
      || !Number.isFinite(began) || !Number.isFinite(finished) || !Number.isFinite(now) || now < started
      || began > finished || finished > now || now - finished > 24 * 60 * 60 * 1000) throw unavailable();
    // Keep hidden diagnostics out but retain empty items: pagination evidence
    // must describe the raw window, not a clean/skipEmpty transformation.
    const dataset = await get(`datasets/${run.defaultDatasetId}/items?clean=false&skipHidden=true&format=json&offset=0&limit=1001`, 8_388_608);
    signal.throwIfAborted();
    const rows = dataset.value;
    const number = (name: string) => { const raw = dataset.headers.get(`x-apify-pagination-${name}`); return raw !== null && /^(?:0|[1-9][0-9]{0,9})$/.test(raw) ? Number(raw) : NaN; };
    const total = number("total");
    if (!Array.isArray(rows) || rows.length > 1000 || number("offset") !== 0 || number("limit") !== 1001
      || number("count") !== rows.length || total !== rows.length || rows.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw unavailable();
    const observedAt = new Date(finished).toISOString();
    const jobs = rows.map(row => normalizeApifyJob(row, taskId, observedAt)).filter((job): job is ScrapedJob => job !== null);
    const completed = Date.now();
    if (!Number.isFinite(completed) || completed < now || completed - started > 15_000 || completed - finished > 24 * 60 * 60 * 1000) throw unavailable();
    signal.throwIfAborted(); return { jobs, observedAt };
  } catch {
    if (parent?.aborted) throw new DOMException("Request aborted", "AbortError");
    throw unavailable();
  } finally { lifetime.abort(); }
}

/** Existing array callers retain their contract; the orchestrator keeps the
 * observation envelope so an empty filtered result cannot renew an old run. */
export async function fetchApifyTask(taskId: string, parent?: AbortSignal): Promise<ScrapedJob[]> {
 return (await fetchApifyTaskSnapshot(taskId, parent)).jobs;
}

export function normalizeApifyJob(
  input: unknown,
  taskId: string,
  observedAt: string,
): ScrapedJob | null {
  if (!input || typeof input !== "object" || Array.isArray(input) || !TASK_ID.test(taskId) || taskId.length > 128 || !instant.safeParse(observedAt).success) return null;
  const row = input as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  if (
    row.isActive === false ||
    row.isExpired === true ||
    /closed|expired/i.test(s(row.jobState || row.status))
  )
    return null;
  const title = s(row.title || row.jobTitle || row.positionName);
  const url = s(row.url || row.jobUrl || row.link);
  const externalId = s(row.id || row.jobId) || url;
  if (!title.trim() || title.length > 300 || externalId.length > 2048 || url.length > 2048 || !isJobUrl(url)) return null;
  const description = s(row.descriptionText || row.description || row.jobDescription)
    // Preserve unmatched text without retrying the scan at every opening <.
    .replace(/<[^>]*(?:>|$)/g, tag => tag.endsWith(">") ? " " : tag)
    .slice(0, 12000);
  const role = matchRole(title, description);
  if (!role) return null;
  const tags: string[] = [];
  if (Array.isArray(row.tags)) for (const value of row.tags) {
    if (typeof value === "string" && value.length <= 100 && !tags.includes(value)) tags.push(value);
    if (tags.length === 50) break;
  }
  const posted = s(row.postedAt || row.publishedAt), postedAt = publicationDate.safeParse(posted).success ? Date.parse(posted) : NaN;
  const companyValue = row.companyName || row.company;
  const company =
    typeof companyValue === "object" && companyValue
      ? s((companyValue as Record<string, unknown>).name)
      : s(companyValue);
  const job: ScrapedJob = {
    source: `apify-${taskId}`,
    externalId,
    title,
    company: company.slice(0, 500) || null,
    url,
    location: s(row.location || row.jobLocation).slice(0, 500) || null,
    remote:
      row.isRemote === true ||
      row.remote === true ||
      /remote/i.test(s(row.workplaceType)),
    role,
    salary: s(row.salary).slice(0, 500) || null,
    description,
    tags,
    seniority: s(row.seniorityLevel || row.seniority).slice(0, 200) || null,
    postedAt: Number.isFinite(postedAt) ? new Date(postedAt).toISOString() : null,
    observedAt,
  };
  return isCareerRelevant(job) ? job : null;
}

export function apifyTaskIds(): string[] {
  return [...new Set((process.env.APIFY_JOB_TASK_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length <= 128 && TASK_ID.test(value)))].slice(0, 5);
}
