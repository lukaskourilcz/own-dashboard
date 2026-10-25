"use client";

import { useMemo, useState } from "react";
import { Plus, Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompetitorActions } from "@/components/competition/use-competitor-actions";
import { CompetitionPagination } from "@/components/competition/competition-pagination";
import { CompetitionRecovery } from "@/components/competition/competition-recovery";
import { CompetitorList } from "@/components/competition/competitor-list";
import { CompetitorDialog, competitorToForm, emptyCompetitorForm, type CompetitorForm } from "@/components/competition/competitor-dialog";
import { staleCompetitorCount, sortCompetitors, competitorPage } from "@/lib/competition";
import { parseDateOnly, todayKey } from "@/lib/date-keys";
import { useDict } from "@/lib/i18n";
import { useNow } from "@/lib/use-now";
import type { Competitor, Project, Updater } from "@/lib/types";

/** The Competition tab inside one project workspace. */
export function ProjectCompetition({ project, competitors, setCompetitors, refreshFailed }: {
  project: Project;
  competitors: Competitor[];
  setCompetitors: Updater<Competitor[]>;
  refreshFailed?: boolean;
}) {
  const t = useDict();
  const p = t.portfolio;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<CompetitorForm>(emptyCompetitorForm(project.id));
  const actions = useCompetitorActions(setCompetitors, competitors);
  // One clock for the tab, collapsed to the calendar day (see CompetitionPanel).
  const tick = useNow();
  const dayKey = tick ? todayKey(tick) : null;
  const now = useMemo(() => (dayKey ? parseDateOnly(dayKey) : null), [dayKey]);
  const [page, setPage] = useState({ projectId: project.id, index: 0 });
  const own = useMemo(() => sortCompetitors(competitors.filter(item => item.project_id === project.id)), [competitors, project.id]);
  const currentPage = competitorPage(own, page.projectId === project.id ? page.index : 0);
  const stale = useMemo(() => now ? staleCompetitorCount(own, now) : 0, [own, now]);
  return (
    <Card className="mx-auto w-full max-w-5xl overflow-hidden p-0">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-border">
        <div>
          <CardTitle><Swords className="h-4 w-4" />{p.projectCompetitionTab}</CardTitle>
          <CardContent className="px-0 pb-0 text-xs text-foreground-muted">{p.competitorsCount(own.length)}{stale > 0 ? ` · ${p.staleCount(stale)}` : ""}</CardContent>
        </div>
        <Button ref={button => actions.registerNewControl(button)} size="sm" disabled={actions.pending.size > 0} onClick={() => { setForm(emptyCompetitorForm(project.id)); setDialogOpen(true); }}><Plus className="h-3.5 w-3.5" />{p.addCompetitor}</Button>
      </CardHeader>
      <div className="px-3"><CompetitionRecovery actions={actions} refreshFailed={refreshFailed} /><CompetitionPagination page={currentPage} onPage={index => setPage({ projectId: project.id, index })} /></div>
      <CompetitorList competitors={currentPage.items} now={now} onEdit={(competitor) => { setForm(competitorToForm(competitor)); setDialogOpen(true); }} onDelete={actions.remove} pending={actions.pending} deleteControl={actions.deleteControl} empty={p.noCompetitorsForProject} />
      <CompetitorDialog open={dialogOpen} onOpenChange={setDialogOpen} form={form} setForm={setForm} projects={[project]} actions={actions} />
    </Card>
  );
}
