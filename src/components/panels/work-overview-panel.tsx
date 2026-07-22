"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bot, BriefcaseBusiness, CircleDollarSign, FolderKanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, SectionLabel } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import { Metric } from "@/components/ui/metric";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { useDict } from "@/lib/i18n";
import { assessProjectHealth } from "@/lib/project-health";
import { qk } from "@/lib/queries/keys";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import type { ClientOpportunity, Cron, ImportantDate, Invoice, JobApplication, Organization, Project, ProjectCost, Todo, Updater, WeeklyReview } from "@/lib/types";

const CLOSED = new Set(["won", "lost", "expired", "archived"]);

function mondayKey(now = new Date()): string {
  const date = new Date(now);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

export function WorkOverviewPanel({
  projects,
  opportunities,
  organizations,
  invoices,
  jobApplications,
  importantDates,
  todos,
  costs,
  crons,
  reviews,
  setReviews,
}: {
  projects: Project[];
  opportunities: ClientOpportunity[];
  organizations: Organization[];
  invoices: Invoice[];
  jobApplications: JobApplication[];
  importantDates: ImportantDate[];
  todos: Todo[];
  costs: ProjectCost[];
  crons: Cron[];
  reviews: WeeklyReview[];
  setReviews: Updater<WeeklyReview[]>;
}) {
  const t = useDict();
  const p = t.professional;
  const supabase = createClient();
  const qc = useQueryClient();
  const toast = useToast();
  const weekStart = mondayKey();
  const current = reviews.find((review) => review.week_start === weekStart);
  const currentItems = current?.items ?? {};
  const readReviewItem = (key: string, fallback = "") => Array.isArray(currentItems[key]) ? (currentItems[key] as string[]).join("\n") : fallback;
  const [reviewDraft, setReviewDraft] = useState({
    facts: readReviewItem("facts"),
    risks: readReviewItem("risks"),
    decisions: readReviewItem("decisions"),
    priorities: readReviewItem("priorities", current?.summary ?? ""),
    followUps: readReviewItem("followUps"),
    sources: readReviewItem("sources"),
  });
  const [generating, setGenerating] = useState(false);
  const attention = useMemo(
    () => projects
      .filter((project) => project.is_active && project.status !== "archived")
      .map((project) => ({ project, result: assessProjectHealth(project, todos, costs, crons) }))
      .filter(({ result }) => result.health !== "healthy"),
    [projects, todos, costs, crons],
  );
  const dueFollowUps = opportunities.filter((item) =>
    !CLOSED.has(item.status) && item.next_follow_up_at && new Date(item.next_follow_up_at) <= new Date(),
  ).length;

  const reviewMutation = useMutation({
    mutationFn: async (complete: boolean) => {
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error("Not authenticated");
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("weekly_reviews")
        .upsert({
          user_id: userId,
          week_start: weekStart,
          summary: reviewDraft.priorities.trim(),
          items: Object.fromEntries(Object.entries(reviewDraft).map(([key, value]) => [key, value.split("\n").map((item) => item.trim()).filter(Boolean)])),
          status: complete ? "completed" : "draft",
          completed_at: complete ? now : null,
          updated_at: now,
        }, { onConflict: "user_id,week_start" })
        .select()
        .single();
      if (error) throw error;
      return data as WeeklyReview;
    },
    onSuccess: (review) => {
      setReviews((old) => [review, ...old.filter((item) => item.id !== review.id && item.week_start !== review.week_start)]);
      void qc.invalidateQueries({ queryKey: qk.weeklyReviews });
      toast.ok(p.saved);
    },
    onError: () => toast.err(p.couldNotSave),
  });

  const metrics = [
    { label: p.activeProjects, value: projects.filter((x) => x.is_active && x.status !== "archived").length, icon: FolderKanban },
    { label: p.openOpportunities, value: opportunities.filter((x) => !CLOSED.has(x.status)).length, icon: BriefcaseBusiness },
    { label: p.followUps, value: dueFollowUps, icon: AlertTriangle },
    { label: p.unpaidInvoices, value: invoices.filter((x) => x.status === "issued").length, icon: CircleDollarSign },
    { label: p.clientsTitle, value: organizations.filter((x) => x.status === "active").length, icon: BriefcaseBusiness },
    { label: p.currentApplications, value: jobApplications.filter((x) => !["rejected", "withdrawn"].includes(x.status)).length, icon: BriefcaseBusiness },
  ];

  const upcomingDates = importantDates
    .filter((item) => item.the_date >= new Date().toISOString().slice(0, 10))
    .sort((a, b) => a.the_date.localeCompare(b.the_date))
    .slice(0, 6);
  const healthReason = (reason: string) => {
    if (reason === "Project is on hold") return p.projectOnHold;
    if (reason === "Running costs without recorded revenue") return p.costsWithoutRevenue;
    if (reason.includes("overdue task")) return `${p.overdueTasks}: ${reason.match(/^\d+/)?.[0] ?? ""}`;
    if (reason.includes("disabled automation")) return `${p.disabledAutomations}: ${reason.match(/^\d+/)?.[0] ?? ""}`;
    return reason;
  };

  async function generateWeeklyBrief() {
    if (!window.confirm(p.aiWeeklyConsent)) return;
    setGenerating(true);
    try {
      const response = await fetch("/api/ai/weekly-brief", { method: "POST" });
      if (!response.ok) throw new Error("unavailable");
      const { brief } = await response.json() as { brief: { facts: string[]; risks: string[]; suggestions: string[]; sources: string[] } };
      setReviewDraft((currentDraft) => ({
        ...currentDraft,
        facts: brief.facts.join("\n"),
        risks: brief.risks.join("\n"),
        priorities: brief.suggestions.join("\n"),
        sources: brief.sources.join("\n"),
      }));
    } catch {
      toast.err(p.aiUnavailable);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div>
      <PageHeader title={p.workTitle} description={p.workDescription} />
      <div className="surface-band -mx-4 grid grid-cols-2 gap-y-2 px-4 py-3 sm:grid-cols-3 md:-mx-6 md:px-6 xl:-mx-8 xl:grid-cols-6 xl:px-8">
        {metrics.map(({ label, value, icon }) => <Metric key={label} label={label} value={value} icon={icon} tone={label === p.followUps && value > 0 ? "attention" : "default"} />)}
      </div>
      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(22rem,.8fr)]">
        <Card className="border-l-2 border-l-warning">
          <CardHeader><CardTitle>{p.attention}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {attention.length === 0 ? <p className="text-sm text-foreground-muted">{p.attentionEmpty}</p> : attention.map(({ project, result }) => (
              <Link key={project.id} href={`/projects/${encodeURIComponent(project.slug)}`} prefetch={false} className="block border-b border-border py-2.5 last:border-0">
                <div className="flex items-center justify-between gap-3"><p className="font-medium">{project.name}</p><StatusBadge value={result.health} /></div>
                <p className="mt-1 text-xs text-foreground-muted">{result.reasons.map(healthReason).join(" · ")}</p>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{p.weeklyReview}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-foreground-muted">{p.weeklyReviewDescription}</p>
            <div className="grid gap-3 sm:grid-cols-2"><ReviewField label={p.facts} value={reviewDraft.facts} onChange={(facts) => setReviewDraft((old) => ({ ...old, facts }))} /><ReviewField label={p.risks} value={reviewDraft.risks} onChange={(risks) => setReviewDraft((old) => ({ ...old, risks }))} /><ReviewField label={p.decisions} value={reviewDraft.decisions} onChange={(decisions) => setReviewDraft((old) => ({ ...old, decisions }))} /><ReviewField label={p.priorities} value={reviewDraft.priorities} onChange={(priorities) => setReviewDraft((old) => ({ ...old, priorities }))} /><ReviewField label={p.followUpActions} value={reviewDraft.followUps} onChange={(followUps) => setReviewDraft((old) => ({ ...old, followUps }))} /><ReviewField label={p.sources} value={reviewDraft.sources} onChange={(sources) => setReviewDraft((old) => ({ ...old, sources }))} /></div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={generateWeeklyBrief} disabled={generating}><Bot />{generating ? p.generatingBrief : p.generateWeeklyBrief}</Button>
              <Button variant="outline" onClick={() => reviewMutation.mutate(false)} disabled={reviewMutation.isPending}>{p.saveReview}</Button>
              <Button onClick={() => reviewMutation.mutate(true)} disabled={reviewMutation.isPending}>{p.completeReview}</Button>
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>{p.pipeline}</CardTitle></CardHeader><CardContent>{opportunities.filter((item) => !CLOSED.has(item.status)).length === 0 ? <p className="text-sm text-foreground-muted">{p.pipelineEmpty}</p> : <ul className="divide-y divide-border">{opportunities.filter((item) => !CLOSED.has(item.status)).slice(0, 6).map((item) => <li key={item.id}><Link href="/opportunities" prefetch={false} className="flex min-h-11 items-center justify-between gap-3 py-2"><span className="text-sm font-medium">{item.title}</span><StatusBadge value={item.status} /></Link></li>)}</ul>}</CardContent></Card>
        <Card><CardHeader><CardTitle>{p.upcomingDates}</CardTitle></CardHeader><CardContent>{upcomingDates.length === 0 ? <p className="text-sm text-foreground-muted">{p.noUpcomingDates}</p> : <ul className="divide-y divide-border">{upcomingDates.map((item) => <li key={item.id}><Link href="/dates" prefetch={false} className="flex min-h-11 items-center justify-between gap-3 py-2"><span className="text-sm font-medium">{item.title}</span><span className="text-xs tabular text-foreground-muted">{item.the_date}</span></Link></li>)}</ul>}</CardContent></Card>
      </div>
    </div>
  );
}

function ReviewField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="space-y-1.5"><SectionLabel>{label}</SectionLabel><Textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder="—" rows={3} className="min-h-20" /></label>;
}
