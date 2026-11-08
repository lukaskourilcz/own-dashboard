import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
vi.mock('server-only', () => ({}));
import sharp from 'sharp';
import {
  layoutDevsharkStory, STORY_HEIGHT, STORY_SAFE_BOTTOM, STORY_SAFE_TOP, STORY_WIDTH,
} from '@/lib/design-studio/devshark-layout';
import { renderDevsharkStory, type DevsharkDeck } from '@/lib/marketing/devshark-render';

// A cover whose body wraps to several lines, so the story exercises the safe-zone centring and the body balancing.
const deck: DevsharkDeck = { schemaVersion: 'devshark-deck/1', cover: 'light', slides: [
  { kind: 'cover', kicker: 'JavaScript quiz', headline: 'What does typeof null return?', body: 'One short question, [[balanced]] so the last line never ends on a single orphan word here.' },
  { kind: 'code', headline: 'Choose an answer', code: 'typeof null' },
  { kind: 'answer', headline: 'B. "object"', body: 'Test it with [[value === null]].' },
] };

// Placeholder picture hrefs keep the golden readable and decoupled from the brand SVG bytes; the JPEG test below uses
// the real pictures. Regenerate with UPDATE_GOLDENS=1.
const assets = { finGreen: 'FIN_GREEN', finInk: 'FIN_INK', logoWhite: 'LOGO_WHITE' };
const goldenPath = path.join(process.cwd(), 'tests', 'lib', 'goldens', 'devshark-story.svg');

const LIGHT_BG = [0xf3, 0xf6, 0xf1];
const near = (pixel: number[], target: number[], tol = 12) => pixel.every((value, index) => Math.abs(value - target[index]!) <= tol);

describe('devShark native 1080×1920 story (owner rule, 8 November 2026)', () => {
  it('centres the cover text inside the Instagram safe zone and never off the frame', () => {
    const layout = layoutDevsharkStory(deck, assets);
    expect(layout.warnings).toEqual([]);
    expect(layout.blocks.length).toBeGreaterThan(0);
    for (const block of layout.blocks) {
      expect(block.box.y).toBeGreaterThanOrEqual(STORY_SAFE_TOP);
      expect(block.box.y + block.height).toBeLessThanOrEqual(STORY_HEIGHT - STORY_SAFE_BOTTOM);
    }
    // The stack is centred in the safe band, not left at the slide's 1350-frame middle.
    const top = Math.min(...layout.blocks.map((b) => b.box.y));
    const bottom = Math.max(...layout.blocks.map((b) => b.box.y + b.height));
    expect(Math.abs((top + bottom) / 2 - (STORY_SAFE_TOP + (STORY_HEIGHT - STORY_SAFE_BOTTOM)) / 2)).toBeLessThanOrEqual(12);
  });

  it('re-flows a cover that carries slide-specific boxes, centring it in the safe zone', () => {
    // A cover authored in the Studio with absolute boxes for the 1350 slide (here near its top) must not keep those
    // positions in the taller story; the story re-flows and centres instead.
    const authored: DevsharkDeck = { schemaVersion: 'devshark-deck/1', cover: 'light', slides: [
      { kind: 'cover', kicker: 'Coding task', headline: 'Reverse the words.', body: '"learn code every day" becomes [["day every code learn"]].',
        layout: { kicker: { x: 80, y: 216, w: 920, size: 36 }, headline: { x: 80, y: 304, w: 920, size: 128 }, body: { x: 80, y: 616, w: 920, size: 68 } } },
      { kind: 'text', headline: 'next' },
    ] };
    const layout = layoutDevsharkStory(authored, assets);
    expect(layout.warnings).toEqual([]);
    for (const block of layout.blocks) {
      expect(block.box.y).toBeGreaterThanOrEqual(STORY_SAFE_TOP);
      expect(block.box.y + block.height).toBeLessThanOrEqual(STORY_HEIGHT - STORY_SAFE_BOTTOM);
    }
    // The kicker did not stay at its slide position (216, above the safe band); it moved down into the safe zone.
    expect(layout.blocks.find((b) => b.key === 'kicker')!.box.y).toBeGreaterThan(216);
  });

  it('matches the golden story SVG', () => {
    const svg = layoutDevsharkStory(deck, assets).svg;
    expect(svg).toContain(`width="${STORY_WIDTH}" height="${STORY_HEIGHT}"`);
    if (process.env.UPDATE_GOLDENS) { mkdirSync(path.dirname(goldenPath), { recursive: true }); writeFileSync(goldenPath, svg); }
    expect(existsSync(goldenPath)).toBe(true);
    expect(svg).toBe(readFileSync(goldenPath, 'utf8'));
  });

  it('renders a 1080×1920 JPEG whose ground fills the frame with no uniform letterbox bands', async () => {
    const story = await renderDevsharkStory(deck);
    const { data, info } = await sharp(story.jpeg).raw().toBuffer({ resolveWithObject: true });
    expect([info.format ?? 'raw', story.width, story.height]).toEqual(['raw', STORY_WIDTH, STORY_HEIGHT]);
    expect([info.width, info.height]).toEqual([STORY_WIDTH, STORY_HEIGHT]);
    const ch = info.channels;
    const pixel = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * ch, (y * info.width + x) * ch + 3));

    // The design's own ground reaches every corner and the centre margins: no darkened/blurred letterbox band, and no
    // seam between a floating card and a filler background. (The old padded story failed both: its bands were a
    // darkened, blurred copy of the cover.) Fin-free sample points only — the fin lives at the bottom-right.
    for (const [x, y] of [[20, 20], [1060, 20], [20, 960], [20, 1900], [540, 40], [540, 1880]] as const) {
      expect(near(pixel(x, y), LIGHT_BG)).toBe(true);
    }
    // The top edge row is a single flat colour across its whole width (a blurred band would vary across x).
    const min = [255, 255, 255], max = [0, 0, 0];
    for (let x = 0; x < info.width; x += 4) { const p = pixel(x, 2); for (let c = 0; c < 3; c += 1) { min[c] = Math.min(min[c]!, p[c]!); max[c] = Math.max(max[c]!, p[c]!); } }
    for (let c = 0; c < 3; c += 1) expect(max[c]! - min[c]!).toBeLessThanOrEqual(8);

    // Content really lives inside the safe band (the headline is drawn, not an empty frame).
    let ink = 0;
    for (let y = STORY_SAFE_TOP; y < STORY_HEIGHT - STORY_SAFE_BOTTOM; y += 3) for (let x = 80; x < 1000; x += 3) if (!near(pixel(x, y), LIGHT_BG, 40)) ink += 1;
    expect(ink).toBeGreaterThan(200);
  }, 60_000);
});
