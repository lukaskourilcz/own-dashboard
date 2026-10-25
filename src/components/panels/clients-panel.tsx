"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
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
import { lookupAres, RegistryLookupError } from "@/lib/tax-registry-client";
import { useOwnerPreferences } from "@/lib/owner-preferences";
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
  const formId = useId();
  const owner = useOwnerPreferences();
  const draftEpoch = useRef(0);
  const draftLookup = useRef<{ controller: AbortController; epoch: number } | null>(null);
  useEffect(() => () => { draftLookup.current?.controller.abort(); }, []);
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
  const [ares, setAres] = useState<{ busy: boolean; message: "aresInvalidIco" | "aresUnavailable" | "aresNotFound" | "aresFilled" | null; filledAt: string | null }>({ busy: false, message: null, filledAt: null });
  const [registryNotice, setRegistryNotice] = useState<{ id: string; text: string } | null>(null);

  // Read the public ARES register through /api/registry/ares and complete the
  // legally required invoice fields. Typed values are kept; the registered name
  // is refreshed, which is the whole point of the lookup.
  function cancelDraftLookup() {
    draftEpoch.current += 1; draftLookup.current?.controller.abort(); draftLookup.current = null;
    setAres({ busy: false, message: null, filledAt: null });
  }
  async function fillFromAres() {
    if (draftLookup.current) return;
    const ico = normalizeIco(form.companyId), typedName = form.name;
    if (!isValidIco(ico)) { setAres({ busy: false, message: "aresInvalidIco", filledAt: null }); return; }
    if (!owner) { setAres({ busy: false, message: "aresUnavailable", filledAt: null }); return; }
    const captured = owner.capture(), attempt = { controller: new AbortController(), epoch: draftEpoch.current };
    const signal = AbortSignal.any([captured.signal, attempt.controller.signal]);
    draftLookup.current = attempt; setAres({ busy: true, message: null, filledAt: null });
    try {
      const subject = await lookupAres({ ownerId: captured.ownerId, signal }, ico);
      if (signal.aborted || draftLookup.current !== attempt || draftEpoch.current !== attempt.epoch) return;
      setForm(current => {
        if (draftEpoch.current !== attempt.epoch || normalizeIco(current.companyId) !== ico) return current;
        const filled = applyAresSubject(current, subject);
        return { ...current, ...filled, companyId: ico, name: current.name === typedName ? filled.name : current.name };
      });
      setAres({ busy: false, message: "aresFilled", filledAt: subject.checkedAt });
    } catch (error) {
      if (!signal.aborted && draftLookup.current === attempt && draftEpoch.current === attempt.epoch) {
        const message = error instanceof RegistryLookupError && error.reason === "not-found" ? "aresNotFound" : error instanceof RegistryLookupError && error.reason === "invalid" ? "aresInvalidIco" : "aresUnavailable";
        setAres({ busy: false, message, filledAt: null });
      }
    } finally { if (draftLookup.current === attempt) draftLookup.current = null; }
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error("Not authenticated");
      const { data, error } = await supabase.from("organizations").insert({ user_id: userId, name: form.name.trim(), type: form.type, website: form.website.trim() || null, email: form.email.trim() || null, notes: form.notes.trim(), company_id: normalizeIco(form.companyId) || null, vat_id: normalizeVatId(form.vatId) || form.vatId.trim() || null, address: form.address.trim() || null, city: form.city.trim() || null, zip: form.zip.trim() || null, country: form.country.trim() || null, ares_verified_at: ares.filledAt }).select().single();
      if (error) throw error;
      return data as Organization;
    },
    onSuccess: (item) => { cancelDraftLookup(); setOrganizations((old) => [...old, item].sort((a, b) => a.name.localeCompare(b.name))); setForm(EMPTY_FORM); setAres({ busy: false, message: null, filledAt: null }); setOpen(false); void qc.invalidateQueries({ queryKey: qk.organizations }); },
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
    onSuccess: (id) => {
      setOrganizations((old) => old.filter((item) => item.id !== id));
      for (const queryKey of [qk.organizations, qk.projects, qk.opportunities, qk.invoices, qk.todos, qk.notes, qk.importantDates]) void qc.invalidateQueries({ queryKey });
    },
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
  // Build relationships when records change, rather than rescanning every
  // collection for every client on each keystroke. Totals are needed only for
  // the one expanded client.
  const related = useMemo(() => {
    function group<T extends { organization_id?: string | null }>(rows: T[]) {
      const map = new Map<string, T[]>();
      for (const row of rows) if (row.organization_id) {
        const list = map.get(row.organization_id) ?? [];
        list.push(row); map.set(row.organization_id, list);
      }
      return map;
    }
    return { projects: group(projects), opportunities: group(opportunities), invoices: group(invoices), todos: group(todos), notes: group(notes), dates: group(importantDates) };
  }, [projects, opportunities, invoices, todos, notes, importantDates]);
  const itemsByInvoice = useMemo(() => {
    const map = new Map<string, InvoiceItem[]>();
    for (const item of invoiceItems) { const list = map.get(item.invoice_id) ?? []; list.push(item); map.set(item.invoice_id, list); }
    return map;
  }, [invoiceItems]);
  const clientQuery = search.trim().toLocaleLowerCase();
  const visibleOrganizations = organizations.filter((org) =>
    (typeFilter === "all" || org.type === typeFilter) &&
    (!clientQuery || `${org.name} ${org.email ?? ""}`.toLocaleLowerCase().includes(clientQuery)),
  );
  return <div>
    <PageHeader title={p.clientsTitle} description={p.clientsDescription} action={<Button onClick={() => { cancelDraftLookup(); setOpen(x => !x); }}><Plus />{p.newClient}</Button>} />
    {open && <Card className="mx-auto mb-4 max-w-4xl"><CardContent className="p-4"><form aria-busy={ares.busy} className="grid gap-3 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); if (form.name.trim() && !createMutation.isPending && !draftLookup.current) createMutation.mutate(); }}>
      <div className="space-y-1.5"><Label htmlFor={`${formId}-name`}>{p.name}</Label><Input id={`${formId}-name`} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      <div className="space-y-1.5"><Label>{p.type}</Label><SimpleSelect aria-label={p.type} value={form.type} onValueChange={(type) => setForm({ ...form, type: type as OrganizationType })} options={TYPES.map((type) => ({ value: type, label: statusLabel(type, lang) }))} /></div>
      <div className="space-y-1.5"><Label htmlFor={`${formId}-website`}>{p.website}</Label><Input id={`${formId}-website`} type="url" pattern="https?://.+" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></div>
      <div className="space-y-1.5"><Label htmlFor={`${formId}-email`}>{p.email}</Label><Input id={`${formId}-email`} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
      <div className="grid gap-3 sm:col-span-2 lg:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="org-ico">{p.companyId}</Label><div className="flex min-w-0 gap-2"><Input className="min-w-24 flex-1" id="org-ico" inputMode="numeric" value={form.companyId} onChange={e => { const companyId = e.target.value; cancelDraftLookup(); setForm(current => ({ ...current, companyId })); }} /><Button type="button" variant="outline" className="shrink-0" disabled={ares.busy || !form.companyId.trim()} onClick={() => void fillFromAres()}><Building2 />{p.fillFromAres}</Button></div></div>
      <div className="space-y-1.5"><Label htmlFor="org-dic">{p.vatId}</Label><Input id="org-dic" value={form.vatId} onChange={(e) => setForm({ ...form, vatId: e.target.value })} /></div></div>
      {ares.message && <p className="text-xs text-foreground-muted sm:col-span-2" role={ares.filledAt ? "status" : "alert"}>{p[ares.message]}</p>}
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="org-address">{p.address}</Label><Input id="org-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
      <div className="space-y-1.5"><Label htmlFor="org-city">{p.city}</Label><Input id="org-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
      <div className="grid grid-cols-2 gap-3"><div className="space-y-1.5"><Label htmlFor="org-zip">{p.zip}</Label><Input id="org-zip" value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} /></div><div className="space-y-1.5"><Label htmlFor="org-country">{p.country}</Label><Input id="org-country" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></div></div>
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor={`${formId}-notes`}>{p.notes}</Label><Textarea id={`${formId}-notes`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      <Button type="submit" className="sm:col-span-2 sm:justify-self-end" disabled={!form.name.trim() || createMutation.isPending || ares.busy}>{p.create}</Button>
    </form></CardContent></Card>}
    <div className="mb-4 grid gap-2 rounded-lg border border-border bg-surface-secondary p-2 sm:grid-cols-[minmax(0,1fr)_16rem]"><Input aria-label={p.searchClients} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={p.searchClients} /><SimpleSelect aria-label={p.allOrganizationTypes} value={typeFilter} onValueChange={(value) => setTypeFilter(value as OrganizationType | "all")} options={[{ value: "all", label: p.allOrganizationTypes }, ...TYPES.map((type) => ({ value: type, label: statusLabel(type, lang) }))]} /></div>
    {visibleOrganizations.length === 0 ? <EmptyState title={organizations.length === 0 ? p.clientsEmpty : t.common.none} icon={Users} /> : <div className="overflow-hidden rounded-lg border border-border bg-surface">{visibleOrganizations.map((org) => {
      const relatedProjects = related.projects.get(org.id) ?? [];
      const relatedOpportunities = related.opportunities.get(org.id) ?? [];
      const relatedInvoices = related.invoices.get(org.id) ?? [];
      const relatedTodos = related.todos.get(org.id) ?? [];
      const relatedNotes = related.notes.get(org.id) ?? [];
      const relatedDates = related.dates.get(org.id) ?? [];
      const counts = { projects: relatedProjects.length, opportunities: relatedOpportunities.length, invoices: relatedInvoices.length };
      const expanded = expandedId === org.id;
      const invoiceTotal = expanded ? relatedInvoices.reduce((sum, invoice) => sum + convert(computeTotals((itemsByInvoice.get(invoice.id) ?? []).map((item) => ({ quantity: Number(item.quantity), unit_price: Number(item.unit_price), vat_rate: Number(item.vat_rate) })), { roundTotal: invoice.round_total, currency: invoice.currency }).total, invoice.currency, displayCurrency), 0) : 0;
      const vatStatus = vatStatusOf(org);
      const vatIsFresh = vatCheckIsFresh(org, new Date());
      const canVerifyVat = isEuVatId(org.vat_id);
      const canFillFromAres = isValidIco(org.company_id);
      return <article key={org.id} className="border-b border-border last:border-0"><div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 p-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,.8fr)_auto]"><button type="button" onClick={() => setExpandedId(expanded ? null : org.id)} aria-expanded={expanded} aria-label={`${p.showRelationship}: ${org.name}`} className="min-h-11 min-w-0 text-left focus-ring"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-sm font-semibold">{org.name}</h2><EntityBadge>{statusLabel(org.type, lang)}</EntityBadge><StatusBadge value={org.status} /></div>{(org.email || org.website) && <p className="mt-1 break-words text-xs text-foreground-muted">{org.email ?? org.website}</p>}</button><div className="col-start-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-foreground-muted lg:col-start-2 lg:row-start-1">{counts.projects + counts.opportunities + counts.invoices === 0 ? <span>{p.noRelatedRecords}</span> : [[p.projects, counts.projects], [p.opportunities, counts.opportunities], [p.invoices, counts.invoices]].filter(([, count]) => Number(count) > 0).map(([label, count]) => <span key={label}><strong className="tabular text-foreground">{count}</strong> {label}</span>)}</div><div className="col-start-2 row-start-1 flex justify-end lg:col-start-3"><Button variant="ghost" size="icon-sm" aria-label={`${p.delete}: ${org.name}`} onClick={() => void removeOrganization(org.id)}><Trash2 /></Button></div></div>
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
