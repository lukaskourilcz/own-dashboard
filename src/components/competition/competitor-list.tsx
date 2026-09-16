"use client";

import { useState } from "react";
import { ChevronDown, ExternalLink, Pencil, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tooltip } from "@/components/ui/tooltip";
import { useDict } from "@/lib/i18n";
import { resourceKey } from "@/lib/link-library";
import { cn } from "@/lib/utils";
import type { Competitor, CompetitorCategory } from "@/lib/types";

function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

const CATEGORY_TONE: Record<CompetitorCategory, "information" | "neutral" | "success"> = {
  direct: "information",
  indirect: "neutral",
  inspiration: "success",
};

/** Five-step relevance marker with a numeric text so the score never relies on color alone. */
export function ScoreDots({ score, label }: { score: number | null; label: string }) {
  const t = useDict();
  if (score == null) return <span className="text-[11px] text-foreground-subtle">{t.portfolio.notScored}</span>;
  return (
    <span className="inline-flex items-center gap-1.5" role="img" aria-label={`${label}: ${score}/5`}>
      <span className="inline-flex gap-0.5" aria-hidden>
        {[1, 2, 3, 4, 5].map((step) => (
          <span key={step} className={cn("h-1.5 w-3 rounded-sm", step <= score ? "bg-[var(--section-accent,var(--mac-blue))]" : "bg-border-strong")} />
        ))}
      </span>
      <span className="text-[11px] tabular text-foreground-muted">{score}/5</span>
    </span>
  );
}

function LinkList({ urls }: { urls: string[] }) {
  const safe = urls.filter((url) => resourceKey(url));
  if (safe.length === 0) return null;
  return (
    <ul className="mt-1 space-y-1 break-all">
      {safe.map((url) => (
        <li key={url}>
          <a href={url} target="_blank" rel="noreferrer" className="focus-ring inline-flex min-h-8 items-center gap-1 rounded underline sm:min-h-6">
            {url}
            <ExternalLink aria-hidden className="h-3 w-3 shrink-0" />
          </a>
        </li>
      ))}
    </ul>
  );
}

export function CompetitorRow({ competitor, onEdit, onDelete }: {
  competitor: Competitor;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useDict();
  const p = t.portfolio;
  const [expanded, setExpanded] = useState(false);
  const safeUrl = competitor.url && resourceKey(competitor.url) ? competitor.url : null;
  const detailsId = `competitor-${competitor.id}`;
  return (
    <li className="min-w-0" data-competitor={competitor.id}>
      <div className="flex items-center gap-2 px-3 py-2 hover:bg-surface-hover/50">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-controls={detailsId}
            className="focus-ring flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md text-left sm:min-h-8"
          >
            <span className="min-w-0 truncate text-sm font-medium">{competitor.name}</span>
            <StatusBadge value={competitor.category} label={p.categories[competitor.category]} tone={CATEGORY_TONE[competitor.category]} />
            <ChevronDown aria-hidden className={cn("h-3.5 w-3.5 shrink-0 text-foreground-muted transition-transform motion-reduce:transition-none", expanded && "rotate-180")} />
          </button>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground-muted">
            {safeUrl && (
              <a href={safeUrl} target="_blank" rel="noreferrer" aria-label={`${p.visit}: ${competitor.name}`} className="focus-ring inline-flex min-h-7 items-center gap-1 rounded hover:text-foreground hover:underline sm:min-h-5">
                <span className="truncate">{hostOf(safeUrl)}</span>
                <ExternalLink aria-hidden className="h-3 w-3 shrink-0" />
              </a>
            )}
            <ScoreDots score={competitor.relevance_score} label={p.relevanceScore} />
            {competitor.pricing_model && <span className="hidden truncate sm:inline">{competitor.pricing_model.length > 90 ? `${competitor.pricing_model.slice(0, 90)}…` : competitor.pricing_model}</span>}
          </div>
        </div>
        <div className="flex shrink-0">
          <Tooltip content={p.editCompetitor}>
            <button type="button" onClick={onEdit} aria-label={`${p.editCompetitor}: ${competitor.name}`} className="focus-ring inline-flex h-11 w-11 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-hover hover:text-foreground sm:h-8 sm:w-8">
              <Pencil aria-hidden className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <Tooltip content={p.deleteCompetitor}>
            <button type="button" onClick={onDelete} aria-label={`${p.deleteCompetitor}: ${competitor.name}`} className="focus-ring inline-flex h-11 w-11 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-hover hover:text-destructive sm:h-8 sm:w-8">
              <Trash2 aria-hidden className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>
      <div id={detailsId} hidden={!expanded} className="space-y-3 border-t border-border/60 bg-surface-muted/30 px-3 py-3 text-xs text-foreground-muted">
        {competitor.summary && <p className="whitespace-pre-line text-foreground [overflow-wrap:anywhere]">{competitor.summary}</p>}
        <div className="grid gap-3 md:grid-cols-2">
          {competitor.useful_features.length > 0 && (
            <div>
              <p className="font-medium text-foreground">{p.usefulFeatures}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">{competitor.useful_features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
            </div>
          )}
          {competitor.social_content && (
            <div>
              <p className="font-medium text-foreground">{p.socialContent}</p>
              <p className="mt-1 whitespace-pre-line [overflow-wrap:anywhere]">{competitor.social_content}</p>
              <LinkList urls={competitor.social_links} />
            </div>
          )}
          {competitor.pricing_model && (
            <div>
              <p className="font-medium text-foreground">{p.pricingModel}</p>
              <p className="mt-1 whitespace-pre-line [overflow-wrap:anywhere]">{competitor.pricing_model}</p>
            </div>
          )}
          {competitor.lessons && (
            <div>
              <p className="font-medium text-foreground">{p.lessons}</p>
              <p className="mt-1 whitespace-pre-line [overflow-wrap:anywhere]">{competitor.lessons}</p>
            </div>
          )}
        </div>
        {competitor.score_rationale && <p><span className="font-medium text-foreground">{p.scoreRationale}:</span> {competitor.score_rationale}</p>}
        {competitor.source_urls.length > 0 && (
          <details>
            <summary className="focus-ring cursor-pointer rounded">{p.sourceUrls}{competitor.reviewed_at ? ` · ${p.reviewedAt} ${competitor.reviewed_at}` : ""}</summary>
            <LinkList urls={competitor.source_urls} />
          </details>
        )}
      </div>
    </li>
  );
}

export function sortCompetitors(list: Competitor[]): Competitor[] {
  return [...list].sort((a, b) =>
    (b.relevance_score ?? 0) - (a.relevance_score ?? 0)
    || a.sort_order - b.sort_order
    || a.name.localeCompare(b.name),
  );
}

export function CompetitorList({ competitors, onEdit, onDelete, empty }: {
  competitors: Competitor[];
  onEdit: (competitor: Competitor) => void;
  onDelete: (competitor: Competitor) => void;
  empty: string;
}) {
  if (competitors.length === 0) return <p className="px-3 py-3 text-sm text-foreground-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {sortCompetitors(competitors).map((competitor) => (
        <CompetitorRow key={competitor.id} competitor={competitor} onEdit={() => onEdit(competitor)} onDelete={() => onDelete(competitor)} />
      ))}
    </ul>
  );
}
