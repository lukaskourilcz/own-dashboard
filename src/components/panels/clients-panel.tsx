"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Building2, ExternalLink, Plus, ShieldCheck, Trash2, Users } from "lucide-react";
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
import {
  applyAresSubject,
  isEuVatId,
  isValidIco,
  normalizeIco,
  normalizeVatId,
  vatCheckIsFresh,
  vatNameMismatch,
  vatStatusOf,
  vatVerificationPatch,
  type AresSubject,
  type ViesResult,
} from "@/lib/tax-registry";
import { computeTotals } from "@/lib/invoices";
import { convert } from "@/lib/fx";
import { formatCurrency } from "@/lib/utils";
import { qk } from "@/lib/queries/keys";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import type { ClientOpportunity, ImportantDate, Invoice, InvoiceItem, Note, Organization, OrganizationType, Project, Todo, Updater } from "@/lib/types";

const TYPES: OrganizationType[] = ["client", "prospective_client", "employer", "prospective_employer", "personal_project", "other"];

const EMPTY_FORM = { name: "", type: "client" as OrganizationType, website: "", email: "", notes: "", companyId: "", vatId: "", address: "", city: "", zip: "", country: "" };

function formatCheckedAt(timestamp: string): string {
  try {
    return format(parseISO(timestamp), "d. M. yyyy");
  } catch {
    return timestamp.slice(0, 10);
  }
}

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
  const [form, setForm] = useState(EMPTY_FORM);
  const [ares, setAres] = useState<{ busy: boolean; message: string | null; filledAt: string | null }>({ busy: false, message: null, filledAt: null });
  const [registryNotice, setRegistryNotice] = useState<{ id: string; text: string } | null>(null);

  // Read the public ARES register through /api/registry/ares and complete the
  // legally required invoice fields. Typed values are kept; the registered name
  // is refreshed, which is the whole point of the lookup.
  async function fillFromAres() {
    const ico = normalizeIco(form.companyId);
    if (!isValidIco(ico)) { setAres({ busy: false, message: p.aresInvalidIco, filledAt: null }); return; }
    setAres({ busy: true, message: null, filledAt: null });
    try {
      const response = await fetch("/api/registry/ares", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ico }) });
      const data = (await response.json().catch(() => ({}))) as Partial<AresSubject> & { checkedAt?: string };
      if (!response.ok) { setAres({ busy: false, message: response.status === 404 ? p.aresNotFound : p.aresUnavailable, filledAt: null }); return; }
      const subject: AresSubject = { ico, name: data.name ?? "", address: data.address ?? "", city: data.city ?? "", zip: data.zip ?? "", country: data.country ?? "", vatId: data.vatId ?? "" };
      setForm((current) => ({ ...current, companyId: ico, ...applyAresSubject({ name: current.name, address: current.address, city: current.city, zip: current.zip, country: current.country, vatId: current.vatId }, subject) }));
      setAres({ busy: false, message: p.aresFilled, filledAt: data.checkedAt ?? new Date().toISOString() });
    } catch {
      setAres({ busy: false, message: p.aresUnavailable, filledAt: null });
    }
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error("Not authenticated");
      const { data, error } = await supabase.from("organizations").insert({ user_id: userId, name: form.name.trim(), type: form.type, website: form.website.trim() || null, email: form.email.trim() || null, notes: form.notes.trim(), company_id: normalizeIco(form.companyId) || null, vat_id: normalizeVatId(form.vatId) || form.vatId.trim() || null, address: form.address.trim() || null, city: form.city.trim() || null, zip: form.zip.trim() || null, country: form.country.trim() || null, ares_verified_at: ares.filledAt }).select().single();
      if (error) throw error;
      return data as Organization;
    },
    onSuccess: (item) => { setOrganizations((old) => [...old, item].sort((a, b) => a.name.localeCompare(b.name))); setForm(EMPTY_FORM); setAres({ busy: false, message: null, filledAt: null }); setOpen(false); void qc.invalidateQueries({ queryKey: qk.organizations }); },
    onError: () => toast.err(p.couldNotSave),
  });

  // Ask VIES about an EU VAT id and store the verdict on the organization. A
  // member-state outage is reported and never overwrites a verdict that still
  // stands for the same number, so an ordinary Brussels timeout cannot erase a
  // recorded check. A cached verdict inside the freshness window is reused;
  // "Check again" is the explicit way past it.
  const verifyMutation = useMutation({
    mutationFn: async ({ organization, force }: { organization: Organization; force: boolean }): Promise<{ organization: Organization; message: string | null }> => {
      if (!force && vatCheckIsFresh(organization, new Date())) return { organization, message: null };
      const response = await fetch("/api/registry/vies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vatId: organization.vat_id ?? "" }) });
      const data = (await response.json().catch(() => ({}))) as Partial<ViesResult> & { checkedAt?: string };
      if (!response.ok) return { organization, message: response.status === 400 ? p.vatNotEu : p.viesUnavailable };
      const result: ViesResult = { status: data.status === "valid" || data.status === "invalid" ? data.status : "unavailable", name: data.name ?? "", address: data.address ?? "" };
      const patch = vatVerificationPatch(organization, result, data.checkedAt ?? new Date().toISOString());
      if (!patch) return { organization, message: p.viesUnavailable };
      const { data: updated, error } = await supabase.from("organizations").update(patch).eq("id", organization.id).select().single();
      if (error) throw error;
      return { organization: updated as Organization, message: result.status === "unavailable" ? p.viesUnavailable : null };
    },
    onSuccess: ({ organization, message }) => {
      setOrganizations((old) => old.map((item) => (item.id === organization.id ? organization : item)));
      setRegistryNotice(message ? { id: organization.id, text: message } : null);
      void qc.invalidateQueries({ queryKey: qk.organizations });
    },
    onError: () => toast.err(p.couldNotSave),
  });

  // The same ARES fill for an organization that already exists: an address
  // typed before this feature landed, or one the register has since changed.
  const aresMutation = useMutation({
    mutationFn: async (organization: Organization): Promise<{ organization: Organization; message: string }> => {
      const response = await fetch("/api/registry/ares", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ico: normalizeIco(organization.company_id) }) });
      const data = (await response.json().catch(() => ({}))) as Partial<AresSubject> & { checkedAt?: string };
      if (!response.ok) return { organization, message: response.status === 404 ? p.aresNotFound : p.aresUnavailable };
      const subject: AresSubject = { ico: normalizeIco(organization.company_id), name: data.name ?? "", address: data.address ?? "", city: data.city ?? "", zip: data.zip ?? "", country: data.country ?? "", vatId: data.vatId ?? "" };
      const filled = applyAresSubject({ name: organization.name, address: organization.address ?? "", city: organization.city ?? "", zip: organization.zip ?? "", country: organization.country ?? "", vatId: organization.vat_id ?? "" }, subject);
      const { data: updated, error } = await supabase.from("organizations").update({ name: filled.name, address: filled.address || null, city: filled.city || null, zip: filled.zip || null, country: filled.country || null, vat_id: filled.vatId || null, ares_verified_at: data.checkedAt ?? new Date().toISOString() }).eq("id", organization.id).select().single();
      if (error) throw error;
      return { organization: updated as Organization, message: p.aresFilled };
    },
    onSuccess: ({ organization, message }) => {
      setOrganizations((old) => old.map((item) => (item.id === organization.id ? organization : item)).sort((a, b) => a.name.localeCompare(b.name)));
      setRegistryNotice({ id: organization.id, text: message });
      void qc.invalidateQueries({ queryKey: qk.organizations });
    },
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
      <div className="space-y-1.5"><Label htmlFor="org-ico">{p.companyId}</Label><div className="flex gap-2"><Input id="org-ico" inputMode="numeric" value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })} /><Button type="button" variant="outline" disabled={ares.busy || !form.companyId.trim()} onClick={() => void fillFromAres()}><Building2 />{p.fillFromAres}</Button></div></div>
      <div className="space-y-1.5"><Label htmlFor="org-dic">{p.vatId}</Label><Input id="org-dic" value={form.vatId} onChange={(e) => setForm({ ...form, vatId: e.target.value })} /></div>
      {ares.message && <p className="text-xs text-foreground-muted sm:col-span-2" role="status">{ares.message}</p>}
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="org-address">{p.address}</Label><Input id="org-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
      <div className="space-y-1.5"><Label htmlFor="org-city">{p.city}</Label><Input id="org-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
      <div className="grid grid-cols-2 gap-3"><div className="space-y-1.5"><Label htmlFor="org-zip">{p.zip}</Label><Input id="org-zip" value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} /></div><div className="space-y-1.5"><Label htmlFor="org-country">{p.country}</Label><Input id="org-country" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></div></div>
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
      const vatStatus = vatStatusOf(org);
      const vatIsFresh = vatCheckIsFresh(org, new Date());
      const canVerifyVat = isEuVatId(org.vat_id);
      const canFillFromAres = isValidIco(org.company_id);
      return <article key={org.id} className="border-b border-border last:border-0"><div className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(13rem,.8fr)_auto] sm:items-center"><button type="button" onClick={() => setExpandedId(expanded ? null : org.id)} aria-expanded={expanded} aria-label={`${p.showRelationship}: ${org.name}`} className="min-w-0 text-left focus-ring"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-sm font-semibold">{org.name}</h2><EntityBadge>{statusLabel(org.type, lang)}</EntityBadge><StatusBadge value={org.status} /></div><p className="mt-1 text-xs text-foreground-muted">{org.email ?? org.website ?? p.noRelatedRecords}</p></button><div className="grid grid-cols-3 gap-2 text-center text-[11px] text-foreground-muted"><span><strong className="block text-sm tabular text-foreground">{counts.projects}</strong>{p.projects}</span><span><strong className="block text-sm tabular text-foreground">{counts.opportunities}</strong>{p.opportunities}</span><span><strong className="block text-sm tabular text-foreground">{counts.invoices}</strong>{p.invoices}</span></div><div className="flex justify-end"><Button variant="ghost" size="icon-sm" aria-label={`${p.delete}: ${org.name}`} onClick={() => void removeOrganization(org.id)}><Trash2 /></Button></div></div>
        {expanded && <div className="grid gap-4 border-t border-border bg-surface-inset p-4 lg:grid-cols-[minmax(14rem,.65fr)_minmax(0,1.35fr)]"><div className="space-y-2">{org.email && <a href={`mailto:${org.email}`} className="block text-sm underline">{org.email}</a>}{org.website && <a href={org.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm underline">{org.website}<ExternalLink className="h-3 w-3" /></a>}{org.notes && <p className="text-sm text-foreground-muted">{org.notes}</p>}{relatedInvoices.length > 0 && <p className="pt-2 text-xs font-medium tabular">{p.totalInvoiced}: {formatCurrency(invoiceTotal, displayCurrency)}</p>}
          <div className="space-y-2 border-t border-border pt-2">
            {org.company_id && <p className="text-xs tabular text-foreground-muted">{p.companyId}: {org.company_id}{org.ares_verified_at ? ` · ${p.aresFilledOn} ${formatCheckedAt(org.ares_verified_at)}` : ""}</p>}
            {org.company_id && !canFillFromAres && <p className="text-xs text-warning">{p.aresInvalidIco}</p>}
            {org.vat_id && <div className="flex flex-wrap items-center gap-2"><span className="text-xs tabular text-foreground-muted">{p.vatId}: {org.vat_id}</span><StatusBadge value={`vat_${vatStatus}`} />{org.vat_verified_at && <span className="text-xs tabular text-foreground-muted">{p.vatVerifiedOn} {formatCheckedAt(org.vat_verified_at)}</span>}</div>}
            {org.vat_id && !canVerifyVat && <p className="text-xs text-foreground-muted">{p.vatNotEu}</p>}
            {canVerifyVat && vatStatus === "unchecked" && <p className="text-xs text-foreground-muted">{p.vatNeverVerified}</p>}
            {(canFillFromAres || canVerifyVat) && <div className="flex flex-wrap gap-2 pt-1">
              {canFillFromAres && <Button variant="outline" size="sm" disabled={aresMutation.isPending} aria-label={`${p.fillFromAres}: ${org.name}`} onClick={() => aresMutation.mutate(org)}><Building2 />{p.fillFromAres}</Button>}
              {canVerifyVat && <Button variant={vatIsFresh ? "ghost" : "outline"} size="sm" disabled={verifyMutation.isPending} aria-label={`${vatIsFresh ? p.recheckVat : p.verifyVat}: ${org.name}`} onClick={() => verifyMutation.mutate({ organization: org, force: vatIsFresh })}><ShieldCheck />{vatIsFresh ? p.recheckVat : p.verifyVat}</Button>}
            </div>}
            {vatNameMismatch(org.name, org.vat_verified_name) && <p className="text-xs text-warning">{p.vatRegisteredAs}: {org.vat_verified_name}</p>}
            {registryNotice?.id === org.id && <p className="text-xs text-foreground-muted" role="status">{registryNotice.text}</p>}
          </div></div><div><p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">{p.relatedWork}</p><ul className="mt-2 divide-y divide-border text-xs text-foreground-muted">{relatedProjects.map((item) => <li key={item.id} className="py-1.5"><Link className="font-medium text-foreground underline" href={`/projects/${encodeURIComponent(item.slug)}`} prefetch={false}>{item.name}</Link></li>)}{relatedOpportunities.map((item) => <li key={item.id} className="flex items-center justify-between gap-2 py-1.5"><span>{p.opportunity}: {item.title}</span><StatusBadge value={item.status} /></li>)}{relatedInvoices.map((item) => <li key={item.id} className="flex items-center justify-between gap-2 py-1.5"><span>{p.invoices}: {item.number}</span><StatusBadge value={item.status} /></li>)}{relatedTodos.slice(0, 3).map((item) => <li key={item.id} className="py-1.5">{p.task}: {item.title}</li>)}{relatedNotes.slice(0, 3).map((item) => <li key={item.id} className="py-1.5">{p.note}: {item.title}</li>)}{relatedDates.slice(0, 3).map((item) => <li key={item.id} className="py-1.5 tabular">{item.the_date}: {item.title}</li>)}</ul></div></div>}
      </article>;
    })}</div>}
  </div>;
}
