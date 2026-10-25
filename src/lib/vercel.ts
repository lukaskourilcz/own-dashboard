import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { awaitWithSignal } from "@/lib/abortable";
import { boundedResponseText } from "@/lib/bounded-response";
import { ProjectTrafficSchema, TrafficTotalsSchema, type ProjectTraffic } from "@/lib/project-traffic-contract";
export type { ProjectTraffic } from "@/lib/project-traffic-contract";

const API = "https://api.vercel.com", DAY = 86_400_000;
const repository = z.string().max(201).regex(/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i);
const repoIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const providerId = z.string().min(1).max(128).regex(/^[a-z0-9_-]+$/i);
const providerRepositoryId = z.union([repoIdSchema, z.string().regex(/^[1-9]\d{0,15}$/).transform(Number).pipe(repoIdSchema)]);
const providerProject = z.object({ id: providerId, name: z.string().max(200), link: z.object({ type: z.literal("github"), org: z.string().min(1).max(100), repo: z.string().min(1).max(100), repoId: providerRepositoryId.optional() }).nullable().optional() });
const projectPage = z.object({ projects: z.array(providerProject).max(2), pagination: z.object({ count: z.number().int().nonnegative().max(2), next: z.number().int().nonnegative().nullable(), prev: z.number().int().nonnegative().nullable().optional() }).optional() });
const cache = new Map<string, { at: number; traffic: ProjectTraffic }>();
const CACHE_MS = 60_000;
export function vercelTrafficConfigured() { return !!process.env.VERCEL_API_TOKEN; }
export function vercelTrafficOwner(ownerId: string) { return z.uuid().safeParse(ownerId).success && ownerId === process.env.DASHBOARD_OWNER_ID; }

/** Only confirmed owned repository context may use the deployment credential.
 * Successes cache for one minute per owner/token/team/repository/UTC window.
 * No provider error is converted to zero or cached. */
export async function getProjectTraffic(repoFullName: string, repoId: number | null | undefined, context: { ownerId: string; signal: AbortSignal }): Promise<ProjectTraffic> {
  const token = process.env.VERCEL_API_TOKEN;
  if (!token) return { kind: "unconfigured" };
  const stop = new AbortController();
  const signal = AbortSignal.any([context.signal, stop.signal, AbortSignal.timeout(20_000)]);
  try {
    signal.throwIfAborted();
    if (!vercelTrafficOwner(context.ownerId)) throw Error();
    const repo = repository.parse(repoFullName);
    if (repoId != null) repoIdSchema.parse(repoId);
    const team = process.env.VERCEL_TEAM_ID || null;
    if (team !== null) providerId.parse(team);
    const at = Date.now(); if (!Number.isFinite(at)) throw Error();
    const now = new Date(at), until = now.toISOString().slice(0, 10);
    const since = new Date(Date.parse(`${until}T00:00:00Z`) - 29 * DAY).toISOString().slice(0, 10);
    const key = createHash("sha256").update(JSON.stringify([context.ownerId, token, team, repo.toLowerCase(), repoId ?? null, since, until])).digest("hex");
    const cached = cache.get(key);
    if (cached && at - cached.at >= 0 && at - cached.at < CACHE_MS) return structuredClone(cached.traffic);
    cache.delete(key);
    const json = async (path: string, params: URLSearchParams): Promise<unknown> => {
      signal.throwIfAborted(); if (team) params.set("teamId", team);
      const budget = AbortSignal.any([signal, AbortSignal.timeout(12_000)]);
      const pending = fetch(`${API}${path}?${params}`, { headers: { Authorization: `Bearer ${token}` }, redirect: "error", cache: "no-store", signal: budget });
      void pending.then(response => { if (budget.aborted && response.body && !response.body.locked) void response.body.cancel().catch(() => undefined); }, () => undefined);
      const response = await awaitWithSignal(pending, budget);
      if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw Error(); }
      return JSON.parse(await boundedResponseText(response, 256 * 1024, budget));
    };
    const selector = new URLSearchParams({ limit: "2", ...(repoId != null ? { repoId: String(repoId) } : { repoUrl: `https://github.com/${repo}` }) });
    const raw = await json("/v10/projects", selector);
    const page = Array.isArray(raw) ? { projects: z.array(providerProject).max(2).parse(raw) } : projectPage.parse(raw);
    if (("pagination" in page && page.pagination && (page.pagination.next !== null || page.pagination.count !== page.projects.length)) || page.projects.length === 2) throw Error();
    if (!page.projects.length) return { kind: "not-found" };
    const project = page.projects[0], link = project.link;
    if (!link || (repoId != null ? link.repoId !== repoId : `${link.org}/${link.repo}`.toLowerCase() !== repo.toLowerCase())) throw Error();
    const params = () => new URLSearchParams({ projectId: project.id, until });
    const lifetimeParams = params(), periodParams = params(), dailyParams = params(); periodParams.set("since", since); dailyParams.set("since", since); dailyParams.set("by", "day"); dailyParams.set("limit", "31");
    const [lifetimeRaw, periodRaw, dailyRaw] = await Promise.all([
      json("/v1/query/web-analytics/visits/count", lifetimeParams), json("/v1/query/web-analytics/visits/count", periodParams), json("/v1/query/web-analytics/visits/aggregate", dailyParams),
    ]);
    const counts = z.object({ data: z.object(TrafficTotalsSchema.shape).refine(value => value.visitors <= value.pageviews), query: z.object({ since: z.string().optional(), until: z.string() }) });
    const lifetime = counts.parse(lifetimeRaw), period = counts.parse(periodRaw);
    const daily = z.object({ data: z.array(z.object({ timestamp: z.union([z.iso.datetime({ offset: true }), z.iso.date()]), pageviews: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), visitors: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) })).max(30), query: z.object({ since: z.string(), until: z.string(), groupBy: z.tuple([z.literal("day")]), limit: z.union([z.number(), z.string()]).optional() }) }).parse(dailyRaw);
    if (lifetime.query.until !== until || lifetime.query.since !== undefined || period.query.since !== since || period.query.until !== until || daily.query.since !== since || daily.query.until !== until
      || (daily.query.limit !== undefined && Number(daily.query.limit) !== 31)) throw Error();
    const days = daily.data.map(row => {
      const stamp = new Date(row.timestamp.length === 10 ? `${row.timestamp}T00:00:00Z` : row.timestamp);
      if (stamp.getUTCHours() || stamp.getUTCMinutes() || stamp.getUTCSeconds() || stamp.getUTCMilliseconds()) throw Error();
      return { date: stamp.toISOString().slice(0, 10), pageviews: row.pageviews, visitors: row.visitors };
    }).sort((a, b) => a.date.localeCompare(b.date));
    const pageviews = days.reduce((sum, row) => sum + row.pageviews, 0), visitors = days.reduce((sum, row) => sum + row.visitors, 0);
    if (!Number.isSafeInteger(pageviews) || !Number.isSafeInteger(visitors) || pageviews !== period.data.pageviews || period.data.visitors > visitors
      || lifetime.data.pageviews < period.data.pageviews || lifetime.data.visitors < period.data.visitors) throw Error();
    const result = ProjectTrafficSchema.parse({ kind: "ok", projectId: project.id, lifetime: lifetime.data, last30: period.data,
      daily: days, window: { since, until }, checkedAt: now.toISOString() });
    signal.throwIfAborted(); cache.set(key, { at, traffic: structuredClone(result) });
    while (cache.size > 50) cache.delete(cache.keys().next().value!);
    return result;
  } catch { return { kind: "error" }; }
  finally { stop.abort(); }
}
