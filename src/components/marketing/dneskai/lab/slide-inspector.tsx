'use client';

import { useId, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { dneskaiLab } from '@/lib/i18n/sections/dneskai-lab';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import {
  draftSlideMoves, imageFocal, imageZoom, insertablePictures, insertSlide, mediaResolution, removeSlide, setImageCrop, setSlideShape, setSlideText, swapSlideImage, type DeckDraft,
} from '@/lib/marketing/dneskai-deck-editor';
import { DNESKAI_INSERT_SHAPES, dneskaiShapeId, dneskaiSlideShape, type DneskaiShapeId } from '@/lib/marketing/dneskai-slide-layout';
import { EntityBadge } from '@/components/ui/status-badge';
import Image from 'next/image';
import { dneskaiCropFractions, dneskaiCropRegion, dneskaiCropUpscale, dneskaiSlotFrame } from '@/lib/marketing/dneskai-crop';
import type { DneskaiFitField, DneskaiFitResult } from '@/lib/marketing/dneskai-lab';
import type { DneskaiWorkspacePost } from '@/lib/marketing/dneskai-workspace';
import { CountedField } from '../post-editor';
import { cn } from '@/lib/utils';
import { DneskaiFocalPicker } from '../focal-picker';
import { DneskaiMediaTray } from '../media-tray';
import { DneskaiRenderProblems } from '../render-problems';

type Lang = 'en' | 'cs';
export type DneskaiFitState = { status: 'idle' | 'checking' | 'ready' | 'unavailable'; result: DneskaiFitResult | null };
/** The studio's gates (vendored dneskai-slide.d.ts): a bleed stretched past 1.2× may look soft, a frame past 1.5×. */
const SOFT_STRETCH = { cover: 1080 / 900, contain: 1.5 } as const;

export function fitFieldText(field: DneskaiFitField | undefined, lang: Lang): { text: string; ok: boolean } | null {
  const t = dneskaiLab[lang].slide;
  if (!field) return null;
  if (field.clipped || field.overBy > 0) return { text: [field.clipped ? t.fitCut : '', field.overBy > 0 ? t.fitOver(field.overBy) : ''].filter(Boolean).join(' · '), ok: false };
  if (field.codes.length) return null;
  return { text: field.lines && field.fontSize ? t.fitOkSet(field.lines, field.fontSize) : t.fitOk, ok: true };
}

/**
 * The selected slide's written fields with counters and fit feedback 300 ms after typing (the studio's fitter, nothing
 * saved), and its pictures with the real crop drawn over the source, the crop preview at the frame's shape, zoom and
 * a picture swap from the topic's pool.
 */
export function DneskaiSlideInspector({ post, draft, index, onDraft, fit, previews, mediaState, lang, firstFieldRef, onSlide, onNotice }: {
  post: DneskaiWorkspacePost; draft: DeckDraft; index: number; onDraft: (draft: DeckDraft) => void; fit: DneskaiFitState;
  previews: ReadonlyMap<string, string>; mediaState: 'loading' | 'ready' | 'unavailable'; lang: Lang; firstFieldRef?: (element: HTMLElement | null) => void;
  /** Moves the Lab to another slide of the draft (after inserting or removing one). */
  onSlide?: (index: number) => void;
  /** Announces a change that moves the Lab to another slide (this inspector remounts per slide). */
  onNotice?: (text: string) => void;
}) {
  const t = dneskaiLab[lang];
  const tw = dneskaiWorkspace[lang];
  const id = useId();
  const [swap, setSwap] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const item = draft.slides[index];
  if (!item) return null;
  const { slide, fields } = item;
  const moves = draftSlideMoves(post, draft, index);
  const shape = dneskaiShapeId(dneskaiSlideShape(slide));
  const fitted = fit.result?.slides[index];
  const bad = fitted ? fitted.fields.filter((field) => field.clipped || field.overBy > 0 || field.codes.length > 0).length + fitted.codes.length : 0;
  const problems = post.renderReport?.problems.filter((problem) => problem.slide === item.from) ?? [];
  return <section aria-labelledby={`${id}-title`} className="min-w-0 space-y-3" data-testid="dneskai-slide-inspector">
    <h4 id={`${id}-title`} className="text-xs font-semibold">{t.slide.title(index + 1, tw.slideTypes[slide.type])}</h4>
    {problems.length > 0 && <DneskaiRenderProblems problems={problems} lang={lang} />}
    {slide.type !== 'sources' && <div className="space-y-1">
      <label htmlFor={`${id}-shape`} className="text-xs font-medium">{t.slide.shape}</label>
      <select id={`${id}-shape`} value={shape} disabled={moves.length < 2} aria-describedby={`${id}-shape-help`} data-testid="dneskai-slide-shape"
        onChange={(event) => {
          const next = setSlideShape(post, draft, index, event.target.value as DneskaiShapeId);
          onDraft(next.draft);
          setNotice(next.dropped.length ? t.slide.shapeDropped(next.dropped.map((field) => t.slide.fields[field]).join(', ')) : '');
        }}
        className="min-h-11 w-full rounded-md border border-border bg-surface px-2 text-sm focus-ring disabled:opacity-70">
        {moves.map((move) => <option key={dneskaiShapeId(move)} value={dneskaiShapeId(move)}>{t.slide.shapes[dneskaiShapeId(move)]}</option>)}
      </select>
      <p id={`${id}-shape-help`} className="text-xs text-foreground-muted">{moves.length < 2 ? t.slide.shapeLocked : t.slide.shapeHelp}</p>
    </div>}
    <p role="status" aria-live="polite" className="min-h-0 text-xs empty:hidden" data-testid="dneskai-inspector-notice">{notice}</p>
    {item.from === null && <Button type="button" variant="outline" size="sm" className="min-h-11 md:min-h-8" data-testid="dneskai-remove-inserted"
      onClick={() => { onDraft(removeSlide(draft, index)); onSlide?.(Math.max(0, index - 1)); onNotice?.(t.slide.insert.removed); }}>{t.slide.insert.remove}</Button>}
    {fields.length === 0 ? <p className="text-xs text-foreground-muted">{t.slide.noFields}</p> : fields.map(({ field, max }, position) => {
      const feedback = fitFieldText(fitted?.fields.find((entry) => entry.field === field), lang);
      return <div key={field} ref={position === 0 ? (element) => firstFieldRef?.(element?.querySelector('input,textarea') ?? null) : undefined}>
        <CountedField id={`${id}-${field}`} label={t.slide.fields[field]} value={slide[field] ?? ''} max={max} multiline={field === 'body' || field === 'headline'} rows={field === 'body' ? 4 : 2}
          lang={lang} help={feedback?.text} onChange={(value) => onDraft(setSlideText(draft, index, field, value))} />
      </div>;
    })}
    <details><summary className="min-h-11 cursor-pointer py-3 text-xs font-medium">{tw.fields.alt}</summary><CountedField id={`${id}-alt`} label={tw.fields.alt} value={slide.alt} max={1000} multiline lang={lang} help={tw.editor.altHelp} onChange={(value) => onDraft(setSlideText(draft, index, 'alt', value))} /></details>
    <p aria-live="polite" role="status" className="min-h-4 text-xs text-foreground-muted" data-testid="dneskai-fit-summary">
      {fit.status === 'unavailable' ? t.slide.fitUnavailable : fit.status === 'checking' && !fitted ? t.slide.fitChecking
        : fitted ? (bad === 0 ? t.slide.fitSummaryOk(index + 1) : <span className="text-warning">{t.slide.fitSummaryBad(index + 1, bad)}</span>) : ''}
    </p>

    {slide.images.length > 0 && slide.type !== 'sources' && <div className="min-w-0 space-y-3">
      <h5 className="text-xs font-semibold">{t.slide.pictures}</h5>
      {slide.images.map((image) => {
        const media = post.brief?.media.find((entry) => entry.assetSha256 === image.assetSha256) ?? null;
        const frame = dneskaiSlotFrame(slide, image.slot);
        const fitMode = image.crop?.fit ?? frame?.fit ?? 'cover';
        const region = media && frame ? dneskaiCropRegion(media, { focal: imageFocal(image), zoom: imageZoom(image) }, frame, fitMode) : null;
        const fractions = region && media ? dneskaiCropFractions(region, media) : undefined;
        const stretch = region ? dneskaiCropUpscale(region) : null;
        const src = previews.get(image.assetSha256) ?? null;
        return <div key={image.slot} className="min-w-0 space-y-2 border-t border-border pt-3" data-testid={`dneskai-lab-picture-${image.slot}`}>
          <p className="text-xs font-medium">{t.slide.picture(image.slot)}{media ? <span className="ml-1 font-normal text-foreground-muted tabular">{media.width} × {media.height}</span> : null}</p>
          <DneskaiFocalPicker lang={lang} label={t.slide.picture(image.slot)} src={src} width={media?.width ?? 1080} height={media?.height ?? 1350} focal={imageFocal(image)} zoom={imageZoom(image)} crop={fractions}
            onFocal={(focal) => onDraft(setImageCrop(draft, index, image.slot, { focal }))} onZoom={(zoom) => onDraft(setImageCrop(draft, index, image.slot, { zoom }))} />
          {region && fractions && src && <div className="flex min-w-0 items-start gap-3">
            <div className="w-28 shrink-0 overflow-hidden rounded-sm border border-border bg-surface-inset" style={{ aspectRatio: `${region.outWidth} / ${region.outHeight}` }} data-testid="dneskai-crop-preview"
              role="img" aria-label={`${t.slide.cropShows}: ${t.slide.picture(image.slot)}`}>
              <span aria-hidden className="block size-full bg-no-repeat" style={{
                backgroundImage: `url(${JSON.stringify(src)})`,
                backgroundSize: `${100 / fractions.width}% ${100 / fractions.height}%`,
                backgroundPosition: `${fractions.width >= 1 ? 0 : (fractions.left / (1 - fractions.width)) * 100}% ${fractions.height >= 1 ? 0 : (fractions.top / (1 - fractions.height)) * 100}%`,
              }} />
            </div>
            <div className="min-w-0 space-y-1 text-xs">
              <p className="font-medium">{t.slide.cropShows}</p>
              <p className="text-foreground-muted">{fitMode === 'cover' ? t.slide.cropHelpCover : t.slide.cropHelpContain}</p>
              {stretch !== null && <p className="tabular text-foreground-muted">{t.slide.cropStretch(stretch.toFixed(2))}</p>}
              {stretch !== null && stretch > SOFT_STRETCH[fitMode] && <p className="text-warning">{t.slide.cropSoft}</p>}
            </div>
          </div>}
          {post.brief && <Button type="button" variant="outline" size="sm" aria-expanded={swap === image.slot} onClick={() => setSwap(swap === image.slot ? null : image.slot)}>
            <ImageIcon />{swap === image.slot ? tw.editor.closeSwap : tw.editor.swap}</Button>}
          {post.brief && swap === image.slot && <DneskaiMediaTray lang={lang} brief={post.brief} slide={slide} current={image.assetSha256} previews={previews} state={mediaState}
            headingId={`${id}-pool-${image.slot}`} onChoose={(choice) => { onDraft(swapSlideImage(draft, index, image.slot, choice, post.brief!.media)); setSwap(null); }} />}
        </div>;
      })}
    </div>}
    {post.deck?.format === 'carousel' && slide.type !== 'sources' && <InsertSlide post={post} draft={draft} index={index} onDraft={onDraft} onSlide={onSlide} previews={previews} lang={lang} onNotice={onNotice ?? setNotice} />}
  </section>;
}

/**
 * „Add a slide after this one“ (review-10): a framed picture or a statement. Pictures are the topic's unused ones from
 * a source the deck already cites, that fit the chosen type; code sets the credit. The new slide starts without a
 * headline and alt text, so it cannot be saved until the owner writes them.
 */
function InsertSlide({ post, draft, index, onDraft, onSlide, previews, lang, onNotice }: {
  post: DneskaiWorkspacePost; draft: DeckDraft; index: number; onDraft: (draft: DeckDraft) => void; onSlide?: (index: number) => void;
  previews: ReadonlyMap<string, string>; lang: Lang; onNotice: (text: string) => void;
}) {
  const t = dneskaiLab[lang];
  const tw = dneskaiWorkspace[lang];
  const id = useId();
  const [kind, setKind] = useState<DneskaiShapeId>('figure');
  const [chosen, setChosen] = useState<string | null>(null);
  const pictures = insertablePictures(post, draft, kind);
  const needsPicture = kind === 'figure' || kind === 'split';
  const picture = pictures.find((item) => item.assetSha256 === chosen) ?? pictures[0] ?? null;
  const full = draft.slides.length >= 10;
  const blocked = full || (needsPicture && !picture);
  return <details className="border-t border-border pt-1" data-testid="dneskai-insert-slide">
    <summary className="min-h-11 cursor-pointer py-3 text-xs font-medium">{t.slide.insert.title}</summary>
    <div className="space-y-3">
      <p id={`${id}-help`} className="text-xs text-foreground-muted">{t.slide.insert.help}</p>
      <div className="space-y-1">
        <label htmlFor={`${id}-kind`} className="text-xs font-medium">{t.slide.insert.type}</label>
        <select id={`${id}-kind`} value={kind} onChange={(event) => { setKind(event.target.value as DneskaiShapeId); setChosen(null); }} className="min-h-11 w-full rounded-md border border-border bg-surface px-2 text-sm focus-ring">
          {DNESKAI_INSERT_SHAPES.map((value) => <option key={value} value={value}>{t.slide.shapes[value]}</option>)}
        </select>
      </div>
      {needsPicture && (pictures.length === 0 ? <p className="text-xs text-foreground-muted" role="status">{t.slide.insert.none}</p>
        : <fieldset className="min-w-0 space-y-2"><legend className="text-xs font-medium">{t.slide.insert.picture}</legend>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">{pictures.map((media) => {
            const preview = previews.get(media.assetSha256);
            return <li key={media.assetSha256}><label className={cn('flex min-h-11 cursor-pointer items-center gap-2 rounded-md border p-2 text-xs focus-within:ring-2 focus-within:ring-ring', picture?.assetSha256 === media.assetSha256 ? 'border-primary bg-surface-selected' : 'border-border')}>
              <input type="radio" name={`${id}-picture`} value={media.assetSha256} checked={picture?.assetSha256 === media.assetSha256} onChange={() => setChosen(media.assetSha256)} className="size-4 shrink-0" />
              {preview ? <Image unoptimized src={preview} alt="" width={media.width} height={media.height} sizes="3rem" className="size-12 shrink-0 rounded-sm object-cover" />
                : <span aria-hidden className="size-12 shrink-0 rounded-sm bg-surface-inset" />}
              <span className="min-w-0 space-y-1"><span className="block break-words">{media.credit}</span>
                <span className="flex flex-wrap items-center gap-1.5"><EntityBadge>{tw.editor.resolution[mediaResolution(media)]}</EntityBadge><span className="tabular text-foreground-muted">{media.width} × {media.height}</span></span></span>
            </label></li>;
          })}</ul>
        </fieldset>)}
      {full && <p className="text-xs text-foreground-muted" role="status">{t.slide.insert.full}</p>}
      <Button type="button" variant="outline" size="sm" className="min-h-11 md:min-h-8" disabled={blocked} aria-describedby={`${id}-help`} data-testid="dneskai-insert-add"
        onClick={() => {
          const result = insertSlide(post, draft, index, kind, needsPicture ? picture : null);
          if (result.index < 0) return;
          onDraft(result.draft); onSlide?.(result.index); onNotice(t.slide.insert.added(result.index + 1)); setChosen(null);
        }}>{t.slide.insert.add}</Button>
    </div>
  </details>;
}
