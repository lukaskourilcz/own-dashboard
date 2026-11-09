"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, ExternalLink, FileJson, KeyRound, Link2, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SimpleSelect } from "@/components/ui/select";
import { EntityBadge, StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { useLang } from "@/lib/i18n";
import { igCollection as strings } from "@/lib/i18n/sections/ig-collection";
import { qk } from "@/lib/queries/keys";
import type { StatusTone } from "@/lib/status-presentation";
import {
  COLLECTION_POST_CAP_USD, COLLECTION_PROCESS_LIMIT, COLLECTION_PROJECTS, COLLECTION_STATUSES, chunkRows, collectionTags, filterCollection, mergeSavedExports, parseSavedExport,
  type CollectionFilter, type CollectionOverview, type CollectionPost, type CollectionStatus, type ParsedSavedExport,
} from "@/lib/marketing/ig-collection";

/** Sample saved posts for /dev-preview: the panel never calls the API there. */
export const PREVIEW_COLLECTION: { overview: CollectionOverview; posts: CollectionPost[] } = {
  overview: { highWater: "2026-11-02T18:40:00.000Z", count: 5, inTips: 1, queued: 1, lastRun: "2026-11-09T08:15:00.000Z", lastImport: "2026-11-09T08:00:00.000Z", hasShareToken: true, shareTokenCreatedAt: "2026-11-09T07:50:00.000Z" },
  posts: [
    { id: "00000000-0000-4000-8000-0000000000c1", shortcode: "DQhook01", url: "https://www.instagram.com/p/DQhook01/", author: "reelcraft.studio", saved_at: "2026-11-02T18:40:00.000Z", published_at: "2026-10-30T09:00:00.000Z", collections: ["Hooks"], status: "done", error: null, thumbnail: null, media_type: "Video", processed_at: "2026-11-09T08:15:00.000Z", ai_link_id: null,
      digest: { summary: "Put the result in the first second, then show how you got there. The hook is one short line on screen and in speech.", tips: ["State the result before the steps", "Keep the on-screen hook under eight words", "Cut the intro logo"], tags: ["hooks", "reels"], project: "devShark", claudeUsd: 0.012, apifyUsd: 0.004 } },
    { id: "00000000-0000-4000-8000-0000000000c2", shortcode: "DQcarousel2", url: "https://www.instagram.com/p/DQcarousel2/", author: "newsdesk.cz", saved_at: "2026-11-01T07:10:00.000Z", published_at: null, collections: ["Carousels"], status: "summarizing", error: null, thumbnail: null, media_type: "Sidecar", processed_at: null, ai_link_id: null, digest: null },
    { id: "00000000-0000-4000-8000-0000000000c3", shortcode: "DQqueued3", url: "https://www.instagram.com/reel/DQqueued3/", author: null, saved_at: "2026-10-28T20:05:00.000Z", published_at: null, collections: [], status: "queued", error: null, thumbnail: null, media_type: null, processed_at: null, ai_link_id: null, digest: null },
    { id: "00000000-0000-4000-8000-0000000000c4", shortcode: "DQprivate4", url: "https://www.instagram.com/p/DQprivate4/", author: "closefriends.only", saved_at: "2026-10-20T12:00:00.000Z", published_at: null, collections: [], status: "restricted", error: "collection-post-restricted", thumbnail: null, media_type: null, processed_at: "2026-11-09T08:14:00.000Z", ai_link_id: null, digest: null },
    { id: "00000000-0000-4000-8000-0000000000c5", shortcode: "CzTip05", url: "https://www.instagram.com/p/CzTip05/", author: null, saved_at: null, published_at: null, collections: [], status: "done", error: null, thumbnail: null, media_type: null, processed_at: "2026-11-09T08:00:00.000Z", ai_link_id: "00000000-0000-4000-8000-0000000000d1",
      digest: { summary: "Batch a week of captions in one sitting and schedule them the same day.", tips: [], tags: [], project: null, fromTips: true } },
  ],
};

const noSubscribe = () => () => {};
const TONE: Record<CollectionStatus, StatusTone> = { queued: "neutral", scraping: "information", summarizing: "information", done: "success", restricted: "warning", failed: "risk" };
type Load = { overview: CollectionOverview; posts: CollectionPost[] };
async function fetchCollection(): Promise<Load> {
  const response = await fetch("/api/marketing/collection", { cache: "no-store" });
  if (!response.ok) throw new Error("collection-unavailable");
  return response.json();
}
async function postAction(body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch("/api/marketing/collection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof json.error === "string" ? json.error : "collection-request-failed");
  return json;
}

export function IgCollectionPanel({ isPreview = false }: { isPreview?: boolean }) {
  const { lang } = useLang();
  const t = strings[lang];
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: qk.igCollection, queryFn: fetchCollection, enabled: !isPreview, staleTime: 30_000 });
  const data = isPreview ? PREVIEW_COLLECTION : query.data;
  const posts = useMemo(() => data?.posts ?? [], [data]);
  const overview = data?.overview;
  const [filter, setFilter] = useState<CollectionFilter>({ status: "all", project: "all", tag: "all", search: "" });
  const shown = useMemo(() => filterCollection(posts, filter), [posts, filter]);
  const tags = useMemo(() => collectionTags(posts), [posts]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const [urlsOpen, setUrlsOpen] = useState(false);
  const [urls, setUrls] = useState("");
  const [consent, setConsent] = useState<{ ids: string[] | null; count: number } | null>(null);
  const [approved, setApproved] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const date = (iso: string, time = false) => new Intl.DateTimeFormat(lang === "cs" ? "cs-CZ" : "en-GB", { dateStyle: "medium", ...(time ? { timeStyle: "short" } : {}), timeZone: "Europe/Prague" }).format(new Date(iso));
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.igCollection });
  const say = (text: string, tone: "info" | "error" = "info") => setMessage({ text, tone });
  const report = (result: { added: number; skippedCollection: number; skippedTips: number; rejected: number }) => say(t.importResult(result.added, result.skippedCollection, result.skippedTips, result.rejected));

  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setMessage(null);
    try {
      const parts: ParsedSavedExport[] = [];
      for (const file of [...files].slice(0, 4)) {
        try { parts.push(parseSavedExport(JSON.parse(await file.text()))); }
        catch { say(t.exportUnsupported, "error"); return; }
      }
      const rows = mergeSavedExports(parts);
      if (!rows.length) { say(t.exportUnsupported, "error"); return; }
      if (isPreview) { report({ added: 0, skippedCollection: rows.length, skippedTips: 0, rejected: 0 }); return; }
      const total = { added: 0, skippedCollection: 0, skippedTips: 0, rejected: 0 };
      for (const chunk of chunkRows(rows)) {
        const result = await postAction({ action: "import", rows: chunk });
        total.added += Number(result.added ?? 0); total.skippedCollection += Number(result.skippedCollection ?? 0); total.skippedTips += Number(result.skippedTips ?? 0);
      }
      report(total); await refresh();
    } catch { say(t.importFailed, "error"); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }
  async function addUrls() {
    setBusy(true); setMessage(null);
    try {
      if (isPreview) { say(t.previewOnly); return; }
      const result = await postAction({ action: "add-urls", text: urls });
      report({ added: Number(result.added ?? 0), skippedCollection: Number(result.skippedCollection ?? 0), skippedTips: Number(result.skippedTips ?? 0), rejected: Number(result.rejected ?? 0) });
      setUrls(""); setUrlsOpen(false); await refresh();
    } catch (error) { say(error instanceof Error && error.message === "collection-no-post-urls" ? t.noUrls : t.importFailed, "error"); }
    finally { setBusy(false); }
  }
  async function startRun() {
    if (!consent || !approved) return;
    setBusy(true); setMessage(null);
    try {
      if (isPreview) { say(t.previewOnly); return; }
      const ids = consent.ids;
      const result = ids?.length === 1 ? await postAction({ action: "reprocess", consent: true, sourceId: ids[0] }) : await postAction({ action: "process", consent: true });
      say(t.processStarted(Number(result.accepted ?? 0))); await refresh();
    } catch { say(t.processFailed, "error"); }
    finally { setBusy(false); setConsent(null); setApproved(false); }
  }
  async function changeToken(action: "rotate-token" | "revoke-token") {
    setBusy(true); setCopied(false);
    try {
      if (isPreview) { say(t.previewOnly); return; }
      const result = await postAction({ action });
      setToken(typeof result.token === "string" ? result.token : null); await refresh();
    } catch { say(t.shareFailed, "error"); }
    finally { setBusy(false); }
  }

  const queued = overview?.queued ?? posts.filter((p) => p.status === "queued").length;
  const runCount = Math.min(queued, COLLECTION_PROCESS_LIMIT);
  // The origin is known only in the browser; the server render shows the path, so hydration matches.
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => "");
  const endpoint = `${origin}/api/marketing/knowledge/share`;
  const statusOptions = [{ value: "all", label: t.all }, ...COLLECTION_STATUSES.map((s) => ({ value: s, label: t.statuses[s] }))];
  const projectOptions = [{ value: "all", label: t.all }, ...COLLECTION_PROJECTS.map((p) => ({ value: p, label: t.projects[p] }))];
  const tagOptions = [{ value: "all", label: t.all }, ...tags.map((tag) => ({ value: tag, label: tag }))];

  return <section className="min-w-0" data-testid="ig-collection-panel">
    <PageHeader title={t.title} description={t.description} action={<div className="flex flex-wrap gap-2">
      <input ref={fileRef} type="file" accept="application/json,.json" multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => void importFiles(event.target.files)} data-testid="ig-collection-file" />
      <Button type="button" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()} title={t.importHint}><FileJson aria-hidden />{t.importExport}</Button>
      <Button type="button" variant="outline" disabled={busy} aria-expanded={urlsOpen} aria-controls="ig-collection-urls" onClick={() => setUrlsOpen((open) => !open)}><Link2 aria-hidden />{t.addUrls}</Button>
      <Button type="button" disabled={busy || runCount === 0} onClick={() => setConsent({ ids: null, count: runCount })}><Play aria-hidden />{t.processQueued(queued)}</Button>
    </div>} />
    {overview && <p className="mb-3 text-xs tabular-nums text-foreground-muted" data-testid="ig-collection-header">
      {t.header(overview.highWater ? date(overview.highWater) : null, overview.count, overview.inTips, overview.lastRun ? date(overview.lastRun, true) : null)}
    </p>}
    {isPreview && <p className="mb-3 text-xs text-foreground-muted">{t.previewOnly}</p>}
    <div aria-live="polite">{message && <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "mb-3 text-sm text-risk" : "mb-3 text-sm text-foreground"}>{message.text}</p>}</div>
    {urlsOpen && <Card id="ig-collection-urls" className="mb-4 space-y-2 p-3">
      <label htmlFor="ig-collection-url-input" className="text-xs font-medium text-foreground-muted">{t.addUrlsLabel}</label>
      <Textarea id="ig-collection-url-input" value={urls} onChange={(event) => setUrls(event.target.value)} rows={4} placeholder={t.addUrlsPlaceholder} className="w-full" />
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={busy || !urls.trim()} onClick={() => void addUrls()}>{busy ? t.working : t.addUrlsSubmit}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setUrlsOpen(false)}>{t.cancel}</Button>
      </div>
    </Card>}

    <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="grid gap-1 text-xs font-medium text-foreground-muted">{t.status}
        <SimpleSelect value={filter.status} onValueChange={(value) => setFilter((old) => ({ ...old, status: value as CollectionFilter["status"] }))} options={statusOptions} aria-label={t.status} />
      </label>
      <label className="grid gap-1 text-xs font-medium text-foreground-muted">{t.project}
        <SimpleSelect value={filter.project} onValueChange={(value) => setFilter((old) => ({ ...old, project: value as CollectionFilter["project"] }))} options={projectOptions} aria-label={t.project} />
      </label>
      <label className="grid gap-1 text-xs font-medium text-foreground-muted">{t.tag}
        <SimpleSelect value={filter.tag} onValueChange={(value) => setFilter((old) => ({ ...old, tag: value }))} options={tagOptions} aria-label={t.tag} />
      </label>
      <label className="grid gap-1 text-xs font-medium text-foreground-muted">{t.search}
        <Input type="search" value={filter.search} onChange={(event) => setFilter((old) => ({ ...old, search: event.target.value }))} placeholder={t.searchPlaceholder} />
      </label>
    </div>
    <p className="mb-2 text-xs tabular-nums text-foreground-muted" aria-live="polite">{t.count(shown.length, posts.length)}</p>

    {!isPreview && query.isPending ? <p role="status" className="text-sm text-foreground-muted">{t.loading}</p>
      : !isPreview && query.isError ? <p role="alert" className="text-sm text-risk">{t.unavailable}</p>
      : posts.length === 0 ? <EmptyState icon={Bookmark} title={t.empty} description={t.emptyHint} />
      : shown.length === 0 ? <p className="text-sm text-foreground-muted">{t.noMatch}</p>
      : <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3" aria-label={t.title}>
        {shown.map((post) => <li key={post.id} className="min-w-0"><PostCard post={post} t={t} date={date} busy={busy} onReprocess={() => setConsent({ ids: [post.id], count: 1 })} /></li>)}
      </ul>}

    <div className="mt-6 grid gap-3 lg:grid-cols-2">
      <Card className="space-y-2 p-4" data-testid="ig-collection-share">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="h-4 w-4" aria-hidden />{t.shareTitle}</h2>
        <p className="text-xs text-foreground-muted">{t.shareBody}</p>
        <p className="text-xs text-foreground-muted">{overview?.hasShareToken && overview.shareTokenCreatedAt ? t.shareActive(date(overview.shareTokenCreatedAt, true)) : t.shareNone}</p>
        <p className="text-xs"><span className="font-medium">{t.shareEndpoint}: </span><code className="break-all">{endpoint}</code></p>
        {token && <div className="space-y-1 rounded-md border border-warning/40 bg-warning-soft p-2" role="status">
          <p className="text-xs text-foreground">{t.shareOnce}</p>
          <div className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all text-xs" data-testid="ig-collection-token">{token}</code>
            <Button type="button" size="sm" variant="outline" onClick={() => { void navigator.clipboard?.writeText(token); setCopied(true); }}>{copied ? t.copied : t.copy}</Button></div>
        </div>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void changeToken("rotate-token")}>{overview?.hasShareToken ? t.shareRotate : t.shareCreate}</Button>
          {overview?.hasShareToken && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void changeToken("revoke-token")}>{t.shareRevoke}</Button>}
        </div>
      </Card>
      <Card className="p-4" data-testid="ig-collection-help">
        <details>
          <summary className="cursor-pointer text-sm font-semibold focus-ring">{t.helpTitle}</summary>
          <div className="mt-3 space-y-3 text-xs text-foreground-muted">
            <div><h3 className="mb-1 font-semibold text-foreground">{t.helpExportTitle}</h3><ol className="list-decimal space-y-1 pl-4">{t.helpExport.map((step) => <li key={step}>{step}</li>)}</ol></div>
            <div><h3 className="mb-1 font-semibold text-foreground">{t.helpShortcutTitle}</h3><ol className="list-decimal space-y-1 pl-4">{t.helpShortcut.map((step) => <li key={step}>{step}</li>)}</ol></div>
            <div><h3 className="mb-1 font-semibold text-foreground">{t.helpProcessingTitle}</h3><p>{t.helpProcessing}</p><p className="mt-1">{t.helpCost}</p></div>
          </div>
        </details>
      </Card>
    </div>

    <Dialog open={consent !== null} onOpenChange={(open) => { if (!open) { setConsent(null); setApproved(false); } }}>
      <DialogContent className="max-w-md" data-testid="ig-collection-consent">
        <DialogHeader>
          <DialogTitle>{t.consentTitle}</DialogTitle>
          <DialogDescription>{consent ? t.consentBody(consent.count, `$${(consent.count * COLLECTION_POST_CAP_USD).toFixed(2)}`) : ""}</DialogDescription>
        </DialogHeader>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={approved} onCheckedChange={(value) => setApproved(value === true)} aria-label={t.consentCheck} className="mt-0.5" />
          <span>{t.consentCheck}</span>
        </label>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => { setConsent(null); setApproved(false); }}>{t.cancel}</Button>
          <Button type="button" disabled={!approved || busy} onClick={() => void startRun()}>{busy ? t.working : t.consentStart}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}

type Strings = (typeof strings)["en"];
function PostCard({ post, t, date, busy, onReprocess }: { post: CollectionPost; t: Strings; date: (iso: string) => string; busy: boolean; onReprocess: () => void }) {
  const [broken, setBroken] = useState(false);
  const who = post.author ?? t.unknownAuthor;
  const canReprocess = post.status === "done" || post.status === "failed" || post.status === "restricted";
  return <Card className="flex h-full min-w-0 gap-3 p-3" data-testid="ig-collection-post">
    <div className="flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-inset">
      {post.thumbnail && !broken
        // Instagram CDN thumbnails are signed and short-lived; a broken one falls back to the icon.
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={post.thumbnail} alt="" width={64} height={80} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="h-full w-full object-cover" />
        : <Bookmark className="h-5 w-5 text-foreground-muted" aria-hidden />}
    </div>
    <div className="min-w-0 flex-1 space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge value={post.status} label={t.statuses[post.status]} tone={TONE[post.status]} />
        {post.ai_link_id && <EntityBadge>{t.inTips}</EntityBadge>}
        {post.digest?.project && <EntityBadge>{t.projects[post.digest.project]}</EntityBadge>}
      </div>
      <p className="truncate text-sm font-medium">{who}</p>
      <p className="text-[11px] tabular-nums text-foreground-muted">{post.saved_at ? t.savedOn(date(post.saved_at)) : t.savedUnknown}</p>
      {post.digest?.summary && <p className="text-sm break-words">{post.digest.summary}</p>}
      {post.ai_link_id && !post.digest && <p className="text-xs text-foreground-muted">{t.inTipsNoSummary}</p>}
      {!!post.digest?.tips.length && <div><p className="text-[11px] font-medium text-foreground-muted">{t.tips}</p>
        <ul className="list-disc space-y-0.5 pl-4 text-xs break-words">{post.digest.tips.map((tip) => <li key={tip}>{tip}</li>)}</ul></div>}
      {(post.status === "failed" || post.status === "restricted") && post.error && <p className="text-xs text-risk">{t.errors[post.error] ?? t.errorGeneric(post.error)}</p>}
      {!!(post.digest?.tags.length || post.collections.length) && <div className="flex flex-wrap gap-1">
        {[...new Set([...post.collections, ...(post.digest?.tags ?? [])])].map((tag) => <EntityBadge key={tag} className="min-h-5 py-0">{tag}</EntityBadge>)}
      </div>}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <a href={post.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 text-xs font-medium underline underline-offset-2 hover:no-underline focus-ring md:min-h-6">{t.openPost}<ExternalLink className="h-3 w-3" aria-hidden /></a>
        {canReprocess && <Button type="button" size="sm" variant="ghost" disabled={busy} aria-label={t.reprocessFor(who)} onClick={onReprocess}><RotateCcw aria-hidden />{t.reprocess}</Button>}
      </div>
    </div>
  </Card>;
}
