'use client';

import { useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { layoutDevsharkSlide, SLIDE_HEIGHT, SLIDE_WIDTH, type StudioBlockKey, type StudioSlide } from '@/lib/design-studio/devshark-layout';
import type { DevsharkBox, DevsharkDeck, DevsharkSlide } from '@/lib/marketing/devshark-deck';
import { designStudio } from '@/lib/i18n/sections/design-studio';
import { DEVSHARK_STUDIO_ASSETS, devsharkStudioSlideSvg } from '@/lib/design-studio/devshark-studio-slide';
import { BoxOverlay, StudioToolbar, type StudioBlock } from './box-overlay';

/** The brand pictures and fonts the editor draws with: the same files the renderer verifies (public/design-studio). */
export const STUDIO_BROWSER_ASSETS = DEVSHARK_STUDIO_ASSETS;
export const STUDIO_FONT_FACES = `@font-face{font-family:"Manrope";font-weight:700;src:url(/design-studio/fonts/manrope-700.ttf) format("truetype")}
@font-face{font-family:"Manrope";font-weight:800;src:url(/design-studio/fonts/manrope-800.ttf) format("truetype")}
@font-face{font-family:"JetBrains Mono";font-weight:400;src:url(/design-studio/fonts/jetbrains-mono-400.ttf) format("truetype")}`;
type Lang = 'en' | 'cs';

/** Every block's current box, so a slide's first manual change fixes all of them where they are. */
function materialised(slide: DevsharkSlide, layout: StudioSlide): NonNullable<DevsharkSlide['layout']> {
  return Object.fromEntries(layout.blocks.map((block) => [block.key, slide.layout?.[block.key] ?? block.box])) as NonNullable<DevsharkSlide['layout']>;
}

/**
 * One slide of the Design Studio (7 November 2026): the exact SVG the renderer publishes, with its text blocks laid
 * over it. Drag a block to move it, drag its right edge to change its width, double-click to write in it, and use the
 * toolbar for size, alignment and green words. Arrow keys move the selected block by 1 px (10 with Shift).
 */
export function SlideCanvas({ deck, index, lang, disabled, onChange }: { deck: DevsharkDeck; index: number; lang: Lang; disabled?: boolean; onChange: (slide: DevsharkSlide) => void }) {
  const t = designStudio[lang];
  const slide = deck.slides[index]!;
  const layout = useMemo(() => layoutDevsharkSlide(deck, index, STUDIO_BROWSER_ASSETS), [deck, index]);
  const editor = useRef<HTMLTextAreaElement>(null);
  const [selected, setSelected] = useState<StudioBlockKey | null>(null);
  const [editing, setEditing] = useState<StudioBlockKey | null>(null);
  const blocks: StudioBlock[] = layout.blocks.map((block) => ({ key: block.key, label: t.blocks[block.key], text: block.text, box: block.box, height: block.height, placed: !!slide.layout?.[block.key],
    warned: layout.warnings.some((warning) => warning.block === block.key && warning.code === 'outside-slide') }));
  const selectedBlock = blocks.find((block) => block.key === selected) ?? null;

  const setBox = (key: string, patch: Partial<Required<DevsharkBox>>) => {
    const boxes = materialised(slide, layout);
    const field = key as StudioBlockKey;
    const current = { ...layout.blocks.find((block) => block.key === field)!.box, ...(boxes[field] ?? {}) };
    onChange({ ...slide, layout: { ...boxes, [field]: { ...current, ...patch } } });
  };
  const auto = (key: string) => { const boxes = { ...(slide.layout ?? {}) }; delete boxes[key as StudioBlockKey]; onChange({ ...slide, layout: Object.keys(boxes).length ? boxes : undefined }); };
  const setText = (key: StudioBlockKey, value: string) => {
    const next = { ...slide };
    if (key === 'kicker') next.kicker = value.trim() ? value : undefined;
    else if (key === 'headline') next.headline = value.trim() ? value : slide.headline;
    else if (key === 'body') next.body = value.trim() ? value : undefined;
    else next.code = value.trim() ? value : undefined;
    onChange(next);
  };
  const green = () => {
    const area = editor.current;
    if (!area || !editing || editing === 'code' || editing === 'kicker') return;
    const { selectionStart: from, selectionEnd: to, value } = area;
    if (from === to) return;
    setText(editing, `${value.slice(0, from)}[[${value.slice(from, to)}]]${value.slice(to)}`);
  };

  return <div className="min-w-0 space-y-2">
    <style>{STUDIO_FONT_FACES}</style>
    <StudioToolbar block={selectedBlock} lang={lang} disabled={disabled} onBox={setBox} onAuto={auto}>
      <button type="button" disabled={disabled || editing === null || editing === 'code' || editing === 'kicker'} onMouseDown={(event) => event.preventDefault()} onClick={green}
        className="min-h-9 rounded px-2 text-xs font-semibold text-success hover:bg-surface-hover focus-ring disabled:opacity-40">{t.green}</button>
    </StudioToolbar>
    <BoxOverlay width={SLIDE_WIDTH} height={SLIDE_HEIGHT} blocks={blocks} selected={selected} onSelect={(key) => setSelected(key as StudioBlockKey | null)} onBox={setBox}
      onEdit={(key) => setEditing(key as StudioBlockKey)} editing={editing} disabled={disabled} lang={lang} testId="design-studio-canvas"
      renderEditor={(block) => <textarea ref={editor} autoFocus aria-label={block.label} defaultValue={block.text} spellCheck={block.key !== 'code'}
        onChange={(event) => setText(block.key as StudioBlockKey, event.target.value)} onBlur={() => setEditing(null)} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setEditing(null); } }}
        className={cn('h-full min-h-16 w-full resize-none rounded-sm bg-surface/90 p-1 text-sm text-foreground shadow-lg focus-ring', block.key === 'code' && 'font-mono')} />}>
      <div aria-hidden className="absolute inset-0 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: layout.svg }} />
    </BoxOverlay>
    <p className="text-xs text-foreground-muted">{t.howTo}</p>
    {layout.warnings.length > 0 && <ul className="space-y-0.5 text-xs text-warning" aria-live="polite">{layout.warnings.map((warning, at) => <li key={at}>{t.blocks[warning.block]}: {t.warnings[warning.code]}</li>)}</ul>}
  </div>;
}

/**
 * One devShark slide exactly as the Studio shows it, without the editing layer: the publishing calendar draws a concept
 * the plan has not rendered yet with this (owner request, 9 November 2026).
 */
export function DevsharkStudioSlide({ deck, index, label, className }: { deck: Pick<DevsharkDeck, 'cover' | 'slides'>; index: number; label: string; className?: string }) {
  const svg = useMemo(() => devsharkStudioSlideSvg(deck, index), [deck, index]);
  // An empty label marks a decorative copy (a card cover next to its title), hidden from assistive technology.
  return <div {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })} className={cn('relative aspect-[4/5] overflow-hidden [&>svg]:h-full [&>svg]:w-full', className)} data-testid="devshark-studio-slide">
    <style>{STUDIO_FONT_FACES}</style>
    <div aria-hidden className="absolute inset-0 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
  </div>;
}
