import { describe, expect, it } from 'vitest';
// The vendored studio's own function, by file: OwnDashboard's runtime imports only the dneskai-slide and fonts entries.
import { cropRegion } from '../../vendor/carousel-studio/dist/images.js';
import { dneskaiCropFractions, dneskaiCropRegion, dneskaiCropUpscale, dneskaiSlotFrame } from '@/lib/marketing/dneskai-crop';

const sources = [{ width: 1600, height: 1200 }, { width: 1200, height: 1500 }, { width: 1000, height: 700 }, { width: 800, height: 800 }, { width: 4032, height: 3024 }, { width: 901, height: 1999 }];
const frames = [{ width: 1080, height: 1350 }, { width: 936, height: 600 }, { width: 468, height: 640 }, { width: 468, height: 360 }, { width: 333.4, height: 211.6 }];
const crops = [{ focal: { x: 0.5, y: 0.5 } }, { focal: { x: 0, y: 0 } }, { focal: { x: 1, y: 1 } }, { focal: { x: 0.13, y: 0.87 }, zoom: 1.35 }, { focal: { x: 0.9, y: 0.1 }, zoom: 2 }, { focal: { x: 0.501, y: 0.499 }, zoom: 4 }];

describe('Design Lab crop arithmetic', () => {
  it('cuts exactly the region the vendored studio cuts, for every fixture picture, crop, frame and fit', () => {
    let compared = 0;
    for (const source of sources) for (const frame of frames) for (const crop of crops) for (const fit of ['cover', 'contain'] as const) {
      expect(dneskaiCropRegion(source, crop, frame, fit)).toEqual(cropRegion(source, crop, frame, fit));
      compared += 1;
    }
    expect(compared).toBe(sources.length * frames.length * crops.length * 2);
  });

  it('declares the full slide for a bleed place, the template frame for a framed one, and nothing for a place a type lacks', () => {
    const image = (slot: string) => ({ slot, assetSha256: 'a'.repeat(64) });
    expect(dneskaiSlotFrame({ type: 'cover-photo', images: [image('image-1')] }, 'image-1')).toEqual({ width: 1080, height: 1350, fit: 'cover' });
    expect(dneskaiSlotFrame({ type: 'single', variant: 'type', images: [] }, 'image-1')).toBeNull();
    expect(dneskaiSlotFrame({ type: 'figure', images: [image('image-1')] }, 'image-1')).toEqual({ width: 936, height: 600, fit: 'contain' });
    expect(dneskaiSlotFrame({ type: 'split', images: [image('image-1')] }, 'image-1')).toEqual({ width: 468, height: 640, fit: 'contain' });
    expect(dneskaiSlotFrame({ type: 'split', images: [image('image-1'), image('image-2')] }, 'image-2')).toEqual({ width: 468, height: 360, fit: 'contain' });
    expect(dneskaiSlotFrame({ type: 'statement', images: [] }, 'image-1')).toBeNull();
  });

  it('measures the stretch the resolution gate reads and draws the region as fractions of the picture', () => {
    const region = dneskaiCropRegion({ width: 1600, height: 1200 }, { focal: { x: 0.5, y: 0.5 }, zoom: 2 }, { width: 1080, height: 1350 }, 'cover');
    expect(region).toMatchObject({ width: 480, height: 600, outWidth: 1080, outHeight: 1350 });
    expect(dneskaiCropUpscale(region)).toBe(2.25);
    expect(dneskaiCropFractions(region, { width: 1600, height: 1200 })).toEqual({ left: 0.35, top: 0.25, width: 0.3, height: 0.5 });
  });
});
