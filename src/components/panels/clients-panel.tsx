"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { SimpleSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EntityBadge, StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { useDict, useLang } from "@/lib/i18n";
import { statusLabel } from "@/lib/status-presentation";
import { computeTotals } from "@/lib/invoices";
import { convert } from "@/lib/fx";
import { formatCurrency } from "@/lib/utils";
import { qk } from "@/lib/queries/keys";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import type { ClientOpportunity, ImportantDate, Invoice, InvoiceItem, Note, Organization, OrganizationType, Project, Todo, Updater } from "@/lib/types";

const TYPES: OrganizationType[] = ["client", "prospective_client", "employer", "prospective_employer", "personal_project", "other"];

export function ClientsPanel({ organizations, setOrganizations, projects, opportunities, invoices, invoiceItems, todos, notes, importantDates, displayCurrency }: {
  organizations: Organization[];
  setOrganizations: Updater<Organization[]>;
  projects: Project[];
  opportunities: ClientOpportunity[];
  invoices: Invoice[];
  invoiceItems: InvoiceItem[];
  todos: Todo[];
  notes: Note[];
  importantDates: ImportantDate[];
  displayCurrency: string;
}) {
  const t = useDict();
  const p = t.professional;
  const { lang } = useLang();
  const supabase = createClient();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirmation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<OrganizationType | "all">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", type: "client" as OrganizationType, website: "", email: "", notes: "" });
  const createMutation = useMutation({
    mutationFn: async () => {
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error("Not authenticated");
      const { data, error } = await supabase.from("organizations").insert({ user_id: userId, name: form.name.trim(), type: form.type, website: form.website.trim() || null, email: form.email.trim() || null, notes: form.notes.trim() }).select().single();
      if (error) throw error;
      return data as Organization;
    },
    onSuccess: (item) => { setOrganizations((old) => [...old, item].sort((a, b) => a.name.localeCompare(b.name))); setForm({ name: "", type: "client", website: "", email: "", notes: "" }); setOpen(false); void qc.invalidateQueries({ queryKey: qk.organizations }); },
    onError: () => toast.err(p.couldNotSave),
  });
  const removeMutation = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("organizations").delete().eq("id", id); if (error) throw error; return id; },
    onSuccess: (id) => setOrganizations((old) => old.filter((item) => item.id !== id)),
    onError: () => toast.err(p.couldNotSave),
  });
  const removeOrganization = async (id: string) => {
    if (await confirm({
      title: p.delete,
      description: p.confirmDeleteOrganization,
      confirmLabel: t.common.delete,
      cancelLabel: t.common.cancel,
      destructive: true,
    })) removeMutation.mutate(id);
  };
  const clientQuery = search.trim().toLocaleLowerCase();
  const visibleOrganizations = organizations.filter((org) =>
    (typeFilter === "all" || org.type === typeFilter) &&
    (!clientQuery || `${org.name} ${org.email ?? ""}`.toLocaleLowerCase().includes(clientQuery)),
  );
  return <div>
    <PageHeader title={p.clientsTitle} description={p.clientsDescription} action={<Button onClick={() => setOpen((x) => !x)}><Plus />{p.newClient}</Button>} />
    {open && <Card className="mb-4"><CardContent className="grid gap-3 p-4 sm:grid-cols-2">
      <div className="space-y-1.5"><Label>{p.name}</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      <div className="space-y-1.5"><Label>{p.type}</Label><SimpleSelect aria-label={p.type} value={form.type} onValueChange={(type) => setForm({ ...form, type: type as OrganizationType })} options={TYPES.map((type) => ({ value: type, label: statusLabel(type, lang) }))} /></div>
      <div className="space-y-1.5"><Label>{p.website}</Label><Input type="url" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></div>
      <div className="space-y-1.5"><Label>{p.email}</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
      <div className="space-y-1.5 sm:col-span-2"><Label>{p.notes}</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      <Button className="sm:col-span-2" disabled={!form.name.trim() || createMutation.isPending} onClick={() => createMutation.mutate()}>{p.create}</Button>
    </CardContent></Card>}
    <div className="mb-4 grid gap-2 rounded-lg border border-border bg-surface-secondary p-2 sm:grid-cols-[minmax(0,1fr)_16rem]"><Input aria-label={p.searchClients} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={p.searchClients} /><SimpleSelect aria-label={p.allOrganizationTypes} value={typeFilter} onValueChange={(value) => setTypeFilter(value as OrganizationType | "all")} options={[{ value: "all", label: p.allOrganizationTypes }, ...TYPES.map((type) => ({ value: type, label: statusLabel(type, lang) }))]} /></div>
    {visibleOrganizations.length === 0 ? <EmptyState title={organizations.length === 0 ? p.clientsEmpty : t.common.none} icon={Users} /> : <div className="overflow-hidden rounded-lg border border-border bg-surface">{visibleOrganizations.map((org) => {
      const relatedProjects = projects.filter((x) => x.organization_id === org.id);
      const relatedOpportunities = opportunities.filter((x) => x.organization_id === org.id);
      const relatedInvoices = invoices.filter((x) => x.organization_id === org.id);
      const relatedTodos = todos.filter((x) => x.organization_id === org.id);
      const relatedNotes = notes.filter((x) => x.organization_id === org.id);
      const relatedDates = importantDates.filter((x) => x.organization_id === org.id);
      const counts = { projects: relatedProjects.length, opportunities: relatedOpportunities.length, invoices: relatedInvoices.length };
      const invoiceTotal = relatedInvoices.reduce((sum, invoice) => sum + convert(computeTotals(invoiceItems.filter((item) => item.invoice_id === invoice.id).map((item) => ({ quantity: Number(item.quantity), unit_price: Number(item.unit_price), vat_rate: Number(item.vat_rate) })), { roundTotal: invoice.round_total, currency: invoice.currency }).total, invoice.currency, displayCurrency), 0);
      const expanded = expandedId === org.id;
      return <article key={org.id} className="border-b border-border last:border-0"><div className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(13rem,.8fr)_auto] sm:items-center"><button type="button" onClick={() => setExpandedId(expanded ? null : org.id)} aria-expanded={expanded} aria-label={`${p.showRelationship}: ${org.name}`} className="min-w-0 text-left focus-ring"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-sm font-semibold">{org.name}</h2><EntityBadge>{statusLabel(org.type, lang)}</EntityBadge><StatusBadge value={org.status} /></div><p className="mt-1 text-xs text-foreground-muted">{org.email ?? org.website ?? p.noRelatedRecords}</p></button><div className="grid grid-cols-3 gap-2 text-center text-[11px] text-foreground-muted"><span><strong className="block text-sm tabular text-foreground">{counts.projects}</strong>{p.projects}</span><span><strong className="block text-sm tabular text-foreground">{counts.opportunities}</strong>{p.opportunities}</span><span><strong className="block text-sm tabular text-foreground">{counts.invoices}</strong>{p.invoices}</span></div><div className="flex justify-end"><Button variant="ghost" size="icon-sm" aria-label={`${p.delete}: ${org.name}`} onClick={() => void removeOrganization(org.id)}><Trash2 /></Button></div></div>
        {expanded && <div className="grid gap-4 border-t border-border bg-surface-inset p-4 lg:grid-cols-[minmax(14rem,.65fr)_minmax(0,1.35fr)]"><div className="space-y-2">{org.email && <a href={`mailto:${org.email}`} className="block text-sm underline">{org.email}</a>}{org.website && <a href={org.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm underline">{org.website}<ExternalLink className="h-3 w-3" /></a>}{org.notes && <p className="text-sm text-foreground-muted">{org.notes}</p>}{relatedInvoices.length > 0 && <p className="pt-2 text-xs font-medium tabular">{p.totalInvoiced}: {formatCurrency(invoiceTotal, displayCurrency)}</p>}</div><div><p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">{p.relatedWork}</p><ul className="mt-2 divide-y divide-border text-xs text-foreground-muted">{relatedProjects.map((item) => <li key={item.id} className="py-1.5"><Link className="font-medium text-foreground underline" href={`/projects/${encodeURIComponent(item.slug)}`} prefetch={false}>{item.name}</Link></li>)}{relatedOpportunities.map((item) => <li key={item.id} className="flex items-center justify-between gap-2 py-1.5"><span>{p.opportunity}: {item.title}</span><StatusBadge value={item.status} /></li>)}{relatedInvoices.map((item) => <li key={item.id} className="flex items-center justify-between gap-2 py-1.5"><span>{p.invoices}: {item.number}</span><StatusBadge value={item.status} /></li>)}{relatedTodos.slice(0, 3).map((item) => <li key={item.id} className="py-1.5">{p.task}: {item.title}</li>)}{relatedNotes.slice(0, 3).map((item) => <li key={item.id} className="py-1.5">{p.note}: {item.title}</li>)}{relatedDates.slice(0, 3).map((item) => <li key={item.id} className="py-1.5 tabular">{item.the_date}: {item.title}</li>)}</ul></div></div>}
      </article>;
    })}</div>}
  </div>;
}
