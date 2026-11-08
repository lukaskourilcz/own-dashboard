import type { DevsharkBox, DevsharkDeck, DevsharkSlide } from '@/lib/marketing/devshark-deck';
import { measureStudioText, STUDIO_FACES } from './metrics';
import derived from '../../../templates/marketing/devshark/derived-layout.json';

/**
 * The devShark slide layout shared by the Design Studio and the publishing renderer (7 November 2026). It turns a
 * slide into positioned text blocks and one SVG of 1080 × 1350; the browser shows that SVG with the same fonts and the
 * server rasterises the same SVG, so what the owner places in the editor is what goes out.
 *
 * A slide without `layout` takes the house layout (`devsharkAutoBoxes`): kicker and waterline on the first slide only,
 * then headline, text and code stacked as one group around the slide's middle. A slide with `layout` places each block at its box: top-left x and y,
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

/**
 * Moves the trailing word-group of the penultimate line onto the last line, so a wrapped block does not end on a lone
 * word (`text-wrap: pretty`). Punctuation glued to its word moves with it, and the move is taken only when the two
 * words then still fit the measure. Returns whether a lone last word remains (the caller may shrink the face to clear
 * it). A single-line or already-balanced paragraph is left untouched.
 */
function balanceLastLine(lines: Token[][], face: string, size: number, width: number): boolean {
  if (lines.length < 2) return false;
  const last = lines[lines.length - 1]!;
  if (last.length !== 1) return false; // a blank line, or two-plus words, is not an orphan
  const prev = lines[lines.length - 2]!;
  let start = prev.length - 1;
  while (start > 0 && prev[start]!.glue) start -= 1; // keep a word and its glued punctuation whole
  if (start <= 0) return true; // the penultimate line is a single group; moving it would empty the line
  const group = prev.slice(start);
  const moved = [{ ...group[0]!, glue: false }, ...group.slice(1), ...last];
  if (measureStudioText(joined(moved), face, size).width > width) return true; // the two words would not fit one line
  lines[lines.length - 2] = prev.slice(0, start);
  lines[lines.length - 1] = moved;
  return false;
}

function wrap(value: string, face: string, size: number, width: number, balance = false): { lines: Token[][]; unknown: number; overlong: boolean; orphaned: boolean } {
  const lines: Token[][] = [];
  let unknown = 0, overlong = false, orphaned = false;
  for (const paragraph of devsharkTokens(value)) {
    const pLines: Token[][] = [];
    let line: Token[] = [];
    for (const token of paragraph) {
      const word = measureStudioText(token.text, face, size);
      unknown += word.unknown;
      if (word.width > width) overlong = true;
      const candidate = [...line, token];
      if (line.length && measureStudioText(joined(candidate), face, size).width > width) {
        const last = token.glue ? line.pop() : undefined;
        pLines.push(line); line = last ? [{ ...last, glue: false }, token] : [{ ...token, glue: false }];
      } else line = candidate;
    }
    pLines.push(line);
    if (balance && balanceLastLine(pLines, face, size, width)) orphaned = true;
    lines.push(...pLines);
  }
  return { lines, unknown, overlong, orphaned };
}

/** The body's wrapped lines as plain text, rebalanced to avoid a lone last word at the given size. A test and preview seam. */
export function devsharkBodyLines(value: string, width: number, size: number = DEFAULT_SIZES.body): string[] {
  return wrap(value, FACE.body, size, width, true).lines.map(joined);
}

/** The smallest body size the owner's house layout will shrink to when rebalancing alone cannot clear a lone last word. */
export const BODY_MIN_SIZE = 56;
const BODY_SIZE_STEP = 4;
/**
 * The largest body size, from the default down to `BODY_MIN_SIZE`, at which the body — after rebalancing — does not end
 * on a lone word; `BODY_MIN_SIZE` if none does. The step mirrors `text-wrap: pretty`: rebalance first, shrink only when
 * a word cannot be pulled back. The published renderer and the Studio preview both size the body through this, so they
 * agree.
 */
export function fitDevsharkBodySize(value: string, width: number): number {
  for (let size = DEFAULT_SIZES.body; size >= BODY_MIN_SIZE; size -= BODY_SIZE_STEP) {
    if (!wrap(value, FACE.body, size, width, true).orphaned) return size;
  }
  return BODY_MIN_SIZE;
}

export type StudioBlock = { key: StudioBlockKey; box: Required<DevsharkBox>; height: number; text: string };
export type StudioWarning = { block: StudioBlockKey; code: 'outside-slide' | 'unsupported-character' | 'word-too-wide' };
export type StudioSlide = { svg: string; theme: Theme; blocks: StudioBlock[]; warnings: StudioWarning[] };

const escapeXml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
const anchorX = (box: Required<DevsharkBox>) => box.align === 'center' ? box.x + box.w / 2 : box.align === 'right' ? box.x + box.w : box.x;
const anchor = (box: Required<DevsharkBox>) => box.align === 'center' ? 'middle' : box.align === 'right' ? 'end' : 'start';

/**
 * The house layout (owner's edits of the first five concepts, 8 November 2026): every block left-aligned at the
 * margin, the brand's sizes, and the slide's words stacked as one group whose middle stands a little above the slide's
 * middle, clear of the fin. The gaps are the ones the owner set by hand: 40 px under the kicker, 48 under the
 * headline, 56 above the code. Positions sit on the editor's 8 px grid.
 */
export const HOUSE_LAYOUT = { middle: 624, top: 96, gaps: { headline: 40, body: 48, code: 56 } } as const;
const grid = (value: number) => Math.round(value / 8) * 8;
const kickerHeight = (size: number) => size * ASCENT + 22 * (size / DEFAULT_SIZES.kicker) + 12;
const textHeight = (value: string, key: 'headline' | 'body', size: number, width: number) => (wrap(value, FACE[key], size, width).lines.length - 1) * size * LEADING[key] + size;
const codeHeight = (value: string, size: number) => value.split('\n').length * size * LEADING.code + CODE.pad * 1.4;

/** The automatic boxes of a slide, in the house layout. */
export function devsharkAutoBoxes(slide: DevsharkSlide, index: number): Partial<Record<StudioBlockKey, Required<DevsharkBox>>> {
  const width = SLIDE_WIDTH - MARGIN * 2;
  const headlineSize = slide.kind === 'cover' ? DEFAULT_SIZES.coverHeadline : DEFAULT_SIZES.headline;
  const stack: { key: StudioBlockKey; size: number; height: number; gap: number }[] = [];
  if (index === 0 && slide.kind !== 'closing') stack.push({ key: 'kicker', size: DEFAULT_SIZES.kicker, height: kickerHeight(DEFAULT_SIZES.kicker), gap: 0 });
  stack.push({ key: 'headline', size: headlineSize, height: textHeight(slide.headline, 'headline', headlineSize, width), gap: stack.length ? HOUSE_LAYOUT.gaps.headline : 0 });
  if (slide.body) { const size = fitDevsharkBodySize(slide.body, width); stack.push({ key: 'body', size, height: textHeight(slide.body, 'body', size, width), gap: HOUSE_LAYOUT.gaps.body }); }
  if (slide.code) stack.push({ key: 'code', size: DEFAULT_SIZES.code, height: codeHeight(slide.code, DEFAULT_SIZES.code), gap: HOUSE_LAYOUT.gaps.code });
  const total = stack.reduce((sum, block) => sum + block.gap + block.height, 0);
  let y = Math.max(HOUSE_LAYOUT.top, HOUSE_LAYOUT.middle - total / 2);
  const boxes: Partial<Record<StudioBlockKey, Required<DevsharkBox>>> = {};
  for (const block of stack) {
    y += block.gap;
    boxes[block.key] = { x: MARGIN, y: grid(y), w: width, size: block.size, align: 'left' };
    y += block.height;
  }
  return boxes;
}

/**
 * Draws a slide's text blocks into SVG fragments, measuring each and warning when a block runs off the frame. Shared
 * by the 1080 × 1350 slide and the 1080 × 1920 story, which differ only in the frame they sit in.
 */
function drawDevsharkBlocks(
  slide: DevsharkSlide, index: number, auto: Partial<Record<StudioBlockKey, Required<DevsharkBox>>>,
  theme: Theme, palette: { background: string; foreground: string; muted: string; accent: string }, green: string, frameHeight: number,
): { parts: string; blocks: StudioBlock[]; warnings: StudioWarning[] } {
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
      // The body is balanced so it does not end on a lone word; the headline is display text and keeps its lone words.
      const wrapped = wrap(value, FACE[key], box.size, box.w, key === 'body');
      if (wrapped.unknown) warnings.push({ block: key, code: 'unsupported-character' });
      if (wrapped.overlong) warnings.push({ block: key, code: 'word-too-wide' });
      const leading = LEADING[key];
      height = (wrapped.lines.length - 1) * box.size * leading + box.size;
      parts += wrapped.lines.map((line, at) => `<text xml:space="preserve" x="${anchorX(box)}" y="${box.y + box.size * ASCENT + at * box.size * leading}" text-anchor="${anchor(box)}" font-family="${escapeXml(f.rasterFamily)}" font-size="${box.size}" font-weight="${f.weight}">${line.map((token, n) => `<tspan fill="${token.green ? green : palette.foreground}">${escapeXml((n && !token.glue ? ' ' : '') + token.text)}</tspan>`).join('')}</text>`).join('');
    }
    if (box.x < 0 || box.y < 0 || box.x + box.w > SLIDE_WIDTH || box.y + height > frameHeight) warnings.push({ block: key, code: 'outside-slide' });
    blocks.push({ key, box, height, text: value });
  }
  return { parts, blocks, warnings };
}

/** Lays out one slide: its blocks, their warnings and the SVG both the editor and the renderer draw. */
export function layoutDevsharkSlide(deck: Pick<DevsharkDeck, 'cover' | 'slides'>, index: number, assets: StudioAssets): StudioSlide {
  const slide = deck.slides[index]!;
  const theme = devsharkSlideTheme(deck, index);
  const palette = themes[theme];
  const green = theme === 'green' ? '#132019' : palette.accent;
  const auto = devsharkAutoBoxes(slide, index);
  const drawn = drawDevsharkBlocks(slide, index, auto, theme, palette, green, SLIDE_HEIGHT);
  let parts = drawn.parts;
  if (slide.kind === 'closing') {
    const after = Math.max(...drawn.blocks.map((block) => block.box.y + block.height), 0);
    parts = `<image x="${MARGIN}" y="104" width="400" height="64" xlink:href="${assets.logoWhite}"/>` + parts
      + `<text x="${MARGIN}" y="${Math.max(after + 60, 760)}" fill="${palette.accent}" font-family="Manrope" font-size="52" font-weight="800">devshark.app</text>`;
  }
  const fin = `<image x="${FIN.x}" y="${SLIDE_HEIGHT - FIN.height}" width="${FIN.width}" height="${FIN.height}" xlink:href="${theme === 'green' ? assets.finInk : assets.finGreen}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" viewBox="0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}"><rect width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" fill="${palette.background}"/>${fin}${parts}</svg>`;
  return { svg, theme, blocks: drawn.blocks, warnings: drawn.warnings };
}

/**
 * Instagram story frame (owner rule, 8 November 2026): one native image that fills the whole 1080 × 1920 (9:16) frame —
 * no letterbox, no blurred bands. A story re-lays out the post's cover for 9:16: the same ground fills the frame, and
 * the same kicker, headline and body are centred within the Instagram safe zone (clear of the top and bottom 250 px,
 * where Instagram draws its own chrome). The fin sits at the bottom corner as it does on a slide.
 */
export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;
export const STORY_SAFE_TOP = 250;
export const STORY_SAFE_BOTTOM = 250;

/** Lays out a deck's cover as a full-frame 1080 × 1920 story: same design, text centred inside the Instagram safe zone. */
export function layoutDevsharkStory(deck: Pick<DevsharkDeck, 'cover' | 'slides'>, assets: StudioAssets): StudioSlide {
  const index = 0;
  // Re-flow the cover with the house layout: the owner's per-block boxes were placed for the 1350 slide and would
  // leave a 1920 story top-heavy, so the story ignores them and centres the stack in the safe zone instead.
  const slide: DevsharkSlide = { ...deck.slides[index]!, layout: undefined };
  const theme = devsharkSlideTheme(deck, index);
  const palette = themes[theme];
  const green = theme === 'green' ? '#132019' : palette.accent;
  const auto = devsharkAutoBoxes(slide, index);
  // Measure the stack once in the taller frame, then translate every box so the stack's middle sits at the centre of
  // the Instagram safe band. The inter-block gaps and the 8 px grid are preserved by shifting a grid-aligned delta.
  const dry = drawDevsharkBlocks(slide, index, auto, theme, palette, green, STORY_HEIGHT);
  const safeCentre = (STORY_SAFE_TOP + (STORY_HEIGHT - STORY_SAFE_BOTTOM)) / 2;
  let delta = 0;
  if (dry.blocks.length) {
    const top = Math.min(...dry.blocks.map((block) => block.box.y));
    const bottom = Math.max(...dry.blocks.map((block) => block.box.y + block.height));
    delta = grid(safeCentre - (top + bottom) / 2);
  }
  const moved: Partial<Record<StudioBlockKey, Required<DevsharkBox>>> = {};
  for (const key of STUDIO_BLOCKS) { const box = auto[key]; if (box) moved[key] = { ...box, y: box.y + delta }; }
  const drawn = drawDevsharkBlocks(slide, index, moved, theme, palette, green, STORY_HEIGHT);
  const fin = `<image x="${FIN.x}" y="${STORY_HEIGHT - FIN.height}" width="${FIN.width}" height="${FIN.height}" xlink:href="${theme === 'green' ? assets.finInk : assets.finGreen}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${STORY_WIDTH}" height="${STORY_HEIGHT}" viewBox="0 0 ${STORY_WIDTH} ${STORY_HEIGHT}"><rect width="${STORY_WIDTH}" height="${STORY_HEIGHT}" fill="${palette.background}"/>${fin}${drawn.parts}</svg>`;
  return { svg, theme, blocks: drawn.blocks, warnings: drawn.warnings };
}
