"use client";

import { useState, type Ref } from "react";
import { ChevronDown, ExternalLink, Pencil, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tooltip } from "@/components/ui/tooltip";
import { useDict, useLang } from "@/lib/i18n";
import { competitorReviewState, sortCompetitors } from "@/lib/competition";
import { safeWebUrl } from "@/lib/web-url";
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

const reviewDates = { en: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }), cs: new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) };
function LinkList({ urls }: { urls: string[] }) {
  const safe = urls.flatMap(value => { const href = safeWebUrl(value); return href ? [{ value, href }] : []; });
  if (safe.length === 0) return null;
  return (
    <ul className="mt-1 space-y-1 break-all">
      {safe.map(({ value, href }, index) => (
        <li key={`${index}-${value}`}>
          <a href={href} target="_blank" rel="noreferrer" className="focus-ring flex min-h-11 min-w-0 max-w-full items-center gap-1 rounded underline md:min-h-6">
            <span className="min-w-0 [overflow-wrap:anywhere]">{value}</span>
            <ExternalLink aria-hidden className="h-3 w-3 shrink-0" />
          </a>
        </li>
      ))}
    </ul>
  );
}

export function CompetitorRow({ competitor, now, onEdit, onDelete, disabled, deleteRef }: {
  competitor: Competitor;
  /** Hydration-safe clock from the owning panel; null before hydration, when no freshness is shown. */
  now: Date | null;
  onEdit: () => void;
  onDelete: () => void;
  disabled?: boolean;
  deleteRef?: Ref<HTMLButtonElement>;
}) {
  const t = useDict();
  const p = t.portfolio;
  const { lang } = useLang();
  const [expanded, setExpanded] = useState(false);
  const review = now ? competitorReviewState(competitor.reviewed_at, now) : null;
  const safeUrl = safeWebUrl(competitor.url);
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
            className="focus-ring flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md text-left md:min-h-8"
          >
            <span className="min-w-0 truncate text-sm font-medium">{competitor.name}</span>
            <StatusBadge value={competitor.category} label={p.categories[competitor.category]} tone={CATEGORY_TONE[competitor.category]} />
            <ChevronDown aria-hidden className={cn("h-3.5 w-3.5 shrink-0 text-foreground-muted transition-transform motion-reduce:transition-none", expanded && "rotate-180")} />
          </button>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground-muted">
            {safeUrl && (
              <a href={safeUrl} target="_blank" rel="noreferrer" aria-label={`${p.visit}: ${competitor.name}`} className="focus-ring inline-flex min-h-11 min-w-0 max-w-full items-center gap-1 rounded hover:text-foreground hover:underline md:min-h-6">
                <span className="truncate">{hostOf(safeUrl)}</span>
                <ExternalLink aria-hidden className="h-3 w-3 shrink-0" />
              </a>
            )}
            <ScoreDots score={competitor.relevance_score} label={p.relevanceScore} />
            {/* Freshness sits beside the date it judges, on the wrapping metadata
                row rather than the title row, so a narrow screen wraps it instead
                of crushing the competitor's name between two badges. */}
            {review && review !== "fresh" && (
              <StatusBadge value={`review-${review}`} label={review === "never" ? p.reviewNever : p.reviewStale} tone="warning" />
            )}
            {competitor.reviewed_at && <span className="tabular">{p.reviewedAt} <time dateTime={competitor.reviewed_at}>{reviewDates[lang].format(new Date(`${competitor.reviewed_at}T00:00:00Z`))}</time></span>}
            {competitor.pricing_model && <span className="hidden truncate sm:inline">{competitor.pricing_model.length > 90 ? `${competitor.pricing_model.slice(0, 90)}…` : competitor.pricing_model}</span>}
          </div>
        </div>
        <div className="flex shrink-0">
          <Tooltip content={p.editCompetitor}>
            <button type="button" disabled={disabled} onClick={onEdit} aria-label={`${p.editCompetitor}: ${competitor.name}`} className="focus-ring inline-flex h-11 w-11 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-hover hover:text-foreground md:h-8 md:w-8">
              <Pencil aria-hidden className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <Tooltip content={p.deleteCompetitor}>
            <button ref={deleteRef} type="button" disabled={disabled} onClick={onDelete} aria-label={`${p.deleteCompetitor}: ${competitor.name}`} className="focus-ring inline-flex h-11 w-11 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-hover hover:text-destructive md:h-8 md:w-8">
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
              <ul className="mt-1 list-disc space-y-0.5 pl-4 [overflow-wrap:anywhere]">{competitor.useful_features.map((feature, index) => <li key={`${index}-${feature}`}>{feature}</li>)}</ul>
            </div>
          )}
          {(competitor.social_content || competitor.social_links.length > 0) && (
            <div>
              <p className="font-medium text-foreground">{p.socialContent}</p>
              {competitor.social_content && <p className="mt-1 whitespace-pre-line [overflow-wrap:anywhere]">{competitor.social_content}</p>}
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
        {competitor.score_rationale && <p className="[overflow-wrap:anywhere]"><span className="font-medium text-foreground">{p.scoreRationale}:</span> {competitor.score_rationale}</p>}
        {competitor.source_urls.length > 0 && (
          <details>
            <summary className="focus-ring inline-flex min-h-11 cursor-pointer items-center rounded md:min-h-6">{p.sourceUrls}</summary>
            <LinkList urls={competitor.source_urls} />
          </details>
        )}
      </div>
    </li>
  );
}

export function CompetitorList({ competitors, now, onEdit, onDelete, empty, pending, deleteControl }: {
  competitors: Competitor[];
  /** Resolved once per panel with `useNow()` and handed down, so a long list opens one clock subscription, not one per row. */
  now: Date | null;
  onEdit: (competitor: Competitor) => void;
  onDelete: (competitor: Competitor) => void;
  empty: string;
  pending?: ReadonlySet<string>;
  deleteControl?: (id: string, button: HTMLButtonElement | null) => void;
}) {
  if (competitors.length === 0) return <p className="px-3 py-3 text-sm text-foreground-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {sortCompetitors(competitors).map((competitor) => (
        <CompetitorRow deleteRef={button => deleteControl?.(competitor.id, button)} disabled={pending?.has(competitor.id)} key={competitor.id} competitor={competitor} now={now} onEdit={() => onEdit(competitor)} onDelete={() => onDelete(competitor)} />
      ))}
    </ul>
  );
}
