import "server-only";

/**
 * Vercel Web Analytics for a project's linked repository.
 *
 * Uses the public Web Analytics API (https://vercel.com/docs/analytics/web-analytics-api):
 *   GET /v1/query/web-analytics/visits/count      → lifetime pageviews/visitors
 *   GET /v1/query/web-analytics/visits/aggregate  → daily rows (last 30 days)
 *
 * The dashboard project is matched to its Vercel project automatically by the
 * linked git repo (GET /v9/projects), so the only configuration is a
 * server-only VERCEL_API_TOKEN (+ optional VERCEL_TEAM_ID for team projects).
 * The token is never exposed to the browser.
 */

const API = "https://api.vercel.com";
const DAY = 24 * 60 * 60 * 1000;

export type TrafficTotals = { pageviews: number; visitors: number };
export type TrafficDay = { date: string; pageviews: number; visitors: number };

export type ProjectTraffic =
  | { kind: "unconfigured" } // no VERCEL_API_TOKEN set
  | { kind: "not-found" } // token set, but no Vercel project matches the repo
  | { kind: "error" }
  | {
      kind: "ok";
      projectId: string;
      lifetime: TrafficTotals;
      last30: TrafficTotals;
      daily: TrafficDay[];
    };

type VercelProject = {
  id: string;
  name: string;
  link?: { type?: string; org?: string; repo?: string } | null;
};

// Best-effort in-memory cache of the project list (per server instance).
let projectCache: { at: number; projects: VercelProject[] } | null = null;

function teamParam(): string {
  const team = process.env.VERCEL_TEAM_ID;
  return team ? `&teamId=${encodeURIComponent(team)}` : "";
}

async function vercelGet(path: string, token: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

async function listProjects(token: string): Promise<VercelProject[] | null> {
  if (projectCache && Date.now() - projectCache.at < 10 * 60 * 1000) {
    return projectCache.projects;
  }
  const team = process.env.VERCEL_TEAM_ID;
  const json = (await vercelGet(
    `/v9/projects?limit=100${team ? `&teamId=${encodeURIComponent(team)}` : ""}`,
    token,
  )) as { projects?: VercelProject[] } | null;
  if (!json?.projects) return null;
  projectCache = { at: Date.now(), projects: json.projects };
  return json.projects;
}

/** Find the Vercel project whose linked git repo matches `owner/name`. */
function matchProject(
  projects: VercelProject[],
  repoFullName: string,
): VercelProject | null {
  const target = repoFullName.toLowerCase();
  const name = target.split("/")[1] ?? target;
  return (
    projects.find((p) => {
      const link = p.link;
      if (link?.org && link?.repo) {
        return `${link.org}/${link.repo}`.toLowerCase() === target;
      }
      return false;
    }) ??
    // Fallback: match by project name == repo name.
    projects.find((p) => p.name.toLowerCase() === name) ??
    null
  );
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function getProjectTraffic(
  repoFullName: string,
): Promise<ProjectTraffic> {
  const token = process.env.VERCEL_API_TOKEN;
  if (!token) return { kind: "unconfigured" };

  const projects = await listProjects(token);
  if (!projects) return { kind: "error" };
  const project = matchProject(projects, repoFullName);
  if (!project) return { kind: "not-found" };

  const team = teamParam();
  const pid = `projectId=${encodeURIComponent(project.id)}`;
  const until = new Date();
  const since = new Date(Date.now() - 30 * DAY);

  const [countRaw, aggRaw] = await Promise.all([
    vercelGet(`/v1/query/web-analytics/visits/count?${pid}${team}`, token),
    vercelGet(
      `/v1/query/web-analytics/visits/aggregate?${pid}${team}` +
        `&since=${ymd(since)}&until=${ymd(until)}&by=day`,
      token,
    ),
  ]);

  const lifetime = (countRaw as { data?: TrafficTotals } | null)?.data ?? {
    pageviews: 0,
    visitors: 0,
  };
  const rows =
    (aggRaw as { data?: Array<{ timestamp: string } & TrafficTotals> } | null)
      ?.data ?? [];
  const daily: TrafficDay[] = rows.map((r) => ({
    date: r.timestamp.slice(0, 10),
    pageviews: r.pageviews ?? 0,
    visitors: r.visitors ?? 0,
  }));
  const last30 = daily.reduce<TrafficTotals>(
    (acc, d) => ({
      pageviews: acc.pageviews + d.pageviews,
      visitors: acc.visitors + d.visitors,
    }),
    { pageviews: 0, visitors: 0 },
  );

  return { kind: "ok", projectId: project.id, lifetime, last30, daily };
}
