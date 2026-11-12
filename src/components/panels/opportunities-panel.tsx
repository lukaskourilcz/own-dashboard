"use client";

import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Copy, ExternalLink, Mail, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { SimpleSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useLang } from "@/lib/i18n";
import { leads as strings } from "@/lib/i18n/sections/leads";
import { qk } from "@/lib/queries/keys";
import {
  DEFAULT_LEAD_FILTER,
  LEAD_OUTREACH_STATUSES,
  LEAD_PAGE_SIZE,
  LEAD_REGIONS,
  LEAD_TEMPLATE_VARIABLES,
  fetchLeadContacts,
  fetchLeadTemplate,
  fetchLeadTrades,
  leadMailto,
  leadSearchTerm,
  leadTemplateValues,
  renderLeadTemplate,
  safeLeadUrl,
  saveLeadTemplate,
  updateLeadContact,
  type LeadContact,
  type LeadFilter,
  type LeadOutreachStatus,
  type LeadSort,
  type LeadTemplate,
  type LeadTrade,
} from "@/lib/leads";
import { cn } from "@/lib/utils";

type Strings = typeof strings.en;

/* Preview data: /dev-preview never calls Supabase. Fictional people and domains. ------------------------------- */

const PREVIEW_TRADE: LeadTrade = { id: "00000000-0000-4000-8000-00000000a001", slug: "hodinovy-manzel", name: "Hodinový manžel", sort_order: 0 };
const previewContact = (index: number, fields: Partial<LeadContact> & Pick<LeadContact, "name" | "email">): LeadContact => ({
  id: `00000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`, trade_id: PREVIEW_TRADE.id,
  email_source_url: "https://www.firmy.cz/detail/0000-ukazka.html", phone: null, website: null, form_status: null,
  quality_score: null, quality_reason: null, activity: "drobné opravy", city: null, region: null, ico: null,
  source: "firmy.cz", source_url: "https://www.firmy.cz/detail/0000-ukazka.html", other_profiles: [],
  collected_at: "2026-11-12", outreach_status: "new", last_contacted_at: null, note: "", updated_at: "2026-11-12T10:00:00.000Z",
  ...fields,
});
export const PREVIEW_LEAD_CONTACTS: LeadContact[] = [
  previewContact(1, { name: "Jan Novák – hodinový manžel", email: "jan.novak@example.cz", phone: "+420602000001", website: "https://hodinovy-manzel-novak.example.cz", form_status: "contact_form", quality_score: 4, quality_reason: "Na mobilu se rozpadá menu, chybí ceník, titulek stránky je „Úvod“.", activity: "drobné opravy, montáž nábytku, elektro", city: "Plzeň", region: "Plzeňský kraj", ico: "00000001" }),
  previewContact(2, { name: "Opravy Dvořák", email: "opravy.dvorak@example.com", activity: "údržba domů a zahrad, sekání trávy", city: "Brno", region: "Jihomoravský kraj", source: "bazos.cz", email_source_url: "https://www.bazos.cz/inzerat/0000/ukazka.php" }),
  previewContact(3, { name: "Kutil Praha", email: "kutil@kutil-praha.example.cz", website: "https://kutil-praha.example.cz", form_status: "none", quality_score: 7, quality_reason: "Čistý web s ceníkem, chybí jen objednání termínu.", activity: "montáž nábytku, vrtání, věšení polic", city: "Praha 6", region: "Hlavní město Praha", ico: "00000003", outreach_status: "contacted", last_contacted_at: "2026-11-10T09:00:00.000Z", email_source_url: "https://kutil-praha.example.cz/kontakt" }),
  previewContact(4, { name: "Petr Svoboda, zámečnictví a drobné opravy v domácnosti pro celý okres Frýdek-Místek", email: "petr.svoboda.opravy@example.com", activity: "zámečnické práce, výměna zámků, opravy kování oken a dveří, montáž polic a kuchyňských linek", city: "Frýdek-Místek", region: "Moravskoslezský kraj", outreach_status: "replied", note: "Volat po 17:00." }),
  previewContact(5, { name: "Údržba Hora", email: "hora@udrzba-hora.example.cz", website: "https://udrzba-hora.example.cz", form_status: "none", quality_score: 2, quality_reason: "Stránka běží bez HTTPS, na mobilu je text nečitelný a kontakt je až v patičce.", activity: "malování, drobné zednické práce", city: "Liberec", region: "Liberecký kraj" }),
  previewContact(6, { name: "Martin Král", email: "martin.kral@example.com", activity: "montáž nábytku", city: "Olomouc", region: "Olomoucký kraj", outreach_status: "do_not_contact", note: "Nechce nabídky." }),
];
const PREVIEW_TEMPLATE: LeadTemplate = {
  id: "00000000-0000-4000-8000-00000000a101", trade_id: PREVIEW_TRADE.id, updated_at: "2026-11-12T10:00:00.000Z",
  subject: "{{jmeno}}: web s objednáním termínu",
  body: "Dobrý den,\n\njmenuji se Lukáš Kouřil a dělám weby pro živnostníky.\n\n{{#web}}Prošel jsem si váš web {{web}}. {{duvod}} Termín si na něm zákazník objednat nemůže.{{/web}}{{^web}}Vlastní web jsem k vám nenašel. Kdo hledá hodinového manžela na Googlu, najde vás jen v katalogu vedle konkurence.{{/web}}\n\nUdělám vám web, na kterém si zákazník sám vybere termín a pošle vám, co potřebuje opravit. Nastavím ho tak, aby vás lidé z okolí našli na Googlu.\n\nVáš e-mail jsem našel na {{zdroj_url}}.\n\nJestli o to nestojíte, stačí odpovědět „ne“ a už se neozvu.\n\nLukáš Kouřil\nukazka@example.com\nIČO: [doplnit]",
};

/** The same filter and order the database applies, for the preview's local rows. */
function filterPreview(rows: LeadContact[], filter: LeadFilter, page: number) {
  const term = leadSearchTerm(filter.search).toLocaleLowerCase("cs");
  const matched = rows.filter((row) =>
    (!term || [row.name, row.email, row.activity, row.city ?? "", row.website ?? ""].some((value) => value.toLocaleLowerCase("cs").includes(term))) &&
    (filter.region === "all" || (filter.region === "unknown" ? row.region === null : row.region === filter.region)) &&
    (filter.status === "all" || (filter.status === "active" ? !["not_interested", "do_not_contact"].includes(row.outreach_status) : row.outreach_status === filter.status)) &&
    (filter.website === "all" || (filter.website === "without") === (row.website === null)),
  ).sort((a, b) => {
    if (filter.sort === "quality_asc" || filter.sort === "quality_desc") {
      if (a.quality_score !== b.quality_score) {
        if (a.quality_score === null) return 1;
        if (b.quality_score === null) return -1;
        return filter.sort === "quality_asc" ? a.quality_score - b.quality_score : b.quality_score - a.quality_score;
      }
    } else if (filter.sort === "newest" && a.collected_at !== b.collected_at) return b.collected_at.localeCompare(a.collected_at);
    return a.name.localeCompare(b.name, "cs");
  });
  return { rows: matched.slice(page * LEAD_PAGE_SIZE, (page + 1) * LEAD_PAGE_SIZE), total: matched.length };
}

/* Panel --------------------------------------------------------------------------------------------------------- */

export function OpportunitiesPanel({ isPreview = false }: { isPreview?: boolean }) {
  const { lang } = useLang();
  const t = strings[lang];
  const [view, setView] = useState<"contacts" | "emails">("contacts");
  const tradesQuery = useQuery({ queryKey: qk.leadTrades, queryFn: fetchLeadTrades, enabled: !isPreview, staleTime: 5 * 60_000 });
  const trades = isPreview ? [PREVIEW_TRADE] : tradesQuery.data ?? [];
  const [chosenTradeId, setTradeId] = useState<string | null>(null);
  const trade = trades.find((item) => item.id === chosenTradeId) ?? trades[0] ?? null;
  const [previewContacts, setPreviewContacts] = useState(PREVIEW_LEAD_CONTACTS);
  const [previewTemplate, setPreviewTemplate] = useState(PREVIEW_TEMPLATE);
  const templateQuery = useQuery({ queryKey: [...qk.leadTemplate, trade?.id], queryFn: () => fetchLeadTemplate(trade!.id), enabled: !isPreview && Boolean(trade), staleTime: 60_000 });
  const template = isPreview ? previewTemplate : templateQuery.data ?? null;

  const viewButton = (value: typeof view, label: string) => (
    <Button variant={view === value ? "default" : "outline"} aria-pressed={view === value} onClick={() => setView(value)}>{label}</Button>
  );

  return <section className="min-w-0" data-testid="opportunities-panel">
    <PageHeader title={t.title} description={t.description} />
    {!isPreview && tradesQuery.isPending ? <p role="status" className="text-sm text-foreground-muted">{t.loadingTrades}</p>
      : !isPreview && tradesQuery.isError ? <div role="alert" className="space-y-2"><p className="text-sm text-risk">{t.tradesUnavailable}</p><Button variant="outline" onClick={() => void tradesQuery.refetch()}>{t.retry}</Button></div>
      : !trade ? <EmptyState icon={Users} title={t.noTrades} description={t.noTradesHint} />
      : <>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <label className="grid gap-1 text-xs font-medium text-foreground-muted">{t.trade}
            <SimpleSelect aria-label={t.trade} className="w-full sm:w-64" value={trade.id} onValueChange={setTradeId} options={trades.map((item) => ({ value: item.id, label: item.name }))} />
          </label>
          <div className="flex gap-2" role="group" aria-label={t.views}>{viewButton("contacts", t.contacts)}{viewButton("emails", t.emails)}</div>
        </div>
        {isPreview && <p className="mb-3 text-xs text-foreground-muted">{t.previewOnly}</p>}
        {view === "contacts"
          ? <ContactsView key={trade.id} t={t} lang={lang} trade={trade} isPreview={isPreview} template={template} templateMissing={!isPreview && templateQuery.isSuccess && !template}
              previewContacts={previewContacts} setPreviewContacts={setPreviewContacts} />
          : <EmailsView key={trade.id} t={t} lang={lang} trade={trade} isPreview={isPreview} template={template} templateQuery={templateQuery}
              previewContacts={previewContacts} onPreviewSave={(value) => setPreviewTemplate((old) => ({ ...old, ...value, updated_at: new Date().toISOString() }))} />}
      </>}
  </section>;
}

/* Contacts ------------------------------------------------------------------------------------------------------ */

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setDebounced(value), ms); return () => clearTimeout(timer); }, [value, ms]);
  return debounced;
}

function ContactsView({ t, lang, trade, isPreview, template, templateMissing, previewContacts, setPreviewContacts }: {
  t: Strings; lang: "en" | "cs"; trade: LeadTrade; isPreview: boolean; template: LeadTemplate | null; templateMissing: boolean;
  previewContacts: LeadContact[]; setPreviewContacts: (update: (old: LeadContact[]) => LeadContact[]) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<LeadFilter>(DEFAULT_LEAD_FILTER);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput, 300);
  const [page, setPage] = useState(0);
  const effective = useMemo(() => ({ ...filter, search }), [filter, search]);
  const key = [...qk.leadContacts, trade.id, effective, page] as const;
  const query = useQuery({ queryKey: key, queryFn: () => fetchLeadContacts(trade.id, effective, page), enabled: !isPreview, placeholderData: keepPreviousData, staleTime: 30_000 });
  const result = isPreview ? filterPreview(previewContacts, effective, page) : query.data;
  const [detailId, setDetailId] = useState<string | null>(null);
  const [composeId, setComposeId] = useState<string | null>(null);
  const rows = result?.rows ?? [];
  const lookup = (id: string | null) => (isPreview ? previewContacts : rows).find((row) => row.id === id) ?? null;

  const update = useMutation({
    mutationFn: ({ id, change }: { id: string; change: { outreach_status?: LeadOutreachStatus; note?: string } }) => updateLeadContact(id, change),
    onSuccess: (row) => {
      queryClient.setQueryData<{ rows: LeadContact[]; total: number }>(key, (old) => old && { ...old, rows: old.rows.map((item) => item.id === row.id ? row : item) });
      void queryClient.invalidateQueries({ queryKey: [...qk.leadContacts, trade.id] });
    },
    onError: () => toast.err(t.saveFailed),
  });
  const change = (id: string, value: { outreach_status?: LeadOutreachStatus; note?: string }) => {
    if (isPreview) {
      setPreviewContacts((old) => old.map((row) => row.id !== id ? row : {
        ...row, ...value,
        last_contacted_at: value.outreach_status === "contacted" && row.outreach_status !== "contacted" ? new Date().toISOString() : row.last_contacted_at,
      }));
      return Promise.resolve();
    }
    return update.mutateAsync({ id, change: value }).then(() => undefined);
  };
  const setFilterPart = (part: Partial<LeadFilter>) => { setFilter((old) => ({ ...old, ...part })); setPage(0); };

  const statusOptions = LEAD_OUTREACH_STATUSES.map((status) => ({ value: status, label: t.statuses[status] }));
  const filtersActive = searchInput !== "" || filter.region !== "all" || filter.status !== DEFAULT_LEAD_FILTER.status || filter.website !== "all";
  const total = result?.total ?? 0;
  const from = total === 0 ? 0 : page * LEAD_PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * LEAD_PAGE_SIZE);
  const lastPage = Math.max(0, Math.ceil(total / LEAD_PAGE_SIZE) - 1);

  const websiteCell = (row: LeadContact) => {
    const url = safeLeadUrl(row.website);
    return url
      ? <a href={url} target="_blank" rel="noreferrer" title={url} className="focus-ring inline-flex min-h-11 max-w-full items-center gap-1 text-sm underline underline-offset-2 hover:no-underline xl:min-h-0"><span className="truncate">{url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "")}</span><ExternalLink className="h-3 w-3 shrink-0" aria-hidden /></a>
      : <span className="inline-block text-3xl font-bold leading-none text-risk" title={t.noWebsite}><span aria-hidden>–</span><span className="sr-only">{t.noWebsite}</span></span>;
  };
  const qualityCell = (row: LeadContact) => row.quality_score === null ? null
    : <span className={cn("tabular-nums text-sm font-semibold", row.quality_score <= 3 ? "text-risk" : row.quality_score <= 6 ? "text-warning" : "text-foreground")} title={row.quality_reason ?? undefined}>
        <span aria-hidden>{row.quality_score}</span><span className="sr-only">{t.qualityOutOf(row.quality_score)}</span>
      </span>;
  const place = (row: LeadContact) => [row.city, row.region].filter(Boolean).join(" · ");
  const statusSelect = (row: LeadContact, className?: string) => (
    <SimpleSelect aria-label={t.statusOf(row.name)} className={className} value={row.outreach_status} onValueChange={(value) => void change(row.id, { outreach_status: value as LeadOutreachStatus })} options={statusOptions} />
  );
  const writeButton = (row: LeadContact) => (
    <Button variant="outline" size="sm" aria-label={t.writeTo(row.name)} onClick={() => setComposeId(row.id)} disabled={row.outreach_status === "do_not_contact"}><Mail aria-hidden />{t.write}</Button>
  );

  return <>
    <div className="mb-3 grid gap-2 rounded-lg border border-border bg-surface-secondary p-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))]">
      <Input aria-label={t.search} placeholder={t.search} value={searchInput} onChange={(event) => { setSearchInput(event.target.value); setPage(0); }} className="sm:col-span-2 xl:col-span-1" />
      <SimpleSelect aria-label={t.region} value={filter.region} onValueChange={(region) => setFilterPart({ region })} options={[{ value: "all", label: t.allRegions }, ...LEAD_REGIONS.map((region) => ({ value: region, label: region })), { value: "unknown", label: t.unknownRegion }]} />
      <SimpleSelect aria-label={t.status} value={filter.status} onValueChange={(status) => setFilterPart({ status: status as LeadFilter["status"] })} options={[{ value: "active", label: t.activeStatuses }, { value: "all", label: t.allStatuses }, ...statusOptions]} />
      <SimpleSelect aria-label={t.website} value={filter.website} onValueChange={(website) => setFilterPart({ website: website as LeadFilter["website"] })} options={[{ value: "all", label: t.allWebsites }, { value: "without", label: t.withoutWebsite }, { value: "with", label: t.withWebsite }]} />
      <SimpleSelect aria-label={t.sort} value={filter.sort} onValueChange={(sort) => setFilterPart({ sort: sort as LeadSort })} options={(["name", "quality_asc", "quality_desc", "newest"] as const).map((sort) => ({ value: sort, label: t.sorts[sort] }))} />
    </div>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs tabular-nums text-foreground-muted" aria-live="polite">{result ? t.count(from, to, total) : ""}</p>
      {filtersActive && <Button variant="ghost" size="sm" onClick={() => { setSearchInput(""); setFilter((old) => ({ ...DEFAULT_LEAD_FILTER, sort: old.sort })); setPage(0); }}>{t.clearFilters}</Button>}
    </div>
    {!isPreview && query.isPending ? <p role="status" className="text-sm text-foreground-muted">{t.loading}</p>
      : !isPreview && query.isError && !query.data ? <div role="alert" className="space-y-2"><p className="text-sm text-risk">{t.unavailable}</p><Button variant="outline" onClick={() => void query.refetch()}>{t.retry}</Button></div>
      : total === 0 && !filtersActive ? <EmptyState icon={Users} title={t.empty} description={t.emptyHint} />
      : total === 0 ? <p className="py-6 text-sm text-foreground-muted">{t.noMatch}</p>
      : <>
        <div className={cn("hidden overflow-x-auto rounded-lg border border-border bg-surface xl:block", query.isPlaceholderData && "opacity-60")}>
          <table className="w-full min-w-[60rem] text-left text-sm">
            <thead className="border-b border-border text-xs text-foreground-muted">
              <tr>
                <th scope="col" className="w-[21%] px-3 py-2 font-medium">{t.columns.name}</th>
                <th scope="col" className="w-[19%] px-3 py-2 font-medium">{t.columns.email}</th>
                <th scope="col" className="w-[15%] px-3 py-2 font-medium">{t.columns.website}</th>
                <th scope="col" className="min-w-48 px-3 py-2 font-medium">{t.columns.activity}</th>
                <th scope="col" className="w-20 px-2 py-2 text-right font-medium">{t.columns.quality}</th>
                <th scope="col" className="w-36 px-2 py-2 font-medium">{t.columns.status}</th>
                <th scope="col" className="w-24 px-2 py-2"><span className="sr-only">{t.columns.actions}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => <tr key={row.id} className="border-b border-border align-top last:border-0">
                <td className="px-3 py-2">
                  <button type="button" className="focus-ring text-left font-medium break-words hover:underline" aria-label={t.details(row.name)} onClick={() => setDetailId(row.id)}>{row.name}</button>
                  {place(row) && <p className="mt-0.5 text-xs text-foreground-muted">{place(row)}</p>}
                </td>
                <td className="px-3 py-2 break-all"><span className="font-mono text-xs">{row.email}</span></td>
                <td className="max-w-0 px-3 py-2">{websiteCell(row)}</td>
                <td className="px-3 py-2 text-xs text-foreground-muted"><span className="line-clamp-3">{row.activity}</span></td>
                <td className="px-2 py-2 text-right">{qualityCell(row)}</td>
                <td className="px-2 py-2">{statusSelect(row, "w-full")}</td>
                <td className="px-2 py-2 text-right">{writeButton(row)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <ul className={cn("grid gap-2 sm:grid-cols-2 xl:hidden", query.isPlaceholderData && "opacity-60")} aria-label={t.contacts}>
          {rows.map((row) => <li key={row.id}>
            <Card className="h-full space-y-2 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <button type="button" className="focus-ring min-h-11 text-left text-sm font-medium break-words hover:underline" aria-label={t.details(row.name)} onClick={() => setDetailId(row.id)}>{row.name}</button>
                  {place(row) && <p className="text-xs text-foreground-muted">{place(row)}</p>}
                </div>
                {qualityCell(row)}
              </div>
              <p className="font-mono text-xs break-all">{row.email}</p>
              <div>{websiteCell(row)}</div>
              {row.activity && <p className="text-xs text-foreground-muted">{row.activity}</p>}
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">{statusSelect(row, "w-full")}{writeButton(row)}</div>
            </Card>
          </li>)}
        </ul>
        {total > LEAD_PAGE_SIZE && <nav className="mt-3 flex items-center justify-end gap-2" aria-label={t.contacts}>
          <Button variant="outline" size="icon" aria-label={t.previous} disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}><ChevronLeft aria-hidden /></Button>
          <span className="text-xs tabular-nums text-foreground-muted">{page + 1} / {lastPage + 1}</span>
          <Button variant="outline" size="icon" aria-label={t.next} disabled={page >= lastPage} onClick={() => setPage((value) => Math.min(lastPage, value + 1))}><ChevronRight aria-hidden /></Button>
        </nav>}
      </>}
    {lookup(detailId) && <ContactDetail t={t} lang={lang} contact={lookup(detailId)!} onClose={() => setDetailId(null)} onWrite={() => { setComposeId(detailId); setDetailId(null); }}
      onSaveNote={(note) => change(detailId!, { note })} statusSelect={statusSelect(lookup(detailId)!, "w-full sm:w-56")} />}
    {lookup(composeId) && <ComposeDialog t={t} contact={lookup(composeId)!} template={template} templateMissing={templateMissing} isPreview={isPreview}
      onClose={() => setComposeId(null)} onContacted={() => change(composeId!, { outreach_status: "contacted" })} />}
  </>;
}

function formatDate(iso: string | null, lang: "en" | "cs", withTime = false): string | null {
  if (!iso) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return new Intl.DateTimeFormat(lang === "cs" ? "cs-CZ" : "en-GB", { dateStyle: "medium", ...(withTime ? { timeStyle: "short" } : {}), timeZone: "Europe/Prague" }).format(date);
}

function ContactDetail({ t, lang, contact, onClose, onWrite, onSaveNote, statusSelect }: {
  t: Strings; lang: "en" | "cs"; contact: LeadContact; onClose: () => void; onWrite: () => void; onSaveNote: (note: string) => Promise<void>; statusSelect: React.ReactNode;
}) {
  const [note, setNote] = useState(contact.note);
  const [saving, setSaving] = useState(false);
  const link = (url: string | null) => { const safe = safeLeadUrl(url); return safe ? <a href={safe} target="_blank" rel="noreferrer" className="focus-ring break-all underline underline-offset-2 hover:no-underline">{safe}</a> : null; };
  const rows: [string, React.ReactNode][] = [
    [t.columns.email, <span key="e" className="font-mono text-xs break-all">{contact.email}</span>],
    [t.phone, contact.phone ? <a key="p" className="focus-ring tabular-nums underline underline-offset-2" href={`tel:${contact.phone}`}>{contact.phone}</a> : null],
    [t.website, link(contact.website) ?? <span key="w" className="text-2xl font-semibold leading-none text-risk"><span aria-hidden>–</span><span className="sr-only">{t.noWebsite}</span></span>],
    [t.formLabel, contact.form_status ? t.formStatus[contact.form_status] : null],
    [t.columns.quality, contact.quality_score === null ? null : `${t.qualityOutOf(contact.quality_score)}${contact.quality_reason ? `. ${contact.quality_reason}` : ""}`],
    [t.columns.activity, contact.activity || null],
    [t.city, [contact.city, contact.region].filter(Boolean).join(" · ") || null],
    [t.ico, contact.ico ? <span key="i" className="tabular-nums">{contact.ico}</span> : null],
    [t.emailSource, link(contact.email_source_url)],
    [t.source, contact.source_url ? <span key="s">{contact.source} · {link(contact.source_url)}</span> : contact.source],
    [t.otherProfiles, contact.other_profiles.length ? <span key="o" className="grid gap-1">{contact.other_profiles.map((url) => <span key={url}>{link(url) ?? url}</span>)}</span> : null],
    [t.collectedAt, formatDate(contact.collected_at, lang)],
    [t.lastContacted, formatDate(contact.last_contacted_at, lang, true) ?? t.never],
  ];
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-w-2xl">
      <DialogHeader><DialogTitle className="break-words">{contact.name}</DialogTitle><DialogDescription>{t.statuses[contact.outreach_status]}</DialogDescription></DialogHeader>
      {contact.outreach_status === "do_not_contact" && <p role="note" className="rounded-md border border-risk/40 bg-risk-soft p-2 text-sm">{t.doNotContactWarning}</p>}
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[11rem_minmax(0,1fr)]">
        {rows.filter(([, value]) => value !== null && value !== "").map(([label, value]) => <div key={label} className="contents"><dt className="text-xs text-foreground-muted sm:pt-0.5">{label}</dt><dd className="min-w-0 break-words">{value}</dd></div>)}
      </dl>
      <div className="grid gap-1.5"><Label>{t.status}</Label>{statusSelect}</div>
      <div className="grid gap-1.5">
        <Label htmlFor={`lead-note-${contact.id}`}>{t.note}</Label>
        <Textarea id={`lead-note-${contact.id}`} value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={5000} />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>{t.close}</Button>
        <Button variant="outline" disabled={note === contact.note || saving} onClick={() => { setSaving(true); void onSaveNote(note).finally(() => setSaving(false)); }}>{saving ? t.saving : t.saveNote}</Button>
        <Button onClick={onWrite} disabled={contact.outreach_status === "do_not_contact"}><Mail aria-hidden />{t.write}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

async function copyText(value: string, toast: ReturnType<typeof useToast>, t: Strings) {
  try { await navigator.clipboard.writeText(value); toast.ok(t.copied); } catch { toast.err(t.copyFailed); }
}

function ComposeDialog({ t, contact, template, templateMissing, isPreview, onClose, onContacted }: {
  t: Strings; contact: LeadContact; template: LeadTemplate | null; templateMissing: boolean; isPreview: boolean; onClose: () => void; onContacted: () => Promise<void>;
}) {
  const toast = useToast();
  const values = leadTemplateValues(contact);
  const subject = template ? renderLeadTemplate(template.subject, values).text : "";
  const body = template ? renderLeadTemplate(template.body, values).text : "";
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-w-2xl">
      <DialogHeader><DialogTitle>{t.composeTitle}</DialogTitle><DialogDescription>{t.composeHelp}</DialogDescription></DialogHeader>
      {!template ? <p role={templateMissing ? "alert" : "status"} className="text-sm text-foreground-muted">{templateMissing ? t.noTemplate : t.loadingTemplate}</p> : <div className="grid min-w-0 gap-3 [&>div]:min-w-0">
        <div><p className="text-xs text-foreground-muted">{t.columns.email}</p><p className="font-mono text-xs break-all">{contact.email}</p></div>
        <div><p className="text-xs text-foreground-muted">{t.subject}</p><p className="text-sm font-medium break-words" data-testid="lead-compose-subject">{subject}</p></div>
        <div><p className="text-xs text-foreground-muted">{t.body}</p><div className="max-h-[45dvh] overflow-y-auto whitespace-pre-wrap rounded-md border [overflow-wrap:anywhere] border-border bg-surface-inset p-3 text-sm" data-testid="lead-compose-body">{body}</div></div>
      </div>}
      <DialogFooter className="flex-wrap">
        {!template && <Button variant="outline" onClick={onClose}>{t.close}</Button>}
        {template && <>
          <Button variant="outline" onClick={() => void copyText(subject, toast, t)}><Copy aria-hidden />{t.copySubject}</Button>
          <Button variant="outline" onClick={() => void copyText(body, toast, t)}><Copy aria-hidden />{t.copyBody}</Button>
          {contact.outreach_status === "new" && <Button variant="outline" onClick={() => void onContacted().then(() => toast.ok(t.saved))}>{t.markContacted}</Button>}
          <Button asChild><a href={leadMailto(contact.email, subject, body)} onClick={(event) => { if (isPreview) event.preventDefault(); }}><Mail aria-hidden />{t.openInMail}</a></Button>
        </>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

/* Emails -------------------------------------------------------------------------------------------------------- */

function EmailsView({ t, lang, trade, isPreview, template, templateQuery, previewContacts, onPreviewSave }: {
  t: Strings; lang: "en" | "cs"; trade: LeadTrade; isPreview: boolean; template: LeadTemplate | null;
  templateQuery: { isPending: boolean; isError: boolean; refetch: () => unknown };
  previewContacts: LeadContact[]; onPreviewSave: (value: { subject: string; body: string }) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null);
  const subject = draft?.subject ?? template?.subject ?? "";
  const body = draft?.body ?? template?.body ?? "";
  const dirty = draft !== null && (draft.subject !== (template?.subject ?? "") || draft.body !== (template?.body ?? ""));
  // Sample contacts for the preview: one with a website, one without, from the first page.
  const sampleQuery = useQuery({ queryKey: [...qk.leadContacts, trade.id, "samples"], queryFn: async () => {
    const [withSite, withoutSite] = await Promise.all([
      fetchLeadContacts(trade.id, { ...DEFAULT_LEAD_FILTER, website: "with", status: "all" }, 0),
      fetchLeadContacts(trade.id, { ...DEFAULT_LEAD_FILTER, website: "without", status: "all" }, 0),
    ]);
    return [...withSite.rows.slice(0, 10), ...withoutSite.rows.slice(0, 10)];
  }, enabled: !isPreview, staleTime: 60_000 });
  const samples = isPreview ? previewContacts : sampleQuery.data ?? [];
  const [sampleId, setSampleId] = useState<string | null>(null);
  const sample = samples.find((row) => row.id === sampleId) ?? samples[0] ?? null;
  const renderedSubject = sample ? renderLeadTemplate(subject, leadTemplateValues(sample)) : null;
  const renderedBody = sample ? renderLeadTemplate(body, leadTemplateValues(sample)) : null;
  const unknown = [...new Set([...(renderedSubject?.unknown ?? []), ...(renderedBody?.unknown ?? []), ...renderLeadTemplate(`${subject}\n${body}`, Object.fromEntries(LEAD_TEMPLATE_VARIABLES.map((name) => [name, ""]))).unknown])];

  const save = useMutation({
    mutationFn: () => saveLeadTemplate(trade.id, template?.id ?? null, { subject, body }),
    onSuccess: (row) => { queryClient.setQueryData([...qk.leadTemplate, trade.id], row); setDraft(null); toast.ok(t.templateSaved); },
    onError: () => toast.err(t.saveFailed),
  });
  const onSave = () => { if (isPreview) { onPreviewSave({ subject, body }); setDraft(null); toast.ok(t.templateSaved); } else save.mutate(); };

  if (!isPreview && templateQuery.isPending) return <p role="status" className="text-sm text-foreground-muted">{t.loadingTemplate}</p>;
  if (!isPreview && templateQuery.isError) return <div role="alert" className="space-y-2"><p className="text-sm text-risk">{t.templateUnavailable}</p><Button variant="outline" onClick={() => void templateQuery.refetch()}>{t.retry}</Button></div>;

  return <div className="grid gap-4 xl:grid-cols-2">
    <Card><CardContent className="grid gap-3 p-4">
      <div><h2 className="text-sm font-semibold">{t.templateTitle}: {trade.name}</h2><p className="mt-1 text-xs text-foreground-muted">{t.templateHelp}</p></div>
      <div className="grid gap-1.5"><Label htmlFor="lead-template-subject">{t.subject}</Label><Input id="lead-template-subject" value={subject} maxLength={300} onChange={(event) => setDraft({ subject: event.target.value, body })} /></div>
      <div className="grid gap-1.5"><Label htmlFor="lead-template-body">{t.body}</Label><Textarea id="lead-template-body" value={body} rows={16} maxLength={10000} className="min-h-80 font-mono text-xs leading-relaxed" onChange={(event) => setDraft({ subject, body: event.target.value })} /></div>
      {unknown.length > 0 && <p role="alert" className="text-xs text-warning">{t.unknownVariables(unknown.map((name) => `{{${name}}}`).join(", "))}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onSave} disabled={!dirty || save.isPending || !subject.trim() || !body.trim()}>{save.isPending ? t.saving : t.saveTemplate}</Button>
        <p className="text-xs text-foreground-muted" aria-live="polite">{dirty ? t.unsaved : template ? t.updatedAt(formatDate(template.updated_at, lang, true) ?? "") : ""}</p>
      </div>
      <details className="text-xs text-foreground-muted">
        <summary className="focus-ring cursor-pointer py-2 font-medium text-foreground">{t.variables}</summary>
        <dl className="mt-1 grid gap-x-3 gap-y-1 sm:grid-cols-[8rem_minmax(0,1fr)]">
          {LEAD_TEMPLATE_VARIABLES.map((name) => <div key={name} className="contents"><dt className="font-mono text-foreground">{`{{${name}}}`}</dt><dd>{t.variableHelp[name]}</dd></div>)}
        </dl>
        <p className="mt-2">{t.sectionHelp}</p>
      </details>
    </CardContent></Card>
    <Card><CardContent className="grid content-start gap-3 p-4">
      <h2 className="text-sm font-semibold">{t.preview}</h2>
      {!sample ? <p className="text-sm text-foreground-muted">{!isPreview && sampleQuery.isPending ? t.loading : t.previewNoContacts}</p> : <>
        <label className="grid gap-1 text-xs font-medium text-foreground-muted">{t.previewFor}
          <SimpleSelect aria-label={t.previewFor} value={sample.id} onValueChange={setSampleId} options={samples.map((row) => ({ value: row.id, label: `${row.name}${row.website ? "" : ` (${t.noWebsite.toLocaleLowerCase(lang)})`}` }))} />
        </label>
        <div><p className="text-xs text-foreground-muted">{t.subject}</p><p className="text-sm font-medium break-words" data-testid="lead-template-preview-subject">{renderedSubject?.text}</p></div>
        <div><p className="text-xs text-foreground-muted">{t.body}</p><div className="whitespace-pre-wrap rounded-md border border-border bg-surface-inset p-3 text-sm [overflow-wrap:anywhere]" data-testid="lead-template-preview-body">{renderedBody?.text}</div></div>
      </>}
    </CardContent></Card>
  </div>;
}
