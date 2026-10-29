"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
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
} from "@/lib/tax-registry";
import { lookupAres, lookupVies, RegistryLookupError } from "@/lib/tax-registry-client";
import { useOwnerPreferences } from "@/lib/owner-preferences";
import { computeTotals } from "@/lib/invoices";
import { convert } from "@/lib/fx";
import { formatCurrency } from "@/lib/utils";
import { qk } from "@/lib/queries/keys";
import { createClient } from "@/lib/supabase/client";
import { applyOrganizationReceipt, createOrganizationRecord, updateOrganizationRecord, removeOrganizationRecord, OrganizationRecordError, type OrganizationFields, type OrganizationScope } from "@/lib/organization-records";
import { useGuardedNavigation, useUnsavedDraft } from "@/components/navigation-guard";
import { safeWebUrl } from "@/lib/web-url";
import { z } from "zod";
import type { ClientOpportunity, ImportantDate, Invoice, InvoiceItem, Note, Organization, OrganizationType, Project, Todo, Updater } from "@/lib/types";

const TYPES: OrganizationType[] = ["client", "prospective_client", "employer", "prospective_employer", "personal_project", "other"];

type NoticeKey = "aresFilled" | "aresNotFound" | "aresInvalidIco" | "aresUnavailable" | "vatNotEu" | "viesUnavailable" | "organizationChanged" | "organizationActionUnconfirmed";
const EMPTY_FORM = { name: "", type: "client" as OrganizationType, website: "", email: "", notes: "", companyId: "", vatId: "", address: "", city: "", zip: "", country: "" };

function formatCheckedAt(timestamp: string): string {
  try {
    return format(parseISO(timestamp), "d. M. yyyy");
  } catch {
    return timestamp.slice(0, 10);
  }
}

export function ClientsPanel({ organizations, setOrganizations, projects, opportunities, invoices, invoiceItems, todos, notes, importantDates, displayCurrency, refreshFailed = false }: {
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
  refreshFailed?: boolean;
}) {
  const formId = useId();
  const newClientControl = useRef<HTMLButtonElement>(null);
  const searchControl = useRef<HTMLInputElement>(null);
  const deleteControls = useRef(new Map<string, HTMLButtonElement>());
  const focusRemoval = useRef<{ id: string; nextId: string | null } | null>(null);
  useLayoutEffect(() => {
    const intent = focusRemoval.current;
    if (!intent || organizations.some(row => row.id === intent.id)) return;
    const next = intent.nextId ? deleteControls.current.get(intent.nextId) : null;
    const control = next && !next.disabled ? next : [...deleteControls.current.values()].find(button => !button.disabled) ?? (newClientControl.current?.disabled ? searchControl.current : newClientControl.current);
    control?.focus(); focusRemoval.current = null;
  }, [organizations]);
  const owner = useOwnerPreferences();
  const lifetime = useRef(new AbortController());
  useLayoutEffect(() => {
    if (lifetime.current.signal.aborted) lifetime.current = new AbortController();
    return () => lifetime.current.abort();
  }, []);
  const draftEpoch = useRef(0);
  const draftLookup = useRef<{ controller: AbortController; epoch: number } | null>(null);
  useEffect(() => () => { draftLookup.current?.controller.abort(); }, []);
  const t = useDict();
  const p = t.professional;
  const { lang } = useLang();
  const supabase = createClient();
  const qc = useQueryClient();
  const confirm = useConfirmation();
  const navigate = useGuardedNavigation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<OrganizationType | "all">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [visited, setVisited] = useState({ name: false, website: false, email: false });
  const [ares, setAres] = useState<{ busy: boolean; message: "aresInvalidIco" | "aresUnavailable" | "aresNotFound" | "aresFilled" | null; filledAt: string | null }>({ busy: false, message: null, filledAt: null });
  const [registryNotice, setRegistryNotice] = useState<{ id: string; key: NoticeKey; error?: boolean } | null>(null);
  const [saveError, setSaveError] = useState<"organizationChanged" | "organizationSaveUnconfirmed" | "organizationInvalid" | null>(null);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const draftIdentity = useRef<string | null>(null);
  const reservations = useRef(new Map<string, OrganizationScope>());
  const [pendingRows, setPendingRows] = useState<ReadonlySet<string>>(new Set());
  const [reloading, setReloading] = useState(false);
  const reloadingRef = useRef(false);
  const [reloadError, setReloadError] = useState(false);
  const readFailed = refreshFailed || reloadError;
  const queryKey = useMemo(() => [...qk.organizations, owner?.ownerId], [owner?.ownerId]);
  const invalidName = !form.name.trim();
  const invalidWebsite = !!form.website.trim() && !safeWebUrl(form.website);
  const invalidEmail = !!form.email.trim() && !z.regexes.html5Email.test(form.email.trim());
  const validForm = !!form.name.trim() && !invalidWebsite && !invalidEmail;
  const dirty = JSON.stringify(form) !== JSON.stringify(EMPTY_FORM);
  const capture = (): OrganizationScope | null => {
    if (!owner) return null;
    const captured = owner.capture();
    return { ownerId: captured.ownerId, signal: AbortSignal.any([captured.signal, lifetime.current.signal]) };
  };
  const errorKey = (error: unknown) => error instanceof OrganizationRecordError && error.reason === "changed" ? "organizationChanged" as const : "organizationActionUnconfirmed" as const;
  const invalidate = () => { void qc.invalidateQueries({ queryKey }); };
  async function reloadOrganizations() {
    if (reloadingRef.current) return;
    const captured = capture(); if (!captured || captured.signal.aborted) return;
    reloadingRef.current = true; setReloading(true);
    try {
      await qc.refetchQueries({ queryKey, exact: true }, { throwOnError: true });
      if (!captured.signal.aborted && qc.getQueryState(queryKey)?.status === "success") { setRegistryNotice(null); setReloadError(false); }
    }
    catch { if (!captured.signal.aborted) setReloadError(true); }
    finally { reloadingRef.current = false; if (!captured.signal.aborted) setReloading(false); }
  }
  function reserve(organization: Organization) {
    if (reservations.current.has(organization.id)) return null;
    const captured = capture();
    if (!captured || captured.signal.aborted || organization.user_id !== captured.ownerId) return null;
    reservations.current.set(organization.id, captured); setPendingRows(new Set(reservations.current.keys()));
    return captured;
  }
  function release(id: string, captured: OrganizationScope) {
    if (reservations.current.get(id) !== captured) return;
    reservations.current.delete(id);
    if (!captured.signal.aborted) setPendingRows(new Set(reservations.current.keys()));
  }

  // Read the public ARES register through /api/registry/ares and complete the
  // legally required invoice fields. Typed values are kept; the registered name
  // is refreshed, which is the whole point of the lookup.
  function cancelDraftLookup() {
    draftEpoch.current += 1; draftLookup.current?.controller.abort(); draftLookup.current = null;
    setAres({ busy: false, message: null, filledAt: null });
  }
  async function fillFromAres() {
    if (draftLookup.current || creatingRef.current) return;
    const ico = normalizeIco(form.companyId), typedName = form.name;
    if (!isValidIco(ico)) { setAres({ busy: false, message: "aresInvalidIco", filledAt: null }); return; }
    if (!owner) { setAres({ busy: false, message: "aresUnavailable", filledAt: null }); return; }
    const captured = capture()!, attempt = { controller: new AbortController(), epoch: draftEpoch.current };
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

  async function saveDraft(): Promise<boolean> {
    if (creatingRef.current || draftLookup.current || reservations.current.size) return false;
    if (!validForm) { setVisited({ name: true, website: true, email: true }); setSaveError("organizationInvalid"); return false; }
    const captured = capture();
    if (!captured || captured.signal.aborted) { setSaveError("organizationSaveUnconfirmed"); return false; }
    creatingRef.current = true; setCreating(true); setSaveError(null);
    // The id survives edits and uncertain responses until confirmation/discard.
    // Changing a draft after an uncertain commit cannot create a second row.
    const id = draftIdentity.current ??= crypto.randomUUID();
    const companyId = form.companyId.trim(), ico = normalizeIco(companyId);
    const fields: OrganizationFields = {
      name: form.name.trim(), type: form.type, website: form.website.trim() || null, email: form.email.trim() || null,
      notes: form.notes.trim(), company_id: companyId.replace(/[^0-9]/g, "").length === 8 && /^[0-9.\s-]+$/.test(companyId) && isValidIco(ico) ? ico : companyId || null,
      vat_id: normalizeVatId(form.vatId) || form.vatId.trim() || null,
      address: form.address.trim() || null, city: form.city.trim() || null, zip: form.zip.trim() || null, country: form.country.trim() || null,
      ares_verified_at: ares.filledAt, logo_url: null, phone: null, status: "active", vat_verification_status: "unchecked", vat_verified_at: null, vat_verified_id: null, vat_verified_name: null, vat_verified_address: null,
    };
    try {
      const item = await createOrganizationRecord(supabase, captured, id, fields);
      await qc.cancelQueries({ queryKey, exact: true });
      if (captured.signal.aborted) return false;
      setOrganizations(old => old.some(row => row.id === item.id) ? old : [...old, item].sort((a, b) => a.name.localeCompare(b.name)));
      draftIdentity.current = null; cancelDraftLookup(); setForm(EMPTY_FORM); setVisited({ name: false, website: false, email: false }); setOpen(false); invalidate(); return true;
    } catch (error) {
      if (!captured.signal.aborted) setSaveError(errorKey(error) === "organizationChanged" ? "organizationChanged" : "organizationSaveUnconfirmed"); return false;
    } finally { creatingRef.current = false; if (!captured.signal.aborted) setCreating(false); }
  }
  useUnsavedDraft({ dirty, pending: creating || pendingRows.size > 0, canSave: validForm && !ares.busy && !creating && pendingRows.size === 0,
    save: saveDraft, discard: () => { cancelDraftLookup(); draftIdentity.current = null; setForm(EMPTY_FORM); setVisited({ name: false, website: false, email: false }); setSaveError(null); },
  });

  async function runRegistry(organization: Organization, kind: "ares" | "vies", force = false) {
    const source = { ...organization }, captured = reserve(source);
    if (!captured) return;
    setRegistryNotice(null);
    try {
      const scope = { ...captured, signal: AbortSignal.any([captured.signal, AbortSignal.timeout(43_000)]) };
      let updated: Organization | null = null, notice: NoticeKey | null = null;
      if (kind === "vies") {
        if (!force && vatCheckIsFresh(source, new Date())) return;
        const result = await lookupVies(scope, source.vat_id ?? "");
        const patch = vatVerificationPatch(source, result, result.checkedAt);
        notice = result.status === "unavailable" ? "viesUnavailable" : null;
        if (patch) updated = await updateOrganizationRecord(supabase, scope, source, patch);
      } else {
        const subject = await lookupAres(scope, source.company_id ?? "");
        const filled = applyAresSubject({ name: source.name, address: source.address ?? "", city: source.city ?? "", zip: source.zip ?? "", country: source.country ?? "", vatId: source.vat_id ?? "" }, subject);
        updated = await updateOrganizationRecord(supabase, scope, source, { name: filled.name, address: filled.address || null, city: filled.city || null, zip: filled.zip || null, country: filled.country || null, vat_id: filled.vatId || null, ares_verified_at: subject.checkedAt });
        notice = "aresFilled";
      }
      if (updated) await qc.cancelQueries({ queryKey, exact: true });
      if (captured.signal.aborted) return;
      if (updated) { const receipt = updated; setOrganizations(old => applyOrganizationReceipt(old, source, receipt).sort((a, b) => a.name.localeCompare(b.name))); invalidate(); }
      setRegistryNotice(notice ? { id: source.id, key: notice } : null);
    } catch (error) {
      if (!captured.signal.aborted) {
        const key = error instanceof RegistryLookupError ? kind === "ares" ? error.reason === "not-found" ? "aresNotFound" : error.reason === "invalid" ? "aresInvalidIco" : "aresUnavailable" : error.reason === "invalid" ? "vatNotEu" : "viesUnavailable" : errorKey(error);
        setRegistryNotice({ id: source.id, key, error: true });
      }
    } finally { release(source.id, captured); }
  }
  async function removeOrganization(organization: Organization) {
    // Reserve and capture before the confirmation wait; a later refresh cannot
    // turn the original delete intent into permission to remove a newer row.
    const source = { ...organization }, captured = reserve(source);
    if (!captured) return;
    try {
      if (!await confirm({ title: p.delete, description: p.confirmDeleteOrganization, confirmLabel: t.common.delete, cancelLabel: t.common.cancel, destructive: true }) || captured.signal.aborted) return;
      await removeOrganizationRecord(supabase, captured, source);
      await qc.cancelQueries({ queryKey, exact: true });
      if (captured.signal.aborted) return;
      focusRemoval.current = { id: source.id, nextId: organizations[organizations.findIndex(row => row.id === source.id) + 1]?.id ?? null };
      setOrganizations(old => applyOrganizationReceipt(old, source, null));
      for (const key of [queryKey, qk.projects, qk.opportunities, qk.invoices, qk.todos, qk.notes, qk.importantDates]) void qc.invalidateQueries({ queryKey: key });
    } catch (error) { if (!captured.signal.aborted) setRegistryNotice({ id: source.id, key: errorKey(error), error: true }); }
    finally { release(source.id, captured); }
  }
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
    <PageHeader title={p.clientsTitle} description={p.clientsDescription} action={<Button ref={newClientControl} disabled={creating} onClick={() => { cancelDraftLookup(); setOpen(x => !x); }}><Plus />{p.newClient}</Button>} />
    {readFailed && <div className="mb-4 flex flex-col gap-3 rounded-lg border border-border bg-surface-secondary p-3 md:flex-row md:items-center md:justify-between"><p className="min-w-0 flex-1 text-sm text-warning" role="alert">{p.organizationReadUnavailable}</p><Button className="md:shrink-0" variant="outline" disabled={reloading || pendingRows.size > 0 || creating} aria-busy={reloading} onClick={() => void reloadOrganizations()}>{p.organizationReload}</Button></div>}
    {open && <Card className="mx-auto mb-4 max-w-4xl"><CardContent className="p-4"><form aria-busy={ares.busy || creating} onSubmit={event => { event.preventDefault(); void saveDraft(); }}><fieldset disabled={creating} className="grid min-w-0 gap-3 sm:grid-cols-2">
      <div className="space-y-1.5"><Label htmlFor={`${formId}-name`}>{p.name}</Label><Input id={`${formId}-name`} required onBlur={() => setVisited(current => ({ ...current, name: true }))} aria-invalid={visited.name && invalidName || undefined} aria-describedby={visited.name && invalidName ? `${formId}-name-error` : undefined} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />{visited.name && invalidName && <p role="alert" id={`${formId}-name-error`} className="text-xs text-risk">{p.organizationNameRequired}</p>}</div>
      <div className="space-y-1.5"><Label>{p.type}</Label><SimpleSelect aria-label={p.type} value={form.type} onValueChange={(type) => setForm({ ...form, type: type as OrganizationType })} options={TYPES.map((type) => ({ value: type, label: statusLabel(type, lang) }))} /></div>
      <div className="space-y-1.5"><Label htmlFor={`${formId}-website`}>{p.website}</Label><Input id={`${formId}-website`} type="url" maxLength={2000} onBlur={() => setVisited(current => ({ ...current, website: true }))} aria-invalid={visited.website && invalidWebsite || undefined} aria-describedby={visited.website && invalidWebsite ? `${formId}-website-error` : undefined} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />{visited.website && invalidWebsite && <p role="alert" id={`${formId}-website-error`} className="text-xs text-risk">{p.organizationWebsiteInvalid}</p>}</div>
      <div className="space-y-1.5"><Label htmlFor={`${formId}-email`}>{p.email}</Label><Input id={`${formId}-email`} type="email" onBlur={() => setVisited(current => ({ ...current, email: true }))} aria-invalid={visited.email && invalidEmail || undefined} aria-describedby={visited.email && invalidEmail ? `${formId}-email-error` : undefined} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />{visited.email && invalidEmail && <p role="alert" id={`${formId}-email-error`} className="text-xs text-risk">{p.organizationEmailInvalid}</p>}</div>
      <div className="grid gap-3 sm:col-span-2 lg:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="org-ico">{p.companyId}</Label><div className="flex min-w-0 gap-2"><Input className="min-w-24 flex-1" id="org-ico" value={form.companyId} onChange={e => { const companyId = e.target.value; cancelDraftLookup(); setForm(current => ({ ...current, companyId })); }} /><Button type="button" variant="outline" className="shrink-0" disabled={ares.busy || !form.companyId.trim()} onClick={() => void fillFromAres()}><Building2 />{p.fillFromAres}</Button></div></div>
      <div className="space-y-1.5"><Label htmlFor="org-dic">{p.vatId}</Label><Input id="org-dic" value={form.vatId} onChange={(e) => setForm({ ...form, vatId: e.target.value })} /></div></div>
      {ares.message && <p className="text-xs text-foreground-muted sm:col-span-2" role={ares.filledAt ? "status" : "alert"}>{p[ares.message]}</p>}
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="org-address">{p.address}</Label><Input id="org-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
      <div className="space-y-1.5"><Label htmlFor="org-city">{p.city}</Label><Input id="org-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
      <div className="grid grid-cols-2 gap-3"><div className="space-y-1.5"><Label htmlFor="org-zip">{p.zip}</Label><Input id="org-zip" value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} /></div><div className="space-y-1.5"><Label htmlFor="org-country">{p.country}</Label><Input id="org-country" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></div></div>
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor={`${formId}-notes`}>{p.notes}</Label><Textarea id={`${formId}-notes`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      {saveError && <div className="space-y-2 sm:col-span-2"><p className="text-sm text-risk" role="alert">{p[saveError]}</p>{saveError === "organizationChanged" && !readFailed && <Button type="button" variant="outline" disabled={reloading} onClick={() => void reloadOrganizations()}>{p.organizationReload}</Button>}</div>}
      <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:justify-end"><Button type="button" variant="ghost" onClick={() => navigate(() => { cancelDraftLookup(); draftIdentity.current = null; setForm(EMPTY_FORM); setVisited({ name: false, website: false, email: false }); setSaveError(null); setOpen(false); })}>{t.common.cancel}</Button><Button type="submit" disabled={!validForm || creating || ares.busy || pendingRows.size > 0} aria-busy={creating}>{p.create}</Button></div>
    </fieldset></form></CardContent></Card>}
    <div className="mb-4 grid gap-2 rounded-lg border border-border bg-surface-secondary p-2 sm:grid-cols-[minmax(0,1fr)_16rem]"><Input ref={searchControl} aria-label={p.searchClients} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={p.searchClients} /><SimpleSelect aria-label={p.allOrganizationTypes} value={typeFilter} onValueChange={(value) => setTypeFilter(value as OrganizationType | "all")} options={[{ value: "all", label: p.allOrganizationTypes }, ...TYPES.map((type) => ({ value: type, label: statusLabel(type, lang) }))]} /></div>
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
      const website = safeWebUrl(org.website);
      const vatStatus = vatStatusOf(org);
      const vatIsFresh = vatCheckIsFresh(org, new Date());
      const canVerifyVat = isEuVatId(org.vat_id);
      const canFillFromAres = isValidIco(org.company_id);
      return <article key={org.id} className="border-b border-border last:border-0"><div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 p-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,.8fr)_auto]"><button type="button" onClick={() => setExpandedId(expanded ? null : org.id)} aria-expanded={expanded} aria-label={`${p.showRelationship}: ${org.name}`} className="min-h-11 min-w-0 text-left focus-ring"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-sm font-semibold">{org.name}</h2><EntityBadge>{statusLabel(org.type, lang)}</EntityBadge><StatusBadge value={org.status} /></div>{(org.email || org.website) && <p className="mt-1 break-words text-xs text-foreground-muted">{org.email ?? org.website}</p>}</button><div className="col-start-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-foreground-muted lg:col-start-2 lg:row-start-1">{counts.projects + counts.opportunities + counts.invoices === 0 ? <span>{p.noRelatedRecords}</span> : [[p.projects, counts.projects], [p.opportunities, counts.opportunities], [p.invoices, counts.invoices]].filter(([, count]) => Number(count) > 0).map(([label, count]) => <span key={label}><strong className="tabular text-foreground">{count}</strong> {label}</span>)}</div><div className="col-start-2 row-start-1 flex justify-end lg:col-start-3"><Button variant="ghost" size="icon-sm" ref={control => { if (control) deleteControls.current.set(org.id, control); else deleteControls.current.delete(org.id); }} aria-label={`${p.delete}: ${org.name}`} disabled={pendingRows.has(org.id)} onClick={() => void removeOrganization(org)}><Trash2 /></Button></div></div>
        {registryNotice?.id === org.id && <div className="space-y-2 px-3 pb-3"><p className={registryNotice.error ? "text-xs text-risk" : "text-xs text-foreground-muted"} role={registryNotice.error ? "alert" : "status"}>{p[registryNotice.key]}</p>{registryNotice.error && !readFailed && !(registryNotice.key === "aresNotFound" || registryNotice.key === "aresInvalidIco" || registryNotice.key === "vatNotEu") && <Button variant="outline" disabled={reloading || pendingRows.size > 0} onClick={() => void reloadOrganizations()}>{p.organizationReload}</Button>}</div>}
        {expanded && <div className="grid gap-4 border-t border-border bg-surface-inset p-4 lg:grid-cols-[minmax(14rem,.65fr)_minmax(0,1.35fr)]"><div className="min-w-0 space-y-2">{org.email && <a href={`mailto:${org.email}`} className="block break-words text-sm underline">{org.email}</a>}{org.website && (website ? <a href={website} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 text-sm underline"><span className="min-w-0 [overflow-wrap:anywhere]">{org.website}</span><ExternalLink className="h-3 w-3 shrink-0" /></a> : <p className="text-sm [overflow-wrap:anywhere]">{org.website}</p>)}{org.notes && <p className="whitespace-pre-wrap text-sm text-foreground-muted [overflow-wrap:anywhere]">{org.notes}</p>}{relatedInvoices.length > 0 && <p className="pt-2 text-xs font-medium tabular">{p.totalInvoiced}: {formatCurrency(invoiceTotal, displayCurrency)}</p>}
          <div className="space-y-2 border-t border-border pt-2">
            {org.company_id && <p className="break-words text-xs tabular text-foreground-muted">{p.companyId}: {org.company_id}{org.ares_verified_at ? ` · ${p.aresFilledOn} ${formatCheckedAt(org.ares_verified_at)}` : ""}</p>}
            {org.company_id && !canFillFromAres && <p className="text-xs text-foreground-muted">{p.aresUnsupported}</p>}
            {org.vat_id && <div className="flex flex-wrap items-center gap-2"><span className="break-all text-xs tabular text-foreground-muted">{p.vatId}: {org.vat_id}</span><StatusBadge value={`vat_${vatStatus}`} />{org.vat_verified_at && <span className="text-xs tabular text-foreground-muted">{p.vatVerifiedOn} {formatCheckedAt(org.vat_verified_at)}</span>}</div>}
            {org.vat_id && !canVerifyVat && <p className="text-xs text-foreground-muted">{p.vatNotEu}</p>}
            {canVerifyVat && vatStatus === "unchecked" && <p className="text-xs text-foreground-muted">{p.vatNeverVerified}</p>}
            {(canFillFromAres || canVerifyVat) && <div className="flex flex-wrap gap-2 pt-1">
              {canFillFromAres && <Button variant="outline" size="sm" disabled={pendingRows.has(org.id)} aria-label={`${p.fillFromAres}: ${org.name}`} onClick={() => void runRegistry(org, "ares")}><Building2 />{p.fillFromAres}</Button>}
              {canVerifyVat && <Button variant={vatIsFresh ? "ghost" : "outline"} size="sm" disabled={pendingRows.has(org.id)} aria-label={`${vatIsFresh ? p.recheckVat : p.verifyVat}: ${org.name}`} onClick={() => void runRegistry(org, "vies", vatIsFresh)}><ShieldCheck />{vatIsFresh ? p.recheckVat : p.verifyVat}</Button>}
            </div>}
            {vatNameMismatch(org.name, org.vat_verified_name) && <p className="break-words text-xs text-warning">{p.vatRegisteredAs}: {org.vat_verified_name}</p>}

          </div></div><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">{p.relatedWork}</p><ul className="mt-2 divide-y divide-border text-xs text-foreground-muted">{relatedProjects.map((item) => <li key={item.id} className="break-words py-1.5"><Link className="font-medium text-foreground underline" href={`/projects/${encodeURIComponent(item.slug)}`} prefetch={false}>{item.name}</Link></li>)}{relatedOpportunities.map((item) => <li key={item.id} className="flex items-center justify-between gap-2 py-1.5"><span className="min-w-0 break-words">{p.opportunity}: {item.title}</span><StatusBadge value={item.status} /></li>)}{relatedInvoices.map((item) => <li key={item.id} className="flex items-center justify-between gap-2 py-1.5"><span>{p.invoices}: {item.number}</span><StatusBadge value={item.status} /></li>)}{relatedTodos.slice(0, 3).map((item) => <li key={item.id} className="break-words py-1.5">{p.task}: {item.title}</li>)}{relatedNotes.slice(0, 3).map((item) => <li key={item.id} className="break-words py-1.5">{p.note}: {item.title}</li>)}{relatedDates.slice(0, 3).map((item) => <li key={item.id} className="py-1.5 tabular">{item.the_date}: {item.title}</li>)}</ul></div></div>}
      </article>;
    })}</div>}
  </div>;
}
