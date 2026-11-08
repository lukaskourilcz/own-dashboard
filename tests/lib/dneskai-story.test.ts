import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { dneskaiGoldenCases, renderDneskaiSlide } from '@/lib/carousel-studio';
import { DNESKAI_COVER_STORY_TEMPLATE } from '@/lib/carousel-studio/dneskai-story';

const goldenPath = path.join(process.cwd(), 'tests', 'lib', 'goldens', 'dneskai-story.json');
const coverInput = async () => (await dneskaiGoldenCases()).find((entry) => entry.name === 'cover-photo')!.input;

// A headline that wraps to several lines, with a lone last word unless it is balanced.
const ORPHAN_HEADLINE = 'Reforma zdravotnictví se odkládá na příští rok kvůli sporu ve vládě';

describe('DNESKAi native 1080×1920 story (owner rule, 8 November 2026)', () => {
  it('is composed for the story canvas, with every block inside the safe area', () => {
    const tmpl = DNESKAI_COVER_STORY_TEMPLATE;
    expect(tmpl.canvas.master).toBe('instagram-story');
    const safe = tmpl.formats['instagram-story'].safeArea;
    for (const layer of tmpl.slides[0]!.layers) {
      if (layer.type === 'image') continue; // the photograph is a full-bleed derivation, not a safe-area block
      expect(layer.x).toBeGreaterThanOrEqual(safe.left - 1e-6);
      expect(layer.y).toBeGreaterThanOrEqual(safe.top - 1e-6);
      expect(layer.x + layer.width).toBeLessThanOrEqual(1 - safe.right + 1e-6);
      expect(layer.y + layer.height).toBeLessThanOrEqual(1 - safe.bottom + 1e-6);
    }
  });

  it('renders a 1080×1920 story that fills the frame with the photograph, no uniform letterbox bands', async () => {
    const result = await renderDneskaiSlide({ ...(await coverInput()), headline: ORPHAN_HEADLINE }, 'instagram-story');
    expect(result.status).toBe('rendered');
    expect(result.template?.id).toBe('dneskai-cover-story');
    const { data, info } = await sharp(result.png!).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([1080, 1920]);
    const ch = info.channels;
    const rowSpread = (y: number) => {
      const min = [255, 255, 255], max = [0, 0, 0];
      for (let x = 0; x < info.width; x += 4) for (let c = 0; c < 3; c += 1) {
        const v = data[(y * info.width + x) * ch + c]!; min[c] = Math.min(min[c]!, v); max[c] = Math.max(max[c]!, v);
      }
      return Math.max(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!);
    };
    // The top edge is the photograph, which varies across its width — not a flat bar. (The old padded story put a
    // blurred, darkened band here; a flat/near-flat top row is exactly the letterbox this rule removes.)
    expect(rowSpread(2)).toBeGreaterThan(24);
  }, 60_000);

  it('refuses a story with no headline or no photograph', async () => {
    const noHeadline = await renderDneskaiSlide({ ...(await coverInput()), headline: '' }, 'instagram-story');
    expect(noHeadline.status).toBe('refused');
    expect(noHeadline.problems.map((p) => p.code)).toContain('text-missing');
    const noPhoto = await renderDneskaiSlide({ ...(await coverInput()), images: [] }, 'instagram-story');
    expect(noPhoto.status).toBe('refused');
    expect(noPhoto.problems.map((p) => p.code)).toContain('image-missing');
  }, 60_000);

  it('matches the golden story PNG hash', async () => {
    const result = await renderDneskaiSlide(await coverInput(), 'instagram-story');
    expect(result.status).toBe('rendered');
    const hash = result.pngHash!;
    if (process.env.UPDATE_GOLDENS) { mkdirSync(path.dirname(goldenPath), { recursive: true }); writeFileSync(goldenPath, JSON.stringify({ name: 'cover-photo', templateId: result.template!.id, pngHash: hash }, null, 2) + '\n'); }
    expect(existsSync(goldenPath)).toBe(true);
    expect(hash).toBe(JSON.parse(readFileSync(goldenPath, 'utf8')).pngHash);
  }, 60_000);
});
