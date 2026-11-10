"use client";

import { ProjectOperatingCosts } from "@/components/finance/project-operating-costs";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDict, useLang } from "@/lib/i18n";
import { projectCostsCopy } from "@/lib/i18n/sections/project-costs";
import { COST_PROJECTS, costEvidenceHref, projectCostEvidence, type ProjectCostInput } from "@/lib/project-cost-evidence";
import { formatCurrency } from "@/lib/utils";
import type { Project } from "@/lib/types";

export function ProjectCostEvidence({ project, input }: { project: Project; input: ProjectCostInput }) {
  const { lang } = useLang(); const t = projectCostsCopy[lang]; const dict = useDict();
  const data = projectCostEvidence(project, input);
  return <details className="group min-w-0 rounded-lg border border-border bg-surface" data-testid="project-cost-evidence">
    <summary className="focus-ring min-h-11 cursor-pointer px-4 py-3 text-sm font-medium"><h2 className="inline text-sm font-medium">{t.details} · {COST_PROJECTS.find(row => (row.slugs as readonly string[]).includes(project.slug))?.name ?? project.name}</h2></summary>
    <div className="min-w-0 space-y-4 border-t border-border p-4 text-xs">
      <p className="text-foreground-muted">{t.scope}</p>
      <section className="space-y-2"><h3 className="font-semibold">{t.recurring}</h3>{!data.hasRecurring && <p className="text-foreground-muted">{t.noRecurring}</p>}
        {data.subscriptions.map(({ subscription: sub, share, monthly }) => <div key={sub.id} className="space-y-1 border-b border-border pb-2"><p className="flex flex-wrap justify-between gap-2"><span>{sub.name} · {t.subscription} {Math.round(share * 100)}%</span><span className="tabular-nums">{formatCurrency(monthly, input.currency)}{dict.subscriptions.perMo}</span></p><p className="text-foreground-muted">{formatCurrency(sub.amount, sub.currency)} · {dict.subscriptions.cycle[sub.billing_cycle]} · {sub.next_billing_date ? `${t.renew}: ${sub.next_billing_date}` : t.noRenew}</p>{sub.notes && <p className="break-words text-foreground-muted">{sub.notes}</p>}</div>)}
        {input.projectCosts.filter(row => row.project_id === project.id && (!row.cost_type || row.cost_type === "monthly_estimate")).map(row => <p key={row.id} className="flex flex-wrap justify-between gap-2"><span>{row.label}</span><span>{formatCurrency(row.amount, row.currency)}</span></p>)}
      </section>
      <section className="space-y-2"><h3 className="font-semibold">{t.paid}</h3>{data.payments.length === 0 && <p className="text-foreground-muted">{t.noPayments}</p>}{data.payments.map(row => <div key={row.id} className="space-y-1 border-b border-border pb-2"><p className="flex flex-wrap justify-between gap-2"><span>{row.occurred_on} · {row.kind === "income" ? t.refund : t.payment}</span><span className="tabular-nums">{row.kind === "income" ? "−" : ""}{formatCurrency(row.amount, row.currency)}</span></p><p className="break-words text-foreground-muted">{row.note}</p></div>)}</section>
      <ProjectOperatingCosts projectId={project.id} preview={input.preview} />
      <section className="space-y-2"><h3 className="font-semibold">{t.evidence}</h3>{data.usage.length === 0 && <p className="text-foreground-muted">{t.noUsage}</p>}{[...data.usage, ...data.credits].map(row => { const href = costEvidenceHref(row.source_url); return <div key={row.id} className="space-y-1 border-b border-border pb-2"><p className="flex flex-wrap justify-between gap-2"><span>{row.label} · {row.cost_type === "credit" ? t.credit : t.usage}</span><span className="tabular-nums">{formatCurrency(row.amount, row.currency)}</span></p><p className="tabular-nums text-foreground-muted">{row.period_start?.slice(0, 10)} → {row.period_end?.slice(0, 10)} · {t.checked}: {row.verified_on ?? t.unknown}</p><p className="whitespace-pre-line break-words text-foreground-muted">{row.note}</p>{href && <a href={href} target="_blank" rel="noreferrer" className="focus-ring inline-flex min-h-11 items-center gap-1 underline">{t.source}<ArrowUpRight aria-hidden className="size-3" /></a>}</div>; })}</section>
    </div>
  </details>;
}

export function ProjectCostOverview({ projects, input, onOpenProject }: { projects: Project[]; input: ProjectCostInput; onOpenProject: (project: Project) => void }) {
  const { lang } = useLang(); const t = projectCostsCopy[lang];
  return <Card className="min-w-0 overflow-hidden p-0" data-testid="project-cost-overview">
    <CardHeader className="border-b border-border"><CardTitle>{t.title}</CardTitle><p className="text-xs text-foreground-muted">{t.intro}</p></CardHeader>
    <CardContent className="space-y-4 pt-4"><p className="text-xs text-foreground-muted">{t.basis}</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[32rem] text-left text-sm"><thead className="border-b border-border text-xs text-foreground-muted"><tr><th scope="col" className="py-2 pr-3">{t.project}</th><th scope="col" className="px-3 py-2 text-right">{t.recurring}</th><th scope="col" className="px-3 py-2 text-right">{t.paid}</th></tr></thead><tbody className="divide-y divide-border">{COST_PROJECTS.map(target => { const project = projects.find(row => (target.slugs as readonly string[]).includes(row.slug)); if (!project) return <tr key={target.name}><th scope="row" className="py-3 pr-3">{target.name}</th><td colSpan={2} className="px-3 py-3 text-xs text-foreground-muted">{t.missingProject}</td></tr>; const data = projectCostEvidence(project, input); return <tr key={project.id}><th scope="row" className="py-2 pr-3"><Button size="sm" variant="ghost" className="-ml-2" onClick={() => onOpenProject(project)}>{target.name}<ArrowUpRight className="size-3" aria-hidden /></Button></th><td className="px-3 py-3 text-right tabular-nums">{data.hasRecurring ? formatCurrency(data.recurring, input.currency) : <span className="text-xs text-foreground-muted">{t.noRecurring}</span>}</td><td className="px-3 py-3 text-right tabular-nums">{data.payments.length ? formatCurrency(data.paid, input.currency) : <span className="text-xs text-foreground-muted">{t.noPayments}</span>}</td></tr>; })}</tbody></table></div>
      {COST_PROJECTS.map(target => { const project = projects.find(row => (target.slugs as readonly string[]).includes(row.slug)); return project ? <ProjectCostEvidence key={project.id} project={project} input={input} /> : null; })}
      {projects.filter(project => project.slug === "own-dashboard").map(project => <div key={project.id} className="space-y-2 border-t border-border pt-4"><p className="text-xs text-foreground-muted">{t.sharedHelp}</p><ProjectCostEvidence project={project} input={input} /></div>)}
    </CardContent>
  </Card>;
}
