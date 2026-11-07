'use client';

import { useId, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { qk } from '@/lib/queries/keys';
import { devsharkStudio } from '@/lib/i18n/sections/devshark-studio';
import type { DevsharkDeck, DevsharkSlide } from '@/lib/marketing/devshark-deck';
import { decideDevsharkDraft, devsharkEditable, devsharkStudioErrorCode, fetchDevsharkDrafts, renderDevsharkPreview, saveDevsharkDraft,
  type DevsharkDraft, type DevsharkDraftsRead, type DevsharkPreview } from '@/lib/marketing/devshark-studio';

type Lang = 'en' | 'cs';
type Draft = { title: string; caption: string; deck: DevsharkDeck };
const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);
const fieldClass = 'w-full min-w-0 rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-ring';

/** Sample concepts for /dev-preview: the studio never calls a server there. */
const PREVIEW_READ: DevsharkDraftsRead = { plan: [], drafts: [{ id: '00000000-0000-4000-8000-000000000001', title: 'typeof null', origin: 'concept', status: 'draft', decided_at: null, created_at: '2026-11-07T17:00:00.000Z',
  caption: 'Guess before you swipe: what does typeof null return?\n\n#javascript #devshark',
  deck: { schemaVersion: 'devshark-deck/1', cover: 'light', slides: [
    { kind: 'cover', kicker: 'JavaScript quiz', headline: 'typeof null', body: 'One line of JavaScript. [[What does it return?]]' },
    { kind: 'answer', headline: 'B. "object"', body: 'A bug from the first JavaScript, kept so old code still works.' },
    { kind: 'closing', headline: 'Quizzes, lessons and [[coding tasks]] for web developers.' }] } }] };

/**
 * devShark studio (owner request, 7 November 2026): the owner edits a concept's slides and caption, renders a preview,
 * saves the version and approves it. Saving returns a concept to review, so an approval always binds the saved text;
 * only approved concepts enter the plan.
 */
export function DevsharkStudioTab({ lang, preview = false }: { lang: Lang; preview?: boolean }) {
  const t = devsharkStudio[lang];
  const query = useQuery({ queryKey: qk.devsharkDrafts, queryFn: fetchDevsharkDrafts, enabled: !preview, staleTime: 30_000 });
  const read = preview ? PREVIEW_READ : query.data;
  const [selected, setSelected] = useState<string | null>(null);
  const drafts = read?.drafts ?? [];
  const current = drafts.find((draft) => draft.id === selected) ?? drafts[0] ?? null;
  return <section aria-labelledby="devshark-studio-title" className="min-w-0 space-y-5" data-testid="devshark-studio">
    <div className="space-y-1">
      <h2 id="devshark-studio-title" className="text-base font-semibold">{t.title}</h2>
      <p className="max-w-3xl text-sm text-foreground-muted">{t.intro}</p>
      {preview && <p className="text-xs text-foreground-muted">{t.previewOnly}</p>}
    </div>
    {!preview && query.isPending ? <p role="status" className="text-sm text-foreground-muted">{t.loading}</p>
      : !preview && query.isError ? <p role="alert" className="text-sm text-risk">{t.unavailable}</p>
      : drafts.length === 0 ? <p className="text-sm text-foreground-muted">{t.empty}</p>
      : <div className="grid min-w-0 gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <nav aria-label={t.concepts} className="min-w-0">
          <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
            {drafts.map((draft) => <li key={draft.id} className="shrink-0 lg:shrink">
              <button type="button" aria-current={draft.id === current?.id ? 'true' : undefined} onClick={() => setSelected(draft.id)}
                className={cn('flex min-h-11 w-full min-w-40 flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left focus-ring', draft.id === current?.id ? 'border-border-strong bg-accent' : 'border-border bg-surface hover:bg-surface-hover')}>
                <span className="text-sm font-medium break-words">{draft.title}</span>
                <span className="text-xs text-foreground-muted">{t.statuses[draft.status]}</span>
              </button>
            </li>)}
          </ul>
        </nav>
        {current && <Editor key={current.id} draft={current} lang={lang} preview={preview} />}
      </div>}
  </section>;
}

function Editor({ draft, lang, preview }: { draft: DevsharkDraft; lang: Lang; preview: boolean }) {
  const t = devsharkStudio[lang];
  const queryClient = useQueryClient();
  const saved: Draft = useMemo(() => ({ title: draft.title, caption: draft.caption, deck: draft.deck }), [draft]);
  const [value, setValue] = useState<Draft>(saved);
  const [rendered, setRendered] = useState<{ for: Draft; slides: DevsharkPreview['slides'] } | null>(null);
  const [busy, setBusy] = useState<'render' | 'save' | 'approve' | 'reject' | 'reopen' | null>(null);
  const [message, setMessage] = useState<{ tone: 'info' | 'risk'; text: string } | null>(null);
  const editable = devsharkEditable(draft.status);
  const dirty = !same(value, saved);
  const stale = rendered !== null && !same(rendered.for, value);
  const ids = useId();
  const setSlide = (index: number, patch: Partial<DevsharkSlide>) => setValue((prev) => ({ ...prev, deck: { ...prev.deck, slides: prev.deck.slides.map((slide, at) => {
    if (at !== index) return slide;
    const next = { ...slide, ...patch };
    for (const key of ['kicker', 'body', 'code'] as const) if (next[key] !== undefined && !next[key]!.trim()) delete next[key];
    return next;
  }) } }));
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.devsharkDrafts });
  const run = async (kind: NonNullable<typeof busy>, action: () => Promise<string | void>) => {
    setBusy(kind); setMessage(null);
    try { const text = await action(); if (text) setMessage({ tone: 'info', text }); }
    catch (error) { const code = devsharkStudioErrorCode(error); setMessage({ tone: 'risk', text: kind === 'render' ? t.renderFailed(code) : t.failed(code) }); }
    finally { setBusy(null); }
  };
  return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="text-sm font-semibold">{draft.title}</h3>
      <span className="rounded-sm border border-border bg-surface-inset px-1.5 py-0.5 text-[11px] font-medium text-foreground-muted">{t.statuses[draft.status]}</span>
    </div>
    {!editable && <p className="text-xs text-foreground-muted">{t.locked}</p>}
    <fieldset disabled={!editable || preview || busy !== null} className="min-w-0 space-y-4">
      <label className="block space-y-1 text-xs font-medium text-foreground-muted">{t.fields.title}
        <input id={`${ids}-title`} className={fieldClass} value={value.title} maxLength={160} onChange={(event) => setValue((prev) => ({ ...prev, title: event.target.value }))} />
      </label>
      <p className="text-xs text-foreground-muted">{t.greenHint}</p>
      <ol className="min-w-0 space-y-3">{value.deck.slides.map((slide, index) => <li key={index} className="min-w-0 space-y-2 rounded-lg border border-border bg-surface p-3">
        <p className="text-xs font-semibold text-foreground-muted">{t.slide(index + 1, value.deck.slides.length)} · {t.kinds[slide.kind]}</p>
        {index === 0 && <label className="block space-y-1 text-xs font-medium text-foreground-muted">{t.fields.kicker}
          <input id={`${ids}-k${index}`} className={fieldClass} value={slide.kicker ?? ''} maxLength={40} onChange={(event) => setSlide(index, { kicker: event.target.value })} /></label>}
        <label className="block space-y-1 text-xs font-medium text-foreground-muted">{t.fields.headline}
          <textarea id={`${ids}-h${index}`} className={fieldClass} rows={2} value={slide.headline} maxLength={140} onChange={(event) => setSlide(index, { headline: event.target.value })} /></label>
        {slide.kind !== 'closing' && <label className="block space-y-1 text-xs font-medium text-foreground-muted">{t.fields.body}
          <textarea id={`${ids}-b${index}`} className={fieldClass} rows={3} value={slide.body ?? ''} maxLength={400} onChange={(event) => setSlide(index, { body: event.target.value })} /></label>}
        {(slide.kind === 'code' || slide.code !== undefined) && <label className="block space-y-1 text-xs font-medium text-foreground-muted">{t.fields.code}
          <textarea id={`${ids}-c${index}`} className={cn(fieldClass, 'font-mono')} rows={4} spellCheck={false} value={slide.code ?? ''} maxLength={600} onChange={(event) => setSlide(index, { code: event.target.value })} /></label>}
      </li>)}</ol>
      <label className="block space-y-1 text-xs font-medium text-foreground-muted">{t.fields.caption}
        <textarea id={`${ids}-caption`} className={fieldClass} rows={6} value={value.caption} maxLength={2200} onChange={(event) => setValue((prev) => ({ ...prev, caption: event.target.value }))} /></label>
    </fieldset>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={preview || busy !== null} onClick={() => run('render', async () => { const result = await renderDevsharkPreview(value.deck); setRendered({ for: value, slides: result.slides }); })}>{busy === 'render' ? t.rendering : t.render}</Button>
      {editable && <Button variant="outline" disabled={preview || !dirty || busy !== null} onClick={() => run('save', async () => { await saveDevsharkDraft({ id: draft.id, title: value.title, caption: value.caption, deck: value.deck }); await refresh(); return t.saved; })}>{busy === 'save' ? t.saving : t.save}</Button>}
      {editable && draft.status !== 'approved' && <Button disabled={preview || dirty || busy !== null} title={dirty ? t.unsavedBeforeApprove : undefined} onClick={() => run('approve', async () => { await decideDevsharkDraft(draft.id, 'approved'); await refresh(); return t.approved; })}>{t.approve}</Button>}
      {editable && draft.status !== 'rejected' && <Button variant="ghost" disabled={preview || busy !== null} onClick={() => run('reject', async () => { await decideDevsharkDraft(draft.id, 'rejected'); await refresh(); return t.rejected; })}>{t.reject}</Button>}
      {editable && draft.status !== 'draft' && <Button variant="ghost" disabled={preview || busy !== null} onClick={() => run('reopen', async () => { await decideDevsharkDraft(draft.id, 'draft'); await refresh(); })}>{t.reopen}</Button>}
    </div>
    {dirty && editable && <p className="text-xs text-foreground-muted">{t.unsavedBeforeApprove}</p>}
    {message && <p role={message.tone === 'risk' ? 'alert' : 'status'} className={cn('text-sm', message.tone === 'risk' ? 'text-risk' : 'text-foreground')}>{message.text}</p>}
    {rendered && <section aria-label={t.previewTitle} className="min-w-0 space-y-2">
      <h4 className="text-sm font-semibold">{t.previewTitle}</h4>
      <p className={cn('text-xs', stale ? 'text-warning' : 'text-foreground-muted')}>{stale ? t.previewStale : t.previewNote}</p>
      <ol className="relative flex w-0 min-w-full snap-x gap-2 overflow-x-auto pb-2" tabIndex={0} aria-label={t.previewTitle}>
        {rendered.slides.map((slide, index) => <li key={index} className="w-48 shrink-0 snap-start sm:w-60">
          {/* eslint-disable-next-line @next/next/no-img-element -- a data URL the server just rendered; nothing to optimise */}
          <img src={slide.src} alt={slide.alt || t.slide(index + 1, rendered.slides.length)} width={1080} height={1350} className="h-auto w-full rounded border border-border" />
        </li>)}
      </ol>
    </section>}
  </div>;
}
