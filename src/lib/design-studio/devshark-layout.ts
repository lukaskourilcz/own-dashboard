import type { DevsharkBox, DevsharkDeck, DevsharkSlide } from '@/lib/marketing/devshark-deck';
import { measureStudioText, STUDIO_FACES } from './metrics';
import derived from '../../../templates/marketing/devshark/derived-layout.json';

/**
 * The devShark slide layout shared by the Design Studio and the publishing renderer (7 November 2026). It turns a
 * slide into positioned text blocks and one SVG of 1080 × 1350; the browser shows that SVG with the same fonts and the
 * server rasterises the same SVG, so what the owner places in the editor is what goes out.
 *
 * A slide without `layout` flows as the first renderer did: kicker and waterline on the first slide only, then
 * headline, text and code stacked from the top. A slide with `layout` places each block at its box: top-left x and y,
 * width, font size and alignment, in slide pixels. Nothing is refused for position; text running off the slide is
 * reported as a warning, and text over the fin is allowed.
 */
export const SLIDE_WIDTH = 1080;
export const SLIDE_HEIGHT = 1350;
export const STUDIO_BLOCKS = ['kicker', 'headline', 'body', 'code'] as const;
export type StudioBlockKey = (typeof STUDIO_BLOCKS)[number];
type Theme = 'light' | 'dark' | 'green';
type Token = { text: string; green: boolean; glue?: boolean };

const MARGIN = 80;
const themes = derived.themes as Record<Theme, { background: string; foreground: string; muted: string; accent: string }>;
const FACE = { kicker: 'manrope-700', headline: 'manrope-800', body: 'manrope-700', code: 'jetbrains-mono-400' } as const;
const LEADING = { kicker: 1, headline: 1.05, body: 1.2, code: 1.5 } as const;
export const DEFAULT_SIZES = { kicker: 36, headline: 108, coverHeadline: 128, body: 68, code: 36 } as const;
const KICKER_TRACKING = 3.2;
const CODE = { background: '#1B2730', foreground: '#E8EEF0', radius: 16, pad: 36 };
const ASCENT = 0.8;
export const FIN = { width: 560, x: 600, height: 560 * 15.9 / 19.2 };

/** Where the brand pictures come from: data URIs on the server, same-origin files in the browser. */
export type StudioAssets = { finGreen: string; finInk: string; logoWhite: string };

export function devsharkSlideTheme(deck: Pick<DevsharkDeck, 'cover' | 'slides'>, index: number): Theme {
  const slide = deck.slides[index]!;
  if (slide.kind === 'closing') return 'dark';
  if (slide.kind === 'answer') return 'green';
  return index % 2 === 0 ? deck.cover : deck.cover === 'light' ? 'dark' : 'light';
}

/** `[[green]]` markup to words that remember their colour; a word glued to the previous one keeps no space. */
export function devsharkTokens(value: string): Token[][] {
  return value.split('\n').map((paragraph) => {
    const tokens: Token[] = [];
    let green = false, previous = '';
    for (const part of paragraph.split(/(\[\[|\]\])/)) {
      if (part === '[[') { green = true; continue; }
      if (part === ']]') { green = false; continue; }
      const words = part.split(/\s+/).filter(Boolean);
      words.forEach((word, at) => tokens.push({ text: word, green, ...(at === 0 && tokens.length && !/^\s/.test(part) && !/\s$/.test(previous) ? { glue: true } : {}) }));
      if (part) previous = part;
    }
    return tokens;
  });
}
export const devsharkPlain = (value: string) => value.replace(/\[\[|\]\]/g, '');
const joined = (tokens: Token[]) => tokens.map((token, at) => (at && !token.glue ? ' ' : '') + token.text).join('');

function wrap(value: string, face: string, size: number, width: number): { lines: Token[][]; unknown: number; overlong: boolean } {
  const lines: Token[][] = [];
  let unknown = 0, overlong = false;
  for (const paragraph of devsharkTokens(value)) {
    let line: Token[] = [];
    for (const token of paragraph) {
      const word = measureStudioText(token.text, face, size);
      unknown += word.unknown;
      if (word.width > width) overlong = true;
      const candidate = [...line, token];
      if (line.length && measureStudioText(joined(candidate), face, size).width > width) {
        const last = token.glue ? line.pop() : undefined;
        lines.push(line); line = last ? [{ ...last, glue: false }, token] : [{ ...token, glue: false }];
      } else line = candidate;
    }
    lines.push(line);
  }
  return { lines, unknown, overlong };
}

export type StudioBlock = { key: StudioBlockKey; box: Required<DevsharkBox>; height: number; text: string };
export type StudioWarning = { block: StudioBlockKey; code: 'outside-slide' | 'unsupported-character' | 'word-too-wide' };
export type StudioSlide = { svg: string; theme: Theme; blocks: StudioBlock[]; warnings: StudioWarning[] };

const escapeXml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
const anchorX = (box: Required<DevsharkBox>) => box.align === 'center' ? box.x + box.w / 2 : box.align === 'right' ? box.x + box.w : box.x;
const anchor = (box: Required<DevsharkBox>) => box.align === 'center' ? 'middle' : box.align === 'right' ? 'end' : 'start';

/** The automatic boxes of a slide, in the order the first renderer stacked them. */
export function devsharkAutoBoxes(slide: DevsharkSlide, index: number): Partial<Record<StudioBlockKey, Required<DevsharkBox>>> {
  const width = SLIDE_WIDTH - MARGIN * 2;
  const boxes: Partial<Record<StudioBlockKey, Required<DevsharkBox>>> = {};
  const headlineSize = slide.kind === 'cover' ? DEFAULT_SIZES.coverHeadline : DEFAULT_SIZES.headline;
  if (index === 0 && slide.kind !== 'closing') boxes.kicker = { x: MARGIN, y: 168 - DEFAULT_SIZES.kicker * ASCENT, w: width, size: DEFAULT_SIZES.kicker, align: 'left' };
  let baseline = slide.kind === 'closing' ? 330 : index > 0 ? 210 : 300;
  boxes.headline = { x: MARGIN, y: baseline - headlineSize * ASCENT, w: width, size: headlineSize, align: 'left' };
  const headlineLines = wrap(slide.headline, FACE.headline, headlineSize, width).lines.length;
  baseline += (headlineLines - 1) * headlineSize * LEADING.headline + 44;
  if (slide.body) {
    baseline += DEFAULT_SIZES.body;
    boxes.body = { x: MARGIN, y: baseline - DEFAULT_SIZES.body * ASCENT, w: width, size: DEFAULT_SIZES.body, align: 'left' };
    baseline += (wrap(slide.body, FACE.body, DEFAULT_SIZES.body, width).lines.length - 1) * DEFAULT_SIZES.body * LEADING.body + 24;
  }
  if (slide.code) boxes.code = { x: MARGIN, y: baseline + 24, w: width, size: DEFAULT_SIZES.code, align: 'left' };
  return boxes;
}

/** Lays out one slide: its blocks, their warnings and the SVG both the editor and the renderer draw. */
export function layoutDevsharkSlide(deck: Pick<DevsharkDeck, 'cover' | 'slides'>, index: number, assets: StudioAssets): StudioSlide {
  const slide = deck.slides[index]!;
  const theme = devsharkSlideTheme(deck, index);
  const palette = themes[theme];
  const green = theme === 'green' ? '#132019' : palette.accent;
  const auto = devsharkAutoBoxes(slide, index);
  const blocks: StudioBlock[] = [];
  const warnings: StudioWarning[] = [];
  let parts = '';
  const text: Record<StudioBlockKey, string | undefined> = { kicker: index === 0 && slide.kind !== 'closing' ? (slide.kicker ?? 'devShark') : undefined, headline: slide.headline, body: slide.body, code: slide.code };
  for (const key of STUDIO_BLOCKS) {
    const value = text[key];
    const fallback = auto[key];
    if (!value || !fallback) continue;
    const box = { ...fallback, ...(slide.layout?.[key] ?? {}) } as Required<DevsharkBox>;
    const f = STUDIO_FACES[FACE[key]]!;
    let height = 0;
    if (key === 'kicker') {
      const label = value.toUpperCase();
      const measured = measureStudioText(label, FACE.kicker, box.size);
      const width = measured.width + label.length * KICKER_TRACKING * (box.size / DEFAULT_SIZES.kicker);
      const color = theme === 'green' ? palette.foreground : palette.accent;
      const left = box.align === 'center' ? box.x + (box.w - width) / 2 : box.align === 'right' ? box.x + box.w - width : box.x;
      const wave = derived.waves[index % derived.waves.length];
      const waveY = box.y + box.size * ASCENT + 22 * (box.size / DEFAULT_SIZES.kicker);
      parts += `<text x="${anchorX(box)}" y="${box.y + box.size * ASCENT}" text-anchor="${anchor(box)}" letter-spacing="${KICKER_TRACKING * (box.size / DEFAULT_SIZES.kicker)}" fill="${color}" font-family="${escapeXml(f.rasterFamily)}" font-size="${box.size}" font-weight="${f.weight}">${escapeXml(label)}</text>`;
      parts += `<defs><pattern id="wave${index}" x="${left}" y="${waveY}" width="48" height="12" patternUnits="userSpaceOnUse"><path d="${wave}" fill="none" stroke="${color}" stroke-width="3.2" stroke-linecap="round"/></pattern></defs><rect x="${left}" y="${waveY}" width="${Math.ceil(width)}" height="12" fill="url(#wave${index})"/>`;
      height = waveY + 12 - box.y;
      if (measured.unknown) warnings.push({ block: key, code: 'unsupported-character' });
    } else if (key === 'code') {
      const lines = value.replace(/\t/g, '  ').split('\n');
      const inner = Math.max(...lines.map((line) => measureStudioText(line, FACE.code, box.size).width));
      if (inner > box.w - CODE.pad * 2) warnings.push({ block: key, code: 'word-too-wide' });
      height = lines.length * box.size * LEADING.code + CODE.pad * 1.4;
      parts += `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${height}" rx="${CODE.radius}" fill="${CODE.background}"/>`;
      parts += `<text xml:space="preserve" x="${box.x + CODE.pad}" y="${box.y + CODE.pad + box.size * ASCENT}" fill="${CODE.foreground}" font-family="${escapeXml(f.rasterFamily)}" font-size="${box.size}" font-weight="${f.weight}">${lines.map((line, at) => `<tspan x="${box.x + CODE.pad}" dy="${at ? box.size * LEADING.code : 0}">${escapeXml(line)}</tspan>`).join('')}</text>`;
    } else {
      const wrapped = wrap(value, FACE[key], box.size, box.w);
      if (wrapped.unknown) warnings.push({ block: key, code: 'unsupported-character' });
      if (wrapped.overlong) warnings.push({ block: key, code: 'word-too-wide' });
      const leading = LEADING[key];
      height = (wrapped.lines.length - 1) * box.size * leading + box.size;
      parts += wrapped.lines.map((line, at) => `<text xml:space="preserve" x="${anchorX(box)}" y="${box.y + box.size * ASCENT + at * box.size * leading}" text-anchor="${anchor(box)}" font-family="${escapeXml(f.rasterFamily)}" font-size="${box.size}" font-weight="${f.weight}">${line.map((token, n) => `<tspan fill="${token.green ? green : palette.foreground}">${escapeXml((n && !token.glue ? ' ' : '') + token.text)}</tspan>`).join('')}</text>`).join('');
    }
    if (box.x < 0 || box.y < 0 || box.x + box.w > SLIDE_WIDTH || box.y + height > SLIDE_HEIGHT) warnings.push({ block: key, code: 'outside-slide' });
    blocks.push({ key, box, height, text: value });
  }
  if (slide.kind === 'closing') {
    const after = Math.max(...blocks.map((block) => block.box.y + block.height), 0);
    parts = `<image x="${MARGIN}" y="104" width="400" height="64" xlink:href="${assets.logoWhite}"/>` + parts
      + `<text x="${MARGIN}" y="${Math.max(after + 60, 760)}" fill="${palette.accent}" font-family="Manrope" font-size="52" font-weight="800">devshark.app</text>`;
  }
  const fin = `<image x="${FIN.x}" y="${SLIDE_HEIGHT - FIN.height}" width="${FIN.width}" height="${FIN.height}" xlink:href="${theme === 'green' ? assets.finInk : assets.finGreen}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" viewBox="0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}"><rect width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" fill="${palette.background}"/>${fin}${parts}</svg>`;
  return { svg, theme, blocks, warnings };
}
