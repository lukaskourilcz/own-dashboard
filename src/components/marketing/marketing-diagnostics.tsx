"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { MarketingState } from "@/lib/marketing/client";

type Lang = "en" | "cs";
const copy = {
  en: {
    title: "Generation diagnostics", sample: "Latest loaded jobs, up to 100. Costs use recorded token usage and configured rates; billing may differ.",
    jobs: "Jobs in this sample", cost: "Known job cost estimates (USD)", unknown: "Unknown", unknownCosts: "Jobs without a recorded cost", empty: "No generation jobs recorded.",
    review: "Approval share at the first visible decision", reviewScope: "Revisions in the latest 100 review events. Earlier decisions may fall outside this sample.", revisions: "Reviewed revisions in this sample",
    unknownBrand: "Brand not recorded", dateUnknown: "Time not recorded", job: "Job", traceTitle: "Generation traces", trace: "Load trace", loading: "Loading trace…", open: "Open trace", traceError: "Trace unavailable. Try again later.", signIn: "Sign in again to open the trace.",
    publicationErrors: "Publication holds and errors", publication: "Publication", details: "Recorded code", attention: "This operation needs review.",
    status: { queued: "Queued", running: "Generating", review: "Ready for review", failed: "Failed", reconciliation: "Needs reconciliation", held: "Held", claimed: "Publishing", published: "Published", cancelled: "Cancelled" },
    source: "The source is unavailable or changed. Refresh it before generating.", template: "The template needs approval or changed.", account: "Verify the publishing account.", consent: "Owner consent is required.", configuration: "Configure the provider and rates.", budget: "The generation budget was exceeded.", invalidCopy: "Generated copy failed validation.", overflow: "The source does not fit the approved layout.", provider: "Generation did not finish. Review the job before retrying.", lease: "Execution is uncertain. Reconcile it before retrying.", asset: "The final media could not be verified.", pending: "The platform is still processing the media.", approval: "Exact owner approval is required.",
  },
  cs: {
    title: "Diagnostika generování", sample: "Poslední načtené úlohy, nejvýše 100. Odhad nákladů používá zaznamenané tokeny a nastavené sazby; vyúčtování se může lišit.",
    jobs: "Úlohy v tomto vzorku", cost: "Známé odhady nákladů úloh (USD)", unknown: "Neznámé", unknownCosts: "Úlohy bez zaznamenané ceny", empty: "Zatím nejsou zaznamenané úlohy generování.",
    review: "Podíl schválení při prvním viditelném rozhodnutí", reviewScope: "Revize v posledních 100 událostech kontroly. Starší rozhodnutí mohou být mimo tento vzorek.", revisions: "Zkontrolované revize v tomto vzorku",
    unknownBrand: "Značka není zaznamenaná", dateUnknown: "Čas není zaznamenaný", job: "Úloha", traceTitle: "Záznamy generování", trace: "Načíst záznam", loading: "Načítání záznamu…", open: "Otevřít záznam", traceError: "Záznam není dostupný. Zkuste to později.", signIn: "Pro otevření záznamu se znovu přihlaste.",
    publicationErrors: "Pozastavená a chybná publikování", publication: "Publikování", details: "Zaznamenaný kód", attention: "Tato operace potřebuje kontrolu.",
    status: { queued: "Ve frontě", running: "Generuje se", review: "Ke kontrole", failed: "Chyba", reconciliation: "Nutné ověření výsledku", held: "Pozastaveno", claimed: "Publikuje se", published: "Publikováno", cancelled: "Zrušeno" },
    source: "Zdroj není dostupný nebo se změnil. Před generováním ho obnovte.", template: "Šablona potřebuje schválení nebo se změnila.", account: "Ověřte publikační účet.", consent: "Je potřeba souhlas vlastníka.", configuration: "Nastavte poskytovatele a sazby.", budget: "Generování překročilo rozpočet.", invalidCopy: "Vygenerovaný text neprošel kontrolou.", overflow: "Zdroj se nevejde do schváleného rozvržení.", provider: "Generování se nedokončilo. Před opakováním zkontrolujte úlohu.", lease: "Výsledek zpracování není jistý. Před opakováním ho ověřte.", asset: "Finální média se nepodařilo ověřit.", pending: "Platforma stále zpracovává média.", approval: "Je potřeba schválení přesné revize vlastníkem.",
  },
} as const;

function reason(code: string, lang: Lang): string {
  const t = copy[lang];
  if (/overflow|unsupported-glyph|challenge-caption/.test(code)) return t.overflow;
  if (/source|authored-code-mismatch/.test(code)) return t.source;
  if (/template|claude-design/.test(code)) return t.template;
  if (/account/.test(code)) return t.account;
  if (/consent/.test(code)) return t.consent;
  if (/configuration|pricing-required|claude-only/.test(code)) return t.configuration;
  if (/budget-exceeded/.test(code)) return t.budget;
  if (/copy-validation|invalid-schema|invalid-request/.test(code)) return t.invalidCopy;
  if (/lease|fence|publish-intent|uncertain|reconciliation/.test(code)) return t.lease;
  if (/asset|font-hash|revision-not-ready|final-assets/.test(code)) return t.asset;
  if (code === "container-pending") return t.pending;
  if (/approval/.test(code)) return t.approval;
  if (/provider|generation|usage-unavailable/.test(code)) return t.provider;
  return t.attention;
}
function recordedCost(value: number | null): value is number { return value !== null && Number.isFinite(value) && value >= 0; }
function ErrorDetail({ code, lang }: { code: string; lang: Lang }) {
  const safeCode = /^[a-z][a-z0-9-]{0,99}$/.test(code) ? code : null;
  return <p className="mt-1 break-words text-xs text-warning">{safeCode ? reason(safeCode, lang) : copy[lang].attention}{safeCode && <span className="block text-foreground-muted">{copy[lang].details}: <code className="break-all font-mono">{safeCode}</code></span>}</p>;
}
function RecordedTime({ value, lang }: { value: string; lang: Lang }) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? <time dateTime={value} className="tabular-nums">{new Intl.DateTimeFormat(lang === "cs" ? "cs-CZ" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Prague" }).format(date)}</time> : <span>{copy[lang].dateUnknown}</span>;
}
function TraceRow({ revision, lang }: { revision: MarketingState["revisions"][number]; lang: Lang }) {
  const t = copy[lang];
  const [busy, setBusy] = useState(false); const [url, setUrl] = useState<string | null>(null); const [error, setError] = useState<"session" | "unavailable" | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  async function loadTrace() {
    if (busy) return;
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/marketing/diagnostics/${encodeURIComponent(revision.id)}`, { method: "GET", credentials: "same-origin", cache: "no-store", signal: request.signal });
      if (response.status === 401) { setError("session"); return; }
      if (!response.ok) throw new Error("trace-unavailable");
      const data: unknown = await response.json();
      if (!data || typeof data !== "object" || !("url" in data) || typeof data.url !== "string") throw new Error("invalid-trace-url");
      const target = new URL(data.url);
      if (target.protocol !== "https:" || target.hostname !== "eu.smith.langchain.com" || target.username || target.password || target.port) throw new Error("invalid-trace-url");
      if (!request.signal.aborted) setUrl(target.href);
    } catch { if (!request.signal.aborted) setError("unavailable"); }
    finally { if (!request.signal.aborted) setBusy(false); }
  }
  return <li className="min-w-0 py-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 break-words text-sm">{revision.revision.title}</span>{url ? <a className="focus-ring inline-flex min-h-11 items-center break-words text-xs text-primary underline md:min-h-8" href={url} target="_blank" rel="noopener noreferrer">{t.open}</a> : <Button type="button" variant="outline" className="min-h-11 md:min-h-8" aria-label={`${t.trace}: ${revision.revision.title}`} disabled={busy} aria-busy={busy} onClick={() => void loadTrace()}>{busy ? t.loading : t.trace}</Button>}</div>
    <p className="mt-1 text-xs text-foreground-muted">{revision.revision.brand === "dneskai" ? "DNESKAi" : "devShark"} · <RecordedTime value={revision.created_at} lang={lang}/></p>
    {busy && <p role="status" className="mt-1 text-xs text-foreground-muted">{t.loading}</p>}{error && <p role="alert" className="mt-1 text-xs text-destructive">{error === "session" ? t.signIn : t.traceError}</p>}
  </li>;
}

export function MarketingDiagnostics({ state, lang }: { state: MarketingState; lang: Lang }) {
  const id = useId(); const t = copy[lang];
  const knownCosts = state.jobs.map((job) => job.costUsd).filter(recordedCost);
  const cost = new Intl.NumberFormat(lang === "cs" ? "cs-CZ" : "en-US", { style: "currency", currency: "USD", minimumFractionDigits: 3, maximumFractionDigits: 6 });
  const rate = state.diagnostics.firstApprovalRate;
  const validRate = state.diagnostics.sampleSize > 0 && rate !== null && Number.isFinite(rate) && rate >= 0 && rate <= 1;
  const traces = state.revisions.filter((row) => row.revision.traceId);
  const publicationErrors = state.publications.filter((publication) => publication.error_code);
  const status = (key: string) => t.status[key as keyof typeof t.status] ?? t.attention;
  return <section aria-labelledby={`${id}-title`} className="min-w-0 space-y-4 border-t border-border pt-4">
    <div><h2 id={`${id}-title`} className="text-sm font-semibold">{t.title}</h2><p className="mt-1 text-xs text-foreground-muted">{t.sample}</p></div>
    <dl className="grid gap-3 text-xs sm:grid-cols-3">
      <div><dt className="text-foreground-muted">{t.jobs}</dt><dd className="mt-1 font-medium tabular-nums">{state.jobs.length}</dd></div>
      <div><dt className="text-foreground-muted">{t.cost}</dt><dd className="mt-1 font-medium tabular-nums">{knownCosts.length ? cost.format(knownCosts.reduce((sum, amount) => sum + amount, 0)) : t.unknown}</dd></div>
      <div><dt className="text-foreground-muted">{t.unknownCosts}</dt><dd className="mt-1 font-medium tabular-nums">{state.jobs.length - knownCosts.length}</dd></div>
    </dl>
    {state.diagnostics.sampleSize > 0 && <div className="space-y-1 border-t border-border pt-3 text-xs"><p>{t.review}: <span className="font-medium tabular-nums">{validRate ? new Intl.NumberFormat(lang === "cs" ? "cs-CZ" : "en-US", { style: "percent", maximumFractionDigits: 1 }).format(rate!) : t.unknown}</span></p><p className="text-foreground-muted">{t.revisions}: {state.diagnostics.sampleSize}. {t.reviewScope}</p></div>}
    {state.jobs.length ? <ul className="divide-y divide-border">{state.jobs.map((job) => <li key={job.id} className="min-w-0 py-3">
      <div className="grid gap-1 text-xs sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-4"><div className="min-w-0"><span className="font-medium">{job.brand === "dneskai" ? "DNESKAi" : job.brand === "devshark" ? "devShark" : t.unknownBrand}</span> · <span>{status(job.status)}</span><span className="mt-1 block break-all font-mono text-foreground-muted">{t.job} {job.id}</span></div><span className="text-foreground-muted"><RecordedTime value={job.createdAt} lang={lang}/></span><span className="font-medium tabular-nums">{recordedCost(job.costUsd) ? cost.format(job.costUsd) : t.unknown}</span></div>
      {job.errorCode && <ErrorDetail code={job.errorCode} lang={lang}/>}
    </li>)}</ul> : <p className="text-sm text-foreground-muted">{t.empty}</p>}
    {publicationErrors.length > 0 && <div className="border-t border-border pt-3"><h3 className="text-xs font-semibold">{t.publicationErrors}</h3><ul className="divide-y divide-border">{publicationErrors.map((publication) => <li key={publication.id} className="min-w-0 py-3"><p className="break-words text-xs">{state.revisions.find((row) => row.id === publication.revision_id)?.revision.title ?? t.publication} · {publication.platform} · {status(publication.status)}</p><ErrorDetail code={publication.error_code!} lang={lang}/></li>)}</ul></div>}
    {traces.length > 0 && <div className="border-t border-border pt-3"><h3 className="text-xs font-semibold">{t.traceTitle}</h3><ul className="divide-y divide-border">{traces.map((revision) => <TraceRow key={`${revision.id}:${revision.revision.traceId}:${revision.content_hash}`} revision={revision} lang={lang}/>)}</ul></div>}
  </section>;
}
