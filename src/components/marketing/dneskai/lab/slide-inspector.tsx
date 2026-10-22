'use client';

import { useId, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { dneskaiLab } from '@/lib/i18n/sections/dneskai-lab';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import { imageFocal, imageZoom, setImageCrop, setSlideText, swapSlideImage, type DeckDraft } from '@/lib/marketing/dneskai-deck-editor';
import { dneskaiCropFractions, dneskaiCropRegion, dneskaiCropUpscale, dneskaiSlotFrame } from '@/lib/marketing/dneskai-crop';
import type { DneskaiFitField, DneskaiFitResult } from '@/lib/marketing/dneskai-lab';
import type { DneskaiWorkspacePost } from '@/lib/marketing/dneskai-workspace';
import { CountedField } from '../post-editor';
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
export function DneskaiSlideInspector({ post, draft, index, onDraft, fit, previews, mediaState, lang, firstFieldRef }: {
  post: DneskaiWorkspacePost; draft: DeckDraft; index: number; onDraft: (draft: DeckDraft) => void; fit: DneskaiFitState;
  previews: ReadonlyMap<string, string>; mediaState: 'loading' | 'ready' | 'unavailable'; lang: Lang; firstFieldRef?: (element: HTMLElement | null) => void;
}) {
  const t = dneskaiLab[lang];
  const tw = dneskaiWorkspace[lang];
  const id = useId();
  const [swap, setSwap] = useState<string | null>(null);
  const item = draft.slides[index];
  if (!item) return null;
  const { slide, fields } = item;
  const fitted = fit.result?.slides[index];
  const bad = fitted ? fitted.fields.filter((field) => field.clipped || field.overBy > 0 || field.codes.length > 0).length + fitted.codes.length : 0;
  const problems = post.renderReport?.problems.filter((problem) => problem.slide === item.from) ?? [];
  return <section aria-labelledby={`${id}-title`} className="min-w-0 space-y-3" data-testid="dneskai-slide-inspector">
    <h4 id={`${id}-title`} className="text-xs font-semibold">{t.slide.title(index + 1, tw.slideTypes[slide.type])}</h4>
    {problems.length > 0 && <DneskaiRenderProblems problems={problems} lang={lang} />}
    {fields.length === 0 ? <p className="text-xs text-foreground-muted">{t.slide.noFields}</p> : fields.map(({ field, max }, position) => {
      const feedback = fitFieldText(fitted?.fields.find((entry) => entry.field === field), lang);
      return <div key={field} ref={position === 0 ? (element) => firstFieldRef?.(element?.querySelector('input,textarea') ?? null) : undefined}>
        <CountedField id={`${id}-${field}`} label={t.slide.fields[field]} value={slide[field] ?? ''} max={max} multiline={field === 'body' || field === 'headline'} rows={field === 'body' ? 4 : 2}
          lang={lang} help={feedback?.text} onChange={(value) => onDraft(setSlideText(draft, index, field, value))} />
      </div>;
    })}
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
  </section>;
}
