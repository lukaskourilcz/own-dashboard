"use client";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useLang } from "@/lib/i18n/lang";
import { knowledgeImportCopy } from "@/lib/marketing/knowledge-copy";
import type { CaptureReport } from "@/lib/marketing/knowledge";

type Preview = CaptureReport & { reviewHash: string };
type Normalization = { report: { preserved: number; skipped: number; evidencePending: number } };
type AnalysisPlan = { plan: { reviewHash: string; [key: string]: unknown } };
export function KnowledgeImport({ onImported, disabled = false }: { onImported?: () => void; disabled?: boolean }) {
  const { lang } = useLang(); const t = knowledgeImportCopy[lang]; const id = useId();
  const [text, setText] = useState(""); const [cutoff, setCutoff] = useState(new Date().toISOString().slice(0, 10));
  const [unknown, setUnknown] = useState(false); const [proofUrl, setProofUrl] = useState(""); const [proofDate, setProofDate] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null); const [normalization, setNormalization] = useState<Normalization | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const [sourceIds, setSourceIds] = useState<string[]>([]); const [provider, setProvider] = useState<"apify" | "claude">("apify"); const [budget, setBudget] = useState("0.25");
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [analysisPlan, setAnalysisPlan] = useState<AnalysisPlan | null>(null); const [consent, setConsent] = useState(false);
  const blocked = disabled || busy;
  const reset = () => { setPreview(null); setNotice(null); setSourceIds([]); setAnalysisPlan(null); setConsent(false); };
  const request = async (input: unknown) => {
    if (disabled) throw new Error("preview-disabled");
    const response = await fetch("/api/marketing/knowledge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "knowledge-import-invalid"); return result;
  };
  const run = async (action: () => Promise<void>) => {
    if (disabled) return;
    setBusy(true); setError(null); setNotice(null);
    try { await action(); } catch (e) {
      const code = e instanceof Error ? e.message : "";
      setError(code === "capture-too-large" ? t.tooLarge : code.includes("changed") ? t.changed : code.includes("configuration") ? t.configure : code.includes("proof") ? t.proofMismatch : t.error);
    } finally { setBusy(false); }
  };
  const capture = () => ({ cutoff: `${cutoff}T00:00:00.000Z`, input: text, includeUnknownDates: unknown,
    timestampProof: proofUrl && proofDate ? { url: proofUrl, savedAt: new Date(proofDate).toISOString() } : null });
  const previewImport = () => run(async () => { setPreview(await request({ action: "preview", capture: capture() })); });
  const saveImport = () => run(async () => {
    if (!preview) return;
    const result = await request({ action: "capture", capture: capture(), reviewHash: preview.reviewHash });
    setSourceIds(result.saved.sourceIds); setSelectedSourceId(result.saved.sourceIds[0] ?? ""); setNotice(t.saved); onImported?.();
  });
  return <section className="space-y-4" aria-labelledby={`${id}-title`}>
    <div><h3 id={`${id}-title`} className="text-sm font-semibold">{t.title}</h3><p className="mt-1 text-xs text-foreground-muted">{t.intro}</p></div>
    <div className="grid gap-3 md:grid-cols-2">
      <div className="space-y-1 md:col-span-2"><Label htmlFor={`${id}-input`}>{t.input}</Label><Textarea id={`${id}-input`} value={text} rows={5} disabled={blocked} onChange={(e) => { setText(e.target.value); reset(); }} aria-describedby={error ? `${id}-error` : undefined} className="font-mono text-xs" /></div>
      <div className="space-y-1"><Label htmlFor={`${id}-file`}>{t.file}</Label><Input id={`${id}-file`} type="file" accept="application/json,.json" disabled={blocked} onChange={(e) => {
        const file = e.target.files?.[0]; if (!file) return;
        void run(async () => { if (file.size > 1_000_000) throw new Error("capture-too-large"); setText(await file.text()); reset(); });
      }} /></div>
      <div className="space-y-1"><Label htmlFor={`${id}-cutoff`}>{t.cutoff}</Label><Input id={`${id}-cutoff`} type="date" value={cutoff} disabled={blocked} onChange={(e) => { setCutoff(e.target.value); reset(); }} /></div>
      <div className="space-y-1"><Label htmlFor={`${id}-proof-url`}>{t.proofUrl}</Label><Input id={`${id}-proof-url`} type="url" value={proofUrl} disabled={blocked} onChange={(e) => { setProofUrl(e.target.value); reset(); }} /></div>
      <div className="space-y-1"><Label htmlFor={`${id}-proof-date`}>{t.proofDate}</Label><Input id={`${id}-proof-date`} type="datetime-local" value={proofDate} disabled={blocked} onChange={(e) => { setProofDate(e.target.value); reset(); }} /></div>
    </div>
    <p className="text-xs text-foreground-muted">{t.proofHelp}</p>
    <label className="flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" checked={unknown} disabled={blocked} onChange={(e) => { setUnknown(e.target.checked); reset(); }} className="focus-ring size-4 shrink-0 accent-primary" />{t.unknown}</label>
    <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={blocked || !text.trim() || !cutoff || (!!proofUrl !== !!proofDate)} onClick={previewImport}>{busy ? t.busy : t.preview}</Button>
      {preview && <Button type="button" disabled={blocked || preview.sources.length === 0} onClick={saveImport}>{t.save}</Button>}</div>
    {preview && <div className="space-y-3 border-t border-border pt-3">
      <h4 className="text-xs font-semibold">{t.report}</h4>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">{([
        [t.received, preview.counts.received], [t.unique, preview.counts.unique], [t.duplicates, preview.counts.duplicates], [t.excluded, preview.counts.outsideWindow], [t.unknownCount, preview.counts.unknownDates], [t.rejected, preview.counts.rejected],
      ] as const).map(([label, count]) => <div key={label}><dt className="text-foreground-muted">{label}</dt><dd className="font-medium tabular-nums">{count}</dd></div>)}</dl>
      {!preview.sources.length ? <p className="text-xs text-warning">{t.empty}</p> : <ul className="divide-y divide-border text-xs">{preview.sources.slice(0, 50).map((source) => <li key={source.shortcode} className="flex flex-col gap-1 py-2 sm:flex-row sm:justify-between">
        <a href={source.canonical_url} target="_blank" rel="noopener noreferrer" className="focus-ring min-h-11 break-all py-2 text-primary underline underline-offset-2">{source.shortcode}</a>
        <span className="text-foreground-muted">{source.saved_at_status === "verified" ? t.verifiedDate : source.saved_at_status === "unverified" ? t.unverifiedDate : t.unknownDate}{source.saved_at ? ` · ${new Date(source.saved_at).toLocaleString(lang)}` : ""}<br />{source.content.transcript.status === "available" ? t.transcriptAvailable : t.captionOnly} · {source.content.ocr.status === "available" ? t.ocrAvailable : t.ocrUnavailable}</span>
      </li>)}</ul>}
      {preview.sources.length > 50 && <p className="text-xs text-foreground-muted">{t.more}</p>}
    </div>}
    <div className="space-y-2 border-t border-border pt-3"><h4 className="text-xs font-semibold">{t.preserved}</h4><p className="text-xs text-foreground-muted">{t.normalizeHelp}</p>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={blocked} onClick={() => void run(async () => { setNormalization(await request({ action: "normalize-existing", apply: false })); })}>{t.normalize}</Button>
        {normalization && <Button disabled={blocked || !normalization.report.preserved} onClick={() => void run(async () => { await request({ action: "normalize-existing", apply: true }); setNotice(t.normalized); onImported?.(); })}>{t.normalizeApply} ({normalization.report.preserved})</Button>}</div>
    </div>
    {!!sourceIds.length && <div className="space-y-3 border-t border-border pt-3"><h4 className="text-xs font-semibold">{t.analysis}</h4>
      <div className="space-y-1"><Label htmlFor={`${id}-analysis-source`}>{t.source}</Label><select id={`${id}-analysis-source`} value={selectedSourceId} disabled={blocked} onChange={(e) => { setSelectedSourceId(e.target.value); setAnalysisPlan(null); setConsent(false); }} className="focus-ring min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm">{sourceIds.map((sourceId, index) => <option key={sourceId} value={sourceId}>{preview?.sources[index]?.shortcode ?? sourceId}</option>)}</select></div>
      <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1"><Label htmlFor={`${id}-provider`}>{t.provider}</Label><select id={`${id}-provider`} value={provider} disabled={blocked} onChange={(e) => { setProvider(e.target.value as "apify" | "claude"); setAnalysisPlan(null); setConsent(false); }} className="focus-ring min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"><option value="apify">{t.scraper}</option><option value="claude">{t.model}</option></select></div>
      <div className="space-y-1"><Label htmlFor={`${id}-budget`}>{t.budget}</Label><Input id={`${id}-budget`} type="number" min="0.01" max="1" step="0.01" value={budget} disabled={blocked} onChange={(e) => { setBudget(e.target.value); setAnalysisPlan(null); setConsent(false); }} /></div></div>
      <Button variant="outline" disabled={blocked || !selectedSourceId || Number(budget) <= 0 || Number(budget) > 1} onClick={() => void run(async () => { setAnalysisPlan(await request({ action: "analysis-plan", sourceIds: [selectedSourceId], provider, maxCostUsd: Number(budget) })); })}>{t.plan}</Button>
      {analysisPlan && <><details open><summary className="focus-ring cursor-pointer text-xs font-medium">{t.titlePlan}</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-surface-muted p-3 text-xs">{JSON.stringify(analysisPlan.plan, null, 2)}</pre></details>
        <label className="flex min-h-11 items-start gap-2 text-xs"><input type="checkbox" checked={consent} disabled={blocked} onChange={(e) => setConsent(e.target.checked)} className="focus-ring mt-1 size-4 shrink-0 accent-primary" />{t.consent}</label>
        <Button disabled={blocked || !consent} onClick={() => void run(async () => { const result = await request({ action: "prepare-analysis", sourceIds: [selectedSourceId], provider, consent, reviewHash: analysisPlan.plan.reviewHash, maxCostUsd: Number(budget) }); setNotice(result.alreadyProcessed ? t.processed : t.queued); setAnalysisPlan(null); setConsent(false); onImported?.(); })}>{t.queue}</Button></>}
    </div>}
    {error && <p id={`${id}-error`} role="alert" className="text-xs text-destructive">{error}</p>}
    {notice && <p role="status" className="text-xs text-success">{notice}</p>}
  </section>;
}
