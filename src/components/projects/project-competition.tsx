"use client";

import { useState } from "react";
import { Plus, Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CompetitorList } from "@/components/competition/competitor-list";
import { CompetitorDialog, competitorToForm, emptyCompetitorForm, useDeleteCompetitor, type CompetitorForm } from "@/components/competition/competitor-dialog";
import { useDict } from "@/lib/i18n";
import type { Competitor, Project, Updater } from "@/lib/types";

/** The Competition tab inside one project workspace. */
export function ProjectCompetition({ project, competitors, setCompetitors }: {
  project: Project;
  competitors: Competitor[];
  setCompetitors: Updater<Competitor[]>;
}) {
  const t = useDict();
  const p = t.portfolio;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<CompetitorForm>(emptyCompetitorForm(project.id));
  const remove = useDeleteCompetitor(setCompetitors);
  const own = competitors.filter((item) => item.project_id === project.id);
  return (
    <Card className="overflow-hidden p-0">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-border">
        <div>
          <CardTitle><Swords className="h-4 w-4" />{p.projectCompetitionTab}</CardTitle>
          <CardContent className="px-0 pb-0 text-xs text-foreground-muted">{p.competitorsCount(own.length)}</CardContent>
        </div>
        <Button size="sm" onClick={() => { setForm(emptyCompetitorForm(project.id)); setDialogOpen(true); }}><Plus className="h-3.5 w-3.5" />{p.addCompetitor}</Button>
      </CardHeader>
      <CompetitorList competitors={own} onEdit={(competitor) => { setForm(competitorToForm(competitor)); setDialogOpen(true); }} onDelete={remove} empty={p.noCompetitorsForProject} />
      <CompetitorDialog open={dialogOpen} onOpenChange={setDialogOpen} form={form} setForm={setForm} projects={[project]} setCompetitors={setCompetitors} />
    </Card>
  );
}
