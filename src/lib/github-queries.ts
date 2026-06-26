import { useQuery, type QueryClient } from "@tanstack/react-query";
import { loadReposResult, type LoadReposResult } from "@/lib/github";

/** Single cache key for the repo list — the Repositories panel and the
 * "Publish to repo" dialog share it, so opening the dialog reuses the panel's
 * already-fetched repos instead of re-hitting GitHub. */
export const reposQueryKey = ["github", "repos"] as const;

export function useReposQuery() {
  return useQuery({
    queryKey: reposQueryKey,
    queryFn: loadReposResult,
    // Repos don't change second-to-second; serve cached for a minute.
    staleTime: 60_000,
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

/** Flip the cache to "disconnected" (after an explicit disconnect or a 401)
 * so all consumers show the Connect CTA without a refetch. */
export function setReposDisconnected(qc: QueryClient): void {
  qc.setQueryData<LoadReposResult>(reposQueryKey, { kind: "disconnected" });
}
