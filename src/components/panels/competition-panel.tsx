"use client";

import { useMemo, useRef, useState } from "react";
import { Plus, Search, Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader, SectionLabel } from "@/components/ui/page-header";
import { SimpleSelect } from "@/components/ui/select";
import { EntityBadge } from "@/components/ui/status-badge";
import { useCompetitorActions } from "@/components/competition/use-competitor-actions";
import { CompetitionPagination } from "@/components/competition/competition-pagination";
import { CompetitionRecovery } from "@/components/competition/competition-recovery";
import { CompetitorList } from "@/components/competition/competitor-list";
import { CompetitorDialog, competitorToForm, emptyCompetitorForm, type CompetitorForm } from "@/components/competition/competitor-dialog";
import { parseDateOnly, todayKey } from "@/lib/date-keys";
import { useDict, useLang } from "@/lib/i18n";
import { isCompetitorReviewStale, staleCompetitorCount, competitionProjectOrder, competitorPage, sortCompetitors } from "@/lib/competition";
import { portfolioEntryFor } from "@/lib/portfolio";
import { useNow } from "@/lib/use-now";
import type { Competitor, CompetitorCategory, Project, Updater } from "@/lib/types";

const searchable = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase();

/**
 * Competition — every competitor recorded for every project, grouped by the
 * portfolio registry's categories, with search, project and type filters.
 */
export function CompetitionPanel({ projects, competitors, setCompetitors, onOpenProject, refreshFailed }: {
  projects: Project[];
  competitors: Competitor[];
  setCompetitors: Updater<Competitor[]>;
  refreshFailed?: boolean;
  onOpenProject: (project: Project) => void;
}) {
  const t = useDict();
  const { lang } = useLang();
  const p = t.portfolio;
  const searchControl = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | CompetitorCategory>("all");
  const [reviewFilter, setReviewFilter] = useState<"all" | "stale">("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<CompetitorForm>(emptyCompetitorForm());
  const actions = useCompetitorActions(setCompetitors, competitors);
  // One clock for the whole panel: every row reads freshness from this prop
  // instead of subscribing itself. Null until hydration, so the server and the
  // first client render agree and no badge flashes in. The 30-second tick is
  // collapsed to the calendar day, because a 90-day marker only ever moves at
  // local midnight and the filter memo should not rerun twice a minute.
  const tick = useNow();
  const dayKey = tick ? todayKey(tick) : null;
  const now = useMemo(() => (dayKey ? parseDateOnly(dayKey) : null), [dayKey]);

  // Portfolio projects first (with their subsections) in registry order, then
  // client projects, then any other project that already has research
  // attached, so nothing recorded is unreachable.
  const orderedProjects = useMemo(() => competitionProjectOrder(projects, competitors), [projects, competitors]);
  const searching = query.trim().length > 0;
  const searchIndex = useMemo(() => searching ? new Map(competitors.map(item => [item.id, searchable([item.name, item.summary, item.pricing_model, item.lessons, item.social_content, ...item.useful_features].join(" "))])) : null, [competitors, searching]);

  const visible = useMemo(() => {
    const words = searchable(query).trim().split(/\s+/).filter(Boolean);
    return competitors.filter((item) => {
      if (projectFilter !== "all" && item.project_id !== projectFilter) return false;
      if (categoryFilter !== "all" && item.category !== categoryFilter) return false;
      if (reviewFilter === "stale" && !(now && isCompetitorReviewStale(item, now))) return false;
      if (words.length === 0) return true;
      const text = searchIndex?.get(item.id) ?? "";
      return words.every((word) => text.includes(word));
    });
  }, [competitors, query, projectFilter, categoryFilter, reviewFilter, now, searchIndex]);

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

  // Totals describe all filtered records; the range identifies the mounted page.
  const groups = useMemo(() => {
    const result: { id: string; project: Project | null; items: Competitor[] }[] = [];
    const seen = new Set<string>();
    for (const project of orderedProjects) {
      seen.add(project.id);
      const items = byProject.get(project.id);
      if (items?.length) result.push({ id: project.id, project, items: sortCompetitors(items) });
    }
    for (const [id, items] of byProject) if (!seen.has(id)) result.push({ id, project: null, items: sortCompetitors(items) });
    return result;
  }, [orderedProjects, byProject]);
  const reviewCounts = useMemo(() => {
    const byProject = new Map<string, number>(); let total = 0;
    for (const group of groups) { const count = now ? staleCompetitorCount(group.items, now) : 0; byProject.set(group.id, count); total += count; }
    return { byProject, total };
  }, [groups, now]);
  const staleTotal = reviewCounts.total;
  const orderedRows = useMemo(() => groups.flatMap(group => group.items), [groups]);
  const currentPage = competitorPage(orderedRows, page);
  const pageByProject = new Map<string, Competitor[]>();
  for (const row of currentPage.items) { const list = pageByProject.get(row.project_id); if (list) list.push(row); else pageByProject.set(row.project_id, [row]); }
  const projectById = useMemo(() => new Map(projects.map(project => [project.id, project])), [projects]);
  const clearFilters = () => { setQuery(""); setProjectFilter("all"); setCategoryFilter("all"); setReviewFilter("all"); setPage(0); searchControl.current?.focus(); };

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader
        title={p.competitionTitle}
        description={p.competitionDescription}
        action={<Button ref={button => actions.registerNewControl(button)} size="sm" disabled={actions.pending.size > 0} onClick={() => openNew()}><Plus className="h-3.5 w-3.5" />{p.addCompetitor}</Button>}
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-0 flex-1 sm:min-w-[14rem]">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-subtle" />
          <Input ref={searchControl} aria-label={p.searchCompetitors} placeholder={p.searchCompetitors} value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} className="pl-8" />
        </div>
        <SimpleSelect aria-label={p.project} value={projectFilter} onValueChange={value => { setProjectFilter(value); setPage(0); }} className="sm:w-44" options={[{ value: "all", label: p.allProjects }, ...orderedProjects.map((project) => ({ value: project.id, label: project.parent_id ? `↳ ${project.name}` : project.name }))]} />
        <SimpleSelect aria-label={p.competitorCategory} value={categoryFilter} onValueChange={(value) => { setCategoryFilter(value as "all" | CompetitorCategory); setPage(0); }} className="sm:w-36" options={[{ value: "all", label: p.allCategories }, ...(["direct", "indirect", "inspiration"] as CompetitorCategory[]).map((value) => ({ value, label: p.categories[value] }))]} />
        <SimpleSelect aria-label={p.reviewFilter} value={reviewFilter} onValueChange={(value) => { setReviewFilter(value as "all" | "stale"); setPage(0); }} className="sm:w-40" options={[{ value: "all", label: p.allReviews }, { value: "stale", label: p.staleOnly }]} />
        <span className="text-xs tabular text-foreground-subtle">{p.competitorsCount(visible.length)}{staleTotal > 0 ? ` · ${p.staleCount(staleTotal)}` : ""}</span>
      </div>

      <CompetitionRecovery actions={actions} refreshFailed={refreshFailed} />

      {staleTotal > 0 && <p className="mb-4 text-xs text-foreground-muted">{p.reviewStaleHint}</p>}

      {competitors.length === 0 ? (
        <Card><CardContent className="py-8"><EmptyState icon={Swords} title={p.noCompetitors} description={p.noCompetitorsHint} action={<Button size="sm" disabled={actions.pending.size > 0} onClick={() => openNew()}><Plus className="h-3.5 w-3.5" />{p.addCompetitor}</Button>} /></CardContent></Card>
      ) : visible.length === 0 ? (
        <EmptyState icon={Search} title={p.competitorNoMatches} description={p.competitorNoMatchesHint} action={<Button size="sm" variant="outline" onClick={clearFilters}>{p.competitorClearFilters}</Button>} />
      ) : (
        <div className="space-y-4">
          <CompetitionPagination page={currentPage} onPage={setPage} />
          {groups.filter(group => pageByProject.has(group.id)).map((group) => {
            const project = group.project;
            const entry = project ? portfolioEntryFor(project) : undefined;
            const parent = project?.parent_id ? projectById.get(project.parent_id) : undefined;
            const list = pageByProject.get(group.id) ?? [];
            const groupStale = reviewCounts.byProject.get(group.id) ?? 0;
            return (
              <Card key={group.id} className="overflow-hidden p-0">
                <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 border-b border-border">
                  <div className="min-w-0">
                    <CardTitle className="flex-wrap">
                      {project ? <button type="button" onClick={() => onOpenProject(project)} className="focus-ring min-w-0 rounded text-left [overflow-wrap:anywhere] hover:underline">{project.name}</button> : <span>{p.competitorProjectUnavailable}</span>}
                      {parent && <EntityBadge>{p.subsectionOf(parent.name)}</EntityBadge>}
                    </CardTitle>
                    {entry && <p className="mt-0.5 text-xs text-foreground-muted">{entry.summary[lang]}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {groups.length > 1 && <SectionLabel>{p.competitorsCount(group.items.length)}{groupStale > 0 ? ` · ${p.staleCount(groupStale)}` : ""}</SectionLabel>}
                    {project && <Button size="sm" variant="outline" disabled={actions.pending.size > 0} onClick={() => openNew(project.id)} aria-label={`${p.addCompetitor}: ${project.name}`}><Plus className="h-3.5 w-3.5" /></Button>}
                  </div>
                </CardHeader>
                <CompetitorList competitors={list} now={now} onEdit={openEdit} onDelete={actions.remove} pending={actions.pending} deleteControl={actions.deleteControl} empty={p.noCompetitorsForProject} />
              </Card>
            );
          })}
        </div>
      )}

      <CompetitorDialog open={dialogOpen} onOpenChange={setDialogOpen} form={form} setForm={setForm} projects={orderedProjects} actions={actions} />
    </div>
  );
}
