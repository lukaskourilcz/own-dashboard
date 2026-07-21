"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { SimpleSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useDict } from "@/lib/i18n";
import { qk } from "@/lib/queries/keys";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import type { ClientOpportunity, OpportunitySource, OpportunityStatus, Organization, Project, Updater } from "@/lib/types";

const SOURCES: OpportunitySource[] = ["tugedr", "referral", "direct", "existing_client", "inbound", "other"];
const STATUSES: OpportunityStatus[] = ["discovered", "shortlisted", "contacted", "proposal_sent", "negotiating", "won", "lost", "expired", "archived"];

const emptyForm = {
  title: "",
  description: "",
  source: "tugedr" as OpportunitySource,
  source_url: "",
  organization_id: "",
  budget_min: "",
  budget_max: "",
  currency: "CZK",
  deadline: "",
  next_follow_up_at: "",
};

export function OpportunitiesPanel({
  opportunities,
  setOpportunities,
  organizations,
  setOrganizations,
  setProjects,
}: {
  opportunities: ClientOpportunity[];
  setOpportunities: Updater<ClientOpportunity[]>;
  organizations: Organization[];
  setOrganizations: Updater<Organization[]>;
  setProjects: Updater<Project[]>;
}) {
  const t = useDict();
  const p = t.professional;
  const supabase = createClient();
  const qc = useQueryClient();
  const toast = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [filter, setFilter] = useState<OpportunityStatus | "open">("open");

  const createMutation = useMutation({
    mutationFn: async () => {
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error("Not authenticated");
      const { data, error } = await supabase.from("client_opportunities").insert({
        user_id: userId,
        title: form.title.trim(),
        description: form.description.trim(),
        source: form.source,
        source_url: form.source_url.trim() || null,
        organization_id: form.organization_id || null,
        budget_min: form.budget_min ? Number(form.budget_min) : null,
        budget_max: form.budget_max ? Number(form.budget_max) : null,
        currency: form.currency,
        deadline: form.deadline || null,
        next_follow_up_at: form.next_follow_up_at ? new Date(form.next_follow_up_at).toISOString() : null,
      }).select().single();
      if (error) throw error;
      return data as ClientOpportunity;
    },
    onSuccess: (item) => {
      setOpportunities((old) => [item, ...old]);
      setForm(emptyForm);
      setShowForm(false);
      void qc.invalidateQueries({ queryKey: qk.opportunities });
    },
    onError: () => toast.err(p.couldNotSave),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: OpportunityStatus }) => {
      const now = new Date().toISOString();
      const { data, error } = await supabase.from("client_opportunities").update({
        status,
        won_at: status === "won" ? now : null,
        lost_at: status === "lost" ? now : null,
        updated_at: now,
      }).eq("id", id).select().single();
      if (error) throw error;
      return data as ClientOpportunity;
    },
    onSuccess: (item) => {
      setOpportunities((old) => old.map((x) => x.id === item.id ? item : x));
      void qc.invalidateQueries({ queryKey: qk.opportunities });
    },
    onError: () => toast.err(p.couldNotSave),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("client_opportunities").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => setOpportunities((old) => old.filter((x) => x.id !== id)),
    onError: () => toast.err(p.couldNotSave),
  });

  const convertMutation = useMutation({
    mutationFn: async (opportunity: ClientOpportunity) => {
      if (!window.confirm(p.confirmConversion)) throw new Error("cancelled");
      const organizationName = opportunity.organization_id ? null : window.prompt(p.organizationNamePrompt)?.trim();
      if (!opportunity.organization_id && !organizationName) throw new Error("organization-required");
      const { data: converted, error: conversionError } = await supabase.rpc("convert_opportunity_to_project", { p_opportunity_id: opportunity.id, p_organization_name: organizationName });
      if (conversionError) throw conversionError;
      const row = Array.isArray(converted) ? converted[0] : converted;
      if (!row?.created_project_id) throw new Error("conversion failed");
      const [{ data: project, error: projectError }, { data: updated, error: opportunityError }, { data: organization }] = await Promise.all([
        supabase.from("projects").select("*").eq("id", row.created_project_id).single(),
        supabase.from("client_opportunities").select("*").eq("id", opportunity.id).single(),
        supabase.from("organizations").select("*").eq("id", row.linked_organization_id).single(),
      ]);
      if (projectError || opportunityError) throw projectError ?? opportunityError;
      return { project: project as Project, opportunity: updated as ClientOpportunity, organization: organization as Organization | null };
    },
    onSuccess: ({ project, opportunity, organization }) => {
      setProjects((old) => [...old, project]);
      setOpportunities((old) => old.map((x) => x.id === opportunity.id ? opportunity : x));
      if (organization) setOrganizations((old) => old.some((item) => item.id === organization.id) ? old : [...old, organization].sort((a, b) => a.name.localeCompare(b.name)));
      void qc.invalidateQueries({ queryKey: qk.projects });
      void qc.invalidateQueries({ queryKey: qk.opportunities });
      toast.ok(p.converted);
    },
    onError: (error) => { if (error instanceof Error && error.message === "organization-required") toast.err(p.organizationRequired); else if (error instanceof Error && error.message !== "cancelled") toast.err(p.couldNotSave); },
  });

  const organizationMutation = useMutation({
    mutationFn: async ({ id, organization_id }: { id: string; organization_id: string }) => {
      const { data, error } = await supabase.from("client_opportunities").update({ organization_id: organization_id || null, updated_at: new Date().toISOString() }).eq("id", id).select().single();
      if (error) throw error;
      return data as ClientOpportunity;
    },
    onSuccess: (item) => setOpportunities((old) => old.map((current) => current.id === item.id ? item : current)),
    onError: () => toast.err(p.couldNotSave),
  });

  const terminal = new Set<OpportunityStatus>(["won", "lost", "expired", "archived"]);
  const visible = opportunities.filter((item) => filter === "open" ? !terminal.has(item.status) : item.status === filter);
  const organizationOptions = [{ value: "", label: p.noOrganization }, ...organizations.map((x) => ({ value: x.id, label: x.name }))];

  return (
    <div>
      <PageHeader title={p.opportunitiesTitle} description={p.opportunitiesDescription} action={<Button onClick={() => setShowForm((x) => !x)}><Plus />{p.newOpportunity}</Button>} />
      {showForm && <Card className="mb-4"><CardContent className="grid gap-3 p-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2"><Label>{p.title}</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
        <div className="space-y-1.5"><Label>{p.source}</Label><SimpleSelect aria-label={p.source} value={form.source} onValueChange={(source) => setForm({ ...form, source: source as OpportunitySource })} options={SOURCES.map((source) => ({ value: source, label: source }))} /></div>
        <div className="space-y-1.5"><Label>{p.organization}</Label><SimpleSelect aria-label={p.organization} value={form.organization_id} onValueChange={(organization_id) => setForm({ ...form, organization_id })} options={organizationOptions} /></div>
        <div className="space-y-1.5 sm:col-span-2"><Label>{p.description}</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        <div className="space-y-1.5"><Label>{p.sourceUrl}</Label><Input type="url" value={form.source_url} onChange={(e) => setForm({ ...form, source_url: e.target.value })} /></div>
        <div className="space-y-1.5"><Label>{p.deadline}</Label><Input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></div>
        <div className="grid grid-cols-3 gap-2 sm:col-span-2"><Input type="number" min="0" placeholder="Min" value={form.budget_min} onChange={(e) => setForm({ ...form, budget_min: e.target.value })} /><Input type="number" min="0" placeholder="Max" value={form.budget_max} onChange={(e) => setForm({ ...form, budget_max: e.target.value })} /><Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></div>
        <Button className="sm:col-span-2" onClick={() => createMutation.mutate()} disabled={!form.title.trim() || createMutation.isPending}>{p.create}</Button>
      </CardContent></Card>}
      <div className="mb-4 max-w-xs"><SimpleSelect aria-label={p.openOpportunities} value={filter} onValueChange={(value) => setFilter(value as OpportunityStatus | "open")} options={[{ value: "open", label: p.openOpportunities }, ...STATUSES.map((status) => ({ value: status, label: status }))]} /></div>
      {visible.length === 0 ? <EmptyState title={p.pipelineEmpty} icon={Plus} /> : <div className="grid gap-3 lg:grid-cols-2">
        {visible.map((item) => <Card key={item.id}><CardHeader><CardTitle className="flex items-start justify-between gap-3"><span>{item.title}</span><span className="text-[10px] uppercase text-foreground-muted">{item.source}</span></CardTitle></CardHeader><CardContent className="space-y-3">
          {item.description && <p className="text-sm text-foreground-muted">{item.description}</p>}
          <div className="flex flex-wrap gap-2 text-xs text-foreground-muted">{item.budget_min != null && <span>{item.budget_min.toLocaleString()}–{(item.budget_max ?? item.budget_min).toLocaleString()} {item.currency}</span>}{item.deadline && <span>· {item.deadline}</span>}{item.source_url && <a className="inline-flex items-center gap-1 underline" href={item.source_url} target="_blank" rel="noreferrer">{item.source}<ExternalLink className="h-3 w-3" /></a>}</div>
          <SimpleSelect aria-label={`${p.status}: ${item.title}`} value={item.status} onValueChange={(status) => statusMutation.mutate({ id: item.id, status: status as OpportunityStatus })} options={STATUSES.map((status) => ({ value: status, label: status }))} />
          <SimpleSelect aria-label={`${p.organization}: ${item.title}`} value={item.organization_id ?? ""} onValueChange={(organization_id) => organizationMutation.mutate({ id: item.id, organization_id })} options={organizationOptions} />
          <div className="flex justify-between gap-2"><Button variant="outline" size="sm" onClick={() => convertMutation.mutate(item)} disabled={Boolean(item.project_id) || convertMutation.isPending}>{item.project_id ? p.converted : p.convertToProject}</Button><Button variant="ghost" size="icon-sm" aria-label={p.delete} onClick={() => removeMutation.mutate(item.id)}><Trash2 /></Button></div>
        </CardContent></Card>)}
      </div>}
    </div>
  );
}
