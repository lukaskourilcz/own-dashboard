import { qk } from "@/lib/queries/keys";
import type { MarketingCalendarsResult } from "@/lib/marketing-calendars";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { loadReposResult, loadRepositoryResult, loadProjectCommits, loadCrossProjectActivity, type LoadReposResult, type RepositoryLookupResult } from "@/lib/github";

/** Single cache key for the repo list — the Repositories panel and the
 * "Publish to repo" dialog share it, so opening the dialog reuses the panel's
 * already-fetched repos instead of re-hitting GitHub. */
export const reposQueryKey = qk.repos;

export function useReposQuery(enabled = true) {
  return useQuery({
    queryKey: reposQueryKey,
    queryFn: async ({ signal }) => {
      const result = await loadReposResult({ signal });
      if (result.kind === "error") throw Error("Repositories unavailable");
      return result;
    },
    retry: false,
    // Repos don't change second-to-second; serve cached for a minute.
    staleTime: 60_000,
    // Off in contexts that only need repos on demand (e.g. the compact Tasks
    // widget) so the dashboard doesn't hit GitHub before the user asks.
    enabled,
  });
}

/** Reuse a known list entry, otherwise resolve only the workspace's repository.
 * Cold project visits do not download the recent 100-repository catalog. */
export function useWorkspaceRepositories(fullName?: string) {
  const list = useReposQuery(!fullName);
  const cached = list.data?.kind === "ok" && fullName
    ? list.data.repos.find(repo => repo.full_name.toLowerCase() === fullName.toLowerCase()) : undefined;
  const scoped = useQuery({
    queryKey: [...qk.githubRepo, fullName?.toLowerCase() ?? ""],
    queryFn: async ({ signal }) => {
      const result = await loadRepositoryResult(fullName!, signal);
      if (result.kind === "error") throw Error("Repository unavailable");
      return result;
    },
    enabled: () => !!fullName && list.data?.kind !== "disconnected" && (!cached || (list.data?.checkedAt ?? 0) < Date.now() - 60_000),
    staleTime: 60_000, retry: false,
  });
  // Cache-only push-time updates do not refresh this provider receipt clock.
  const preferListEntry = !!cached && (!scoped.data || (list.data?.checkedAt ?? 0) > (scoped.data.checkedAt ?? 0));
  const data = useMemo(() => {
    if (!fullName) return list.data;
    if (list.data?.kind === "disconnected") return list.data;
    if (preferListEntry && cached) return { kind: "ok" as const, repos: [cached], hasMore: false };
    if (scoped.data?.kind === "ok") return { kind: "ok" as const, repos: [scoped.data.repo], hasMore: false };
    if (scoped.data) return scoped.data;
    return undefined;
  }, [fullName, list.data, scoped.data, cached, preferListEntry]);
  return {
    data,
    isPending: fullName ? !data && scoped.isPending : list.isPending,
    isFetching: fullName ? scoped.isFetching : list.isFetching,
    isError: fullName ? scoped.isError || (preferListEntry && list.isError) : list.isError,
    refetch: fullName ? scoped.refetch : list.refetch,
  };
}

function updateRepositoryPushTime(qc: QueryClient, repoId: number, resort: boolean) {
  const pushed_at = new Date().toISOString();
  qc.setQueryData<LoadReposResult>(reposQueryKey, previous => {
    if (previous?.kind !== "ok") return previous;
    const repos = previous.repos.map(repo => repo.id === repoId ? { ...repo, pushed_at } : repo);
    if (resort) repos.sort((a, b) => Date.parse(b.pushed_at ?? "1970-01-01") - Date.parse(a.pushed_at ?? "1970-01-01"));
    return { ...previous, repos };
  });
  qc.setQueriesData<RepositoryLookupResult>({ queryKey: qk.githubRepo }, previous =>
    previous?.kind === "ok" && previous.repo.id === repoId ? { ...previous, repo: { ...previous.repo, pushed_at } } : previous);
}

/** Publication refreshes the matching scoped metadata too, without an extra
 * provider read. Only the catalog's explicit bump changes its row order. */
export function bumpRepoInCache(qc: QueryClient, repoId: number): void {
  updateRepositoryPushTime(qc, repoId, true);
}
export function touchRepoInCache(qc: QueryClient, repoId: number): void {
  updateRepositoryPushTime(qc, repoId, false);
}

/** Cancel late reads before marking every remote GitHub projection offline.
 * Imported/local notes, tasks and links remain owned dashboard records. */
export async function setReposDisconnected(qc: QueryClient): Promise<void> {
  await qc.cancelQueries({ queryKey: ["github"] });
  qc.setQueryData<LoadReposResult>(reposQueryKey, { kind: "disconnected" });
  for (const projection of ["repo", "commits", "activity", "detected-tools", "file", "about-project", "project-doc"]) {
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
