"use client";

import { useState } from "react";
import {
  Activity,
  ArrowLeft,
  Bot,
  BriefcaseBusiness,
  CircleDollarSign,
  ExternalLink,
  FileText,
  ListTodo,
  ServerCog,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { GithubIcon } from "@/components/icons/github";
import { CostsPanel } from "@/components/panels/costs-panel";
import { ProjectCommunicationPanel } from "@/components/projects/project-communication-panel";
import { ProjectGithubActivity } from "@/components/projects/project-github-activity";
import { ProjectKnowledgePanel } from "@/components/projects/project-knowledge-panel";
import { ProjectDocPanel } from "@/components/projects/project-doc-panel";
import { ReposPanel } from "@/components/panels/repos-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, SectionLabel } from "@/components/ui/page-header";
import { Metric as OperationalMetric } from "@/components/ui/metric";
import { AiProposalPanel, AiResultGroup } from "@/components/ui/ai-proposal";
import { EntityBadge, StatusBadge } from "@/components/ui/status-badge";
import { useDict, useLang } from "@/lib/i18n";
import { convert } from "@/lib/fx";
import { computeTotals } from "@/lib/invoices";
import { assessProjectHealth } from "@/lib/project-health";
import { projectMonthlyIn } from "@/lib/projects";
import { statusLabel } from "@/lib/status-presentation";
import { cn, formatCurrency } from "@/lib/utils";
import {
  PROJECT_WORKSPACE_TABS,
  type ProjectWorkspaceTab,
} from "@/lib/project-workspace-tabs";
import { useProjectTabVisibility } from "@/lib/use-prefs";
import type {
  ClientOpportunity,
  Cron,
  ImportantDate,
  InboxItem,
  Invoice,
  InvoiceItem,
  Note,
  Organization,
  Project,
  ProjectCommunication,
  ProjectCost,
  Prompt,
  RepoLink,
  RepoNote,
  Subscription,
  Todo,
  Transaction,
  Updater,
} from "@/lib/types";

type ProjectBrief = {
  facts: string[];
  risks: string[];
  suggestions: string[];
  sources: string[];
  limited: boolean;
};

type Props = {
  project: Project;
  costs: ProjectCost[];
  crons: Cron[];
  todos: Todo[];
  notes: Note[];
  invoices: Invoice[];
  invoiceItems: InvoiceItem[];
  subscriptions: Subscription[];
  transactions: Transaction[];
  organizations: Organization[];
  opportunities: ClientOpportunity[];
  importantDates: ImportantDate[];
  prompts: Prompt[];
  inboxItems: InboxItem[];
  repoNotes: RepoNote[];
  setRepoNotes: Updater<RepoNote[]>;
  repoLinks: RepoLink[];
  setRepoLinks: Updater<RepoLink[]>;
  communications: ProjectCommunication[];
  setCommunications: Updater<ProjectCommunication[]>;
  displayCurrency: string;
  repositoryIntegrationEnabled: boolean;
  onBackToProjects: () => void;
};

function invoiceTotal(invoice: Invoice, items: InvoiceItem[]): number {
  return computeTotals(
    items.filter((item) => item.invoice_id === invoice.id).map((item) => ({
      quantity: Number(item.quantity) || 0,
      unit_price: Number(item.unit_price) || 0,
      vat_rate: Number(item.vat_rate) || 0,
    })),
    { roundTotal: invoice.round_total, currency: invoice.currency },
  ).total;
}

function matchesProjectInbox(item: InboxItem, projectId: string): boolean {
  return item.source_id === projectId || item.payload.project_id === projectId;
}

export function ProjectWorkspace(props: Props) {
  const { project, displayCurrency } = props;
  const t = useDict();
  const { lang } = useLang();
  const p = t.professional;
  const [tab, setTab] = useState<ProjectWorkspaceTab>("overview");
  const { isProjectTabHidden } = useProjectTabVisibility();
  const [brief, setBrief] = useState<ProjectBrief | null>(null);
  const [briefError, setBriefError] = useState(false);
  const [generating, setGenerating] = useState(false);

  const projectTodos = props.todos.filter((todo) =>
    todo.project_id === project.id ||
    (!todo.project_id && project.repo_full_name != null && todo.repo_full_name === project.repo_full_name),
  );
  const projectNotes = props.notes.filter((note) => note.project_id === project.id);
  const projectInvoices = props.invoices.filter((invoice) => invoice.project_id === project.id);
  const projectSubscriptions = props.subscriptions.filter((subscription) => subscription.project_id === project.id);
  const projectTransactions = props.transactions.filter((transaction) => transaction.project_id === project.id);
  const projectOpportunities = props.opportunities.filter((opportunity) => opportunity.project_id === project.id);
  const projectDates = props.importantDates.filter((date) => date.project_id === project.id);
  const projectPrompts = props.prompts.filter((prompt) => prompt.project_id === project.id);
  const projectInbox = props.inboxItems.filter((item) => matchesProjectInbox(item, project.id));
  const projectCommunications = props.communications.filter((item) => item.project_id === project.id);
  const organization = props.organizations.find((item) => item.id === project.organization_id);
  const monthlyCost = projectMonthlyIn(props.costs, props.crons, displayCurrency);
  const annualCost = monthlyCost * 12;
  const revenue = convert(Number(project.revenue ?? 0), project.revenue_currency ?? "CZK", displayCurrency);
  const outstanding = projectInvoices
    .filter((invoice) => invoice.status === "issued")
    .reduce((sum, invoice) => sum + convert(invoiceTotal(invoice, props.invoiceItems), invoice.currency, displayCurrency), 0);
  const health = assessProjectHealth(project, projectTodos, props.costs, props.crons);

  const activity = [
    ...projectNotes.map((item) => ({ id: `note-${item.id}`, at: item.updated_at, label: `${t.nav.sections.notes}: ${item.title}` })),
    ...projectTodos.map((item) => ({ id: `todo-${item.id}`, at: item.created_at, label: `${t.nav.sections.tasks}: ${item.title}` })),
    ...projectInvoices.map((item) => ({ id: `invoice-${item.id}`, at: item.updated_at, label: `${t.nav.sections.invoices}: ${item.number} · ${statusLabel(item.status, lang)}` })),
    ...projectOpportunities.map((item) => ({ id: `opportunity-${item.id}`, at: item.updated_at, label: `${p.opportunity}: ${item.title} · ${statusLabel(item.status, lang)}` })),
    ...props.costs.map((item) => ({ id: `cost-${item.id}`, at: item.updated_at, label: `${p.monthlyCost}: ${item.label}` })),
    ...projectCommunications.map((item) => ({ id: `communication-${item.id}`, at: item.occurred_at, label: `${p.projectCommunication}: ${item.subject || item.summary.slice(0, 80)}` })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);

  const tabLabels: Record<ProjectWorkspaceTab, string> = {
    overview: p.projectOverview,
    tasks: p.projectTasks,
    activity: p.projectActivity,
    communication: p.projectCommunication,
    repository: p.projectRepository,
    operations: p.projectOperations,
    finance: p.projectFinance,
    knowledge: p.projectKnowledge,
    scaling: p.projectScaling,
    monetization: p.projectMonetization,
  };
  const tabs = PROJECT_WORKSPACE_TABS.filter(
    (item) => item === "overview" || !isProjectTabHidden(item),
  ).map((id) => ({ id, label: tabLabels[id] }));

  const healthLabel = health.health === "healthy" ? p.healthy : health.health === "attention" ? p.attentionStatus : p.atRisk;
  const localHealthReason = (reason: string) => {
    if (reason === "Project is on hold") return p.projectOnHold;
    if (reason === "Running costs without recorded revenue") return p.costsWithoutRevenue;
    if (reason.includes("overdue task")) return `${p.overdueTasks}: ${reason.match(/^\d+/)?.[0] ?? ""}`;
    if (reason.includes("disabled automation")) return `${p.disabledAutomations}: ${reason.match(/^\d+/)?.[0] ?? ""}`;
    return reason;
  };

  async function generateBrief() {
    if (!window.confirm(p.aiProjectConsent)) return;
    setGenerating(true);
    setBriefError(false);
    try {
      const response = await fetch("/api/ai/project-copilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project_id: project.id }),
      });
      if (!response.ok) throw new Error("brief unavailable");
      const data = await response.json() as { brief?: ProjectBrief };
      if (!data.brief) throw new Error("brief unavailable");
      setBrief(data.brief);
    } catch {
      setBriefError(true);
    } finally {
      setGenerating(false);
    }
  }

  return <div>
    <button type="button" onClick={props.onBackToProjects} className="mb-3 inline-flex items-center gap-1 rounded text-xs text-foreground-muted hover:text-foreground focus-ring"><ArrowLeft className="h-3.5 w-3.5" />{p.backToProjects}</button>
    <PageHeader
      title={project.name}
      description={project.summary || p.projectWorkspace}
      eyebrow={organization?.name ?? p.projectWorkspace}
      action={<div className="flex flex-wrap items-center gap-2"><StatusBadge value={project.status ?? (project.is_active ? "active" : "archived")} />{project.dev_url && <Button size="sm" variant="outline" asChild><a href={project.dev_url} target="_blank" rel="noreferrer"><ExternalLink />{p.developmentProject}</a></Button>}{project.url && <Button size="sm" variant="outline" asChild><a href={project.url} target="_blank" rel="noreferrer"><ExternalLink />{p.externalProject}</a></Button>}</div>}
    />
    <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1" role="tablist" aria-label={p.projectWorkspace}>
      {tabs.map((item) => <button key={item.id} role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={cn("whitespace-nowrap rounded-md px-3 py-2 text-xs font-medium", tab === item.id ? "bg-accent text-foreground" : "text-foreground-muted hover:text-foreground")}>{item.label}</button>)}
    </div>

    {tab === "overview" && <div className="space-y-4">
      <div className="grid gap-2 rounded-lg border border-border bg-surface-secondary p-2 sm:grid-cols-2 xl:grid-cols-4">
        <OperationalMetric label={p.health} value={healthLabel} icon={Activity} tone={health.health === "at_risk" ? "risk" : health.health === "attention" ? "attention" : "default"} />
        <OperationalMetric label={p.openTasks} value={String(projectTodos.filter((item) => !item.done).length)} icon={ListTodo} />
        <OperationalMetric label={p.monthlyCost} value={formatCurrency(monthlyCost, displayCurrency)} icon={CircleDollarSign} />
        <OperationalMetric label={p.outstandingAmount} value={formatCurrency(outstanding, displayCurrency)} icon={BriefcaseBusiness} tone={outstanding > 0 ? "attention" : "default"} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>{p.projectSummary}</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><p>{project.summary || project.notes || p.noRelatedRecords}</p><div><SectionLabel>{p.linkedOrganization}</SectionLabel><p className="mt-1">{organization ? <EntityBadge>{organization.name}</EntityBadge> : p.noLinkedOrganization}</p></div>{projectDates.length > 0 && <div><SectionLabel>{t.nav.sections.dates}</SectionLabel><ul className="mt-1 divide-y divide-border">{projectDates.slice(0, 5).map((date) => <li key={date.id} className="flex justify-between gap-3 py-1.5"><span>{date.title}</span><span className="tabular text-foreground-muted">{date.the_date}</span></li>)}</ul></div>}</CardContent></Card>
        <Card><CardHeader><CardTitle>{p.attention}</CardTitle></CardHeader><CardContent>{health.reasons.length === 0 ? <p className="text-sm text-foreground-muted">{p.attentionEmpty}</p> : <ul className="space-y-2 text-sm">{health.reasons.map((reason) => <li key={reason} className="rounded-md border border-border p-2">{localHealthReason(reason)}</li>)}</ul>}</CardContent></Card>
      </div>
      <AiProposalPanel label={p.projectCopilot} description={`${p.projectCopilotDescription} ${p.aiNotSaved}`}><div className="space-y-3"><Button onClick={generateBrief} disabled={generating}><Bot />{generating ? p.generatingBrief : p.generateBrief}</Button>{briefError && <p role="alert" className="text-sm text-destructive">{p.aiUnavailable}</p>}{brief && <><div className="grid gap-4 md:grid-cols-3"><AiResultGroup kind="facts" title={p.facts} items={brief.facts} /><AiResultGroup kind="risks" title={p.risks} items={brief.risks} /><AiResultGroup kind="suggestions" title={p.suggestions} items={brief.suggestions} /></div><div className="border-t border-border pt-3"><p className="text-[11px] text-foreground-muted">{brief.limited && p.limitedContext}</p><div className="mt-2 flex flex-wrap gap-1.5">{brief.sources.map((source) => <EntityBadge key={source}>{source}</EntityBadge>)}</div></div></>}</div></AiProposalPanel>
    </div>}

    {tab === "tasks" && <div className="grid gap-4 lg:grid-cols-2"><RecordCard title={p.projectTasks} icon={ListTodo} empty={p.noRelatedRecords} items={projectTodos.map((item) => ({ id: item.id, primary: item.title, secondary: `${item.done ? p.completed : p.open}${item.due_date ? ` · ${item.due_date}` : ""}` }))} /><RecordCard title={p.relatedInbox} icon={BriefcaseBusiness} empty={p.noRelatedRecords} items={projectInbox.map((item) => ({ id: item.id, primary: item.title, secondary: statusLabel(item.status, lang) }))} /></div>}
    {tab === "activity" && <div className="space-y-4">{project.repo_full_name && <ProjectGithubActivity repoFullName={project.repo_full_name} enabled={props.repositoryIntegrationEnabled} />}<RecordCard title={p.recentActivity} icon={Activity} empty={p.noRelatedRecords} items={activity.map((item) => ({ id: item.id, primary: item.label, secondary: item.at.slice(0, 10) }))} /></div>}
    {tab === "communication" && <ProjectCommunicationPanel projectId={project.id} communications={projectCommunications} setCommunications={props.setCommunications} />}
    {tab === "repository" && (project.repo_full_name && props.repositoryIntegrationEnabled ? <ReposPanel initialVisibleIds={[]} repoFullName={project.repo_full_name} repoNotes={props.repoNotes} setRepoNotes={props.setRepoNotes} repoLinks={props.repoLinks} setRepoLinks={props.setRepoLinks} /> : <Card><CardHeader><CardTitle className="flex items-center gap-2"><GithubIcon className="h-4 w-4" />{p.projectRepository}</CardTitle></CardHeader><CardContent>{project.repo_full_name ? <div className="space-y-3"><a className="inline-flex items-center gap-2 text-sm underline" href={`https://github.com/${project.repo_full_name}`} target="_blank" rel="noreferrer">{project.repo_full_name}<ExternalLink className="h-3.5 w-3.5" /></a>{project.notes && <p className="whitespace-pre-wrap text-sm text-foreground-muted">{project.notes}</p>}</div> : <p className="text-sm text-foreground-muted">{p.repositoryUnavailable}</p>}</CardContent></Card>)}
    {tab === "operations" && <div className="space-y-4"><RecordCard title={p.projectOperations} icon={ServerCog} empty={p.noRelatedRecords} items={props.crons.map((item) => ({ id: item.id, primary: item.name, secondary: `${item.schedule} · ${item.enabled ? p.open : p.operationalWarning}${item.last_run_at ? ` · ${item.last_run_at.slice(0, 10)}` : ""}` }))} />{project.repo_full_name && props.repositoryIntegrationEnabled && <CostsPanel initialVisibleIds={[]} repoFullName={project.repo_full_name} />}</div>}
    {tab === "finance" && <div className="space-y-4"><div className="grid gap-2 rounded-lg border border-border bg-surface-secondary p-2 sm:grid-cols-2 xl:grid-cols-4"><OperationalMetric label={p.monthlyCost} value={formatCurrency(monthlyCost, displayCurrency)} icon={CircleDollarSign} /><OperationalMetric label={p.annualCost} value={formatCurrency(annualCost, displayCurrency)} icon={CircleDollarSign} /><OperationalMetric label={p.revenue} value={formatCurrency(revenue, displayCurrency)} icon={BriefcaseBusiness} /><OperationalMetric label={p.estimatedProfit} value={formatCurrency(revenue - annualCost, displayCurrency)} icon={Activity} tone={revenue - annualCost < 0 ? "risk" : "default"} /></div><div className="grid gap-4 lg:grid-cols-2"><RecordCard title={t.nav.sections.invoices} icon={FileText} empty={p.noRelatedRecords} items={projectInvoices.map((item) => ({ id: item.id, primary: item.number, secondary: `${statusLabel(item.status, lang)} · ${formatCurrency(invoiceTotal(item, props.invoiceItems), item.currency)}` }))} /><RecordCard title={t.nav.sections.subscriptions} icon={CircleDollarSign} empty={p.noRelatedRecords} items={projectSubscriptions.map((item) => ({ id: item.id, primary: item.name, secondary: formatCurrency(item.amount, item.currency) }))} /><RecordCard title={t.nav.sections.transactions} icon={CircleDollarSign} empty={p.noRelatedRecords} items={projectTransactions.map((item) => ({ id: item.id, primary: item.note || item.category || statusLabel(item.kind, lang), secondary: `${item.occurred_on} · ${formatCurrency(item.amount, item.currency)}` }))} /><RecordCard title={p.monthlyCost} icon={CircleDollarSign} empty={p.noRelatedRecords} items={props.costs.map((item) => ({ id: item.id, primary: item.label, secondary: formatCurrency(item.amount, item.currency) }))} /></div></div>}
    {tab === "knowledge" && <div className="grid gap-4 lg:grid-cols-2"><ProjectKnowledgePanel repoFullName={project.repo_full_name} enabled={props.repositoryIntegrationEnabled} /><RecordCard title={t.nav.sections.notes} icon={FileText} empty={p.noRelatedRecords} items={projectNotes.map((item) => ({ id: item.id, primary: item.title, secondary: item.plain_text.slice(0, 120) }))} /><RecordCard title={t.nav.sections.prompts} icon={Bot} empty={p.noRelatedRecords} items={projectPrompts.map((item) => ({ id: item.id, primary: item.name, secondary: item.body.slice(0, 120) }))} /></div>}
    {tab === "scaling" && <div className="grid gap-4"><ProjectDocPanel repoFullName={project.repo_full_name} enabled={props.repositoryIntegrationEnabled} file="scaling.md" title={p.projectScaling} description={p.scalingDescription} /></div>}
    {tab === "monetization" && <div className="grid gap-4"><ProjectDocPanel repoFullName={project.repo_full_name} enabled={props.repositoryIntegrationEnabled} file="monetization.md" title={p.projectMonetization} description={p.monetizationDescription} /></div>}
  </div>;
}

function RecordCard({ title, icon: Icon, empty, items }: { title: string; icon: typeof Activity; empty: string; items: { id: string; primary: string; secondary?: string }[] }) {
  return <Card><CardHeader><CardTitle className="flex items-center gap-2"><Icon className="h-4 w-4" />{title}</CardTitle></CardHeader><CardContent>{items.length === 0 ? <p className="text-sm text-foreground-muted">{empty}</p> : <ul className="divide-y divide-border">{items.map((item) => <li key={item.id} className="py-2.5"><p className="text-sm font-medium">{item.primary}</p>{item.secondary && <p className="mt-1 text-xs text-foreground-muted">{item.secondary}</p>}</li>)}</ul>}</CardContent></Card>;
}
