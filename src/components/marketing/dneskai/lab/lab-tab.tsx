'use client';

import { useGuardedNavigation, useUnsavedDraft } from '@/components/navigation-guard';
import { useDneskaiDraft } from './use-draft';
import { useDneskaiDraftPreview } from './use-draft-preview';
import { DneskaiAudioPicker } from './audio-picker';
import { DneskaiFormatSwitch } from './format-switch';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import Image from 'next/image';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { dneskaiLab as copy } from '@/lib/i18n/sections/dneskai-lab';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import { dneskaiDraftCaption, createDeckDraft, setDraftKit, dneskaiSlidePixelsKey, draftProblems, DNESKAI_CAPTION_MAX } from '@/lib/marketing/dneskai-deck-editor';
import { dneskaiKitRenderable, dneskaiLabOrder, dneskaiLabProfileCovers, dneskaiLabPost, dneskaiLabQueue, dneskaiMissedSlot, dneskaiNextFreeSlot, dneskaiTakenSlots, DNESKAI_KITS, type DneskaiKit, type DneskaiLabDay, type DneskaiLabPost, type DneskaiApproveManyResult } from '@/lib/marketing/dneskai-lab';
import { dneskaiWorkspaceApi, dneskaiWorkspaceKeys, DneskaiWorkspaceRequestError } from '@/lib/marketing/dneskai-workspace-client';
import { formatDneskaiDay, formatDneskaiDayTime, type DneskaiWorkspaceRead } from '@/lib/marketing/dneskai-workspace';
import { cn } from '@/lib/utils';
import { CountedField } from '../counted-field';
import { DneskaiCodeText } from '../code-text';
import { DNESKAI_TONE_TINTS, DneskaiStateChip, dneskaiStateText, dneskaiStateTint } from '../state-chip';
import { DneskaiKitTiles } from './kit-tiles';
import { DneskaiEngagementEditor } from './engagement-editor';
import { DneskaiTopicsList } from './topics-list';
import { DneskaiSlideInspector } from './slide-inspector';
import { DneskaiLabStage, type DneskaiStagePreview, type DneskaiStageSlide, type DneskaiStageView } from './stage';

type Props = { read: DneskaiWorkspaceRead; projectId: string; lang: 'en' | 'cs'; preview: boolean; refreshing: boolean; onRefresh: () => void; renderFailed: ReadonlySet<string>; addRenderFailed: (id: string) => void; guest?: boolean; onSavedRevision?: () => void };
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
  const requestNavigation = useGuardedNavigation();
  const [notice, setNotice] = useState('');
  const [batch, setBatch] = useState<DneskaiLabDay | null>(null);
  const days = useMemo(() => dneskaiLabQueue(props.read, now, props.renderFailed), [props.read, now, props.renderFailed]);
  const ordered = dneskaiLabOrder(days);
  const named = props.read.posts.find((item) => item.status !== 'superseded' && (item.id === chosen.post || item.replacesId === chosen.post));
  const active = ordered.find((item) => item.post.id === chosen.post) ?? ordered.find((item) => item.post.replacesId === chosen.post) ?? (named ? dneskaiLabPost(named, props.read, now, props.renderFailed) : null) ?? ordered.find((item) => item.post.status === 'review' && !item.deadline.passed) ?? ordered.find((item) => item.post.status === 'review') ?? ordered[0] ?? null;
  useEffect(() => {
    if (props.preview) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [props.preview]);
  const choose = (post: string) => {
    if (post === active?.post.id) return;
    requestNavigation(() => { setDirty(false); setChosen({ post, slide: 0 }); remember(post, 0); });
  };
  useEffect(() => {
    const onPop = () => { if (!dirty) setChosen(selection()); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [dirty]);
  return <section className="space-y-4" data-testid="dneskai-lab">
    <div className="flex items-center justify-between gap-3">
      <button type="button" className="min-h-11 rounded px-2 text-xs font-medium text-foreground-muted underline focus-ring md:min-h-8" onClick={() => document.getElementById(`${props.projectId}-topics-title`)?.scrollIntoView({ block: 'start', behavior: 'instant' })}>{t.topics.title}</button>
      <h2 className="sr-only">{t.title}</h2>
      <Tooltip content={props.refreshing ? dneskaiWorkspace[props.lang].refreshing : dneskaiWorkspace[props.lang].refresh}>
        <Button variant="ghost" size="icon" aria-label={props.refreshing ? dneskaiWorkspace[props.lang].refreshing : dneskaiWorkspace[props.lang].refresh} aria-busy={props.refreshing} disabled={props.refreshing || dirty} onClick={props.onRefresh} data-testid="dneskai-lab-refresh">
          <RefreshCw aria-hidden className={cn(props.refreshing && 'motion-safe:animate-spin')} />
        </Button>
      </Tooltip>
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
          <h3 className="text-xs font-semibold">{index === 0 ? t.queue.today : index === 1 ? t.queue.tomorrow : formatDneskaiDay(day.date)}</h3>
          <ol className="flex gap-2 overflow-x-auto pb-1 xl:block xl:space-y-1 xl:overflow-visible">
            {day.posts.map((item) => {
              // #173: the card's tint carries the state; its words stay in the accessible name and the tooltip.
              const state = dneskaiStateText(item.state, props.lang);
              const note = dneskaiMissedSlot(item) ? t.queue.moved : item.deadline.passed ? t.queue.passed : t.queue.timeLeft(item.deadline.minutesLeft);
              const current = active?.post.id === item.post.id;
              return <li key={item.post.id} className="w-56 shrink-0 xl:w-auto"><Tooltip content={state} side="right"><button type="button" onClick={() => choose(item.post.id)} aria-current={current ? 'true' : undefined}
                aria-label={`${item.deadline.time} ${item.post.title}, ${note}, ${state}`} data-state-tone={item.state.state}
                className={cn('min-h-11 w-full rounded-md border p-2 text-left focus-ring', dneskaiStateTint(item.state), current ? 'border-primary ring-1 ring-primary' : 'hover:border-border-strong')} data-testid="dneskai-lab-queue-post">
                <span className="block text-xs tabular">{item.deadline.time}</span>
                <span className="mt-1 block line-clamp-2 text-xs font-medium">{item.post.title}</span>
                <span className={cn('mt-1 block text-[11px]', item.deadline.urgent || dneskaiMissedSlot(item) ? 'text-warning' : 'text-foreground-muted')}>{note}</span>
              </button></Tooltip></li>;
            })}
          </ol>
          {day.jobs.map((item) => <p key={item.job.id} className={cn('rounded-md border p-2 text-xs text-foreground-muted', DNESKAI_TONE_TINTS.neutral)}>{item.deadline?.time} · {t.queue.preparing}</p>)}
          {day.waiting.length > 0 && <GenerateNow {...props} waiting={day.waiting} />}
          {!day.posts.length && !day.jobs.length && !day.waiting.length && <p className="text-xs text-foreground-muted">{t.queue.empty}</p>}
          <Button type="button" variant="outline" size="sm" className="w-full" disabled={props.guest || dirty || !day.approvable.length} onClick={() => setBatch(structuredClone(day))}>{t.queue.approveDay(day.approvable.length)}</Button>
        </section>)}
      </nav>
      {active ? <LabSession key={`${active.post.id}:${active.revision.contentHash}`} {...props} now={now} lab={active} slide={Math.min(chosen.slide, 9)}
        onSlide={(slide) => { setChosen({ post: active.post.id, slide }); remember(active.post.id, slide); }} onDirty={setDirty}
        onChoose={choose} onBatch={() => { const day = days.find((item) => item.date === active.deadline.date); if (day && !dirty && day.approvable.length) setBatch(structuredClone(day)); }}
        onSaved={(post, saved) => { props.onSavedRevision?.(); setNotice(saved ?? t.actions.saved); setDirty(false); setChosen({ post, slide: chosen.slide }); remember(post, chosen.slide); }} order={ordered} /> : <p role="status" className="text-sm text-foreground-muted">{t.stage.noPost}</p>}
    </div>

    <DneskaiTopicsList projectId={props.projectId} lang={props.lang} preview={props.preview} />
    {props.preview && <details className="border-t border-border pt-3 text-xs"><summary className="min-h-11 cursor-pointer py-3 font-medium">{t.specimens.title}</summary><div className="space-y-6">{DNESKAI_KITS.map((kit) => <figure key={kit} className="space-y-2"><figcaption className="text-foreground-muted">{t.specimens.help(t.kits.names[kit])}</figcaption><a href={`/demo/dneskai/kit-${kit}.png`} target="_blank" rel="noreferrer"><Image unoptimized src={`/demo/dneskai/kit-${kit}.png`} alt={t.specimens.help(t.kits.names[kit])} width={1944} height={2574} sizes="100vw" className="h-auto w-full" /></a></figure>)}</div></details>}
    {batch && <ApproveDay {...props} day={batch} onClose={() => setBatch(null)} />}
  </section>;
}

/** Draft problems that make the edit itself invalid, so no preview can be drawn until the owner fixes them. */
const PREVIEW_BLOCKERS = new Set(['text-missing', 'alt-missing', 'alt-too-long', 'deck-edit-slide-count']);

function LabSession({ lab, slide: requested, onSlide, onDirty, onChoose, onBatch, onSaved, order, now, ...props }: Props & { lab: DneskaiLabPost; slide: number; onSlide: (index: number) => void; onDirty: (dirty: boolean) => void; onChoose: (id: string) => void; onBatch: () => void; onSaved: (id: string, notice?: string) => void; order: DneskaiLabPost[]; now: number }) {
  const t = copy[props.lang];
  const id = useId(), client = useQueryClient(), fieldRef = useRef<HTMLElement | null>(null), rootRef = useRef<HTMLDivElement>(null);
  const post = lab.post, account = props.read.accounts.find((item) => item.remoteId === post.account.id);
  const { draft, setDraft, fit, setFit, expired, request, editable, dirty, onlyTimeChanged } = useDneskaiDraft(post, account?.id ?? null, props.preview, !!props.guest, onDirty);
  const [view, setView] = useState<DneskaiStageView>('feed');
  const [loaded, setLoaded] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [busyAction, setBusyAction] = useState<'approve' | 'save' | 'return' | 'skip' | 'publish' | 'move' | 'regenerate' | null>(null), [message, setMessage] = useState(''), [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'return' | 'skip' | 'shortcuts' | 'publish' | 'move' | 'regenerate' | null>(null), [note, setNote] = useState('');
  // Owner decision 6: the slot shown in the confirmation is the one the request binds; the server checks it again.
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  const [regenerateNote, setRegenerateNote] = useState(() => post.feedback ?? '');
  const busy = busyAction !== null;
  // The slide on show is a slide of the draft, which can have more slides than the saved version.
  const slide = Math.max(0, Math.min(requested, draft.slides.length - 1));
  // REN-01: a draft slide whose pixels differ from the saved JPEG (other words, pictures, crop, type, place or deck
  // length) is shown as a render-only preview; an unchanged one keeps showing the saved, approvable JPEG.
  const savedSlides = post.deck?.slides ?? [];
  const stageSlides: DneskaiStageSlide[] = draft.slides.map((item, index) => {
    const unchanged = draft.kit === lab.kit && draft.slides.length === savedSlides.length && item.from === index && !!savedSlides[index] && dneskaiSlidePixelsKey(item.slide) === dneskaiSlidePixelsKey(savedSlides[index]!);
    const saved = unchanged ? lab.slides[index] : undefined;
    return { index, type: item.slide.type, render: saved?.render ?? null, problems: saved?.problems ?? [], draft: unchanged ? null : item.from === null ? 'added' : 'changed', alt: item.slide.alt };
  });
  const invalidDraft = draftProblems(post, draft).some((problem) => PREVIEW_BLOCKERS.has(problem.code));
  const previewKey = !props.guest && stageSlides[slide]?.draft && request?.deck && !invalidDraft ? JSON.stringify({ deck: request.deck, slide }) : null;
  const { preview: renderedPreview, retryPreview, retryBlocked } = useDneskaiDraftPreview(previewKey, post.id, props.preview);
  const preview: DneskaiStagePreview | null = !stageSlides[slide]?.draft ? null
    : invalidDraft ? { slide, status: 'unavailable', image: null, code: 'deck-edit-invalid' }
      : previewKey ? renderedPreview : { slide, status: 'unavailable', image: null, code: null };

  const keys = dneskaiWorkspaceKeys(props.projectId);
  const media = useQueries({ queries: [...new Set((post.brief?.evidence ?? []).map((item) => item.candidateId))].slice(0, 8).map((candidateId) => ({ queryKey: keys.media(candidateId), staleTime: 30 * 60_000, retry: false,
    queryFn: async ({ signal }: { signal: AbortSignal }) => (await dneskaiWorkspaceApi(props.preview)).loadMedia(props.projectId, candidateId, signal) })) });
  const previews = useMemo(() => new Map(media.flatMap((entry) => (entry.data?.candidates ?? []).flatMap((candidate) => candidate.assets.flatMap((asset) => asset.previewUrl ? [[asset.sha256, asset.previewUrl] as const] : [])))), [media]);
  const mediaState = media.some((item) => item.isPending) ? 'loading' : media.some((item) => item.isError) ? 'unavailable' : 'ready';
  const onLoaded = (url: string, ok: boolean) => setLoaded((before) => before.get(url) === ok ? before : new Map(before).set(url, ok));
  const allLoaded = lab.slides.length > 0 && lab.slides.every((item) => item.render && loaded.get(item.render.url) === true);
  const block = props.guest ? t.publicTour : dirty ? t.actions.dirty : lab.block ? t.actions.blocked[lab.block] : !allLoaded ? t.actions.imagesLoading : null;
  const publishable = post.status === 'review' && !!post.deck;
  const canReturn = ['review', 'approved'].includes(post.status) && !['claimed', 'published', 'reconciliation'].includes(post.publication?.status ?? '');
  const publishBlock = props.guest ? t.publicTour : dirty && !onlyTimeChanged ? t.actions.publishNowDirty : lab.block ? t.actions.blocked[lab.block] : !account?.enabled ? t.actions.publishNowOff : !allLoaded ? t.actions.imagesLoading : null;
  // Owner decision 6: a post in review whose slot passed moves, as exactly this version, to the next free daily slot.
  const missed = dneskaiMissedSlot(lab);
  const nextSlot = missed ? dneskaiNextFreeSlot({ today: props.read.today, slots: props.read.slots, taken: dneskaiTakenSlots(props.read, post.id), now }) : null;
  const moveBlock = props.guest ? t.publicTour : dirty && !onlyTimeChanged ? t.actions.moved.dirty : lab.block ? t.actions.blocked[lab.block] : !nextSlot ? t.actions.moved.none : !allLoaded ? t.actions.imagesLoading : null;
  // Owner decision 8: a returned post, or one in review, can be drafted again with a note; it never approves anything.
  const regeneratable = (post.status === 'review' || post.status === 'returned') && !!post.deck;
  const regenerateBlock = props.guest ? t.publicTour : !props.read.capabilities?.regenerate ? t.actions.regenerateOff : dirty && !onlyTimeChanged ? t.actions.dirty : null;
  async function refresh() { await Promise.all([client.invalidateQueries({ queryKey: keys.review }), client.invalidateQueries({ queryKey: keys.costs })]); }
  async function perform(action: 'approve' | 'save' | 'return' | 'skip' | 'publish' | 'move' | 'regenerate'): Promise<boolean> {
    if (props.guest || busy || (action === 'return' && (!canReturn || dirty)) || (action === 'approve' && block) || (action === 'publish' && publishBlock) || (action === 'move' && (moveBlock || !moveTarget)) || (action === 'regenerate' && (regenerateBlock || !regenerateNote.trim()))) return false;
    if (action === 'save') {
      const problems = draftProblems(post, draft, fit.status === 'ready' ? fit.result : null);
      if (!request || problems.length) { setError(problems.find((problem) => problem.field === 'scheduledAt')?.code ?? problems.find((problem) => problem.field.startsWith('engagement.'))?.code ?? 'deck-edit-invalid'); return false; }
    }
    setBusyAction(action); setError(null); setMessage('');
    try {
      const api = await dneskaiWorkspaceApi(props.preview);
      if (action === 'approve') { await api.approve(post.id, post.contentHash); setMessage(t.actions.approved(lab.deadline.time)); }
      else if (action === 'save') { const result = await api.edit(request!); onSaved(result.id); setMessage(t.actions.saved); }
      else if (action === 'publish') { const result = await api.publishNow(post.id, post.contentHash); const done = t.actions.publishNowDone(pragueClock(result.scheduledAt)); setDialog(null); onSaved(result.id, done); setMessage(done); }
      else if (action === 'move') { const result = await api.approveAt(post.id, post.contentHash, moveTarget!); const done = t.actions.moved.done(pragueClock(result.scheduledAt)); setDialog(null); onSaved(result.id, done); setMessage(done); }
      else if (action === 'regenerate') {
        const result = await api.regenerate(post.id, post.contentHash, regenerateNote);
        setDialog(null);
        if (result.status === 'failed') setError(result.errorCode ?? 'worker-execution-failed');
        if (result.status === 'review' && result.revisionId) onSaved(result.revisionId, t.actions.regenerateDone);
        setMessage(result.status === 'review' ? t.actions.regenerateDone : result.status === 'queued' ? t.actions.regenerateQueued : t.actions.regenerateFailed);
      }
      else { await api.decide(post.id, action === 'return' ? 'returned' : 'skipped', action === 'return' ? note : undefined); setMessage(action === 'return' ? t.actions.returned : t.actions.skipped); setDialog(null); }
      await refresh();
      return true;
    } catch (failure) {
      setError(failure instanceof DneskaiWorkspaceRequestError ? failure.code : 'decision-failed');
      if (failure instanceof DneskaiWorkspaceRequestError && failure.revisionId) { props.addRenderFailed(failure.revisionId); onSaved(failure.revisionId); }
      await refresh();
      return false;
    } finally { setBusyAction(null); }
  }
  useUnsavedDraft({ pending: busy, dirty, canSave: !busy && !!request && draftProblems(post, draft, fit.status === 'ready' ? fit.result : null).length === 0, save: () => perform('save') });
  // A kit switch is a draft edit: every slide shows as a render-only preview in the new kit until it is saved.
  function chooseKit(kit: DneskaiKit) {
    if (props.guest || busy || !editable) return;
    if (!dneskaiKitRenderable(kit)) { setMessage(t.kits.unavailableNotice(t.kits.names[kit])); return; }
    if (kit !== draft.kit) { setDraft(setDraftKit(draft, kit)); setFit({ status: 'checking', result: null }); }
  }
  function shortcut(event: React.KeyboardEvent) {
    if (event.defaultPrevented || busy || dialog || event.altKey || event.ctrlKey || event.metaKey || (event.target as HTMLElement).closest('input,textarea,select,button,a,summary,[contenteditable=true],[role=dialog],[role=region],[role=slider],[role=tab],[role=radio]')) return;
    const key = event.key.toLowerCase();
    if (props.guest && ['a','d','e','r','s','1','2','3','4','5','6'].includes(key)) return;
    const position = order.findIndex((item) => item.post.id === post.id);
    if (['j', 'k', 'arrowdown', 'arrowup'].includes(key)) onChoose(order[Math.max(0, Math.min(order.length - 1, position + (key === 'j' || key === 'arrowdown' ? 1 : -1)))]!.post.id);
    else if (key === 'arrowleft' || key === 'arrowright') onSlide(Math.max(0, Math.min(draft.slides.length - 1, slide + (key === 'arrowright' ? 1 : -1))));
    else if (/^[1-6]$/.test(key)) { const kit = DNESKAI_KITS[Number(key) - 1]!; chooseKit(kit); }
    else if (key === 'a') void perform('approve');
    else if (key === 'd') { if (!dirty) onBatch(); }
    else if (key === 'e') fieldRef.current?.focus();
    else if (key === 'r' || key === 's') { if (!dirty && (key === 'r' ? canReturn : post.status === 'review')) setDialog(key === 'r' ? 'return' : 'skip'); }
    else if (key === 'g') setView(view === 'profile' ? 'feed' : 'profile');
    else if (key === '?') setDialog('shortcuts');
    else return;
    event.preventDefault();
  }
  return <div ref={rootRef} tabIndex={-1} onKeyDown={shortcut} className="min-w-0 space-y-4 focus:outline-none" data-testid="dneskai-lab-session" aria-busy={busy}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="min-w-0 text-sm font-semibold">{post.title}</h3><DneskaiStateChip detail={lab.state} lang={props.lang} /></div>
    {message && <p role="status" className="text-sm">{message}</p>}{error && <div role="alert"><DneskaiCodeText code={error} lang={props.lang} /></div>}
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,21rem)]">
      <div className="min-w-0 space-y-3">{missed && <section aria-labelledby={`${id}-moved`} className="space-y-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-xs" data-testid="dneskai-lab-moved">
          <h3 id={`${id}-moved`} className="font-semibold text-warning">{t.actions.moved.title}</h3>
          <p>{nextSlot ? t.actions.moved.help(pragueClock(post.scheduledAt), slotLabel(nextSlot, props.read.today, props.lang)) : t.actions.moved.none}</p>
          {nextSlot && <><Button size="sm" data-testid="dneskai-lab-move" disabled={busy || !!moveBlock} aria-describedby={moveBlock ? `${id}-move-block` : undefined} onClick={() => { setMoveTarget(nextSlot); setError(null); setDialog('move'); }}>{t.actions.moved.button(slotLabel(nextSlot, props.read.today, props.lang))}</Button>
            {moveBlock && <p id={`${id}-move-block`} className="text-foreground-muted">{moveBlock}</p>}</>}
        </section>}
        {dirty && <p role="status" className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-warning">{t.actions.dirty} {t.savedPreview}</p>}
        <DneskaiLabStage lab={lab} slides={stageSlides} preview={preview} onRetryPreview={retryPreview} retryBlocked={retryBlocked} slide={slide} onSlide={onSlide} view={view} onView={setView} profileCovers={dneskaiLabProfileCovers(props.read, post.id)} onLoaded={onLoaded} caption={post.caption} lang={props.lang} />
      </div>
      <div className="min-w-0 space-y-5">
        <DneskaiKitTiles kits={lab.kits} chosen={draft.kit} onChoose={chooseKit} lang={props.lang} />
        <fieldset disabled={props.guest || busy || !['review', 'returned'].includes(post.status)} className="min-w-0 space-y-5">
          <legend className="sr-only">{t.post.title}</legend>
          <DneskaiSlideInspector key={slide} post={post} draft={draft} index={slide} onDraft={(next) => { setDraft(next); setFit({ status: 'checking', result: null }); }} fit={fit} previews={previews} mediaState={mediaState} lang={props.lang} firstFieldRef={(element) => { fieldRef.current = element; }} onSlide={onSlide} onNotice={setMessage} />
          <CountedField id={`${id}-caption`} label={t.post.caption} value={draft.caption} max={DNESKAI_CAPTION_MAX} count={caption => dneskaiDraftCaption({ ...draft, caption }).length} help={draft.engagement ? dneskaiWorkspace[props.lang].editor.captionCountHelp : undefined} multiline rows={5} lang={props.lang} onChange={(caption) => setDraft({ ...draft, caption })} />
          {post.deck?.format === 'carousel' && <DneskaiFormatSwitch value={draft.format} onChange={(format) => setDraft({ ...draft, format })} preview={props.preview} lang={props.lang} />}
          {props.read.capabilities?.engagement && <DneskaiEngagementEditor id={`${id}-engagement`} draft={draft} onDraft={setDraft} handle={post.account.handle} lang={props.lang} />}
          {draft.format === 'reel' && <DneskaiAudioPicker value={draft.audioTrackId} onChange={(audioTrackId) => setDraft({ ...draft, audioTrackId })} preview={props.preview} lang={props.lang} />}
          {post.deck?.format === 'single-image' && <p className="text-xs text-foreground-muted">{t.post.reelRequiresDeck}</p>}
          <div><label htmlFor={`${id}-time`} className="text-xs font-medium">{t.post.slot} · Europe/Prague</label><Input id={`${id}-time`} type="datetime-local" value={draft.scheduledLocal} aria-describedby={expired ? `${id}-time-expired` : undefined} onChange={(event) => setDraft({ ...draft, scheduledLocal: event.target.value })} />
            {expired && <p id={`${id}-time-expired`} className="mt-1 text-xs text-warning">{t.post.slotExpired(pragueClock(post.scheduledAt))}</p>}</div>
        </fieldset>
        <section className="space-y-1 text-xs"><h4 className="font-medium">{t.post.disclosure}</h4><p className="text-foreground-muted">{post.deck?.slides.some((item) => item.type === 'sources') ? t.post.disclosureText : t.post.disclosureMissing}</p></section>
        {post.status === 'returned' && <section className="space-y-2 border-t border-border pt-3 text-xs"><p>{post.feedback}</p><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => fieldRef.current?.focus()}>{t.actions.editByHand}</Button>
          {regeneratable && <Button variant="outline" size="sm" data-testid="dneskai-lab-regenerate" disabled={busy || !!regenerateBlock} aria-describedby={regenerateBlock ? `${id}-regenerate-block` : undefined} onClick={() => { setError(null); setDialog('regenerate'); }}>{t.actions.regenerate}</Button>}</div>
          {regenerateBlock && <p id={`${id}-regenerate-block`} className="text-foreground-muted">{regenerateBlock}</p>}</section>}
        {post.brief && <details className="text-xs"><summary className="min-h-11 cursor-pointer py-3 font-medium">{t.post.sources}</summary><ul className="space-y-2">{post.brief.evidence.map((item) => <li key={item.candidateId}><a href={item.url} target="_blank" rel="noreferrer" className="break-words underline">{item.title}</a></li>)}</ul></details>}
      </div>
    </div>
    <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 md:bottom-0 space-y-2 border-t border-border bg-surface/95 py-3 backdrop-blur-sm" aria-label={t.actions.label}>
      {block && <p id={`${id}-block`} className="text-xs text-foreground-muted">{block}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button data-testid="dneskai-lab-approve" disabled={busy || !!block} aria-describedby={block ? `${id}-block` : undefined} onClick={() => void perform('approve')}>{busyAction === 'approve' ? t.actions.approving : t.actions.approve} · <span className="font-mono text-xs">{lab.revision.shortHash}</span></Button>
        <Button variant="outline" disabled={props.guest || busy || !['review', 'returned'].includes(post.status) || (!dirty && lab.block !== 'render-attach-failed')} onClick={() => void perform('save')}>{busyAction === 'save' ? t.actions.saving : t.actions.save}</Button>
        {post.status === 'review' && regeneratable && <Button variant="outline" data-testid="dneskai-lab-regenerate" disabled={busy || !!regenerateBlock} title={regenerateBlock ?? undefined} onClick={() => { setError(null); setDialog('regenerate'); }}>{busyAction === 'regenerate' ? t.actions.regenerating : t.actions.regenerate}</Button>}
        {dirty && <Button variant="ghost" disabled={busy} onClick={() => setDraft(createDeckDraft(post, account?.id ?? null))}>{t.actions.discard}</Button>}
        <div className="flex flex-wrap items-center gap-2 border-l border-border pl-3 sm:ml-auto">
        {publishable && <Button variant="outline" data-testid="dneskai-lab-publish-now" disabled={busy || !!publishBlock} title={publishBlock ?? undefined} onClick={() => setDialog('publish')}>{busyAction === 'publish' ? t.actions.approving : t.actions.publishNow}</Button>}
        <Button variant="ghost" disabled={props.guest || busy || dirty || !canReturn} onClick={() => setDialog('return')}>{t.actions.return}</Button><Button variant="ghost" disabled={props.guest || busy || dirty || post.status !== 'review'} onClick={() => setDialog('skip')}>{t.actions.skip}</Button>
        </div>
      </div>
    </div>
    <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open && !busy) setDialog(null); }}><DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); rootRef.current?.focus(); }}>
      <DialogHeader><DialogTitle>{dialog === 'shortcuts' ? t.shortcuts.title : dialog === 'return' ? t.actions.return : dialog === 'publish' ? t.actions.publishNowTitle : dialog === 'move' ? t.actions.moved.dialogTitle(moveTarget ? slotLabel(moveTarget, props.read.today, props.lang) : '') : dialog === 'regenerate' ? t.actions.regenerateTitle : t.actions.skipConfirm}</DialogTitle><DialogDescription>{dialog === 'shortcuts' ? t.shortcuts.description : dialog === 'return' ? t.actions.noteHelp : dialog === 'publish' ? t.actions.publishNowDescription : dialog === 'move' ? t.actions.moved.dialogDescription : dialog === 'regenerate' ? t.actions.regenerateDescription : post.title}</DialogDescription></DialogHeader>
      {dialog === 'move' ? <>
        <div className="space-y-2 text-xs" data-testid="dneskai-move-summary">
          <p className="font-medium">{post.title}</p>
          <p>{t.actions.publishNowAccount(post.account.handle)} · {t.actions.publishNowSlides(lab.slides.length)} · <span className="font-mono">{t.actions.version(lab.revision.shortHash)}</span></p>
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-border p-2">{post.caption}</p>
        </div>
        {error && <div role="alert"><DneskaiCodeText code={error} lang={props.lang} /></div>}
        <div className="mt-4 flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setDialog(null)}>{t.actions.cancel}</Button><Button data-testid="dneskai-move-confirm" disabled={busy || !!moveBlock} onClick={() => void perform('move')}>{busyAction === 'move' ? t.actions.approving : t.actions.moved.confirm}</Button></div>
      </> : dialog === 'regenerate' ? <>
        <label htmlFor={`${id}-regenerate-note`} className="text-xs font-medium">{t.actions.regenerateNote}</label>
        <Textarea id={`${id}-regenerate-note`} data-testid="dneskai-regenerate-note" value={regenerateNote} maxLength={1000} aria-describedby={`${id}-regenerate-help`} onChange={(event) => setRegenerateNote(event.target.value)} />
        <p id={`${id}-regenerate-help`} className="text-xs text-foreground-muted">{t.actions.regenerateNoteHelp}</p>
        {error && <div role="alert"><DneskaiCodeText code={error} lang={props.lang} /></div>}
        <div className="mt-4 flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setDialog(null)}>{t.actions.cancel}</Button><Button data-testid="dneskai-regenerate-confirm" disabled={busy || !!regenerateBlock || !regenerateNote.trim()} onClick={() => void perform('regenerate')}>{busyAction === 'regenerate' ? t.actions.regenerating : t.actions.regenerateConfirm}</Button></div>
      </> : dialog === 'publish' ? <>
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
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><DialogContent className="max-w-3xl" data-testid="dneskai-approve-day"><DialogHeader><DialogTitle>{t.approveDay.title}</DialogTitle><DialogDescription>{t.approveDay.description(formatDneskaiDay(day.date))}</DialogDescription></DialogHeader>
    <ul className="space-y-4">{posts.map((item) => <li key={item.post.id} className="space-y-2 border-b border-border pb-3"><p className="text-xs font-semibold">{item.deadline.time} · {item.post.title} <span className="font-normal text-foreground-muted">{t.actions.version(item.revision.shortHash)}</span></p>
      <div className="flex gap-2 overflow-x-auto">{item.slides.map((slide) => slide.render ? <Image unoptimized key={slide.index} src={slide.render.url} alt={slide.render.alt} width={slide.render.width} height={slide.render.height} className="h-40 w-32 shrink-0 object-contain" onLoad={() => setLoaded((before) => new Set(before).add(slide.render!.url))} onError={() => setLoaded((before) => { const next = new Set(before); next.delete(slide.render!.url); return next; })} /> : <p key={slide.index} className="text-xs">{t.stage.noRender}</p>)}</div>
      <p className="whitespace-pre-wrap text-xs">{item.post.caption}</p><p className="text-xs text-foreground-muted">@{item.post.account.handle} · <time dateTime={item.post.scheduledAt} className="tabular">{formatDneskaiDayTime(item.post.scheduledAt)}</time></p>
      {result?.results.find((entry) => entry.id === item.post.id && !entry.ok) && <div role="alert"><DneskaiCodeText code={result.results.find((entry) => entry.id === item.post.id)!.error ?? 'approval-unavailable'} lang={props.lang} /></div>}
    </li>)}</ul>
    {result && <p role="status" className="mt-3 text-sm">{t.approveDay.result(result.results.filter((item) => item.ok).length, result.results.filter((item) => !item.ok).length)}</p>}
    {error && <div role="alert"><DneskaiCodeText code={error} lang={props.lang} /></div>}
    {!ready && <p role="status" className="text-xs text-foreground-muted">{t.actions.imagesLoading}</p>}
    <div className="mt-4 flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={onClose}>{result ? t.shortcuts.close : t.actions.cancel}</Button>{!result && <Button disabled={busy || !ready} onClick={() => void approve()}>{t.approveDay.confirm(posts.length)}</Button>}</div>
  </DialogContent></Dialog>;
}

/**
 * „Generate now“ for the topics of one day that wait for the scheduler (owner decision 9). Each button names its topic;
 * the outcome or the refusal is announced in a polite status region under the list.
 */
function GenerateNow({ waiting, ...props }: Props & { waiting: DneskaiLabDay['waiting'] }) {
  const t = copy[props.lang], client = useQueryClient(), id = useId();
  const [busy, setBusy] = useState<string | null>(null), [message, setMessage] = useState(''), [error, setError] = useState<string | null>(null);
  const off = props.guest || !props.read.capabilities?.generateNow;
  async function generate(briefId: string) {
    if (off || busy) return;
    setBusy(briefId); setMessage(''); setError(null);
    try {
      const result = await (await dneskaiWorkspaceApi(props.preview)).generateNow(briefId);
      if (result.status === 'failed') { setMessage(t.queue.generateNowFailed); setError(result.errorCode ?? 'worker-execution-failed'); }
      else setMessage(result.status === 'review' ? t.queue.generateNowDone : t.queue.generateNowQueued);
    } catch (failure) { setError(failure instanceof DneskaiWorkspaceRequestError ? failure.code : 'generate-now-unavailable'); }
    finally {
      setBusy(null);
      await Promise.all([client.invalidateQueries({ queryKey: dneskaiWorkspaceKeys(props.projectId).review }), client.invalidateQueries({ queryKey: dneskaiWorkspaceKeys(props.projectId).costs })]);
    }
  }
  return <div className="space-y-2" data-testid="dneskai-lab-waiting">
    <ul className="space-y-2">{waiting.map((brief) => <li key={brief.briefId} className="space-y-1 rounded-md border border-dashed border-border p-2 text-xs">
      <p><span className="tabular">{pragueClock(brief.scheduledAt)}</span> · <span className="text-foreground-muted">{t.queue.waiting}</span></p>
      <p className="line-clamp-2 font-medium">{brief.title}</p>
      <Button type="button" variant="outline" size="sm" className="min-h-11 w-full" disabled={off || busy !== null} aria-label={t.queue.generateNowName(brief.title)} aria-describedby={`${id}-help`} onClick={() => void generate(brief.briefId)}>{busy === brief.briefId ? t.queue.generating : t.queue.generateNow}</Button>
    </li>)}</ul>
    <p id={`${id}-help`} className="text-[11px] text-foreground-muted">{props.guest ? t.publicTour : off ? t.queue.generateNowOff : t.queue.generateNowHelp}</p>
    <div role="status" className="text-xs">{message}{error && <DneskaiCodeText code={error} lang={props.lang} />}</div>
  </div>;
}

/** HH:MM in Prague, with the day named when the slot is tomorrow. */
function slotLabel(iso: string, today: string, lang: 'en' | 'cs') {
  const time = pragueClock(iso);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague' }).format(new Date(iso)) === today ? time : `${copy[lang].queue.tomorrow.toLocaleLowerCase(lang)} ${time}`;
}

/** HH:MM in Prague for a stored instant. */
function pragueClock(iso: string) {
  return new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
