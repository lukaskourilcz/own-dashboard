'use client';

import { useCallback, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Textarea } from '@/components/ui/textarea';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import { dneskaiWorkspaceApi, dneskaiWorkspaceKeys, DneskaiWorkspaceRequestError, type DneskaiEditResult } from '@/lib/marketing/dneskai-workspace-client';
import {
  dneskaiJobState, dneskaiPostState, dneskaiReviewQueue, dneskaiStateContext, pragueDate, pragueDayAfter, type DneskaiWorkspaceJob, type DneskaiWorkspacePost, type DneskaiWorkspaceRead,
} from '@/lib/marketing/dneskai-workspace';
import { DneskaiSlideStrip } from './slide-strip';
import { DneskaiStateChip } from './state-chip';
import { DneskaiRenderProblems } from './render-problems';
import { DneskaiCodeText, DneskaiDetails } from './code-text';
import { DneskaiPostEditor, dneskaiApprovalBlock } from './post-editor';

type Lang = 'en' | 'cs';
const shortHash = (hash: string) => hash.slice(0, 7);
export const pragueDateTime = (iso: string, lang: Lang) => new Intl.DateTimeFormat(lang === 'cs' ? 'cs-CZ' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Prague' }).format(new Date(iso));

/**
 * „Dnes ke schválení“ (#119): every undecided DNESKAi post with its full slide strip, its state and one main button
 * that approves this exact version by its hash; drafting jobs for the coming days; and what was already decided for
 * today and tomorrow. Approve, return and skip go through the existing revisions route.
 */
export function DneskaiReviewTab({ read, projectId, lang, preview, refreshing, onRefresh }: {
  read: DneskaiWorkspaceRead; projectId: string; lang: Lang; preview: boolean; refreshing: boolean; onRefresh: () => void;
}) {
  const t = dneskaiWorkspace[lang];
  const queryClient = useQueryClient();
  const keys = dneskaiWorkspaceKeys(projectId);
  const [message, setMessage] = useState<{ text: string; code?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ id: string; slide: number } | null>(null);
  // Versions an edit saved whose slides did not attach (502 render-attach-failed): a problem at once, not after the grace period.
  const [renderFailed, setRenderFailed] = useState<ReadonlySet<string>>(() => new Set());
  const context = dneskaiStateContext(read, renderFailed);
  // The control that opened the editor gets focus back on close; after a save replaced its card, the heading does.
  const opener = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLDivElement>(null);
  const openEditor = (id: string, slide: number) => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setEditor({ id, slide }); };
  const returnFocus = useCallback(() => {
    const target = opener.current?.isConnected ? opener.current : heading.current?.querySelector<HTMLElement>('h2');
    target?.focus();
  }, []);
  const queue = dneskaiReviewQueue(read);
  const soon = new Set([read.today, pragueDayAfter(read.today, 1)]);
  const decided = read.posts.filter((post) => !queue.posts.includes(post) && post.status !== 'superseded' && soon.has(pragueDate(post.scheduledAt)));
  const verified = read.accounts.some((account) => account.verified);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: keys.review });
    void queryClient.invalidateQueries({ queryKey: keys.costs });
  }, [queryClient, keys.review, keys.costs]);

  async function approve(post: DneskaiWorkspacePost): Promise<boolean> {
    setBusy(post.id); setMessage(null);
    try {
      await (await dneskaiWorkspaceApi(preview)).approve(post.id, post.contentHash);
      setMessage({ text: t.card.approved(pragueDateTime(post.scheduledAt, lang)) });
      await refresh();
      return true;
    } catch (error) {
      setMessage({ text: '', code: error instanceof DneskaiWorkspaceRequestError ? error.code : 'approval-unavailable' });
      await refresh();
      return false;
    } finally { setBusy(null); }
  }
  async function decide(post: DneskaiWorkspacePost, action: 'returned' | 'skipped', feedback?: string): Promise<boolean> {
    setBusy(post.id); setMessage(null);
    try {
      await (await dneskaiWorkspaceApi(preview)).decide(post.id, action, feedback);
      setMessage({ text: action === 'returned' ? t.card.returned : t.card.skipped });
      await refresh();
      return true;
    } catch (error) {
      setMessage({ text: '', code: error instanceof DneskaiWorkspaceRequestError ? error.code : 'decision-unavailable' });
      return false;
    } finally { setBusy(null); }
  }
  const onSaved = useCallback((result: DneskaiEditResult) => { setEditor((current) => current ? { id: result.id, slide: current.slide } : current); }, []);
  const onRenderFailed = useCallback((id: string) => {
    setRenderFailed((current) => new Set(current).add(id));
    setEditor((current) => current ? { id, slide: current.slide } : current);
  }, []);

  return <section aria-labelledby="dneskai-review-title" className="min-w-0 space-y-5" data-testid="dneskai-review">
    <div ref={heading}><TabHeader id="dneskai-review-title" title={t.review.title} intro={t.review.intro} lang={lang} refreshing={refreshing} onRefresh={onRefresh} preview={preview} unreadable={read.unreadable} focusable /></div>
    {!verified && <p className="border-l-2 border-warning pl-3 text-sm">{t.review.noAccount}</p>}
    <div aria-live="polite">{message && (message.code ? <div role="alert"><DneskaiCodeText code={message.code} lang={lang} /></div> : <p role="status" className="text-sm text-success">{message.text}</p>)}</div>
    {queue.posts.length === 0 && queue.jobs.length === 0 ? <EmptyState align="start" title={t.review.empty} description={t.review.emptyDescription} className="rounded-lg border border-border bg-surface" />
      : <div className="space-y-4">{queue.posts.map((post) => <PostCard key={post.id} post={post} read={read} renderFailed={renderFailed} lang={lang} busy={busy === post.id}
        onEdit={(slide) => openEditor(post.id, slide)} onApprove={() => void approve(post)} onDecide={(action, feedback) => decide(post, action, feedback)} />)}</div>}
    {queue.jobs.length > 0 && <section aria-labelledby="dneskai-preparing-title" className="space-y-2">
      <h3 id="dneskai-preparing-title" className="text-sm font-semibold">{t.review.preparingTitle}</h3>
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">{queue.jobs.map((job) => <JobRow key={job.id} job={job} lang={lang} />)}</ul>
    </section>}
    {decided.length > 0 && <section aria-labelledby="dneskai-decided-title" className="space-y-2">
      <h3 id="dneskai-decided-title" className="text-sm font-semibold">{t.review.decided}</h3>
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">{decided.map((post) => {
        const state = dneskaiPostState(post, context);
        return <li key={post.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
          <span className="min-w-0 break-words">{post.title}</span>
          <span className="flex flex-wrap items-center gap-2 text-xs text-foreground-muted"><time dateTime={post.scheduledAt} className="tabular">{pragueDateTime(post.scheduledAt, lang)}</time><DneskaiStateChip detail={state} lang={lang} /></span>
          {state.code && <DneskaiCodeText code={state.code} lang={lang} className="w-full" />}
        </li>;
      })}</ul>
    </section>}
    <DneskaiPostEditor open={!!editor} onOpenChange={(open) => { if (!open) setEditor(null); }} postId={editor?.id ?? null} initialSlide={editor?.slide ?? 0} read={read}
      projectId={projectId} lang={lang} preview={preview} onSaved={onSaved} onRenderFailed={onRenderFailed} renderFailed={renderFailed} onApprove={approve} approving={!!editor && busy === editor.id} returnFocus={returnFocus} />
  </section>;
}

export function TabHeader({ id, title, intro, lang, refreshing, onRefresh, preview, unreadable = 0, focusable = false }: {
  id: string; title: string; intro: string; lang: Lang; refreshing: boolean; onRefresh: () => void; preview: boolean; unreadable?: number; focusable?: boolean;
}) {
  const t = dneskaiWorkspace[lang];
  return <div className="space-y-2">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h2 id={id} tabIndex={focusable ? -1 : undefined} className="rounded text-sm font-semibold focus-ring">{title}</h2><p className="mt-1 max-w-3xl text-sm text-foreground-muted">{intro}</p></div>
      <Button variant="outline" className="min-h-11 md:min-h-8" disabled={refreshing} aria-busy={refreshing} onClick={onRefresh}>{refreshing ? t.refreshing : t.refresh}</Button>
    </div>
    {preview && <p className="border-l-2 border-information pl-3 text-xs text-foreground-muted">{t.preview}</p>}
    {unreadable > 0 && <p className="text-xs text-warning">{t.unreadable(unreadable)}</p>}
  </div>;
}

function JobRow({ job, lang }: { job: DneskaiWorkspaceJob; lang: Lang }) {
  const t = dneskaiWorkspace[lang];
  const state = dneskaiJobState(job);
  return <li className="min-w-0 space-y-1.5 px-3 py-2.5" data-testid="dneskai-job">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="min-w-0 break-words text-sm">{job.title || t.calendar.job}</p>
      <span className="flex flex-wrap items-center gap-2 text-xs text-foreground-muted">{job.scheduledAt && <time dateTime={job.scheduledAt} className="tabular">{pragueDateTime(job.scheduledAt, lang)}</time>}<DneskaiStateChip detail={state} lang={lang} /></span></div>
    {state.state === 'preparing' ? <><p className="text-xs text-foreground-muted">{t.review.preparingNote}</p><DneskaiDetails lang={lang} rows={[[t.detailJob, job.id]]} /></>
      : <DneskaiCodeText code={state.code} lang={lang} details={[[t.detailJob, job.id]]} />}
  </li>;
}

function PostCard({ post, read, renderFailed, lang, busy, onEdit, onApprove, onDecide }: {
  post: DneskaiWorkspacePost; read: DneskaiWorkspaceRead; renderFailed: ReadonlySet<string>; lang: Lang; busy: boolean; onEdit: (slide: number) => void; onApprove: () => void;
  onDecide: (action: 'returned' | 'skipped', feedback?: string) => Promise<boolean>;
}) {
  const t = dneskaiWorkspace[lang];
  const id = useId();
  const state = dneskaiPostState(post, dneskaiStateContext(read, renderFailed));
  const [loaded, setLoaded] = useState(false);
  const onLoadedChange = useCallback((value: boolean) => setLoaded(value), []);
  const [mode, setMode] = useState<'idle' | 'return' | 'skip'>('idle');
  const [feedback, setFeedback] = useState('');
  const block = dneskaiApprovalBlock(post, read, loaded, lang, renderFailed);
  return <article aria-labelledby={`${id}-title`} className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface" data-testid="dneskai-post">
    <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <h3 id={`${id}-title`} className="break-words text-sm font-semibold">{post.title}</h3>
        <p className="mt-0.5 text-xs text-foreground-muted"><time dateTime={post.scheduledAt} className="tabular">{pragueDateTime(post.scheduledAt, lang)}</time> · @{post.account.handle}{post.deck ? ` · ${t.card.slideCount(post.deck.slides.length)}` : ''}</p>
      </div>
      <DneskaiStateChip detail={state} lang={lang} />
    </header>
    <div className="min-w-0 space-y-4 p-4">
      <DneskaiSlideStrip post={post} lang={lang} onOpenSlide={post.deck ? onEdit : undefined} onLoadedChange={onLoadedChange} />
      {post.renderReport && <DneskaiRenderProblems problems={post.renderReport.problems} lang={lang} />}
      {state.state === 'problem' && !post.renderReport?.problems.length && <DneskaiCodeText code={state.code} lang={lang} />}
      <div className="min-w-0 space-y-1 text-sm">
        {post.status === 'returned' && post.feedback && <p className="border-l-2 border-warning pl-2 text-xs"><span className="font-medium">{t.card.returnedNote}</span> {post.feedback}</p>}
        <details>
          <summary className="inline-flex min-h-11 cursor-pointer items-center rounded text-xs font-semibold focus-ring md:min-h-6">{t.card.caption} · <span className="ml-1 font-normal text-foreground-muted tabular">{t.card.characters([...post.caption].length)}</span></summary>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm">{post.caption}</p>
        </details>
        {post.brief && <details>
          <summary className="inline-flex min-h-11 cursor-pointer items-center rounded text-xs font-semibold focus-ring md:min-h-6">{t.card.sources} ({post.brief.evidence.length})</summary>
          <ul className="mt-2 space-y-1 text-xs">{post.brief.evidence.map((item) => <li key={item.candidateId} className="break-words"><a className="rounded underline focus-ring" href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a></li>)}</ul>
        </details>}
        <DneskaiDetails lang={lang} rows={[[t.detailRevision, post.id], [t.detailHash, post.contentHash], [t.detailTrace, post.traceId], [t.detailTemplate, post.templateVersion],
          [t.detailAssets, post.assets.map((asset) => asset.sha256).join(', ')], [t.detailSources, [...new Set(post.deck?.slides.flatMap((slide) => slide.images.map((image) => image.assetSha256)) ?? [])].join(', ')]]} />
      </div>
    </div>
    <footer className="space-y-3 border-t border-border px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!!block || busy} aria-describedby={block ? `${id}-block` : undefined} onClick={onApprove} data-testid="dneskai-approve">
          {busy ? t.card.approving : t.card.approve}<span className="font-mono text-[11px]">· {t.card.version(shortHash(post.contentHash))}</span>
        </Button>
        {post.deck && <Button variant="outline" disabled={busy} onClick={() => onEdit(0)}>{t.card.edit}</Button>}
        <Button variant="ghost" disabled={busy} aria-expanded={mode === 'return'} onClick={() => setMode(mode === 'return' ? 'idle' : 'return')}>{t.card.return}</Button>
        <Button variant="ghost" disabled={busy} aria-expanded={mode === 'skip'} onClick={() => setMode(mode === 'skip' ? 'idle' : 'skip')}>{t.card.skip}</Button>
      </div>
      {block && <p id={`${id}-block`} className="text-xs text-foreground-muted">{block}</p>}
      {mode === 'return' && <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); if (!feedback.trim()) return; void onDecide('returned', feedback).then((done) => { if (done) { setMode('idle'); setFeedback(''); } }); }}>
        <label htmlFor={`${id}-feedback`} className="text-xs font-medium text-foreground-muted">{t.card.feedback}</label>
        <Textarea id={`${id}-feedback`} value={feedback} maxLength={2000} rows={3} required aria-describedby={`${id}-feedback-help`} onChange={(event) => setFeedback(event.target.value)} />
        <p id={`${id}-feedback-help`} className="text-xs text-foreground-muted">{t.card.feedbackHelp}</p>
        <div className="flex flex-wrap gap-2"><Button type="submit" variant="outline" disabled={busy || !feedback.trim()}>{t.card.sendReturn}</Button><Button type="button" variant="ghost" onClick={() => setMode('idle')}>{t.card.cancel}</Button></div>
      </form>}
      {mode === 'skip' && <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t.card.skip}>
        <p className="text-sm">{t.card.skipConfirm}</p>
        <Button variant="destructive" size="sm" disabled={busy} onClick={() => void onDecide('skipped').then((done) => { if (done) setMode('idle'); })}>{t.card.skipYes}</Button>
        <Button variant="ghost" size="sm" onClick={() => setMode('idle')}>{t.card.back}</Button>
      </div>}
    </footer>
  </article>;
}
