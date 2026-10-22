import type { DneskaiImageCrop, DneskaiSlide } from './dneskai-slides';

/**
 * The studio's crop arithmetic (`cropRegion` in vendor/carousel-studio/dist/images.js), copied so the Design Lab can
 * draw the real crop on the client while the owner moves the focal point or zoom, without a render. Pure integer
 * arithmetic; `tests/lib/marketing-dneskai-crop.test.ts` runs both on fixture inputs so the copy cannot drift.
 */
export type DneskaiCropRegion = { left: number; top: number; width: number; height: number; outWidth: number; outHeight: number };
export type DneskaiFrame = { width: number; height: number; fit: 'cover' | 'contain' };

export function dneskaiCropRegion(source: { width: number; height: number }, crop: Pick<DneskaiImageCrop, 'focal' | 'zoom'>, frame: { width: number; height: number }, fit: 'cover' | 'contain'): DneskaiCropRegion {
  const frameWidth = Math.max(1, Math.round(frame.width));
  const frameHeight = Math.max(1, Math.round(frame.height));
  const zoom = crop.zoom ?? 1;
  let regionWidth = source.width;
  let regionHeight = source.height;
  if (fit === 'cover') {
    const aspect = frameWidth / frameHeight;
    regionWidth = Math.min(source.width, source.height * aspect);
    regionHeight = regionWidth / aspect;
  }
  const width = Math.min(source.width, Math.max(1, Math.round(regionWidth / zoom)));
  const height = Math.min(source.height, Math.max(1, Math.round(regionHeight / zoom)));
  const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));
  const left = clamp(Math.round(crop.focal.x * source.width - width / 2), source.width - width);
  const top = clamp(Math.round(crop.focal.y * source.height - height / 2), source.height - height);
  if (fit === 'cover') return { left, top, width, height, outWidth: frameWidth, outHeight: frameHeight };
  const scale = Math.min(frameWidth / width, frameHeight / height);
  return { left, top, width, height, outWidth: Math.max(1, Math.round(width * scale)), outHeight: Math.max(1, Math.round(height * scale)) };
}

/**
 * The frame a picture place is declared at in the editorial kit's templates (vendored `dneskai-photo.js`, 1080 × 1350
 * canvas): a full-bleed place is the whole slide and cuts to it (`cover`); a framed place shows the whole picture
 * (`contain`) and the layout may shrink the frame to the words around it, which changes its size but not what a
 * `contain` crop keeps. Null for a place the slide type does not have. `fit` on the crop overrides the template.
 */
export function dneskaiSlotFrame(slide: Pick<DneskaiSlide, 'type' | 'variant' | 'images'>, slot: string): DneskaiFrame | null {
  const pair = slide.images.some((image) => image.slot === 'image-2');
  switch (slide.type) {
    case 'cover-photo': return slot === 'image-1' ? { width: 1080, height: 1350, fit: 'cover' } : null;
    case 'single': return slot === 'image-1' && (slide.variant ?? 'photo') === 'photo' ? { width: 1080, height: 1350, fit: 'cover' } : null;
    case 'figure': return slot === 'image-1' ? { width: 936, height: 600, fit: 'contain' } : null;
    case 'split': return slot === 'image-1' || (pair && slot === 'image-2') ? pair ? { width: 468, height: 360, fit: 'contain' } : { width: 468, height: 640, fit: 'contain' } : null;
    default: return null;
  }
}

/** How far a crop stretches the pixels it cuts, as the studio's resolution gate measures it. */
export const dneskaiCropUpscale = (region: DneskaiCropRegion) => Math.max(region.outWidth / region.width, region.outHeight / region.height);

/** The region as fractions of the source, for drawing it over a preview of any size. */
export function dneskaiCropFractions(region: DneskaiCropRegion, source: { width: number; height: number }) {
  return { left: region.left / source.width, top: region.top / source.height, width: region.width / source.width, height: region.height / source.height };
}
