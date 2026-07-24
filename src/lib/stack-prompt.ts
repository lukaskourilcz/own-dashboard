import { loadRepoFile, type RepoFileResult } from "@/lib/github";

// The file every "App costs & scaling" card reads from a repo root. Renamed
// from stack-and-scaling.md — the stack now lives in about-project.md, so this
// file is scaling/cost only.
export const SCALING_FILE = "scaling.md";
// Legacy name, still read as a fallback during the rename transition.
export const LEGACY_SCALING_FILE = "stack-and-scaling.md";
// Back-compat alias for existing imports.
export const STACK_AND_SCALING_FILE = SCALING_FILE;

/**
 * Load a repo's scaling doc, preferring `scaling.md` and falling back to the
 * legacy `stack-and-scaling.md` when the new name isn't present yet — so repos
 * mid-rename keep rendering. Only a clean not-found triggers the fallback; a
 * disconnected/error result is returned as-is.
 */
export async function loadScalingFile(
  owner: string,
  repo: string,
): Promise<RepoFileResult> {
  const primary = await loadRepoFile(owner, repo, SCALING_FILE);
  if (primary.kind === "not-found") {
    const legacy = await loadRepoFile(owner, repo, LEGACY_SCALING_FILE);
    if (legacy.kind === "ok") return legacy;
  }
  return primary;
}

// The prompt to hand another Claude Code session so it writes / updates the
// scaling.md in a repo root. Surfaced via a "Copy prompt" button on cards whose
// repo doesn't have the file yet.
export const STACK_AND_SCALING_PROMPT = `Add or update \`scaling.md\` at this repository root (renamed from \`stack-and-scaling.md\`; the technology stack now lives in \`about-project.md\`, so keep this file cost/scaling only). Inspect the actual code, manifests, infrastructure configuration, environment variables, cron/deployment files, and documented product scope; do not guess what is deployed or paid.

Write a concise English operating reference with:

1. Product name and one-sentence scope.
2. A current-cost table that separates fixed platform cost, variable usage, and excluded items. If live billing is unavailable, say so explicitly and describe free-tier versus reliable-production scenarios.
3. Official provider links and the date every price was checked.
4. Realistic 1-owner, 100-user, and 1,000-user planning bands with assumptions. Make clear when a user-count scenario conflicts with the current product model.
5. Measured upgrade triggers for database, hosting/functions, AI, email, caching/rate limiting, analytics, and monitoring.
6. Cost controls the owner should configure.

Never prescribe a replica, queue, cache, larger database, or paid plan solely from user count. Tie architecture changes to observed latency, storage, connection, retry, concurrency, token, or quota pressure. Keep estimates honest: distinguish official prices from calculated scenarios, and do not call a service free when its public pricing is unavailable.`;
