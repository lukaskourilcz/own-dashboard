import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fontFiles, measureEm, resolveFace } from '@/lib/carousel-studio/fonts';
import { DNESKAI_CLOSING_DEFAULTS, type DneskaiClosingWords } from './dneskai-closing';

/**
 * The DNESKAi closing card drawn from its words (owner, 9 November 2026: the owner edits it in the Design Lab). The
 * same 1080 × 1350 card as `closing-card-source/card.html`: the black-and-white city fading into ink
 * (`card-base.png`, that page without its words), the follow word in Poppins Black, the DNESKAi logotype itself under
 * it (white DNESK over icy blue Ai, so the K stays white), the line in Inter and the handle in a white outlined pill.
 * resvg draws it with the repository's own fonts only, so every machine draws the same pixels.
 */
const SOURCE = path.join(process.cwd(), 'templates', 'carousel-studio', 'brand-kits', 'caught-up');
const BASE = path.join(SOURCE, 'closing-card-source', 'card-base.png');
const POPPINS = path.join(SOURCE, 'closing-card-source', 'poppins-900.ttf');
const LOGO = path.join(SOURCE, 'DNESKAi-logo-dark.svg');
export const DNESKAI_CLOSING_CARD_VERSION = 'dneskai-closing-card/2';

export { DNESKAI_CLOSING_DEFAULTS } from './dneskai-closing';

const W = 1080, H = 1350, LEFT = 72, MEASURE = 936, BOTTOM = 84;
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The closing slide's words from its text: "<headline> [[DNESKAi]]" and "<body> <@handle>". */
export function dneskaiClosingWords(slide: { headline?: string; body?: string }): DneskaiClosingWords {
  const headline = (slide.headline ?? '').replace(/\[\[.*?\]\]/g, '').trim() || DNESKAI_CLOSING_DEFAULTS.headline;
  const body = (slide.body ?? '').trim();
  const handle = /(@[A-Za-z0-9._]{1,30})\s*$/.exec(body)?.[1] ?? DNESKAI_CLOSING_DEFAULTS.handle;
  const line = body.replace(/@[A-Za-z0-9._]{1,30}\s*$/, '').trim() || DNESKAI_CLOSING_DEFAULTS.body;
  return { headline, body: line, handle };
}

/** The closing slide's text for given words, as the deck stores it. */
export const dneskaiClosingText = (words: DneskaiClosingWords) => ({ headline: `${words.headline} [[DNESKAi]]`, body: `${words.body} ${words.handle}` });

function wrap(text: string, size: number, width: number): string[] {
  const face = resolveFace('Inter', 400);
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measureEm(face, next) * size > width) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

let assets: Promise<{ base: string; logo: string }> | null = null;
function loadAssets() {
  assets ??= Promise.all([readFile(BASE), readFile(LOGO, 'utf8')]).then(([base, logo]) => ({
    base: `data:image/png;base64,${base.toString('base64')}`,
    logo: [...logo.matchAll(/<path [^>]*><\/path>/g)].map((match) => match[0]).join(''),
  })).catch((error: unknown) => { assets = null; throw error; });
  return assets;
}

export async function renderDneskaiClosingCard(words: DneskaiClosingWords): Promise<Buffer> {
  const [{ base, logo }, { Resvg }] = await Promise.all([loadAssets(), import('@resvg/resvg-js')]);
  const bodyLines = wrap(words.body, 32, 880);
  const pillText = 38, pillPadX = 31, pillPadY = 19, pillStroke = 3;
  const pillWidth = measureEm(resolveFace('Inter', 700), words.handle) * pillText + 2 * pillPadX + 2 * pillStroke;
  const pillHeight = pillText + 2 * pillPadY + 2 * pillStroke;
  // Stacked from the floor up, as the page sets it: pill, 64 px, the line, 18 px, the logotype, 22 px, the word.
  const pillTop = H - BOTTOM - pillHeight;
  const bodyTop = pillTop - 64 - bodyLines.length * 41.6;
  const logoHeight = MEASURE * 708 / 4217.817852834741;
  const logoTop = bodyTop - 18 - logoHeight;
  const headlineTop = logoTop - 22 - 206;
  const scale = MEASURE / 4217.817852834741;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<image href="${base}" x="0" y="0" width="${W}" height="${H}"/>
<text x="${LEFT - 6}" y="${(headlineTop + 175).toFixed(1)}" font-family="Poppins" font-weight="900" font-size="206" letter-spacing="-2" fill="#FFFFFF">${escape(words.headline.toUpperCase())}</text>
<g transform="translate(${LEFT} ${logoTop.toFixed(2)}) scale(${scale.toFixed(6)}) translate(-50 708)">${logo}</g>
${bodyLines.map((line, index) => `<text x="${LEFT + 2}" y="${(bodyTop + index * 41.6 + 32.5).toFixed(1)}" font-family="Inter" font-weight="400" font-size="32" fill="#E6E7EA">${escape(line)}</text>`).join('')}
<rect x="${(W - LEFT - pillWidth + pillStroke / 2).toFixed(1)}" y="${(pillTop + pillStroke / 2).toFixed(1)}" width="${(pillWidth - pillStroke).toFixed(1)}" height="${pillHeight - pillStroke}" rx="${(pillHeight / 2).toFixed(1)}" fill="none" stroke="#FFFFFF" stroke-width="${pillStroke}"/>
<text x="${(W - LEFT - pillWidth / 2).toFixed(1)}" y="${(pillTop + pillHeight / 2 + 13.5).toFixed(1)}" text-anchor="middle" font-family="Inter" font-weight="700" font-size="${pillText}" fill="#FFFFFF">${escape(words.handle)}</text>
</svg>`;
  return Buffer.from(new Resvg(svg, { font: { fontFiles: [...fontFiles(), POPPINS], loadSystemFonts: false, defaultFontFamily: 'Inter' } }).render().asPng());
}
