"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plus, Trash2, Users } from "lucide-react";
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
  const supabase = createClient();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
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
    mutationFn: async (id: string) => { if (!window.confirm(p.confirmDeleteOrganization)) throw new Error("cancelled"); const { error } = await supabase.from("organizations").delete().eq("id", id); if (error) throw error; return id; },
    onSuccess: (id) => setOrganizations((old) => old.filter((item) => item.id !== id)),
    onError: (error) => { if (!(error instanceof Error && error.message === "cancelled")) toast.err(p.couldNotSave); },
  });
  return <div>
    <PageHeader title={p.clientsTitle} description={p.clientsDescription} action={<Button onClick={() => setOpen((x) => !x)}><Plus />{p.newClient}</Button>} />
    {open && <Card className="mb-4"><CardContent className="grid gap-3 p-4 sm:grid-cols-2">
      <div className="space-y-1.5"><Label>{p.name}</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      <div className="space-y-1.5"><Label>{p.type}</Label><SimpleSelect aria-label={p.type} value={form.type} onValueChange={(type) => setForm({ ...form, type: type as OrganizationType })} options={TYPES.map((type) => ({ value: type, label: type }))} /></div>
      <div className="space-y-1.5"><Label>{p.website}</Label><Input type="url" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></div>
      <div className="space-y-1.5"><Label>{p.email}</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
      <div className="space-y-1.5 sm:col-span-2"><Label>{p.notes}</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      <Button className="sm:col-span-2" disabled={!form.name.trim() || createMutation.isPending} onClick={() => createMutation.mutate()}>{p.create}</Button>
    </CardContent></Card>}
    {organizations.length === 0 ? <EmptyState title={p.clientsEmpty} icon={Users} /> : <div className="grid gap-3 lg:grid-cols-2">{organizations.map((org) => {
      const relatedProjects = projects.filter((x) => x.organization_id === org.id);
      const relatedOpportunities = opportunities.filter((x) => x.organization_id === org.id);
      const relatedInvoices = invoices.filter((x) => x.organization_id === org.id);
      const relatedTodos = todos.filter((x) => x.organization_id === org.id);
      const relatedNotes = notes.filter((x) => x.organization_id === org.id);
      const relatedDates = importantDates.filter((x) => x.organization_id === org.id);
      const counts = { projects: relatedProjects.length, opportunities: relatedOpportunities.length, invoices: relatedInvoices.length };
      const invoiceTotal = relatedInvoices.reduce((sum, invoice) => sum + convert(computeTotals(invoiceItems.filter((item) => item.invoice_id === invoice.id).map((item) => ({ quantity: Number(item.quantity), unit_price: Number(item.unit_price), vat_rate: Number(item.vat_rate) })), { roundTotal: invoice.round_total, currency: invoice.currency }).total, invoice.currency, displayCurrency), 0);
      return <Card key={org.id}><CardHeader><CardTitle className="flex items-start justify-between gap-3"><span>{org.name}</span><span className="text-[10px] uppercase text-foreground-muted">{org.type.replaceAll("_", " ")}</span></CardTitle></CardHeader><CardContent className="space-y-3">
        <div className="flex flex-wrap gap-3 text-xs text-foreground-muted"><span>{counts.projects} {p.projects}</span><span>{counts.opportunities} {p.opportunities}</span><span>{counts.invoices} {p.invoices}</span></div>
        {org.email && <a href={`mailto:${org.email}`} className="block text-sm underline">{org.email}</a>}{org.website && <a href={org.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm underline">{org.website}<ExternalLink className="h-3 w-3" /></a>}{org.notes && <p className="text-sm text-foreground-muted">{org.notes}</p>}
        <div className="rounded-md border border-border p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">{p.relatedWork}</p><ul className="mt-2 space-y-1 text-xs text-foreground-muted">{relatedProjects.map((item) => <li key={item.id}><Link className="underline" href={`/projects/${encodeURIComponent(item.slug)}`}>{item.name}</Link></li>)}{relatedOpportunities.map((item) => <li key={item.id}>{p.opportunity}: {item.title} · {item.status}</li>)}{relatedInvoices.map((item) => <li key={item.id}>{p.invoices}: {item.number} · {item.status}</li>)}{relatedTodos.slice(0, 3).map((item) => <li key={item.id}>{p.task}: {item.title}</li>)}{relatedNotes.slice(0, 3).map((item) => <li key={item.id}>{p.note}: {item.title}</li>)}{relatedDates.slice(0, 3).map((item) => <li key={item.id}>{item.the_date}: {item.title}</li>)}</ul>{relatedInvoices.length > 0 && <p className="mt-2 text-xs font-medium">{p.totalInvoiced}: {formatCurrency(invoiceTotal, displayCurrency)}</p>}</div>
        <div className="flex justify-end"><Button variant="ghost" size="icon-sm" aria-label={p.delete} onClick={() => removeMutation.mutate(org.id)}><Trash2 /></Button></div>
      </CardContent></Card>;
    })}</div>}
  </div>;
}
