import 'server-only';
import { characterCount } from './dneskai-deck-editor';
import { DNESKAI_SLIDES_VERSION, DneskaiDeckSchema, type DneskaiSlide } from './dneskai-slides';
import { dneskaiSlideTextProblems } from './dneskai-render';
import { dneskaiSlideFieldLimits } from './dneskai-workspace-read';
import { DNESKAI_FIT_VERSION, DneskaiFitRequestSchema, dneskaiKitRenderable, type DneskaiFitField, type DneskaiFitRequest, type DneskaiFitResult } from './dneskai-lab';

/** The Lab asked to fit a kit OwnDashboard cannot render yet. */
export class DneskaiFitError extends Error {
  constructor(readonly code: 'kit-unavailable' | 'fit-input-invalid') { super(code); this.name = 'DneskaiFitError'; }
}

/** A sha256-shaped stand-in: the fit never sees pictures, only which places a slide fills. */
const NO_ASSET = '0'.repeat(64);

/**
 * Text fit feedback before saving (design-lab-spec.md §5): for every slide the written fields its template draws,
 * with their character count against the layer's limit and whether the studio's fitter would cut them, plus any other
 * text problem the render would refuse. No media, no render, no storage, no model call; $0 and a few milliseconds.
 */
export async function fitDneskaiDeck(input: DneskaiFitRequest): Promise<DneskaiFitResult> {
  if (!dneskaiKitRenderable(input.kit)) throw new DneskaiFitError('kit-unavailable');
  const slides: DneskaiSlide[] = input.slides.map((slide) => ({
    type: slide.type, ...(slide.variant ? { variant: slide.variant } : {}), headline: slide.headline,
    ...(slide.body !== undefined ? { body: slide.body } : {}), ...(slide.kicker !== undefined ? { kicker: slide.kicker } : {}),
    ...(slide.credit !== undefined ? { credit: slide.credit } : {}),
    // A sources slide's lines are code-owned and not fitted here; one stand-in line keeps it a valid slide.
    ...(slide.type === 'sources' ? { sources: ['-'] } : {}),
    images: slide.images.map((slot) => ({ slot, assetSha256: NO_ASSET })), alt: '-',
  }));
  // The same deck rules as a save: a carousel of 2–10 slides or exactly one single slide.
  const format = slides.length === 1 && slides[0]!.type === 'single' ? 'single-image' : 'carousel';
  if (!DneskaiDeckSchema.safeParse({ schemaVersion: DNESKAI_SLIDES_VERSION, format, slides }).success) throw new DneskaiFitError('fit-input-invalid');
  const fitted = await Promise.all(slides.map(async (slide, index) => {
    const problems = await dneskaiSlideTextProblems(slide, { index, count: slides.length }, input.kit);
    const fields: DneskaiFitField[] = dneskaiSlideFieldLimits(slide, index).map(({ field, max }) => {
      const characters = characterCount((slide[field] ?? '').trim());
      const own = problems.filter((problem) => problem.field === field);
      return {
        field, characters, max, overBy: Math.max(0, characters - max),
        clipped: own.some((problem) => problem.code === 'text-clipped'),
        lines: null, fontSize: null,
        codes: [...new Set(own.filter((problem) => problem.code !== 'text-clipped').map((problem) => problem.code))].slice(0, 8),
      };
    });
    const named = new Set(fields.map((field) => field.field as string));
    const codes = [...new Set(problems.filter((problem) => !problem.field || !named.has(problem.field)).map((problem) => problem.code))].slice(0, 8);
    const fits = !problems.some((problem) => problem.blocking) && fields.every((field) => field.overBy === 0 && !field.clipped);
    return { index, fits, fields, codes };
  }));
  return { schemaVersion: DNESKAI_FIT_VERSION, kit: input.kit, slides: fitted };
}

/** The HTTP answer shared by the owner's route and the fixture-only preview route: parse, fit, answer with codes only. */
export async function dneskaiFitResponse(request: Request): Promise<Response> {
  let input: DneskaiFitRequest;
  try { const raw = await request.text(); if (raw.length > 20_000) throw new Error('too-large'); input = DneskaiFitRequestSchema.parse(JSON.parse(raw)); }
  catch { return Response.json({ error: 'invalid-request' }, { status: 400 }); }
  try {
    return Response.json(await fitDneskaiDeck(input), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof DneskaiFitError) return Response.json({ error: error.code }, { status: error.code === 'kit-unavailable' ? 409 : 400 });
    return Response.json({ error: 'fit-unavailable' }, { status: 503 });
  }
}
