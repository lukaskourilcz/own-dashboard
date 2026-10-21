'use client';

import { useCallback, useId, useMemo, useState } from 'react';
import Image from 'next/image';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, GripVertical, ImageIcon, ImageOff, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import {
  characterCount, createDeckDraft, DNESKAI_CAPTION_MAX, dneskaiEditRequest, draftProblems, imageFocal, imageZoom, moveSlide, removeSlide, setImageCrop, setSlideText,
  swapSlideImage, type DeckDraft, type DraftProblem,
} from '@/lib/marketing/dneskai-deck-editor';
import { dneskaiWorkspaceApi, dneskaiWorkspaceKeys, DneskaiWorkspaceRequestError, type DneskaiEditResult } from '@/lib/marketing/dneskai-workspace-client';
import { dneskaiPostState, dneskaiStateContext, renderBlocking, type DneskaiWorkspacePost, type DneskaiWorkspaceRead } from '@/lib/marketing/dneskai-workspace';
import type { DneskaiFieldLimit } from '@/lib/marketing/dneskai-workspace';
import { cn } from '@/lib/utils';
import { DneskaiSlideStrip } from './slide-strip';
import { DneskaiFocalPicker } from './focal-picker';
import { DneskaiMediaTray } from './media-tray';
import { DneskaiRenderProblems, dneskaiFieldLabel } from './render-problems';
import { DneskaiCodeText, DneskaiDetails } from './code-text';
import { DneskaiStateChip } from './state-chip';

type Lang = 'en' | 'cs';
const shortHash = (hash: string) => hash.slice(0, 7);

/** Whether the owner may approve this exact version now, and if not, why. */
export function dneskaiApprovalBlock(post: DneskaiWorkspacePost, read: Pick<DneskaiWorkspaceRead, 'accounts' | 'generatedAt'>, loaded: boolean, lang: Lang, renderFailed?: ReadonlySet<string>): string | null {
  const t = dneskaiWorkspace[lang].card;
  const detail = dneskaiPostState(post, dneskaiStateContext(read, renderFailed));
  if (post.status !== 'review') return t.blockedStatus;
  if (renderBlocking(post.renderReport)) return t.blockedRender;
  if (detail.code === 'render-attach-failed') return t.blockedAttach;
  if (!post.ready || detail.state === 'preparing') return t.blockedPreparing;
  if (!read.accounts.some((account) => account.verified && account.remoteId === post.account.id)) return t.blockedAccount;
  if (!loaded) return t.blockedImages;
  return null;
}

/**
 * The post editor (#119): one dialog with the current version's slides, the selected slide's written fields (only
 * those its template draws, with counters), its pictures (swap from the topic's pool, focal point, zoom), removing
 * and ordering slides, and the caption, time and account. Saving renders a new version; the one main button is then
 * „Approve and schedule“ with the new version's hash. Radix keeps focus inside and Escape returns it to the opener.
 */
export function DneskaiPostEditor({ open, onOpenChange, postId, initialSlide, read, projectId, lang, preview, onSaved, onRenderFailed, renderFailed, onApprove, approving, returnFocus }: {
  open: boolean; onOpenChange: (open: boolean) => void; postId: string | null; initialSlide: number; read: DneskaiWorkspaceRead; projectId: string; lang: Lang; preview: boolean;
  onSaved: (result: DneskaiEditResult, previousId: string) => void; onApprove: (post: DneskaiWorkspacePost) => Promise<boolean>; approving: boolean;
  /** An edit saved a new version, then its render did not attach (502 render-attach-failed): the editor moves to that version. */
  onRenderFailed?: (id: string, previousId: string) => void;
  /** Versions this session saw fail to attach; they read as a problem at once instead of after the grace period. */
  renderFailed?: ReadonlySet<string>;
  /** Where focus goes when the editor closes: the control that opened it, or a stable fallback when that is gone. */
  returnFocus?: () => void;
}) {
  const t = dneskaiWorkspace[lang];
  // A failed save may still have replaced the open version (a timeout after saving); then the editor follows its successor.
  const post = postId ? read.posts.find((item) => item.id === postId) ?? read.posts.find((item) => item.replacesId === postId && item.status !== 'superseded') ?? null : null;
  // Kept here, not in the body: a save switches the editor to the new version, which remounts the body.
  const [notice, setNotice] = useState('');
  return <Dialog open={open} onOpenChange={(next) => { if (!next) setNotice(''); onOpenChange(next); }}>
    <DialogContent className="max-h-[94dvh] w-[calc(100%-1rem)] max-w-6xl p-4 sm:p-5" data-testid="dneskai-post-editor"
      onCloseAutoFocus={(event) => { if (returnFocus) { event.preventDefault(); returnFocus(); } }}>
      <DialogHeader>
        <DialogTitle>{t.editor.title}</DialogTitle>
        <DialogDescription>{post ? `${post.title} · ${t.editor.description}` : t.editor.description}</DialogDescription>
      </DialogHeader>
      {post ? <EditorBody key={post.id} post={post} read={read} initialSlide={initialSlide} projectId={projectId} lang={lang} preview={preview} onSaved={onSaved} onApprove={onApprove} approving={approving}
        onRenderFailed={onRenderFailed} renderFailed={renderFailed}
        notice={notice} setNotice={setNotice} onClose={() => { setNotice(''); onOpenChange(false); }} />
        : <p role="status" className="py-6 text-sm text-foreground-muted">{t.editor.waiting}</p>}
    </DialogContent>
  </Dialog>;
}

function EditorBody({ post, read, initialSlide, projectId, lang, preview, onSaved, onRenderFailed, renderFailed, onApprove, approving, onClose, notice, setNotice }: {
  post: DneskaiWorkspacePost; read: DneskaiWorkspaceRead; initialSlide: number; projectId: string; lang: Lang; preview: boolean;
  onSaved: (result: DneskaiEditResult, previousId: string) => void; onApprove: (post: DneskaiWorkspacePost) => Promise<boolean>; approving: boolean; onClose: () => void;
  onRenderFailed?: (id: string, previousId: string) => void; renderFailed?: ReadonlySet<string>;
  notice: string; setNotice: (notice: string) => void;
}) {
  const t = dneskaiWorkspace[lang];
  const id = useId();
  const queryClient = useQueryClient();
  const currentAccount = read.accounts.find((account) => account.remoteId === post.account.id) ?? null;
  const [draft, setDraft] = useState<DeckDraft>(() => createDeckDraft(post, currentAccount?.id ?? null));
  const [selected, setSelected] = useState(() => Math.min(Math.max(initialSlide, 0), Math.max(0, (post.deck?.slides.length ?? 1) - 1)));
  const [swapSlot, setSwapSlot] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<DraftProblem[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const onLoadedChange = useCallback((value: boolean) => setLoaded(value), []);
  const keys = dneskaiWorkspaceKeys(projectId);
  const candidates = (post.brief?.evidence ?? []).map((item) => item.candidateId).slice(0, 8);
  const media = useQueries({ queries: candidates.map((candidateId) => ({
    queryKey: keys.media(candidateId), staleTime: 30 * 60_000, retry: false, refetchOnWindowFocus: false,
    queryFn: async ({ signal }: { signal: AbortSignal }) => (await dneskaiWorkspaceApi(preview)).loadMedia(projectId, candidateId, signal),
  })) });
  const previews = useMemo(() => {
    const map = new Map<string, string>();
    for (const result of media) for (const candidate of result.data?.candidates ?? []) for (const asset of candidate.assets) if (asset.previewUrl) map.set(asset.sha256, asset.previewUrl);
    return map;
  }, [media]);
  const mediaState = media.some((result) => result.isPending) ? 'loading' as const : media.some((result) => result.isError) ? 'unavailable' as const : 'ready' as const;

  const request = useMemo(() => { try { return dneskaiEditRequest(post, draft, draft.accountId && draft.accountId !== currentAccount?.id ? draft.accountId : null); } catch { return null; } }, [post, draft, currentAccount]);
  const dirty = !request || !!request.deck || request.caption !== post.caption || request.scheduledAt !== post.scheduledAt || !!request.accountId;
  const detail = dneskaiPostState(post, dneskaiStateContext(read, renderFailed));
  // A version whose slides never attached can be saved unchanged: that renders it again as a new version.
  const rerender = detail.code === 'render-attach-failed';
  const block = dneskaiApprovalBlock(post, read, loaded, lang, renderFailed);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ids = draft.slides.map((item) => `slide-${item.from}`);
  const minimum = post.deck?.format === 'single-image' ? 1 : 2;

  function update(next: DeckDraft, message = '') { setDraft(next); setProblems([]); setFailure(null); if (message) setNotice(message); }
  function move(from: number, to: number) {
    if (to < 0 || to >= draft.slides.length) return;
    update(moveSlide(draft, from, to), t.editor.moved(to + 1));
    setSelected(to);
  }
  function onDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    move(ids.indexOf(String(event.active.id)), ids.indexOf(String(event.over.id)));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const found = draftProblems(post, draft);
    if (found.length) { setProblems(found); setNotice(''); return; }
    if ((!dirty && !rerender) || !request) { setNotice(t.editor.unchanged); return; }
    setSaving(true); setFailure(null); setNotice(t.editor.saving);
    try {
      const result = await (await dneskaiWorkspaceApi(preview)).edit(request);
      // The editor moves to the new version at once and waits for it; the old one is superseded.
      setNotice(result.ready ? t.editor.saved : t.editor.savedBlocked);
      onSaved(result, post.id);
      void queryClient.invalidateQueries({ queryKey: keys.review });
      void queryClient.invalidateQueries({ queryKey: keys.costs });
    } catch (error) {
      setFailure(error instanceof DneskaiWorkspaceRequestError ? error.code : 'decision-failed');
      setNotice('');
      // The server may have saved a new version and superseded this one before failing; read again either way.
      if (error instanceof DneskaiWorkspaceRequestError && error.code === 'render-attach-failed' && error.revisionId) onRenderFailed?.(error.revisionId, post.id);
      void queryClient.invalidateQueries({ queryKey: keys.review });
      void queryClient.invalidateQueries({ queryKey: keys.costs });
    } finally { setSaving(false); }
  }

  const current = draft.slides[selected];
  const problemText = (problem: DraftProblem) => {
    const field = dneskaiFieldLabel(problem.field, lang) ?? problem.field;
    const message = t.draftProblems[problem.code];
    return problem.code === 'deck-edit-slide-count' ? message : `${problem.slide !== null ? `${t.card.problemSlide(problem.slide + 1)} · ` : ''}${field} ${message}`;
  };

  return <form onSubmit={save} className="space-y-4" aria-busy={saving} noValidate>
    <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-muted">
      <DneskaiStateChip detail={detail} lang={lang} />
      <span className="tabular">{new Intl.DateTimeFormat(lang === 'cs' ? 'cs-CZ' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Prague' }).format(new Date(post.scheduledAt))}</span>
      <span>@{post.account.handle}</span>
    </div>
    <DneskaiSlideStrip compact post={post} lang={lang} selected={selected} onLoadedChange={onLoadedChange} label={`${t.card.slides}: ${post.title}`}
      onOpenSlide={(index) => { const at = draft.slides.findIndex((item) => item.from === index); if (at >= 0) setSelected(at); }} />
    {post.renderReport && <DneskaiRenderProblems problems={post.renderReport.problems} lang={lang} />}
    {detail.state === 'problem' && !post.renderReport?.problems.length && <DneskaiCodeText code={detail.code} lang={lang} />}

    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,16.5rem)_minmax(0,1fr)_minmax(0,18rem)]">
      <section aria-labelledby={`${id}-slides`} className="min-w-0 space-y-2">
        <h3 id={`${id}-slides`} className="text-xs font-semibold">{t.editor.slides}</h3>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}
          accessibility={{ screenReaderInstructions: { draggable: t.editor.drag }, announcements: {
            onDragStart: () => t.editor.drag, onDragOver: ({ over }) => over ? t.editor.moved(ids.indexOf(String(over.id)) + 1) : '', onDragEnd: ({ over }) => over ? t.editor.moved(ids.indexOf(String(over.id)) + 1) : '', onDragCancel: () => '' } }}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ol className="space-y-1">{draft.slides.map((item, index) => <SlideRow key={ids[index]} id={ids[index]!} index={index} count={draft.slides.length} item={item} post={post} lang={lang}
              selected={selected === index} onSelect={() => { setSelected(index); setSwapSlot(null); }} onMove={(delta) => move(index, index + delta)}
              canRemove={draft.slides.length > minimum} onRemove={() => { update(removeSlide(draft, index), t.editor.removed); setSelected(Math.max(0, Math.min(index, draft.slides.length - 2))); }} />)}</ol>
          </SortableContext>
        </DndContext>
      </section>

      <section aria-labelledby={`${id}-slide`} className="min-w-0 space-y-4" data-testid="dneskai-slide-editor">
        {current && <>
          <h3 id={`${id}-slide`} className="text-sm font-semibold">{t.card.slide(selected + 1, draft.slides.length)} · {t.slideTypes[current.slide.type]}</h3>
          <SlideFields item={current} index={selected} lang={lang} onChange={(field, value) => update(setSlideText(draft, selected, field, value))} />
          {current.slide.images.length > 0 && current.slide.type !== 'sources' && <div className="space-y-4">
            <h4 className="text-xs font-semibold">{t.editor.pictures}</h4>
            {current.slide.images.map((image) => {
              const pool = post.brief?.media.find((item) => item.assetSha256 === image.assetSha256);
              const label = `${t.card.problemSlide(selected + 1)} · ${t.editor.place(image.slot)}`;
              return <div key={image.slot} className="min-w-0 space-y-2 border-t border-border pt-3">
                <p className="text-xs font-medium">{t.editor.place(image.slot)}{pool ? ` · ${pool.credit}` : ''}</p>
                <DneskaiFocalPicker lang={lang} label={label} src={previews.get(image.assetSha256) ?? null} width={pool?.width ?? 1080} height={pool?.height ?? 1350}
                  focal={imageFocal(image)} zoom={imageZoom(image)} onFocal={(focal) => update(setImageCrop(draft, selected, image.slot, { focal }))} onZoom={(zoom) => update(setImageCrop(draft, selected, image.slot, { zoom }))} />
                {post.brief && <Button type="button" variant="outline" size="sm" aria-expanded={swapSlot === image.slot} aria-controls={`${id}-tray-${image.slot}`}
                  onClick={() => setSwapSlot(swapSlot === image.slot ? null : image.slot)}><ImageIcon />{swapSlot === image.slot ? t.editor.closeSwap : t.editor.swap}</Button>}
                {post.brief && swapSlot === image.slot && <div id={`${id}-tray-${image.slot}`}><DneskaiMediaTray lang={lang} brief={post.brief} slide={current.slide} current={image.assetSha256} previews={previews} state={mediaState}
                  headingId={`${id}-pool-${image.slot}`} onChoose={(choice) => { update(swapSlideImage(draft, selected, image.slot, choice, post.brief!.media), t.editor.chosen); setSwapSlot(null); }} /></div>}
              </div>;
            })}
          </div>}
          <details className="space-y-2">
            <summary className="inline-flex min-h-11 cursor-pointer items-center rounded text-xs font-semibold focus-ring md:min-h-6">{t.fields.alt}</summary>
            <CountedField id={`${id}-alt-${selected}`} label={t.fields.alt} help={t.editor.altHelp} value={current.slide.alt} max={1000} multiline lang={lang} onChange={(value) => update(setSlideText(draft, selected, 'alt', value))} />
          </details>
        </>}
      </section>

      <section aria-labelledby={`${id}-post`} className="min-w-0 space-y-3">
        <h3 id={`${id}-post`} className="text-xs font-semibold">{t.editor.post}</h3>
        <CountedField id={`${id}-caption`} label={t.editor.caption} value={draft.caption} max={DNESKAI_CAPTION_MAX} multiline rows={10} lang={lang} onChange={(value) => update({ ...draft, caption: value })} />
        <div className="space-y-1">
          <label htmlFor={`${id}-time`} className="text-xs font-medium text-foreground-muted">{t.editor.time}</label>
          <Input id={`${id}-time`} type="datetime-local" value={draft.scheduledLocal} aria-describedby={`${id}-time-help`} onChange={(event) => update({ ...draft, scheduledLocal: event.target.value })} />
          <p id={`${id}-time-help`} className="text-xs text-foreground-muted">{t.editor.timeHelp}</p>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-account`} className="text-xs font-medium text-foreground-muted">{t.editor.account}</label>
          <select id={`${id}-account`} value={draft.accountId ?? ''} onChange={(event) => update({ ...draft, accountId: event.target.value || null })}
            className="h-11 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-foreground focus-ring md:h-8 md:text-[13px]">
            {!currentAccount && <option value="">@{post.account.handle}</option>}
            {read.accounts.map((account) => <option key={account.id} value={account.id} disabled={!account.verified}>@{account.handle}{account.verified ? '' : ` (${t.editor.accountUnverified})`}</option>)}
          </select>
        </div>
        {post.brief && <div className="space-y-1"><h4 className="text-xs font-medium text-foreground-muted">{t.editor.sources}</h4>
          <ul className="space-y-1 text-xs">{post.brief.evidence.map((item) => <li key={item.candidateId} className="break-words"><a href={item.url} target="_blank" rel="noopener noreferrer" className="rounded underline focus-ring">{item.title}</a></li>)}</ul></div>}
      </section>
    </div>

    <div aria-live="polite" className="space-y-2">
      {notice && <p role="status" className={cn('text-sm', saving ? 'text-foreground-muted' : 'text-foreground')}>{notice}</p>}
      {problems.length > 0 && <div role="alert" className="space-y-1 text-sm text-risk"><p className="font-medium">{t.editor.fix}</p><ul className="list-inside list-disc text-xs">{problems.map((problem, index) => <li key={index}>{problemText(problem)}</li>)}</ul></div>}
      {failure && <div role="alert"><DneskaiCodeText code={failure} lang={lang} /></div>}
    </div>
    <DneskaiDetails lang={lang} rows={[[t.detailRevision, post.id], [t.detailHash, post.contentHash], [t.detailTrace, post.traceId], [t.detailTemplate, post.templateVersion],
      [t.detailAssets, post.assets.map((asset) => asset.sha256).join(', ')], [t.detailSources, [...new Set(post.deck?.slides.flatMap((slide) => slide.images.map((image) => image.assetSha256)) ?? [])].join(', ')]]} />

    <div className="flex flex-col-reverse gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-end">
      <Button type="button" variant="ghost" onClick={onClose}>{t.editor.close}</Button>
      {dirty || rerender
        ? <Button type="submit" disabled={saving} aria-busy={saving} data-testid="dneskai-editor-main">{saving ? t.editor.saving : dirty ? t.editor.save : t.editor.rerender}</Button>
        : <div className="flex flex-col items-stretch gap-1 sm:items-end">
          <Button type="button" disabled={!!block || approving} data-testid="dneskai-editor-main" aria-describedby={block ? `${id}-block` : undefined} onClick={() => void onApprove(post).then((done) => { if (done) onClose(); })}>
            {approving ? t.card.approving : t.card.approve}<span className="font-mono text-[11px]">· {t.card.version(shortHash(post.contentHash))}</span>
          </Button>
          {block && <p id={`${id}-block`} className="text-xs text-foreground-muted">{block}</p>}
        </div>}
    </div>
  </form>;
}

function SlideRow({ id, index, count, item, post, lang, selected, onSelect, onMove, canRemove, onRemove }: {
  id: string; index: number; count: number; item: DeckDraft['slides'][number]; post: DneskaiWorkspacePost; lang: Lang; selected: boolean;
  onSelect: () => void; onMove: (delta: number) => void; canRemove: boolean; onRemove: () => void;
}) {
  const t = dneskaiWorkspace[lang];
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const thumb = post.assets[item.from];
  const icon = 'size-11 md:size-8';
  return <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} data-testid="dneskai-editor-slide"
    className={cn('flex min-w-0 items-center gap-1 rounded-md border p-1', selected ? 'border-primary bg-surface-selected' : 'border-border bg-surface', isDragging && 'z-10 opacity-80')}>
    <button ref={setActivatorNodeRef} type="button" aria-label={`${t.editor.drag}: ${t.card.problemSlide(index + 1)}`} {...attributes} {...listeners}
      className={cn('inline-flex shrink-0 touch-none cursor-grab items-center justify-center rounded text-foreground-subtle hover:bg-surface-hover focus-ring', icon)}><GripVertical className="size-4" /></button>
    <button type="button" onClick={onSelect} aria-current={selected ? 'true' : undefined} aria-label={t.editor.select(index + 1)}
      className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded text-left focus-ring md:min-h-8">
      {thumb ? <Image unoptimized src={thumb.url} alt="" width={thumb.width} height={thumb.height} loading="lazy" sizes="2rem" className="h-10 w-8 shrink-0 rounded-sm border border-border object-cover" />
        : <span title={t.editor.newSlide} className="flex h-10 w-8 shrink-0 items-center justify-center rounded-sm border border-dashed border-border-strong text-foreground-muted"><ImageOff className="size-3.5" aria-hidden /></span>}
      <span className="min-w-0 text-xs"><span className="block font-medium tabular">{index + 1}/{count}</span><span className="block truncate text-foreground-muted">{t.slideTypes[item.slide.type]}</span></span>
    </button>
    <Button type="button" variant="ghost" size="icon-sm" className={icon} aria-label={`${t.editor.moveUp}: ${t.card.problemSlide(index + 1)}`} disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp /></Button>
    <Button type="button" variant="ghost" size="icon-sm" className={icon} aria-label={`${t.editor.moveDown}: ${t.card.problemSlide(index + 1)}`} disabled={index === count - 1} onClick={() => onMove(1)}><ArrowDown /></Button>
    <Button type="button" variant="ghost" size="icon-sm" className={icon} aria-label={`${t.editor.remove}: ${t.card.problemSlide(index + 1)}`} disabled={!canRemove} onClick={onRemove}><Trash2 /></Button>
  </li>;
}

function SlideFields({ item, index, lang, onChange }: { item: DeckDraft['slides'][number]; index: number; lang: Lang; onChange: (field: DneskaiFieldLimit['field'], value: string) => void }) {
  const t = dneskaiWorkspace[lang];
  if (!item.fields.length) return <p className="text-xs text-foreground-muted">{t.editor.noText}</p>;
  return <div className="space-y-3">
    <h4 className="text-xs font-semibold">{t.editor.text}</h4>
    {item.fields.map(({ field, max }) => <CountedField key={field} id={`slide-${index}-${field}`} label={t.fields[field]} value={item.slide[field] ?? ''} max={max} multiline={field === 'body' || field === 'headline'} rows={field === 'body' ? 4 : 2} lang={lang} onChange={(value) => onChange(field, value)} />)}
  </div>;
}

/** A labelled text field with a character counter tied to it; past the limit the counter says by how much. */
export function CountedField({ id, label, value, max, multiline, rows = 3, help, lang, onChange }: {
  id: string; label: string; value: string; max: number; multiline?: boolean; rows?: number; help?: string; lang: Lang; onChange: (value: string) => void;
}) {
  const t = dneskaiWorkspace[lang];
  const count = characterCount(value.trim());
  const over = count - max;
  const described = [`${id}-count`, help ? `${id}-help` : ''].filter(Boolean).join(' ');
  const props = { id, value, 'aria-describedby': described, 'aria-invalid': over > 0 || undefined, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
    className: cn(over > 0 && 'border-risk') };
  return <div className="min-w-0 space-y-1" data-testid={`dneskai-field-${id}`}>
    <div className="flex items-baseline justify-between gap-2">
      <label htmlFor={id} className="text-xs font-medium text-foreground-muted">{label}</label>
      <span id={`${id}-count`} className={cn('text-[11px] tabular', over > 0 ? 'font-semibold text-risk' : 'text-foreground-muted')}>{t.counter(count, max)}{over > 0 ? ` · ${t.over(over)}` : ''}</span>
    </div>
    {multiline ? <Textarea rows={rows} {...props} className={cn('min-h-0 md:min-h-0', props.className)} /> : <Input {...props} />}
    {help && <p id={`${id}-help`} className="text-xs text-foreground-muted">{help}</p>}
  </div>;
}
