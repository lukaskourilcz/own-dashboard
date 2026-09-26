"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EntityBadge } from "@/components/ui/status-badge";
import { useDict, useLang } from "@/lib/i18n";
import type { DetectedTool, DetectedToolsResponse, ProjectStackStatus } from "@/lib/stack-detection";
import { cn } from "@/lib/utils";

/** What the Tools panel knows about the repositories right now. */
export type DetectionView =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "rate-limited" }
  | { kind: "disconnected" }
  | { kind: "ok"; data: DetectedToolsResponse };

const SOURCE_FILE = { "about-project": "about-project.md", "package-json": "package.json" } as const;
const PROBLEM_STATUSES = new Set<ProjectStackStatus["status"]>(["unreadable", "error", "not-found"]);

/**
 * The tools the active projects' repositories list, below the tools the owner
 * added by hand. Dense rows rather than cards: this list can run to dozens of
 * entries. Every row says it was detected and from which file, and the
 * repository statuses explain a project that contributed nothing.
 */
export function DetectedToolsSection({
  view,
  tools,
  filtered,
  checking,
  canCheck = true,
  onCheckAgain,
  maxRepositories,
}: {
  view: DetectionView;
  /** Detected tools not already added by hand, after the panel's filters. */
  tools: DetectedTool[];
  /** Whether a text or project filter is narrowing the list. */
  filtered: boolean;
  checking: boolean;
  /** False in the fixture preview, which has no repositories to read. */
  canCheck?: boolean;
  onCheckAgain: () => void;
  maxRepositories: number;
}) {
  const t = useDict();
  const tt = t.tools;
  const { lang } = useLang();
  const statuses = view.kind === "ok" ? view.data.projects : [];
  const read = statuses.filter((status) => status.status === "ok" || status.status === "empty").length;
  const hasProblem = statuses.some((status) => PROBLEM_STATUSES.has(status.status));
  const checkedAt =
    view.kind === "ok"
      ? new Date(view.data.checkedAt).toLocaleTimeString(lang === "cs" ? "cs-CZ" : "en-GB", { hour: "2-digit", minute: "2-digit" })
      : null;

  const statusText = (status: ProjectStackStatus): string => {
    const labels = tt.repositoryStatus;
    switch (status.status) {
      case "ok":
        return labels.ok(status.toolCount, SOURCE_FILE[status.source ?? "about-project"]);
      case "empty":
        return labels.empty(SOURCE_FILE[status.source ?? "about-project"]);
      case "inherited":
        return labels.inherited(status.parentName ?? "");
      case "skipped":
        return labels.skipped(maxRepositories);
      default:
        return labels[status.status];
    }
  };

  return (
    <section aria-labelledby="tools-detected" aria-busy={checking} className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-border pb-2">
        <div className="min-w-0 max-w-3xl">
          <h2 id="tools-detected" className="flex items-baseline gap-2 text-sm font-semibold">
            {tt.detectedTitle}
            {view.kind === "ok" && (
              <span className="text-[11px] font-medium tabular text-foreground-muted">{tt.count(tools.length)}</span>
            )}
          </h2>
          <p className="mt-1 text-xs text-foreground-muted">{tt.detectedDescription}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {checkedAt && <span className="text-[11px] tabular text-foreground-subtle">{tt.checkedAt(checkedAt)}</span>}
          <Button size="sm" variant="outline" onClick={onCheckAgain} disabled={checking || !canCheck} className="min-h-11 sm:min-h-0">
            {checking ? tt.checking : tt.checkAgain}
          </Button>
        </div>
      </div>

      {view.kind === "loading" ? (
        <div aria-live="polite" className="space-y-2">
          <p className="text-xs text-foreground-muted">{tt.detectedLoading}</p>
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-12 w-full" />
          ))}
        </div>
      ) : view.kind === "error" || view.kind === "rate-limited" ? (
        <p role="alert" className="rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-destructive">
          {view.kind === "error" ? tt.detectedError : tt.detectedRateLimited}
        </p>
      ) : view.kind === "disconnected" ? (
        <p role="status" className="rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-foreground-muted">
          {tt.detectedDisconnected}
        </p>
      ) : (
        <>
          {statuses.length > 0 && (
            <details open={hasProblem || undefined} className="rounded-md border border-border bg-surface-inset px-3">
              <summary className="focus-ring flex min-h-11 cursor-pointer items-center py-2 text-xs font-medium sm:min-h-0">
                {tt.repositories(statuses.length, read)}
              </summary>
              <ul className="divide-y divide-border border-t border-border">
                {statuses.map((status) => (
                  <li
                    key={status.projectId}
                    data-repository-status={status.status}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5 text-xs"
                  >
                    <span className="font-medium text-foreground [overflow-wrap:anywhere]">{status.projectName}</span>
                    <span
                      className={cn(
                        "[overflow-wrap:anywhere]",
                        PROBLEM_STATUSES.has(status.status) ? "text-warning" : "text-foreground-muted",
                      )}
                    >
                      {statusText(status)}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {tools.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-foreground-muted">
              {filtered
                ? tt.detectedNoMatches
                : statuses.some((status) => status.repo)
                  ? tt.detectedEmpty
                  : tt.detectedNoRepositories}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {tools.map((tool) => (
                <DetectedToolRow key={tool.key} tool={tool} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function DetectedToolRow({ tool }: { tool: DetectedTool }) {
  const tt = useDict().tools;
  const sources = [...new Set(tool.projects.map((usage) => SOURCE_FILE[usage.source]))].join(", ");
  // Per-project notes only when they add something beyond the shared line.
  const notes = tool.projects.filter((usage) => usage.note && usage.note !== tool.whatItDoes);
  return (
    <li data-detected-tool={tool.key} className="px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">{tool.name}</h3>
        <ul aria-label={`${tt.usedIn}: ${tool.name}`} className="flex min-w-0 flex-wrap gap-1">
          {tool.projects.map((usage) => (
            <li key={usage.id}>
              <EntityBadge className="min-h-5 max-w-48 truncate py-0">{usage.name}</EntityBadge>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-1 text-xs text-foreground-muted [overflow-wrap:anywhere]">{tool.whatItDoes || tt.fromPackageJson}</p>
      <p className="mt-1 text-[11px] text-foreground-subtle">
        {tt.autoDetected} · {sources}
      </p>
      {notes.length > 0 && tool.projects.length > 1 && (
        <details className="mt-1 text-xs">
          <summary className="focus-ring inline-flex min-h-11 cursor-pointer items-center text-foreground-muted sm:min-h-0">
            {tt.howEachUses}
          </summary>
          <ul className="mt-1 space-y-1">
            {tool.projects.map((usage) => (
              <li key={usage.id} className="[overflow-wrap:anywhere]">
                <span className="font-medium text-foreground">{usage.name}</span>
                {usage.note && <span className="text-foreground-muted"> — {usage.note}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}
