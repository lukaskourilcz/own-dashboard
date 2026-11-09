import { z } from 'zod';

/**
 * The devShark slide format (`devshark-deck/1`), browser-safe so the studio, the API and the renderer share it.
 * Green words are marked `[[like this]]`; the renderer (`devshark-render.ts`) draws them.
 */
/**
 * One text block's place on the 1080 × 1350 slide, set in the Design Studio (7 November 2026): top-left corner, width,
 * font size and alignment in slide pixels. A block without a box flows automatically.
 */
export const DevsharkBoxSchema = z.strictObject({
  x: z.number().min(-540).max(1620),
  y: z.number().min(-675).max(2025),
  w: z.number().min(80).max(1080),
  size: z.number().min(12).max(240),
  align: z.enum(['left', 'center', 'right']).default('left'),
});
export type DevsharkBox = z.input<typeof DevsharkBoxSchema>;
export const DevsharkSlideSchema = z.strictObject({
  kind: z.enum(['cover', 'text', 'code', 'answer', 'closing']),
  kicker: z.string().trim().min(1).max(40).optional(),
  headline: z.string().trim().min(1).max(140),
  body: z.string().trim().max(400).optional(),
  code: z.string().max(600).optional(),
  layout: z.strictObject({ kicker: DevsharkBoxSchema.optional(), headline: DevsharkBoxSchema.optional(), body: DevsharkBoxSchema.optional(), code: DevsharkBoxSchema.optional() }).optional(),
});
export type DevsharkSlide = z.infer<typeof DevsharkSlideSchema>;
export const DevsharkDeckSchema = z.strictObject({
  schemaVersion: z.literal('devshark-deck/1'),
  /** The cover's ground; inner slides alternate from it, the answer is green and the closer is ink. */
  cover: z.enum(['light', 'dark']),
  strong: z.literal(true).optional(),
  slides: z.array(DevsharkSlideSchema).min(2).max(8),
});
export type DevsharkDeck = z.infer<typeof DevsharkDeckSchema>;
