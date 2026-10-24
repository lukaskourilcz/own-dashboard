import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createGitHubFetcher } from "@/lib/github-token";
import { awaitWithSignal } from "@/lib/abortable";
import { githubActivityProject, githubActivityResponse, type GithubActivityProject, type GithubHistoryCommit } from "@/lib/github-activity-contract";
import { readGithubHistory } from "@/lib/github-activity-server";

export const maxDuration = 30;
const headers = { "cache-control": "private, no-store" };
const MAX_PROJECTS = 10;
/** Ten recent active project rows, grouped by repository before provider reads.
 * Scope and unavailable counts make a capped/partial feed explicit. */
export async function GET(request: Request) {
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(20_000)]);
  try {
    const client = await awaitWithSignal(createClient(signal), signal);
    const auth = await awaitWithSignal(client.auth.getUser(), signal);
    if (auth.error) throw Error("Authentication unavailable");
    if (!auth.data.user) return NextResponse.json({ error: "Not authenticated." }, { status: 401, headers });
    const read = await awaitWithSignal(client.from("projects")
      .select("id,name,slug,repo_full_name,parent_id,repo_id,updated_at", { count: "exact" })
      .eq("user_id", auth.data.user.id).eq("is_active", true).neq("status", "archived").not("repo_full_name", "is", null)
      .order("updated_at", { ascending: false }).order("id", { ascending: true }).limit(MAX_PROJECTS).abortSignal(signal), signal);
    if (read.error || !Number.isSafeInteger(read.count) || read.count! < 0 || !Array.isArray(read.data) || read.data.length !== Math.min(MAX_PROJECTS, read.count!)) throw Error("Project scope unavailable");
    const rows = read.data.map(row => githubActivityProject.parse(row));
    if (new Set(rows.map(row => row.id)).size !== rows.length) throw Error("Project scope unavailable");
    const groups: { representative: GithubActivityProject; names: Set<string>; ids: Set<number> }[] = [];
    for (const project of rows) {
      const name = project.repo_full_name.toLowerCase();
      const matches = groups.filter(group => group.names.has(name) || (project.repo_id !== null && group.ids.has(project.repo_id)));
      const group = matches[0];
      if (!group) { groups.push({ representative: project, names: new Set([name]), ids: new Set(project.repo_id === null ? [] : [project.repo_id]) }); continue; }
      for (const other of matches.slice(1)) {
        for (const alias of other.names) group.names.add(alias);
        for (const id of other.ids) group.ids.add(id);
        if (group.representative.parent_id && !other.representative.parent_id) group.representative = other.representative;
        groups.splice(groups.indexOf(other), 1);
      }
      group.names.add(name);
      if (project.repo_id !== null) group.ids.add(project.repo_id);
      if (group.ids.size > 1) throw Error("Repository identity unavailable");
      if (group.representative.parent_id && !project.parent_id) group.representative = project;
    }
    const projects = groups.map(group => group.representative);
    const commits: { project: GithubActivityProject; commit: GithubHistoryCommit }[] = [];
    let cursor = 0, unavailable = 0, disconnected = false;
    const fetcher = createGitHubFetcher(auth.data.user.id, signal);
    async function worker() {
      while (cursor < projects.length) {
        const project = projects[cursor++];
        const history = await readGithubHistory(fetcher, project.repo_full_name, 5, signal);
        if (history.kind === "disconnected") { disconnected = true; controller.abort(); return; }
        if (history.kind !== "ok") { unavailable++; continue; }
        for (const commit of history.commits) commits.push({ project, commit });
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, projects.length) }, worker));
    if (disconnected) return NextResponse.json({ items: [], connected: false }, { status: 401, headers });
    if (projects.length > 0 && unavailable === projects.length) throw Error("History unavailable");
    const items = commits.sort((a, b) => (Date.parse(b.commit.date) || 0) - (Date.parse(a.commit.date) || 0) || a.commit.sha.localeCompare(b.commit.sha)).slice(0, 30)
      .map(({ project, commit }) => ({ ...commit, projectId: project.id, projectName: project.name, projectSlug: project.slug, repo: project.repo_full_name }));
    return NextResponse.json(githubActivityResponse.parse({ items, connected: true, scope: { projects: rows.length, totalProjects: read.count, repositories: projects.length, unavailableRepositories: unavailable } }), { headers });
  } catch { return NextResponse.json({ error: "Could not load project activity." }, { status: 503, headers }); }
}
