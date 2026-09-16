"use client";

import { ExternalLink, Lightbulb, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PricingDot } from "@/components/panels/link-library-card";
import { useDict } from "@/lib/i18n";
import { linkDescription } from "@/lib/link-export";
import { resourceKey } from "@/lib/link-library";
import { projectLinks, projectRelevanceKeys } from "@/lib/portfolio";
import type { AiLink, Project } from "@/lib/types";

function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function ScoreBadge({ score }: { score: number | null | undefined }) {
  const t = useDict();
  if (score == null) return null;
  return <span className="inline-flex shrink-0 items-center rounded-sm border border-border bg-surface-inset px-1.5 py-0.5 text-[11px] font-semibold tabular text-foreground-muted" aria-label={`${t.portfolio.score} ${score}/5`}>{score}/5</span>;
}

function RelevanceReason({ link, project }: { link: AiLink; project: Project }) {
  const keys = projectRelevanceKeys(project);
  const reason = (link.project_relevance ?? []).find((item) => keys.has(item.repository.trim().toLowerCase()))?.reason;
  return reason ? <p className="mt-1 text-xs text-foreground-muted [overflow-wrap:anywhere]">{reason}</p> : null;
}

/**
 * Links & Ideas tab of a project workspace: the Library records whose research
 * marks this project relevant, best usefulness score first. Read-only here;
 * editing stays in the Library.
 */
export function ProjectLinksPanel({ project, links, onOpenLibrary }: {
  project: Project;
  links: AiLink[];
  onOpenLibrary: () => void;
}) {
  const t = useDict();
  const p = t.portfolio;
  const relevant = projectLinks(links, project);
  const resources = relevant.filter((link) => link.record_type !== "idea");
  const ideas = relevant.filter((link) => link.record_type === "idea");
  return (
    <div className="space-y-4">
      <p className="text-sm text-foreground-muted">{p.linksDescription}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden p-0">
          <CardHeader className="border-b border-border"><CardTitle><Link2 className="h-4 w-4" />{p.topLinks} <span className="text-xs font-normal tabular text-foreground-muted">({resources.length})</span></CardTitle></CardHeader>
          {resources.length === 0 ? (
            <CardContent className="pt-4"><p className="text-sm text-foreground-muted">{p.noProjectLinks}</p><Button size="sm" variant="outline" className="mt-3" onClick={onOpenLibrary}>{p.openLibrary}</Button></CardContent>
          ) : (
            <ul className="divide-y divide-border">
              {resources.map((link) => {
                const safeUrl = resourceKey(link.url) ? link.url : undefined;
                return (
                  <li key={link.id} className="px-4 py-2.5">
                    <div className="flex items-start gap-2">
                      <PricingDot pricing={link.pricing} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 truncate text-sm font-medium">{link.title}</span>
                          <ScoreBadge score={link.usefulness_rating} />
                        </div>
                        {safeUrl && <a href={safeUrl} target="_blank" rel="noreferrer" className="focus-ring inline-flex min-h-7 items-center gap-1 rounded text-xs text-foreground-muted hover:text-foreground hover:underline sm:min-h-5">{hostOf(link.url)}<ExternalLink aria-hidden className="h-3 w-3" /></a>}
                        <RelevanceReason link={link} project={project} />
                        {link.rating_rationale && <p className="mt-1 text-xs text-foreground-subtle [overflow-wrap:anywhere]">{link.rating_rationale}</p>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card className="overflow-hidden p-0">
          <CardHeader className="border-b border-border"><CardTitle><Lightbulb className="h-4 w-4" />{p.topIdeas} <span className="text-xs font-normal tabular text-foreground-muted">({ideas.length})</span></CardTitle></CardHeader>
          {ideas.length === 0 ? (
            <CardContent className="pt-4"><p className="text-sm text-foreground-muted">{p.noProjectIdeas}</p></CardContent>
          ) : (
            <ul className="divide-y divide-border">
              {ideas.map((idea) => (
                <li key={idea.id} className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 text-sm font-medium [overflow-wrap:anywhere]">{idea.title}</span>
                    <ScoreBadge score={idea.usefulness_rating} />
                  </div>
                  <p className="mt-1 whitespace-pre-line text-xs text-foreground-muted [overflow-wrap:anywhere]">{linkDescription(idea)}</p>
                  <RelevanceReason link={idea} project={project} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
