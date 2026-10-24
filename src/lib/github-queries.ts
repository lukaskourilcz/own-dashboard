import { qk } from "@/lib/queries/keys";
import type { MarketingCalendarsResult } from "@/lib/marketing-calendars";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { loadReposResult, loadProjectCommits, loadCrossProjectActivity, type LoadReposResult } from "@/lib/github";

/** Single cache key for the repo list — the Repositories panel and the
 * "Publish to repo" dialog share it, so opening the dialog reuses the panel's
 * already-fetched repos instead of re-hitting GitHub. */
export const reposQueryKey = qk.repos;

export function useReposQuery(enabled = true) {
  return useQuery({
    queryKey: reposQueryKey,
    queryFn: loadReposResult,
    // Repos don't change second-to-second; serve cached for a minute.
    staleTime: 60_000,
    // Off in contexts that only need repos on demand (e.g. the compact Tasks
    // widget) so the dashboard doesn't hit GitHub before the user asks.
    enabled,
  });
}

/** Optimistically bump a repo's pushed_at in the cached list and re-sort, so a
 * repo just committed to jumps to the top across every consumer — no refetch. */
export function bumpRepoInCache(qc: QueryClient, repoId: number): void {
  qc.setQueryData<LoadReposResult>(reposQueryKey, (prev) => {
    if (!prev || prev.kind !== "ok") return prev;
    const repos = prev.repos
      .map((r) =>
        r.id === repoId ? { ...r, pushed_at: new Date().toISOString() } : r,
      )
      .sort(
        (a, b) =>
          new Date(b.pushed_at ?? 0).getTime() -
          new Date(a.pushed_at ?? 0).getTime(),
      );
    return { kind: "ok", repos };
  });
}

/** Refresh a repo's pushed_at in the cached list *without re-sorting*, so the
 * board order stays put after an action that shouldn't reshuffle it (e.g.
 * saving per-repo notes). The repo shows as just-updated but doesn't jump. */
export function touchRepoInCache(qc: QueryClient, repoId: number): void {
  qc.setQueryData<LoadReposResult>(reposQueryKey, (prev) => {
    if (!prev || prev.kind !== "ok") return prev;
    const repos = prev.repos.map((r) =>
      r.id === repoId ? { ...r, pushed_at: new Date().toISOString() } : r,
    );
    return { kind: "ok", repos };
  });
}

/** Cancel late reads before marking every remote GitHub projection offline.
 * Imported/local notes, tasks and links remain owned dashboard records. */
export async function setReposDisconnected(qc: QueryClient): Promise<void> {
  await qc.cancelQueries({ queryKey: ["github"] });
  qc.setQueryData<LoadReposResult>(reposQueryKey, { kind: "disconnected" });
  for (const projection of ["commits", "activity", "detected-tools", "file", "about-project", "project-doc"]) {
    qc.setQueriesData({ queryKey: ["github", projection] }, { kind: "disconnected" });
  }
  qc.setQueryData<MarketingCalendarsResult>(qk.marketingCalendars, previous => {
    if (previous?.kind !== "ok") return previous;
    return { kind: "ok", data: { ...previous.data, sources: previous.data.sources.map(source => ({
      ...source, status: "disconnected", calendar: null, detail: null,
    })) } };
  });
}

/** Recent commits + code volume for one project repo. On demand only (the
 * project workspace's activity view), so it doesn't hit GitHub until opened. */
export function useProjectCommitsQuery(
  repoFullName: string | null | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: ["github", "commits", repoFullName ?? ""] as const,
    queryFn: () => loadProjectCommits(repoFullName as string),
    staleTime: 60_000,
    enabled: enabled && !!repoFullName,
  });
}

/** Merged recent-commit feed across active project repos. On demand only (the
 * Work overview), cached briefly so it doesn't refetch on every visit. */
export function useCrossProjectActivityQuery(enabled = true) {
  return useQuery({
    queryKey: ["github", "activity"] as const,
    queryFn: loadCrossProjectActivity,
    staleTime: 60_000,
    enabled,
  });
}
