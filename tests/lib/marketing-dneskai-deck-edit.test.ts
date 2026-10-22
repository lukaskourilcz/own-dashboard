import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { applyDneskaiDeckEdit, dneskaiDeckEditNeedsPool, DneskaiRevisionEditError, type DneskaiDeckEdit, type DneskaiEditPool } from '@/lib/marketing/dneskai-deck-edit';
import { prepareDneskaiRevisionEdit } from '@/lib/marketing/dneskai-revision-edit';
import {
  createDeckDraft, dneskaiEditRequest, dneskaiSlidePixelsKey, draftProblems, draftSlideMoves, insertablePictures, insertPosition, insertSlide, setSlideShape, setSlideText,
} from '@/lib/marketing/dneskai-deck-editor';
import { dneskaiInsertablePictures, dneskaiPictureFitsShape, dneskaiShapeId, dneskaiSlideFieldLimits, dneskaiSlideMoves } from '@/lib/marketing/dneskai-slide-layout';
import { dneskaiSlideFieldLimits as serverFieldLimits } from '@/lib/marketing/dneskai-workspace-read';
import { createDneskaiWorkspaceFixture, demoFieldLimits } from '@/lib/demo/dneskai-workspace-fixtures';
import { DNESKAI_FIT_VERSION, type DneskaiFitResult } from '@/lib/marketing/dneskai-lab';
import type { DneskaiDeck } from '@/lib/marketing/dneskai-slides';
import type { DneskaiWorkspacePost } from '@/lib/marketing/dneskai-workspace';
import { a, b, c, d, deck, deckRevision } from './marketing-dneskai-revision-fixture';

// The drafts read the clock (an expired time is replaced, the time window is checked): pin it to the fixture's day.
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2026-10-24T09:00:00Z'));

const code = async (run: () => unknown) => { try { await run(); } catch (error) { return error instanceof DneskaiRevisionEditError ? error.code : String(error); } return null; };
const media = (assetSha256: string, candidateId: string, flags: { full: boolean; inset: boolean }, credit = 'Foto: ukázkový zdroj') =>
  ({ assetSha256, candidateId, credit, fullBleedCapable: flags.full, insetCapable: flags.inset });
/** a: primary source, full-bleed; b: same source, framed only; c: primary source, too small; d: an uncited source. */
const pool: DneskaiEditPool = {
  media: [media(a, 'primary', { full: true, inset: true }), media(b, 'primary', { full: false, inset: true }), media(c, 'primary', { full: false, inset: false }), media(d, 'other', { full: true, inset: true })],
  primaryCandidateId: 'primary',
};
const statements = (): DneskaiDeck => ({ ...deck(), slides: [deck().slides[0]!, { type: 'statement', headline: 'Výrok', body: 'Text.', images: [], alt: 'Výrok' }, deck().slides[2]!] });
const single = (): DneskaiDeck => ({ schemaVersion: deck().schemaVersion, format: 'single-image', slides: [{ type: 'single', variant: 'photo', headline: 'Jeden', credit: 'Foto: zdroj', images: [{ slot: 'image-1', assetSha256: a }], alt: 'Fotka' }] });
const keep = (count: number) => Array.from({ length: count }, (_, from) => ({ from }));

describe('review-10 edit contract: variants and type moves', () => {
  it('switches a statement between accent and ink without the pool', () => {
    const edit: DneskaiDeckEdit = { slides: [{ from: 0 }, { from: 1, variant: 'ink' }, { from: 2 }] };
    expect(dneskaiDeckEditNeedsPool(statements(), edit)).toBe(false);
    expect(applyDneskaiDeckEdit(statements(), edit).slides[1]).toMatchObject({ type: 'statement', variant: 'ink', headline: 'Výrok' });
    // Naming the studio's default changes nothing, so the slide keeps its render key.
    expect(applyDneskaiDeckEdit(statements(), { slides: [{ from: 0 }, { from: 1, variant: 'accent' }, { from: 2 }] }).slides[1]!.variant).toBeUndefined();
  });
  it('refuses a variant outside the type set and a move nobody allows', async () => {
    expect(await code(() => applyDneskaiDeckEdit(statements(), { slides: [{ from: 0 }, { from: 1, variant: 'photo' }, { from: 2 }] }))).toBe('deck-edit-variant-invalid');
    expect(await code(() => applyDneskaiDeckEdit(statements(), { slides: [{ from: 0 }, { from: 1, type: 'figure' }, { from: 2 }] }))).toBe('deck-edit-move-not-allowed');
    expect(await code(() => applyDneskaiDeckEdit(deck(), { slides: [{ from: 0 }, { from: 1, type: 'figure' }, { from: 2 }] }, pool))).toBe('deck-edit-move-not-allowed');
    expect(await code(() => applyDneskaiDeckEdit(deck(), { slides: [{ from: 0, type: 'statement' }, { from: 1 }, { from: 2 }] }, pool))).toBe('deck-edit-move-not-allowed');
  });
  it('moves a one-picture slide between cover, figure and split only as its picture and place allow', async () => {
    expect(await code(() => applyDneskaiDeckEdit(deck(), { slides: [{ from: 0, type: 'figure', kicker: null }, ...keep(3).slice(1)] }))).toBe('deck-edit-pool-unavailable');
    const figure = applyDneskaiDeckEdit(deck(), { slides: [{ from: 0, type: 'figure', kicker: null }, { from: 1 }, { from: 2 }] }, pool);
    expect(figure.slides[0]).toMatchObject({ type: 'figure', headline: deck().slides[0]!.headline, images: deck().slides[0]!.images });
    expect(figure.slides[0]!.kicker).toBeUndefined();
    // Text the new type does not draw must go with the move, never sit unseen in the approved deck.
    const kickered = { ...deck(), slides: [deck().slides[0]!, { type: 'split' as const, kicker: 'TIP', headline: 'Rada', body: 'Text.', images: [{ slot: 'image-1', assetSha256: b }], alt: 'Rada' }, deck().slides[2]!] };
    expect(await code(() => applyDneskaiDeckEdit(kickered, { slides: [{ from: 0 }, { from: 1, type: 'figure' }, { from: 2 }] }, pool))).toBe('deck-edit-text-unplaced');
    expect(applyDneskaiDeckEdit(kickered, { slides: [{ from: 0 }, { from: 1, type: 'figure', kicker: null }, { from: 2 }] }, pool).slides[1]).toMatchObject({ type: 'figure', headline: 'Rada', body: 'Text.' });
    // A cover only opens the carousel and needs a full-bleed picture.
    const framed = { ...deck(), slides: [deck().slides[0]!, { type: 'figure' as const, headline: 'Obrázek', images: [{ slot: 'image-1', assetSha256: b }], alt: 'Obrázek' }, deck().slides[2]!] };
    expect(await code(() => applyDneskaiDeckEdit(framed, { slides: [{ from: 0 }, { from: 1, type: 'cover-photo' }, { from: 2 }] }, pool))).toBe('deck-edit-move-not-allowed');
    expect(await code(() => applyDneskaiDeckEdit(framed, { slides: [{ from: 1, type: 'cover-photo' }, { from: 0, type: 'figure', kicker: null }, { from: 2 }] }, pool))).toBe('deck-edit-move-not-allowed');
    expect(applyDneskaiDeckEdit(framed, { slides: [{ from: 0 }, { from: 1, type: 'split', kicker: 'NOVĚ' }, { from: 2 }] }, pool).slides[1]).toMatchObject({ type: 'split', kicker: 'NOVĚ' });
    // A picture the pool does not vouch for cannot move.
    expect(await code(() => applyDneskaiDeckEdit(framed, { slides: [{ from: 0 }, { from: 1, type: 'split' }, { from: 2 }] }, { media: [], primaryCandidateId: null }))).toBe('deck-edit-move-not-allowed');
  });
  it('drops the picture and credit of a single photo post that becomes type-only', () => {
    const next = applyDneskaiDeckEdit(single(), { slides: [{ from: 0, variant: 'type' }] });
    expect(next.slides[0]).toMatchObject({ type: 'single', variant: 'type', images: [] });
    expect(next.slides[0]!.credit).toBeUndefined();
  });
});

describe('kit switches', () => {
  it('switches the whole post, writes editorial by omission and refuses a kit OwnDashboard cannot draw', async () => {
    const renderable = await import('@/lib/marketing/dneskai-slides');
    const other = renderable.DNESKAI_KIT_IDS.find((kit) => kit !== 'editorial' && !renderable.DNESKAI_RENDERABLE_KIT_IDS.includes(kit));
    if (other) expect(await code(() => applyDneskaiDeckEdit(deck(), { kit: other, slides: keep(3) }))).toBe('kit-unavailable');
    const drawn = renderable.DNESKAI_RENDERABLE_KIT_IDS.find((kit) => kit !== 'editorial');
    if (drawn) {
      const switched = applyDneskaiDeckEdit(deck(), { kit: drawn, slides: keep(3) });
      expect(switched.kit).toBe(drawn);
      // Without a kit the edit keeps the deck's kit; back to editorial removes the field.
      expect(applyDneskaiDeckEdit(switched, { slides: keep(3) }).kit).toBe(drawn);
      expect('kit' in applyDneskaiDeckEdit(switched, { kit: 'editorial', slides: keep(3) })).toBe(false);
    }
    expect('kit' in applyDneskaiDeckEdit(deck(), { kit: 'editorial', slides: keep(3) })).toBe(false);
  });
});

describe('review-10 edit contract: inserted slides', () => {
  const figure = (assetSha256: string) => ({ insert: { type: 'figure' as const, headline: 'Nový slide', body: 'Vlastní text.', alt: 'Popis obrázku', images: [{ slot: 'image-1', assetSha256 }] } });
  const deckWithB = (): DneskaiDeck => ({ ...deck(), slides: [deck().slides[0]!, { ...deck().slides[1]!, images: [{ slot: 'image-1', assetSha256: a }] }, deck().slides[2]!] });
  /** A deck saved before the 22 October 2026 rules, still ending in a sources slide. */
  const legacy = (): DneskaiDeck => ({ ...deckWithB(), slides: [...deckWithB().slides, { type: 'sources', headline: '', sources: ['The Verge, 20. 10. 2026'], images: [], alt: 'Zdroje' }] });
  it('inserts a framed picture from a cited source without a credit line', () => {
    const next = applyDneskaiDeckEdit(deckWithB(), { slides: [{ from: 0 }, figure(b), { from: 1 }, { from: 2 }] }, pool);
    expect(next.slides.map((slide) => slide.type)).toEqual(['cover-photo', 'figure', 'split', 'statement']);
    expect(next.slides[1]).toMatchObject({ headline: 'Nový slide', images: [{ slot: 'image-1', assetSha256: b }] });
    // No slide shows a picture credit (owner rule, 22 October 2026): the credit stays in the pool, not on the slide.
    expect(next.slides[1]!.credit).toBeUndefined();
    const statement = applyDneskaiDeckEdit(deck(), { slides: [{ from: 0 }, { insert: { type: 'statement', variant: 'ink', headline: 'Můj výrok', alt: 'Výrok' , images: [] } }, { from: 1 }, { from: 2 }] }, pool);
    expect(statement.slides[1]).toMatchObject({ type: 'statement', variant: 'ink', images: [] });
    expect(statement.slides[1]!.credit).toBeUndefined();
  });
  it('refuses inserts the rules do not allow', async () => {
    const run = (slides: DneskaiDeckEdit['slides'], value: DneskaiDeck = deckWithB(), given: DneskaiEditPool | null = pool) => code(() => applyDneskaiDeckEdit(value, { slides }, given));
    expect(await run([{ from: 0 }, figure(b), { from: 1 }, { from: 2 }], deckWithB(), null)).toBe('deck-edit-pool-unavailable');
    expect(await run([{ from: 0 }, { from: 1 }, { from: 2 }, { from: 3 }, figure(b)], legacy())).toBe('deck-edit-insert-after-sources');
    expect(await run([{ from: 0 }, figure(a), { from: 1 }, { from: 2 }])).toBe('deck-edit-insert-picture-unavailable');
    expect(await run([{ from: 0 }, figure(b), figure(b), { from: 1 }, { from: 2 }])).toBe('deck-edit-insert-picture-unavailable');
    expect(await run([{ from: 0 }, figure(d), { from: 1 }, { from: 2 }])).toBe('deck-edit-insert-picture-unavailable');
    expect(await run([{ from: 0 }, figure(c), { from: 1 }, { from: 2 }])).toBe('deck-edit-insert-picture-unfit');
    expect(await run([{ from: 0 }, figure('9'.repeat(64)), { from: 1 }, { from: 2 }])).toBe('deck-asset-outside-brief');
    expect(await run([{ from: 0 }, { insert: { ...figure(b).insert, kicker: 'NE' } }, { from: 1 }, { from: 2 }])).toBe('deck-edit-text-unplaced');
    expect(await run([{ from: 0 }, { insert: { ...figure(b).insert, images: [] } }, { from: 1 }, { from: 2 }])).toBe('deck-edit-insert-pictures');
    expect(await run([{ from: 0 }, { insert: { ...figure(b).insert, headline: ' ' } }, { from: 1 }, { from: 2 }])).toBe('deck-edit-invalid');
    expect(await code(() => applyDneskaiDeckEdit(single(), { slides: [figure(b), { from: 0 }] }, pool))).toBe('deck-edit-insert-not-allowed');
  });
  it('loads the pool for the save only when the edit needs it', async () => {
    const list = vi.fn(async () => [a, b, c]);
    const load = vi.fn(async () => pool);
    await prepareDneskaiRevisionEdit(deckRevision(), { caption: 'x', scheduledAt: '2099-10-22T06:00:00Z', deck: { slides: [{ from: 1 }, { from: 0 }] } }, list, load);
    expect(load).not.toHaveBeenCalled();
    const revision = { ...deckRevision(), deck: deckWithB() };
    const next = await prepareDneskaiRevisionEdit(revision, { caption: 'x', scheduledAt: '2099-10-22T06:00:00Z', deck: { slides: [{ from: 0 }, figure(b), { from: 1 }, { from: 2 }] } }, list, load);
    expect(load).toHaveBeenCalledWith(revision);
    expect(next.deck!.slides).toHaveLength(4);
    expect(next.assets).toEqual([]);
    expect(await code(() => prepareDneskaiRevisionEdit(revision, { caption: 'x', scheduledAt: '2099-10-22T06:00:00Z', deck: { slides: [{ from: 0 }, figure(b), { from: 1 }, { from: 2 }] } }, list))).toBe('deck-edit-pool-unavailable');
  });
});

describe('review-10 in the editor: the draft and the server agree', () => {
  const now = new Date('2026-10-24T09:00:00Z');
  const post = (n: number): DneskaiWorkspacePost => createDneskaiWorkspaceFixture(now).posts.find((item) => item.id.endsWith(String(n).padStart(12, '0')))!;
  const serverPool = (value: DneskaiWorkspacePost): DneskaiEditPool => ({ media: value.brief!.media, primaryCandidateId: value.brief!.evidence[0]!.candidateId });
  const roundTrip = (value: DneskaiWorkspacePost, draft: ReturnType<typeof createDeckDraft>) => {
    const request = dneskaiEditRequest(value, draft);
    return applyDneskaiDeckEdit(value.deck!, request.deck as DneskaiDeckEdit, serverPool(value));
  };
  it('offers the moves the pictures allow and saves exactly what the draft shows', () => {
    const value = post(1);
    const draft = createDeckDraft(value);
    expect(draftSlideMoves(value, draft, 0).map(dneskaiShapeId)).toEqual(['cover-photo', 'figure', 'split']);
    expect(draftSlideMoves(value, draft, 2).map(dneskaiShapeId)).toEqual(['split', 'figure']);
    expect(draftSlideMoves(value, draft, 3).map(dneskaiShapeId)).toEqual(['statement-accent', 'statement-ink']);
    const cover = setSlideShape(value, draft, 0, 'figure');
    expect(cover.dropped).toEqual([]);
    expect(cover.draft.slides[0]!.fields.map((field) => field.field)).toEqual(['headline', 'body']);
    // A split's kicker goes with a move to a figure, which draws none.
    const moved = setSlideShape(value, cover.draft, 2, 'figure');
    expect(moved.dropped).toEqual(['kicker']);
    expect(moved.draft.slides[2]!.fields.map((field) => field.field)).toEqual(['headline', 'body']);
    const ink = setSlideShape(value, moved.draft, 3, 'statement-ink').draft;
    expect(roundTrip(value, ink).slides).toEqual(ink.slides.map((item) => item.slide));
    // A move outside the allowed set changes nothing.
    expect(setSlideShape(value, draft, 3, 'figure').draft).toBe(draft);
  });
  it('inserts from cited, unused, fitting pictures and saves the same slide', () => {
    const value = post(1);
    const draft = createDeckDraft(value);
    const offered = insertablePictures(value, draft, 'figure');
    // p5 is too small for a frame; p1, p3 and p4 are already shown.
    expect(offered.map((item) => item.width)).toEqual([1440, 1200]);
    expect(insertablePictures(value, draft, 'statement-accent')).toEqual([]);
    expect(insertPosition(draft, 9)).toBe(4);
    const { draft: next, index } = insertSlide(value, draft, 1, 'figure', offered[0]!);
    expect(index).toBe(2);
    expect(next.slides[2]).toMatchObject({ from: null, slide: { type: 'figure', headline: '', alt: '' } });
    expect(next.slides[2]!.slide.credit).toBeUndefined();
    expect(draftProblems(value, next).filter((problem) => problem.slide === 2).map((problem) => problem.code)).toEqual(['text-missing', 'alt-missing']);
    const written = setSlideText(setSlideText(next, 2, 'headline', 'Můj titulek'), 2, 'alt', 'Popis obrázku');
    expect(roundTrip(value, written).slides).toEqual(written.slides.map((item) => item.slide));
    const statement = insertSlide(value, written, 0, 'statement-ink', null);
    expect(statement.draft.slides[1]!.slide).toMatchObject({ type: 'statement', variant: 'ink', images: [] });
    expect(insertSlide(value, draft, 1, 'figure', { assetSha256: value.deck!.slides[0]!.images[0]!.assetSha256 }).index).toBe(-1);
    expect(insertSlide(post(2), createDeckDraft(post(2)), 0, 'statement-accent', null).index).toBe(-1);
  });
  it('turns a single photo post into a type-only post', () => {
    const value = post(2);
    const moved = setSlideShape(value, createDeckDraft(value), 0, 'single-type');
    expect(moved.draft.slides[0]!.slide).toMatchObject({ variant: 'type', images: [] });
    expect(roundTrip(value, moved.draft).slides).toEqual(moved.draft.slides.map((item) => item.slide));
  });
  it('blocks a save the fit report says would be cut', () => {
    const value = post(1);
    const draft = createDeckDraft(value);
    const fit: DneskaiFitResult = { schemaVersion: DNESKAI_FIT_VERSION, kit: 'editorial', slides: draft.slides.map((_, index) => ({ index, fits: index !== 1,
      fields: index === 1 ? [{ field: 'headline', characters: 90, max: 110, overBy: 0, clipped: true, lines: null, fontSize: null, codes: [] }] : [], codes: [] })) };
    expect(draftProblems(value, draft, fit)).toEqual([{ slide: 1, field: 'headline', code: 'text-clipped' }]);
    // A report for another deck length is stale and ignored.
    expect(draftProblems(value, draft, { ...fit, slides: fit.slides.slice(1) })).toEqual([]);
  });
});

describe('the shared layout tables', () => {
  it('match the server read model and the preview fixtures for every shape', () => {
    const slides = [
      { type: 'cover-photo', images: [1] }, { type: 'figure', images: [1] }, { type: 'split', images: [1] }, { type: 'split', images: [1, 2] }, { type: 'statement', images: [] },
      { type: 'single', variant: 'photo', images: [1] }, { type: 'single', variant: 'type', images: [] }, { type: 'sources', images: [] },
    ] as const;
    for (const slide of slides) {
      const shaped = { ...slide, images: slide.images.map((n) => ({ slot: `image-${n}`, assetSha256: a })), headline: 'x', alt: 'x' };
      expect(dneskaiSlideFieldLimits(shaped)).toEqual(serverFieldLimits(shaped));
      expect(dneskaiSlideFieldLimits(shaped)).toEqual(demoFieldLimits(shaped));
    }
  });
  it('reads capability flags the way generation offers pictures', () => {
    expect(dneskaiPictureFitsShape({ credit: 'Foto: x', fullBleedCapable: true, insetCapable: true }, { type: 'single', variant: 'photo' })).toBe(true);
    // No slide carries a credit line, so a long credit never rules a picture out.
    expect(dneskaiPictureFitsShape({ credit: `Foto: ${'x'.repeat(40)}`, fullBleedCapable: true, insetCapable: true }, { type: 'single', variant: 'photo' })).toBe(true);
    expect(dneskaiPictureFitsShape({ credit: 'x', fullBleedCapable: false, insetCapable: true }, { type: 'cover-photo' })).toBe(false);
    expect(dneskaiSlideMoves({ type: 'split', images: [{ slot: 'image-1', assetSha256: a }, { slot: 'image-2', assetSha256: b }] }, { index: 1, format: 'carousel', media: new Map() }).map(dneskaiShapeId)).toEqual(['split']);
    expect(dneskaiInsertablePictures(pool.media, deck(), null).map((item) => item.assetSha256)).toEqual([c]);
  });
});

describe('the Lab keeps a saved JPEG only while the pixels cannot differ', () => {
  it('ignores alt text and surrounding whitespace, and notices words, variants and crops', () => {
    const slide = statements().slides[1]!;
    const key = dneskaiSlidePixelsKey(slide);
    expect(dneskaiSlidePixelsKey({ ...slide, alt: 'Jiný popis', headline: ` ${slide.headline} `, kicker: '' })).toBe(key);
    expect(dneskaiSlidePixelsKey({ ...slide, headline: 'Jiný výrok' })).not.toBe(key);
    expect(dneskaiSlidePixelsKey({ ...slide, variant: 'ink' })).not.toBe(key);
    const cover = deck().slides[0]!;
    expect(dneskaiSlidePixelsKey({ ...cover, images: [{ ...cover.images[0]!, crop: { focal: { x: 0.5, y: 0.41 } } }] })).not.toBe(dneskaiSlidePixelsKey(cover));
  });
});

describe('spotlight cover inset', () => {
  it('adds and drops the cover inset only in a kit that draws one, on server and draft alike', async () => {
    const cover = deck().slides[0]!;
    const withInset = { from: 0, images: [...cover.images, { slot: 'image-2', assetSha256: b }] };
    // Any other kit keeps the cover's one picture place.
    expect(await code(() => applyDneskaiDeckEdit(deck(), { slides: [withInset, { from: 1 }, { from: 2 }] }))).toBe('deck-edit-slots-changed');
    const spotlight = applyDneskaiDeckEdit(deck(), { kit: 'spotlight', slides: [withInset, { from: 1 }, { from: 2 }] });
    expect(spotlight.slides[0]!.images.map((image) => image.slot)).toEqual(['image-1', 'image-2']);
    // The same picture twice is no inset.
    expect(await code(() => applyDneskaiDeckEdit(deck(), { kit: 'spotlight', slides: [{ from: 0, images: [...cover.images, { slot: 'image-2', assetSha256: cover.images[0]!.assetSha256 }] }, { from: 1 }, { from: 2 }] }))).toBe('deck-edit-slots-changed');
    const dropped = applyDneskaiDeckEdit(spotlight, { slides: [{ from: 0, images: cover.images }, { from: 1 }, { from: 2 }] });
    expect(dropped.slides[0]!.images.map((image) => image.slot)).toEqual(['image-1']);
    // Leaving spotlight drops the inset when the deck is shown.
    const { dneskaiShownDeck } = await import('@/lib/marketing/dneskai-slide-layout');
    expect(dneskaiShownDeck({ ...spotlight, kit: 'bold' }).slides[0]!.images.map((image) => image.slot)).toEqual(['image-1']);
    expect(dneskaiShownDeck(spotlight).slides[0]!.images.map((image) => image.slot)).toEqual(['image-1', 'image-2']);
  });

  it('lets the draft add, replace and remove the inset and drops it when the kit changes', async () => {
    const { createDeckDraft, setCoverInset, setDraftKit } = await import('@/lib/marketing/dneskai-deck-editor');
    const value = createDneskaiWorkspaceFixture(new Date('2026-10-24T09:00:00Z')).posts.find((item) => item.id.endsWith('000000000001'))!;
    const draft = setDraftKit(createDeckDraft(value), 'spotlight');
    const pool = value.brief!.media.filter((item) => !value.deck!.slides[0]!.images.some((image) => image.assetSha256 === item.assetSha256));
    const inset = setCoverInset(draft, 0, pool[0]!);
    expect(inset.slides[0]!.slide.images.map((image) => image.slot)).toEqual(['image-1', 'image-2']);
    expect(setCoverInset(inset, 0, null).slides[0]!.slide.images.map((image) => image.slot)).toEqual(['image-1']);
    expect(setDraftKit(inset, 'ticker').slides[0]!.slide.images.map((image) => image.slot)).toEqual(['image-1']);
    // Not on another slide, not in another kit.
    expect(setCoverInset(inset, 1, pool[0]!)).toBe(inset);
    expect(setCoverInset(createDeckDraft(value), 0, pool[0]!).slides[0]!.slide.images).toHaveLength(1);
  });
});
