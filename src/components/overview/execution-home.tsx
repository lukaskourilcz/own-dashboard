"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, BriefcaseBusiness, ListChecks } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EntityBadge } from "@/components/ui/status-badge";
import { PREVIEW_BACKLOG } from "@/components/panels/backlog-panel";
import { fetchBacklogItems } from "@/lib/backlog";
import { qk } from "@/lib/queries/keys";
import type { EntityStatus } from "@/lib/queries/entities";
import { homeApplications, homeBacklog } from "@/lib/home-execution";
import { isPositionReady } from "@/lib/jobs/pipeline";
import { useLang } from "@/lib/i18n";
import type { JobApplication, SavedJobPosition } from "@/lib/types";

export function ExecutionHome({ positions, applications, careerStatus, onBacklog, onCareer, isPreview = false }: {
  positions: SavedJobPosition[]; applications: JobApplication[]; careerStatus: EntityStatus;
  onBacklog: () => void; onCareer: () => void; isPreview?: boolean;
}) {
  const { lang } = useLang();
  const cs = lang === "cs";
  const backlog = useQuery({ queryKey: qk.backlog, queryFn: fetchBacklogItems, enabled: !isPreview, staleTime: 30_000 });
  const tasks = homeBacklog(isPreview ? PREVIEW_BACKLOG : backlog.data ?? []);
  const jobs = homeApplications(positions, applications);
  return <section data-testid="execution-home" className="space-y-4">
    <p className="text-sm text-foreground-muted">{cs ? "Pět úkolů z backlogu a pět příležitostí k přihlášce." : "Five backlog tasks and five opportunities to apply for."}</p>
    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
      <Card className="min-w-0 overflow-hidden p-0">
        <CardHeader className="flex-row items-center justify-between gap-2 border-b border-border"><CardTitle><ListChecks className="size-4" />{cs ? "Prvních 5 z backlogu" : "First 5 from Backlog"}</CardTitle><Button variant="ghost" size="sm" onClick={onBacklog}>{cs ? "Celý backlog" : "All backlog"}<ArrowUpRight className="size-4" aria-hidden /></Button></CardHeader>
        {!isPreview && backlog.isPending ? <p role="status" className="p-4 text-sm">{cs ? "Načítám backlog…" : "Loading backlog…"}</p>
          : !isPreview && backlog.isError ? <div role="alert" className="space-y-2 p-4 text-sm"><p>{cs ? "Backlog se nepodařilo načíst." : "Backlog could not be loaded."}</p><Button variant="outline" size="sm" onClick={() => void backlog.refetch()}>{cs ? "Zkusit znovu" : "Retry"}</Button></div>
          : tasks.length === 0 ? <p className="p-4 text-sm text-foreground-muted">{cs ? "V backlogu nejsou žádné nedokončené úkoly." : "No unfinished backlog tasks."}</p>
          : <ol className="divide-y divide-border" aria-label={cs ? "Úkoly z backlogu" : "Backlog tasks"}>{tasks.map((item, index) => <li key={item.id} className="flex gap-3 p-4"><span className="pt-0.5 text-xs tabular-nums text-foreground-subtle">{index + 1}</span><div className="min-w-0 flex-1 space-y-2"><p className="break-words text-sm font-medium">{item.title}</p><div className="flex flex-wrap gap-1.5"><EntityBadge>{item.project}</EntityBadge><EntityBadge>{item.executor === "me" ? "JA" : "AI"}</EntityBadge></div></div></li>)}</ol>}
      </Card>
      <Card className="min-w-0 overflow-hidden p-0">
        <CardHeader className="flex-row items-center justify-between gap-2 border-b border-border"><CardTitle><BriefcaseBusiness className="size-4" />{cs ? "5 přihlášek z Kariéry" : "5 Career applications"}</CardTitle><Button variant="ghost" size="sm" onClick={onCareer}>{cs ? "Kariéra" : "Career"}<ArrowUpRight className="size-4" aria-hidden /></Button></CardHeader>
        {careerStatus.failed ? <p role="alert" className="p-4 text-sm">{cs ? "Příležitosti se nepodařilo načíst. Otevři Kariéru a zkus načtení znovu." : "Opportunities could not be loaded. Open Career to retry."}</p>
          : !careerStatus.ready ? <p role="status" className="p-4 text-sm">{cs ? "Načítám příležitosti…" : "Loading opportunities…"}</p>
          : jobs.length === 0 ? <p className="p-4 text-sm text-foreground-muted">{cs ? "Žádné uložené pozice nečekají na přihlášku." : "No saved positions are waiting for an application."}</p>
          : <ol className="divide-y divide-border" aria-label={cs ? "Příležitosti k přihlášce" : "Opportunities to apply"}>{jobs.map((job, index) => <li key={job.id} className="flex gap-3 p-4"><span className="pt-0.5 text-xs tabular-nums text-foreground-subtle">{index + 1}</span><div className="min-w-0 flex-1 space-y-1"><a href={job.url} target="_blank" rel="noreferrer" className="focus-ring inline-flex min-h-11 items-center gap-2 break-words text-sm font-medium hover:underline">{job.title}<ArrowUpRight className="size-4 shrink-0" aria-hidden /><span className="sr-only">{cs ? "Nová karta" : "New tab"}</span></a><p className="break-words text-xs text-foreground-muted">{[job.company, job.location].filter(Boolean).join(" · ")}</p><EntityBadge>{isPositionReady(job) ? (cs ? "Připraveno k odeslání" : "Ready to apply") : (cs ? "Nejdřív připravit přihlášku" : "Prepare application first")}</EntityBadge></div></li>)}</ol>}
      </Card>
    </div>
  </section>;
}
