import { z } from 'zod';

/**
 * The devShark slide format (`devshark-deck/1`), browser-safe so the studio, the API and the renderer share it.
 * Green words are marked `[[like this]]`; the renderer (`devshark-render.ts`) draws them.
 */
export const DevsharkSlideSchema = z.strictObject({
  kind: z.enum(['cover', 'text', 'code', 'answer', 'closing']),
  kicker: z.string().trim().min(1).max(40).optional(),
  headline: z.string().trim().min(1).max(140),
  body: z.string().trim().max(400).optional(),
  code: z.string().max(600).optional(),
});
export type DevsharkSlide = z.infer<typeof DevsharkSlideSchema>;
export const DevsharkDeckSchema = z.strictObject({
  schemaVersion: z.literal('devshark-deck/1'),
  /** The cover's ground; inner slides alternate from it, the answer is green and the closer is ink. */
  cover: z.enum(['light', 'dark']),
  slides: z.array(DevsharkSlideSchema).min(2).max(8),
});
export type DevsharkDeck = z.infer<typeof DevsharkDeckSchema>;
