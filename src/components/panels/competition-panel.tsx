"use client";

import { useMemo, useState } from "react";
import { Plus, Search, Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader, SectionLabel } from "@/components/ui/page-header";
import { SimpleSelect } from "@/components/ui/select";
import { EntityBadge } from "@/components/ui/status-badge";
import { CompetitorList } from "@/components/competition/competitor-list";
import { CompetitorDialog, competitorToForm, emptyCompetitorForm, useDeleteCompetitor, type CompetitorForm } from "@/components/competition/competitor-dialog";
import { parseDateOnly, todayKey } from "@/lib/date-keys";
import { useDict, useLang } from "@/lib/i18n";
import { isCompetitorReviewStale, staleCompetitorCount } from "@/lib/competition";
import { childProjects, groupPortfolio, portfolioEntryFor, projectScope } from "@/lib/portfolio";
import { useNow } from "@/lib/use-now";
import type { Competitor, CompetitorCategory, Project, Updater } from "@/lib/types";

const searchable = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase();

/**
 * Competition — every competitor recorded for every project, grouped the same
 * way the Projects table is grouped, with search, project and type filters.
 */
export function CompetitionPanel({ projects, competitors, setCompetitors, onOpenProject }: {
  projects: Project[];
  competitors: Competitor[];
  setCompetitors: Updater<Competitor[]>;
  onOpenProject: (project: Project) => void;
}) {
  const t = useDict();
  const { lang } = useLang();
  const p = t.portfolio;
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | CompetitorCategory>("all");
  const [reviewFilter, setReviewFilter] = useState<"all" | "stale">("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<CompetitorForm>(emptyCompetitorForm());
  const remove = useDeleteCompetitor(setCompetitors);
  // One clock for the whole panel: every row reads freshness from this prop
  // instead of subscribing itself. Null until hydration, so the server and the
  // first client render agree and no badge flashes in. The 30-second tick is
  // collapsed to the calendar day, because a 90-day marker only ever moves at
  // local midnight and the filter memo should not rerun twice a minute.
  const tick = useNow();
  const dayKey = tick ? todayKey(tick) : null;
  const now = useMemo(() => (dayKey ? parseDateOnly(dayKey) : null), [dayKey]);

  // Portfolio projects first (with their subsections), then any other project
  // that already has research attached, so nothing recorded is unreachable.
  const orderedProjects = useMemo(() => {
    const active = projects.filter((project) => project.is_active && projectScope(project) !== "other");
    const withCompetitors = new Set(competitors.map((item) => item.project_id));
    const ordered: Project[] = [];
    for (const group of groupPortfolio(active)) {
      for (const project of group.projects) {
        ordered.push(project);
        ordered.push(...childProjects(projects, project.id));
      }
    }
    for (const project of projects) {
      if (!ordered.some((item) => item.id === project.id) && withCompetitors.has(project.id)) ordered.push(project);
    }
    return ordered;
  }, [projects, competitors]);

  const visible = useMemo(() => {
    const words = searchable(query).trim().split(/\s+/).filter(Boolean);
    return competitors.filter((item) => {
      if (projectFilter !== "all" && item.project_id !== projectFilter) return false;
      if (categoryFilter !== "all" && item.category !== categoryFilter) return false;
      if (reviewFilter === "stale" && !(now && isCompetitorReviewStale(item, now))) return false;
      if (words.length === 0) return true;
      const text = searchable([item.name, item.summary, item.pricing_model, item.lessons, item.social_content, ...item.useful_features].join(" "));
      return words.every((word) => text.includes(word));
    });
  }, [competitors, query, projectFilter, categoryFilter, reviewFilter, now]);

  const byProject = useMemo(() => {
    const map = new Map<string, Competitor[]>();
    for (const item of visible) {
      const list = map.get(item.project_id);
      if (list) list.push(item);
      else map.set(item.project_id, [item]);
    }
    return map;
  }, [visible]);

  const openNew = (projectId?: string) => {
    setForm(emptyCompetitorForm(projectId ?? (projectFilter !== "all" ? projectFilter : orderedProjects[0]?.id ?? "")));
    setDialogOpen(true);
  };
  const openEdit = (competitor: Competitor) => {
    setForm(competitorToForm(competitor));
    setDialogOpen(true);
  };

  // Counted over the rows actually on screen, so the two toolbar numbers
  // always describe the same set rather than inviting a subtraction that is
  // wrong the moment a filter is active.
  const staleTotal = now ? staleCompetitorCount(visible, now) : 0;
  const filtering = query.trim() !== "" || projectFilter !== "all" || categoryFilter !== "all" || reviewFilter !== "all";
  const groupsToRender = orderedProjects.filter((project) => byProject.has(project.id) || (!filtering && projectScope(project) === "project"));

  return (
    <div>
      <PageHeader
        title={p.competitionTitle}
        description={p.competitionDescription}
        action={<Button size="sm" onClick={() => openNew()}><Plus className="h-3.5 w-3.5" />{p.addCompetitor}</Button>}
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-0 flex-1 sm:min-w-[14rem]">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-subtle" />
          <Input aria-label={p.searchCompetitors} placeholder={p.searchCompetitors} value={query} onChange={(event) => setQuery(event.target.value)} className="pl-8" />
        </div>
        <SimpleSelect aria-label={p.project} value={projectFilter} onValueChange={setProjectFilter} className="sm:w-56" options={[{ value: "all", label: p.allProjects }, ...orderedProjects.map((project) => ({ value: project.id, label: project.parent_id ? `↳ ${project.name}` : project.name }))]} />
        <SimpleSelect aria-label={p.competitorCategory} value={categoryFilter} onValueChange={(value) => setCategoryFilter(value as "all" | CompetitorCategory)} className="sm:w-40" options={[{ value: "all", label: p.allCategories }, ...(["direct", "indirect", "inspiration"] as CompetitorCategory[]).map((value) => ({ value, label: p.categories[value] }))]} />
        <SimpleSelect aria-label={p.reviewFilter} value={reviewFilter} onValueChange={(value) => setReviewFilter(value as "all" | "stale")} className="sm:w-44" options={[{ value: "all", label: p.allReviews }, { value: "stale", label: p.staleOnly }]} />
        <span className="text-xs tabular text-foreground-subtle">{p.competitorsCount(visible.length)}{staleTotal > 0 ? ` · ${p.staleCount(staleTotal)}` : ""}</span>
      </div>

      {staleTotal > 0 && <p className="mb-4 text-xs text-foreground-muted">{p.reviewStaleHint}</p>}

      {competitors.length === 0 ? (
        <Card><CardContent className="py-8"><EmptyState icon={Swords} title={p.noCompetitors} description={p.noCompetitorsHint} action={<Button size="sm" onClick={() => openNew()}><Plus className="h-3.5 w-3.5" />{p.addCompetitor}</Button>} /></CardContent></Card>
      ) : (
        <div className="space-y-4">
          {groupsToRender.map((project) => {
            const entry = portfolioEntryFor(project);
            const parent = project.parent_id ? projects.find((item) => item.id === project.parent_id) : undefined;
            const list = byProject.get(project.id) ?? [];
            const groupStale = now ? staleCompetitorCount(list, now) : 0;
            return (
              <Card key={project.id} className="overflow-hidden p-0">
                <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 border-b border-border">
                  <div className="min-w-0">
                    <CardTitle>
                      <button type="button" onClick={() => onOpenProject(project)} className="focus-ring rounded text-left hover:underline">{project.name}</button>
                      {parent && <EntityBadge>{p.subsectionOf(parent.name)}</EntityBadge>}
                    </CardTitle>
                    {entry && <p className="mt-0.5 text-xs text-foreground-muted">{entry.summary[lang]}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <SectionLabel>{p.competitorsCount(list.length)}{groupStale > 0 ? ` · ${p.staleCount(groupStale)}` : ""}</SectionLabel>
                    <Button size="sm" variant="outline" onClick={() => openNew(project.id)} aria-label={`${p.addCompetitor}: ${project.name}`}><Plus className="h-3.5 w-3.5" /></Button>
                  </div>
                </CardHeader>
                <CompetitorList competitors={list} now={now} onEdit={openEdit} onDelete={remove} empty={p.noCompetitorsForProject} />
              </Card>
            );
          })}
        </div>
      )}

      <CompetitorDialog open={dialogOpen} onOpenChange={setDialogOpen} form={form} setForm={setForm} projects={orderedProjects} setCompetitors={setCompetitors} />
    </div>
  );
}
