import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { briefPictures, briefFixture, validCopy } from './marketing-dneskai-generation-fixture';
import { validateDneskaiCopy, buildDneskaiDeck, dneskaiBriefOffer } from '@/lib/marketing/dneskai-generation';
import { dneskaiSlideFieldLimits, dneskaiShownDeck } from '@/lib/marketing/dneskai-slide-layout';
import { dneskaiSlideTextProblems } from '@/lib/marketing/dneskai-render';
import { fitDneskaiDeck } from '@/lib/marketing/dneskai-fit';
import { createDeckDraft, dneskaiEditRequest, draftProblems, removeUnplacedSlideText, moveSlide } from '@/lib/marketing/dneskai-deck-editor';
import { prepareDneskaiRevisionEdit } from '@/lib/marketing/dneskai-revision-edit';
import { revisionReadiness } from '@/lib/marketing/contracts';
import { dneskaiLabApprovalBlock } from '@/lib/marketing/dneskai-lab';
import { createDneskaiWorkspaceFixture } from '@/lib/demo/dneskai-workspace-fixtures';
import { deckRevision } from './marketing-dneskai-revision-fixture';
import type { DneskaiDeck, DneskaiSlide } from '@/lib/marketing/dneskai-slides';

const first = { type: 'statement', headline: 'Nová funkce upraví text.', body: 'Firma ji zpřístupní v aplikaci.', images: [], alt: 'Textový přehled nové funkce.' } satisfies DneskaiSlide;
const deck = (): DneskaiDeck => ({ ...deckRevision().deck!, slides: [structuredClone(first), { ...structuredClone(first), headline: 'Další krok v aplikaci.' }] });

describe('binding DNESKAi public slide policy', () => {
  it('refuses body text on generated first statements and strips it from the constructed public deck', async () => {
    const pictures = await briefPictures();
    const offer = dneskaiBriefOffer(briefFixture(pictures, { media: [], suggestedFormat: 'carousel' }), ['Fixture publisher']);
    const copy = { ...validCopy(pictures), slides: Array.from({ length: 4 }, () => structuredClone(first)) };
    expect(validateDneskaiCopy(copy, offer)).toEqual([expect.objectContaining({ code: 'text-unplaced', slide: 0, field: 'body' })]);
    const built = buildDneskaiDeck(copy, offer);
    expect(built.slides[0]).not.toHaveProperty('body');
    expect(built.slides[1]!.body).toBe(first.body);
  });
  it('keeps only the headline editable on the first slide, with body available on later statements', () => {
    expect(dneskaiSlideFieldLimits(first, 0).map(item => item.field)).toEqual(['headline']);
    expect(dneskaiSlideFieldLimits(first, 1).map(item => item.field)).toEqual(['headline', 'body']);
  });
  it('normalizes an edited legacy deck without retaining a forbidden sources fallback', () => {
    expect(dneskaiShownDeck(deck()).slides[0]).not.toHaveProperty('body');
    const legacy: DneskaiDeck = { ...deck(), slides: [first, { type: 'sources', headline: '', sources: ['Dated provenance'], images: [], alt: 'Sources' }] };
    const shown = dneskaiShownDeck(legacy);
    expect(shown.slides).toHaveLength(1);
    expect(shown.slides[0]).not.toHaveProperty('body');
    // The caller must require another content slide before this can be saved as a carousel.
  });
  it('refuses first-slide body text in the actual renderer and fitter, without refusing the later statement', async () => {
    expect(await dneskaiSlideTextProblems(first, { index: 0, count: 2 })).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'body', code: 'text-unplaced', blocking: true })]));
    expect(await dneskaiSlideTextProblems(first, { index: 1, count: 2 })).toEqual([]);
    const fit = await fitDneskaiDeck({ kit: 'editorial', slides: deck().slides.map(slide => ({ ...slide, images: [] })) });
    expect(fit.slides.map(slide => slide.fits)).toEqual([false, true]);
  });
  it('keeps old text until explicit cleanup, then saves exactly the cleaned draft as a new unrendered revision', async () => {
    const now = new Date('2026-10-24T09:00:00Z');
    const post = { ...createDneskaiWorkspaceFixture(now).posts[0]!, deck: deck() };
    const draft = createDeckDraft(post, null, now);
    expect(draft.slides[0]!.slide.body).toBe(first.body);
    expect(draft.slides[0]!.fields.map(field => field.field)).toEqual(['headline']);
    expect(draftProblems(post, draft, null, now)).toContainEqual({ slide: 0, field: 'slide', code: 'text-unfit' });
    const cleaned = removeUnplacedSlideText(draft, 0);
    expect(cleaned.slides[0]!.slide.body).toBeUndefined();
    expect(draft.slides[0]!.slide.body).toBe(first.body);
    const request = dneskaiEditRequest(post, cleaned);
    expect(request.deck!.slides[0]).toMatchObject({ from: 0, body: null });
    const result = await prepareDneskaiRevisionEdit({ ...deckRevision(), deck: post.deck }, { caption: request.caption, scheduledAt: request.scheduledAt, deck: request.deck }, async () => []);
    expect(result.deck!.slides).toEqual(cleaned.slides.map(item => item.slide));
    expect(result.assets).toEqual([]);
    // Moving a later statement to the first place changes its fields, while preserving its words until cleanup.
    const moved = moveSlide(cleaned, 1, 0);
    expect(moved.slides[0]!.fields.map(field => field.field)).toEqual(['headline']);
    expect(moved.slides[0]!.slide.body).toBe(first.body);
    expect(moved.slides[1]!.fields.map(field => field.field)).toEqual(['headline', 'body']);
  });
  it('refuses a normalized one-slide legacy carousel instead of restoring its sources slide', async () => {
    const original = { ...deckRevision(), deck: { ...deck(), slides: [first, { type: 'sources' as const, headline: '', sources: ['Legacy provenance'], images: [], alt: 'Sources' }] } };
    await expect(prepareDneskaiRevisionEdit(original, { caption: original.caption, scheduledAt: original.scheduledAt }, async () => [])).rejects.toMatchObject({ code: 'deck-edit-slide-count' });
    expect(original.deck.slides[1]!.type).toBe('sources');
  });
  it('holds legacy approval/publication readiness without changing the stored deck', () => {
    const revision = { ...deckRevision(), deck: deck(), assets: deckRevision().assets.slice(0, 2) };
    expect(revisionReadiness(revision)).toContain('text-unplaced');
    const read = createDneskaiWorkspaceFixture(new Date('2026-10-24T09:00:00Z'));
    const post = { ...read.posts[0]!, deck: revision.deck };
    expect(dneskaiLabApprovalBlock(post, read)).toBe('render-blocked');
    expect(revision.deck.slides[0]!.body).toBe(first.body);
  });
});
