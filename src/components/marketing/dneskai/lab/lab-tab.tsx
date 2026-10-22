'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { dneskaiLab as copy } from '@/lib/i18n/sections/dneskai-lab';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import { createDeckDraft, dneskaiEditRequest, dneskaiScheduleExpired, dneskaiSlidePixelsKey, draftProblems, DNESKAI_CAPTION_MAX, type DeckDraft } from '@/lib/marketing/dneskai-deck-editor';
import { dneskaiFitSlide, dneskaiLabOrder, dneskaiLabProfileCovers, dneskaiLabPost, dneskaiLabQueue, DNESKAI_KITS, type DneskaiLabDay, type DneskaiLabPost, type DneskaiApproveManyResult } from '@/lib/marketing/dneskai-lab';
import { dneskaiWorkspaceApi, dneskaiWorkspaceKeys, DneskaiWorkspaceRequestError } from '@/lib/marketing/dneskai-workspace-client';
import type { DneskaiWorkspaceRead } from '@/lib/marketing/dneskai-workspace';
import { cn } from '@/lib/utils';
import { CountedField } from '../post-editor';
import { DneskaiCodeText } from '../code-text';
import { DneskaiStateChip } from '../state-chip';
import { DneskaiKitTiles } from './kit-tiles';
import { DneskaiSlideInspector, type DneskaiFitState } from './slide-inspector';
import { DneskaiLabStage, type DneskaiStagePreview, type DneskaiStageSlide, type DneskaiStageView } from './stage';

type Props = { read: DneskaiWorkspaceRead; projectId: string; lang: 'en' | 'cs'; preview: boolean; refreshing: boolean; onRefresh: () => void; renderFailed: ReadonlySet<string>; addRenderFailed: (id: string) => void; onDirtyChange?: (value: boolean) => void; guest?: boolean; onOpenSources?: () => void };
const selection = () => typeof window === 'undefined' ? { post: '', slide: 0 } : { post: new URLSearchParams(window.location.search).get('labPost') ?? '', slide: Math.max(0, Math.floor(Number(new URLSearchParams(window.location.search).get('labSlide'))) || 0) };
function remember(post: string, slide: number) {
  const url = new URL(window.location.href);
  url.searchParams.set('projectTab', 'dneskai-review'); url.searchParams.set('labPost', post); url.searchParams.set('labSlide', String(slide));
  window.history.replaceState(window.history.state, '', url);
}

/** The queue and the edit session share a revision identity. A saved successor remounts the draft. */
export function DneskaiLabTab(props: Props) {
  const t = copy[props.lang];
  const [chosen, setChosen] = useState(selection);
  const [now, setNow] = useState(() => Date.parse(props.read.generatedAt));
  const [dirty, setDirty] = useState(false);
  const onDirtyChange = props.onDirtyChange;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [batch, setBatch] = useState<DneskaiLabDay | null>(null);
  const days = useMemo(() => dneskaiLabQueue(props.read, now, props.renderFailed), [props.read, now, props.renderFailed]);
  const ordered = dneskaiLabOrder(days);
  const named = props.read.posts.find((item) => item.status !== 'superseded' && (item.id === chosen.post || item.replacesId === chosen.post));
  const active = ordered.find((item) => item.post.id === chosen.post) ?? ordered.find((item) => item.post.replacesId === chosen.post) ?? (named ? dneskaiLabPost(named, props.read, now, props.renderFailed) : null) ?? ordered.find((item) => item.post.status === 'review') ?? ordered[0] ?? null;
  useEffect(() => {
    if (props.preview) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [props.preview]);
  const choose = (post: string) => {
    if (dirty && post !== active?.post.id) { setPending(post); return; }
    setChosen({ post, slide: 0 }); remember(post, 0);
  };
  useEffect(() => {
    const onPop = () => { if (!dirty) setChosen(selection()); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [dirty]);
  return <section className="space-y-4" data-testid="dneskai-lab">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-base font-semibold">{t.title}</h2><p className="text-xs text-foreground-muted">{t.intro}</p></div>
      <Button variant="outline" size="sm" disabled={props.refreshing || dirty} onClick={props.onRefresh}>{dneskaiWorkspace[props.lang].refresh}</Button>
    </div>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {props.preview && <p className="border-l-2 border-information pl-3 text-xs text-foreground-muted">{props.guest ? t.publicTour : dneskaiWorkspace[props.lang].preview}</p>}
    <div className="grid min-w-0 gap-4 xl:grid-cols-[13rem_minmax(0,1fr)]">
      <nav onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || !active) return;
        const key = event.key.toLowerCase();
        if (!['j','k','arrowdown','arrowup'].includes(key)) return;
        event.preventDefault();
        const at = ordered.findIndex((item) => item.post.id === active.post.id);
        choose(ordered[Math.max(0, Math.min(ordered.length - 1, at + (key === 'j' || key === 'arrowdown' ? 1 : -1)))]!.post.id);
      }} aria-label={t.queue.label} className="min-w-0 space-y-4" data-testid="dneskai-lab-queue">
        {days.map((day, index) => <section key={day.date} className="space-y-2">
          <h3 className="text-xs font-semibold">{index === 0 ? t.queue.today : t.queue.tomorrow} <span className="font-normal text-foreground-muted tabular">{day.date}</span></h3>
          <ol className="flex gap-2 overflow-x-auto pb-1 xl:block xl:space-y-1 xl:overflow-visible">
            {day.posts.map((item) => <li key={item.post.id} className="w-56 shrink-0 xl:w-auto"><button type="button" onClick={() => choose(item.post.id)} aria-current={active?.post.id === item.post.id ? 'true' : undefined}
              className={cn('min-h-11 w-full rounded-md border p-2 text-left focus-ring', active?.post.id === item.post.id ? 'border-primary bg-surface-selected' : 'border-border hover:bg-surface-hover')} data-testid="dneskai-lab-queue-post">
              <span className="flex items-center justify-between gap-2 text-xs"><span className="tabular">{item.deadline.time}</span><DneskaiStateChip detail={item.state} lang={props.lang} /></span>
              <span className="mt-1 block line-clamp-2 text-xs font-medium">{item.post.title}</span>
              <span className={cn('mt-1 block text-[11px]', item.deadline.urgent ? 'text-warning' : 'text-foreground-muted')}>{item.deadline.passed ? t.queue.passed : t.queue.timeLeft(item.deadline.minutesLeft)}</span>
            </button></li>)}
          </ol>
          {day.jobs.map((item) => <p key={item.job.id} className="text-xs text-foreground-muted">{item.deadline?.time} · {t.queue.preparing}</p>)}
          {!day.posts.length && !day.jobs.length && <p className="text-xs text-foreground-muted">{t.queue.empty}</p>}
          <Button type="button" variant="outline" size="sm" className="w-full" disabled={props.guest || dirty || !day.approvable.length} onClick={() => setBatch(structuredClone(day))}>{t.queue.approveDay(day.approvable.length)}</Button>
        </section>)}
        {props.onOpenSources && !props.guest && <button type="button" className="focus-ring inline-flex min-h-11 items-center rounded text-left text-xs text-information underline" onClick={props.onOpenSources}>{t.queue.recovery}</button>}
      </nav>
      {active ? <LabSession key={`${active.post.id}:${active.revision.contentHash}`} {...props} lab={active} slide={Math.min(chosen.slide, 9)}
        onSlide={(slide) => { setChosen({ post: active.post.id, slide }); remember(active.post.id, slide); }} onDirty={setDirty}
        onChoose={choose} onBatch={() => { const day = days.find((item) => item.date === active.deadline.date); if (day && !dirty && day.approvable.length) setBatch(structuredClone(day)); }}
        onSaved={(post) => { setNotice(t.actions.saved); setDirty(false); setChosen({ post, slide: chosen.slide }); remember(post, chosen.slide); }} order={ordered} /> : <p role="status" className="text-sm text-foreground-muted">{t.stage.noPost}</p>}
    </div>
    <Dialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null); }}><DialogContent><DialogHeader><DialogTitle>{t.actions.discard}</DialogTitle><DialogDescription>{t.actions.dirty}</DialogDescription></DialogHeader>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setPending(null)}>{t.actions.cancel}</Button><Button onClick={() => { const post = pending!; setPending(null); setDirty(false); setChosen({ post, slide: 0 }); remember(post, 0); }}>{t.actions.discard}</Button></div>
    </DialogContent></Dialog>
    {props.preview && <details className="border-t border-border pt-3 text-xs"><summary className="min-h-11 cursor-pointer py-3 font-medium">{t.specimens.title}</summary><p className="mb-3 text-foreground-muted">{t.specimens.help}</p><a href="/demo/dneskai/kit-editorial.png" target="_blank" rel="noreferrer"><Image unoptimized src="/demo/dneskai/kit-editorial.png" alt={t.specimens.help} width={1944} height={2574} sizes="100vw" className="h-auto w-full" /></a></details>}
    {batch && <ApproveDay {...props} day={batch} onClose={() => setBatch(null)} />}
  </section>;
}

/** The most render-only previews one edit session keeps (each is a ~100 KB data URL). */
const PREVIEW_MEMORY = 16;
/** Draft problems that make the edit itself invalid, so no preview can be drawn until the owner fixes them. */
const PREVIEW_BLOCKERS = new Set(['text-missing', 'alt-missing', 'deck-edit-slide-count']);

function LabSession({ lab, slide: requested, onSlide, onDirty, onChoose, onBatch, onSaved, order, ...props }: Props & { lab: DneskaiLabPost; slide: number; onSlide: (index: number) => void; onDirty: (dirty: boolean) => void; onChoose: (id: string) => void; onBatch: () => void; onSaved: (id: string) => void; order: DneskaiLabPost[] }) {
  const t = copy[props.lang];
  const id = useId(), client = useQueryClient(), fieldRef = useRef<HTMLElement | null>(null), rootRef = useRef<HTMLDivElement>(null);
  const post = lab.post, account = props.read.accounts.find((item) => item.remoteId === post.account.id);
  const [draft, setDraft] = useState<DeckDraft>(() => createDeckDraft(post, account?.id ?? null));
  const [view, setView] = useState<DneskaiStageView>('feed');
  const [loaded, setLoaded] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [busyAction, setBusyAction] = useState<'approve' | 'save' | 'return' | 'skip' | 'publish' | null>(null), [message, setMessage] = useState(''), [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'return' | 'skip' | 'shortcuts' | 'publish' | null>(null), [note, setNote] = useState('');
  // Read once when the post opens: an expired time is replaced in the draft by the nearest possible one (createDeckDraft).
  const [expired] = useState(() => dneskaiScheduleExpired(post));
  const [fit, setFit] = useState<DneskaiFitState>({ status: 'idle', result: null });
  const [previewMemory, setPreviewMemory] = useState<ReadonlyMap<string, DneskaiStagePreview>>(() => new Map());
  const busy = busyAction !== null;
  // The slide on show is a slide of the draft, which can have more slides than the saved version.
  const slide = Math.max(0, Math.min(requested, draft.slides.length - 1));
  const request = (() => { try { return dneskaiEditRequest(post, draft, draft.accountId !== account?.id ? draft.accountId : null); } catch { return null; } })();
  // Only a post that can still be edited has unsaved changes; once approved, the draft is no longer an edit.
  const editable = ['review', 'returned'].includes(post.status);
  const dirty = editable && (!request || !!request.deck || request.caption !== post.caption || Date.parse(request.scheduledAt) !== Date.parse(post.scheduledAt) || !!request.accountId);
  // Publish now replaces the time itself, so a draft that differs only in its time may use it.
  const onlyTimeChanged = !!request && !request.deck && request.caption === post.caption && !request.accountId;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  // REN-01: a draft slide whose pixels differ from the saved JPEG (other words, pictures, crop, type, place or deck
  // length) is shown as a render-only preview; an unchanged one keeps showing the saved, approvable JPEG.
  const savedSlides = post.deck?.slides ?? [];
  const stageSlides: DneskaiStageSlide[] = draft.slides.map((item, index) => {
    const unchanged = draft.slides.length === savedSlides.length && item.from === index && !!savedSlides[index] && dneskaiSlidePixelsKey(item.slide) === dneskaiSlidePixelsKey(savedSlides[index]!);
    const saved = unchanged ? lab.slides[index] : undefined;
    return { index, type: item.slide.type, render: saved?.render ?? null, problems: saved?.problems ?? [], draft: unchanged ? null : item.from === null ? 'added' : 'changed', alt: item.slide.alt };
  });
  const invalidDraft = draftProblems(post, draft).some((problem) => PREVIEW_BLOCKERS.has(problem.code));
  const previewKey = !props.guest && stageSlides[slide]?.draft && request?.deck && !invalidDraft ? JSON.stringify({ deck: request.deck, slide }) : null;
  const preview: DneskaiStagePreview | null = !stageSlides[slide]?.draft ? null
    : invalidDraft ? { slide, status: 'unavailable', image: null, code: 'deck-edit-invalid' }
      : previewKey ? previewMemory.get(previewKey) ?? { slide, status: 'loading', image: null, code: null } : { slide, status: 'unavailable', image: null, code: null };
  const remembered = previewKey ? previewMemory.has(previewKey) : true;
  useEffect(() => {
    if (!previewKey || remembered) return;
    const abort = new AbortController();
    const { deck, slide: index } = JSON.parse(previewKey) as { deck: NonNullable<typeof request>['deck']; slide: number };
    const keep = (value: DneskaiStagePreview) => setPreviewMemory((before) => {
      const next = new Map(before).set(previewKey, value);
      while (next.size > PREVIEW_MEMORY) next.delete(next.keys().next().value!);
      return next;
    });
    // Debounced like the fit check, so typing renders once per pause, not per key.
    const timer = window.setTimeout(async () => {
      try {
        const result = await (await dneskaiWorkspaceApi(props.preview)).renderPreview({ id: post.id, deck: deck!, slide: index }, abort.signal);
        if (!abort.signal.aborted) keep({ slide: index, status: result.status, image: result.image, code: result.problems.find((problem) => problem.blocking)?.code ?? null });
      } catch (failure) {
        if (abort.signal.aborted) return;
        // Kept for this exact draft: the next change asks again (a rate limit or network failure included).
        keep({ slide: index, status: 'unavailable', image: null, code: failure instanceof DneskaiWorkspaceRequestError ? failure.code : null });
      }
    }, 450);
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [previewKey, remembered, post.id, props.preview]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    if (dirty) window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const keys = dneskaiWorkspaceKeys(props.projectId);
  const media = useQueries({ queries: [...new Set((post.brief?.evidence ?? []).map((item) => item.candidateId))].slice(0, 8).map((candidateId) => ({ queryKey: keys.media(candidateId), staleTime: 30 * 60_000, retry: false,
    queryFn: async ({ signal }: { signal: AbortSignal }) => (await dneskaiWorkspaceApi(props.preview)).loadMedia(props.projectId, candidateId, signal) })) });
  const previews = useMemo(() => new Map(media.flatMap((entry) => (entry.data?.candidates ?? []).flatMap((candidate) => candidate.assets.flatMap((asset) => asset.previewUrl ? [[asset.sha256, asset.previewUrl] as const] : [])))), [media]);
  const mediaState = media.some((item) => item.isPending) ? 'loading' : media.some((item) => item.isError) ? 'unavailable' : 'ready';
  useEffect(() => {
    if (props.guest) return;
    const abort = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const slides = draft.slides.map((item) => dneskaiFitSlide(item.slide));
        setFit({ status: 'checking', result: null });
        const result = await (await dneskaiWorkspaceApi(props.preview)).fit({ kit: lab.kit, slides }, abort.signal);
        if (!abort.signal.aborted) setFit({ status: 'ready', result });
      } catch { if (!abort.signal.aborted) setFit({ status: 'unavailable', result: null }); }
    }, 300);
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [draft.slides, lab.kit, props.preview, props.guest]);
  const onLoaded = (url: string, ok: boolean) => setLoaded((before) => before.get(url) === ok ? before : new Map(before).set(url, ok));
  const allLoaded = lab.slides.length > 0 && lab.slides.every((item) => item.render && loaded.get(item.render.url) === true);
  const block = props.guest ? t.publicTour : dirty ? t.actions.dirty : lab.block ? t.actions.blocked[lab.block] : !allLoaded ? t.actions.imagesLoading : null;
  const publishable = post.status === 'review' && !!post.deck;
  const publishBlock = props.guest ? t.publicTour : dirty && !onlyTimeChanged ? t.actions.publishNowDirty : lab.block ? t.actions.blocked[lab.block] : !account?.enabled ? t.actions.publishNowOff : !allLoaded ? t.actions.imagesLoading : null;
  async function refresh() { await Promise.all([client.invalidateQueries({ queryKey: keys.review }), client.invalidateQueries({ queryKey: keys.costs })]); }
  async function perform(action: 'approve' | 'save' | 'return' | 'skip' | 'publish') {
    if (props.guest || busy || (action === 'approve' && block) || (action === 'publish' && publishBlock)) return;
    if (action === 'save') {
      const problems = draftProblems(post, draft, fit.status === 'ready' ? fit.result : null);
      if (!request || problems.length) { setError(problems.find((problem) => problem.field === 'scheduledAt')?.code ?? 'deck-edit-invalid'); return; }
    }
    setBusyAction(action); setError(null); setMessage('');
    try {
      const api = await dneskaiWorkspaceApi(props.preview);
      if (action === 'approve') { await api.approve(post.id, post.contentHash); setMessage(t.actions.approved(lab.deadline.time)); }
      else if (action === 'save') { const result = await api.edit(request!); onSaved(result.id); setMessage(t.actions.saved); }
      else if (action === 'publish') { const result = await api.publishNow(post.id, post.contentHash); setDialog(null); onSaved(result.id); setMessage(t.actions.publishNowDone(pragueClock(result.scheduledAt))); }
      else { await api.decide(post.id, action === 'return' ? 'returned' : 'skipped', action === 'return' ? note : undefined); setMessage(action === 'return' ? t.actions.returned : t.actions.skipped); setDialog(null); }
      await refresh();
    } catch (failure) {
      setError(failure instanceof DneskaiWorkspaceRequestError ? failure.code : 'decision-failed');
      if (failure instanceof DneskaiWorkspaceRequestError && failure.revisionId) { props.addRenderFailed(failure.revisionId); onSaved(failure.revisionId); }
      await refresh();
    } finally { setBusyAction(null); }
  }
  function shortcut(event: React.KeyboardEvent) {
    if (busy || dialog || event.altKey || event.ctrlKey || event.metaKey || (event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true],[role=dialog]')) return;
    const key = event.key.toLowerCase();
    if (props.guest && ['a','d','e','r','s','1','2','3','4','5'].includes(key)) return;
    const position = order.findIndex((item) => item.post.id === post.id);
    if (['j', 'k', 'arrowdown', 'arrowup'].includes(key)) onChoose(order[Math.max(0, Math.min(order.length - 1, position + (key === 'j' || key === 'arrowdown' ? 1 : -1)))]!.post.id);
    else if (key === 'arrowleft' || key === 'arrowright') onSlide(Math.max(0, Math.min(draft.slides.length - 1, slide + (key === 'arrowright' ? 1 : -1))));
    else if (/^[1-5]$/.test(key)) { const kit = DNESKAI_KITS[Number(key) - 1]!; if (kit !== lab.kit) setMessage(t.kits.unavailableNotice(t.kits.names[kit])); }
    else if (key === 'a') void perform('approve');
    else if (key === 'd') { if (!dirty) onBatch(); }
    else if (key === 'e') fieldRef.current?.focus();
    else if (key === 'r' || key === 's') { if (!dirty && post.status === 'review') setDialog(key === 'r' ? 'return' : 'skip'); }
    else if (key === 'g') setView(view === 'profile' ? 'feed' : 'profile');
    else if (key === '?') setDialog('shortcuts');
    else return;
    event.preventDefault();
  }
  return <div ref={rootRef} tabIndex={-1} onKeyDown={shortcut} className="min-w-0 space-y-4 focus:outline-none" data-testid="dneskai-lab-session" aria-busy={busy}>
    <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><DneskaiStateChip detail={lab.state} lang={props.lang} /><span className="text-xs text-foreground-muted tabular" title={post.contentHash}>{t.actions.version(lab.revision.shortHash)}</span></div><Button variant="ghost" size="sm" onClick={() => setDialog('shortcuts')}>{t.shortcutsButton}</Button></div>
    {message && <p role="status" className="text-sm">{message}</p>}{error && <div role="alert"><DneskaiCodeText code={error} lang={props.lang} /></div>}
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,21rem)]">
      <div className="min-w-0 space-y-3">{dirty && <p role="status" className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-warning">{t.actions.dirty} {t.savedPreview}</p>}
        <DneskaiLabStage lab={lab} slides={stageSlides} preview={preview} slide={slide} onSlide={onSlide} view={view} onView={setView} profileCovers={dneskaiLabProfileCovers(props.read, post.id)} onLoaded={onLoaded} caption={post.caption} lang={props.lang} />
      </div>
      <div className="min-w-0 space-y-5">
        <DneskaiKitTiles kits={lab.kits} chosen={lab.kit} onChoose={() => undefined} lang={props.lang} />
        <fieldset disabled={props.guest || busy || !['review', 'returned'].includes(post.status)} className="min-w-0 space-y-5">
          <legend className="sr-only">{t.post.title}</legend>
          <DneskaiSlideInspector key={slide} post={post} draft={draft} index={slide} onDraft={(next) => { setDraft(next); setFit({ status: 'checking', result: null }); }} fit={fit} previews={previews} mediaState={mediaState} lang={props.lang} firstFieldRef={(element) => { fieldRef.current = element; }} onSlide={onSlide} onNotice={setMessage} />
          <CountedField id={`${id}-caption`} label={t.post.caption} value={draft.caption} max={DNESKAI_CAPTION_MAX} multiline rows={5} lang={props.lang} onChange={(caption) => setDraft({ ...draft, caption })} />
          <div><label htmlFor={`${id}-time`} className="text-xs font-medium">{t.post.slot} · Europe/Prague</label><Input id={`${id}-time`} type="datetime-local" value={draft.scheduledLocal} aria-describedby={expired ? `${id}-time-expired` : undefined} onChange={(event) => setDraft({ ...draft, scheduledLocal: event.target.value })} />
            {expired && <p id={`${id}-time-expired`} className="mt-1 text-xs text-warning">{t.post.slotExpired(pragueClock(post.scheduledAt))}</p>}</div>
          <div><label htmlFor={`${id}-account`} className="text-xs font-medium">{t.post.account}</label><select id={`${id}-account`} value={draft.accountId ?? ''} onChange={(event) => setDraft({ ...draft, accountId: event.target.value })} className="min-h-11 w-full rounded-md border border-border bg-surface px-2 text-sm focus-ring"><option value="" disabled>@{post.account.handle}</option>{props.read.accounts.filter((item) => item.verified).map((item) => <option key={item.id} value={item.id}>@{item.handle}</option>)}</select></div>
        </fieldset>
        <section className="space-y-1 text-xs"><h4 className="font-medium">{t.post.disclosure}</h4><p className="text-foreground-muted">{post.deck?.slides.some((item) => item.type === 'sources') ? t.post.disclosureText : t.post.disclosureMissing}</p></section>
        {post.status === 'returned' && <section className="space-y-2 border-t border-border pt-3 text-xs"><p>{post.feedback}</p><Button variant="outline" size="sm" onClick={() => fieldRef.current?.focus()}>{t.actions.editByHand}</Button><p className="text-foreground-muted">{t.actions.regenerateOff}</p></section>}
        {post.brief && <details className="text-xs"><summary className="min-h-11 cursor-pointer py-3 font-medium">{t.post.sources}</summary><ul className="space-y-2">{post.brief.evidence.map((item) => <li key={item.candidateId}><a href={item.url} target="_blank" rel="noreferrer" className="break-words underline">{item.title}</a></li>)}</ul></details>}
      </div>
    </div>
    <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 md:bottom-0 space-y-2 border-t border-border bg-surface/95 py-3 backdrop-blur-sm" aria-label={t.actions.label}>
      {block && <p id={`${id}-block`} className="text-xs text-foreground-muted">{block}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button data-testid="dneskai-lab-approve" disabled={busy || !!block} aria-describedby={block ? `${id}-block` : undefined} onClick={() => void perform('approve')}>{busyAction === 'approve' ? t.actions.approving : t.actions.approve} · <span className="font-mono text-xs">{lab.revision.shortHash}</span></Button>
        <Button variant="outline" disabled={props.guest || busy || !['review', 'returned'].includes(post.status) || (!dirty && lab.block !== 'render-attach-failed')} onClick={() => void perform('save')}>{busyAction === 'save' ? t.actions.saving : t.actions.save}</Button>
        {publishable && <Button variant="outline" data-testid="dneskai-lab-publish-now" disabled={busy || !!publishBlock} title={publishBlock ?? undefined} onClick={() => setDialog('publish')}>{busyAction === 'publish' ? t.actions.approving : t.actions.publishNow}</Button>}
        {dirty && <Button variant="ghost" disabled={busy} onClick={() => setDraft(createDeckDraft(post, account?.id ?? null))}>{t.actions.discard}</Button>}
        <Button variant="ghost" disabled={props.guest || busy || dirty || post.status !== 'review'} onClick={() => setDialog('return')}>{t.actions.return}</Button><Button variant="ghost" disabled={props.guest || busy || dirty || post.status !== 'review'} onClick={() => setDialog('skip')}>{t.actions.skip}</Button>
      </div>
    </div>
    <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open && !busy) setDialog(null); }}><DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); rootRef.current?.focus(); }}>
      <DialogHeader><DialogTitle>{dialog === 'shortcuts' ? t.shortcuts.title : dialog === 'return' ? t.actions.return : dialog === 'publish' ? t.actions.publishNowTitle : t.actions.skipConfirm}</DialogTitle><DialogDescription>{dialog === 'shortcuts' ? t.shortcuts.description : dialog === 'return' ? t.actions.noteHelp : dialog === 'publish' ? t.actions.publishNowDescription : post.title}</DialogDescription></DialogHeader>
      {dialog === 'publish' ? <>
        <div className="space-y-2 text-xs" data-testid="dneskai-publish-now-summary">
          <p className="font-medium">{post.title}</p>
          <p>{t.actions.publishNowAccount(post.account.handle)} · {t.actions.publishNowSlides(lab.slides.length)} · <span className="font-mono">{t.actions.version(lab.revision.shortHash)}</span></p>
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-border p-2">{post.caption}</p>
        </div>
        {error && <div role="alert"><DneskaiCodeText code={error} lang={props.lang} /></div>}
        <div className="mt-4 flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setDialog(null)}>{t.actions.cancel}</Button><Button data-testid="dneskai-publish-now-confirm" disabled={busy || !!publishBlock} onClick={() => void perform('publish')}>{busyAction === 'publish' ? t.actions.approving : t.actions.publishNowConfirm}</Button></div>
      </> : dialog === 'shortcuts' ? <dl className="space-y-2 text-xs">{t.shortcuts.rows.map(([key, value]) => <div key={key} className="flex justify-between gap-4"><dt className="font-mono">{key}</dt><dd>{value}</dd></div>)}</dl> : <>
        {dialog === 'return' && <><label htmlFor={`${id}-note`} className="text-xs font-medium">{t.actions.note}</label><Textarea id={`${id}-note`} value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} /></>}
        <div className="mt-4 flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setDialog(null)}>{t.actions.cancel}</Button><Button disabled={busy || (dialog === 'return' && !note.trim())} onClick={() => void perform(dialog === 'return' ? 'return' : 'skip')}>{dialog === 'return' ? t.actions.sendReturn : t.actions.skipYes}</Button></div>
      </>}
    </DialogContent></Dialog>
  </div>;
}

/** Capture all hashes when opening the dialog. Refreshes never silently widen or replace this approval. */
function ApproveDay({ day, onClose, ...props }: Props & { day: DneskaiLabDay; onClose: () => void }) {
  const t = copy[props.lang], client = useQueryClient();
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set());
  const [result, setResult] = useState<DneskaiApproveManyResult | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const posts = day.posts.filter((item) => day.approvable.some((eligible) => eligible.id === item.post.id));
  const images = posts.flatMap((item) => item.slides.map((slide) => slide.render));
  const ready = images.length > 0 && images.every((image) => image && loaded.has(image.url));
  async function approve() {
    if (!ready || busy || result) return;
    setBusy(true); setError(null);
    try {
      setResult(await (await dneskaiWorkspaceApi(props.preview)).approveMany(day.approvable));
      await client.invalidateQueries({ queryKey: dneskaiWorkspaceKeys(props.projectId).review });
      await client.invalidateQueries({ queryKey: dneskaiWorkspaceKeys(props.projectId).costs });
    } catch (failure) { setError(failure instanceof DneskaiWorkspaceRequestError ? failure.code : 'decision-failed'); }
    finally { await client.invalidateQueries({ queryKey: dneskaiWorkspaceKeys(props.projectId).review }); setBusy(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><DialogContent className="max-w-3xl" data-testid="dneskai-approve-day"><DialogHeader><DialogTitle>{t.approveDay.title}</DialogTitle><DialogDescription>{t.approveDay.description(day.date)}</DialogDescription></DialogHeader>
    <ul className="space-y-4">{posts.map((item) => <li key={item.post.id} className="space-y-2 border-b border-border pb-3"><p className="text-xs font-semibold">{item.deadline.time} · {item.post.title} <span className="font-normal text-foreground-muted">{t.actions.version(item.revision.shortHash)}</span></p>
      <div className="flex gap-2 overflow-x-auto">{item.slides.map((slide) => slide.render ? <Image unoptimized key={slide.index} src={slide.render.url} alt={slide.render.alt} width={slide.render.width} height={slide.render.height} className="h-40 w-32 shrink-0 object-contain" onLoad={() => setLoaded((before) => new Set(before).add(slide.render!.url))} onError={() => setLoaded((before) => { const next = new Set(before); next.delete(slide.render!.url); return next; })} /> : <p key={slide.index} className="text-xs">{t.stage.noRender}</p>)}</div>
      <p className="whitespace-pre-wrap text-xs">{item.post.caption}</p><p className="text-xs text-foreground-muted">@{item.post.account.handle} · {item.post.scheduledAt}</p>
      {result?.results.find((entry) => entry.id === item.post.id && !entry.ok) && <div role="alert"><DneskaiCodeText code={result.results.find((entry) => entry.id === item.post.id)!.error ?? 'approval-unavailable'} lang={props.lang} /></div>}
    </li>)}</ul>
    {result && <p role="status" className="mt-3 text-sm">{t.approveDay.result(result.results.filter((item) => item.ok).length, result.results.filter((item) => !item.ok).length)}</p>}
    {error && <div role="alert"><DneskaiCodeText code={error} lang={props.lang} /></div>}
    {!ready && <p role="status" className="text-xs text-foreground-muted">{t.actions.imagesLoading}</p>}
    <div className="mt-4 flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={onClose}>{result ? t.shortcuts.close : t.actions.cancel}</Button>{!result && <Button disabled={busy || !ready} onClick={() => void approve()}>{t.approveDay.confirm(posts.length)}</Button>}</div>
  </DialogContent></Dialog>;
}

/** HH:MM in Prague for a stored instant. */
function pragueClock(iso: string) {
  return new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
