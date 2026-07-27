"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { useDict, useLang } from "@/lib/i18n";
import { JOB_SOURCE_META, type JobSourceKind } from "@/lib/jobs/meta";
import type { JobScrapeRun, SourceOutcome } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Says which boards supply the Career listings and what each returned on the
 * last check. It also explains why an offer vanishes: a full-board feed drops
 * a missing offer immediately, a paginated board only after its page 404s.
 *
 * Collapsed by default — this answers "where does this come from" rather than
 * being part of the daily scanning flow.
 */
export function JobSources({ lastRun }: { lastRun: JobScrapeRun | null }) {
  const t = useDict();
  const { lang } = useLang();
  const [open, setOpen] = useState(false);

  const outcomes = (lastRun?.sources ?? {}) as Record<string, SourceOutcome>;
  const kindLabel: Record<JobSourceKind, string> = {
    json: t.jobs.sourceKindJson,
    html: t.jobs.sourceKindHtml,
    rss: t.jobs.sourceKindRss,
  };

  return (
    <Card className="p-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="focus-ring flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="min-w-0">
          <span className="block text-xs font-semibold">{t.jobs.sourcesTitle}</span>
          <span className="mt-0.5 block text-[11px] leading-5 text-foreground-muted">
            {t.jobs.sourcesDescription}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-foreground-muted">
          {open ? t.jobs.sourcesHide : t.jobs.sourcesShow}
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
            aria-hidden
          />
        </span>
      </button>

      {open && (
        <ul className="border-t border-border">
          {Object.entries(JOB_SOURCE_META).map(([id, meta]) => {
            const outcome = outcomes[id];
            return (
              <li
                key={id}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-border px-4 py-2.5 last:border-b-0"
              >
                <a
                  href={meta.site}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={`${meta.label} — ${t.jobs.sourceOpen}`}
                  className="focus-ring inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline"
                >
                  {meta.label}
                  <ExternalLink className="h-3 w-3 text-foreground-subtle" aria-hidden />
                </a>

                <span className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-foreground-muted">
                  {kindLabel[meta.kind]}
                </span>

                <Tooltip
                  content={
                    meta.complete ? t.jobs.sourceCompleteHint : t.jobs.sourcePartialHint
                  }
                >
                  <span className="rounded-sm bg-surface-inset px-1.5 py-0.5 text-[10px] text-foreground-muted">
                    {meta.complete ? t.jobs.sourceComplete : t.jobs.sourcePartial}
                  </span>
                </Tooltip>

                <span className="w-full text-[11px] leading-5 text-foreground-muted sm:w-auto sm:flex-1">
                  {meta.scope[lang]}
                </span>

                {outcome?.error ? (
                  <Tooltip content={outcome.error}>
                    <span className="inline-flex items-center gap-1 text-[11px] text-warning">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                      {t.jobs.sourceErrors}
                    </span>
                  </Tooltip>
                ) : outcome ? (
                  <span className="whitespace-nowrap text-[11px] tabular-nums text-foreground-muted">
                    {t.jobs.sourceFound(outcome.count)}
                    {outcome.pruned ? ` · ${t.jobs.sourceRemoved(outcome.pruned)}` : ""}
                  </span>
                ) : (
                  <span className="whitespace-nowrap text-[11px] text-foreground-subtle">
                    {t.jobs.sourceNoRun}
                  </span>
                )}

                <code className="w-full break-all font-mono text-[10px] text-foreground-subtle">
                  {meta.endpoint}
                </code>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
