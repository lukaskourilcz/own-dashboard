import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  dneskaiAwaitingRender, dneskaiCalendarDays, dneskaiJobState, dneskaiPostState, dneskaiPublished, dneskaiReviewQueue, dneskaiStateContext, DneskaiCostsReadSchema, DneskaiWorkspaceReadSchema,
  DNESKAI_POST_STATES, DNESKAI_RENDER_ATTACH_GRACE_MS, DNESKAI_STATE_TONES, pragueDstDay, type DneskaiWorkspacePost,
} from '@/lib/marketing/dneskai-workspace';
import {
  createDeckDraft, dneskaiCreditLine, dneskaiEditRequest, draftProblems, focalFromPoint, mediaFits, mediaResolution, moveFocal, moveSlide, orderedMediaPool, removeSlide,
  scheduledIso, setImageCrop, setSlideText, swapSlideImage,
} from '@/lib/marketing/dneskai-deck-editor';
import { createDneskaiCostsFixture, createDneskaiWorkspaceFixture, demoFieldLimits } from '@/lib/demo/dneskai-workspace-fixtures';
import assets from '@/lib/demo/dneskai-preview-assets.json';
import { dneskaiSlideFieldLimits } from '@/lib/marketing/dneskai-workspace-read';
import { fitDneskaiCredit } from '@/lib/marketing/dneskai-generation';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import { pragueScheduledAt } from '@/lib/marketing/clock';
import { renderAndAttachDneskaiRevision } from '@/lib/marketing/dneskai-revision-edit';
import { deckRevision } from './marketing-dneskai-revision-fixture';

const now = new Date('2026-10-24T09:00:00Z');
const read = () => createDneskaiWorkspaceFixture(now);
const post = (n: number) => read().posts.find((item) => item.id.endsWith(String(n).padStart(12, '0')))!;
const base = (patch: Partial<DneskaiWorkspacePost>): DneskaiWorkspacePost => ({ ...post(1), ...patch });
const context = { now: now.getTime() };
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

describe('DNESKAi post states (#119)', () => {
  it('maps every revision, render and publication combination to one state with text and tone', () => {
    const cases: Array<[Partial<DneskaiWorkspacePost>, string, string | null]> = [
      [{}, 'review', null],
      [{ status: 'returned' }, 'returned', null],
      [{ status: 'approved', publication: null }, 'approved', null],
      [{ status: 'approved', publication: { ...post(5).publication! } }, 'scheduled', null],
      [{ status: 'publishing', publication: { ...post(5).publication!, status: 'claimed' } }, 'scheduled', null],
      [{ status: 'published', publication: { ...post(6).publication! } }, 'published', null],
      [{ status: 'reconciliation', publication: { ...post(7).publication! } }, 'problem', 'meta-request-uncertain'],
      [{ status: 'reconciliation', publication: { ...post(7).publication!, errorCode: null } }, 'problem', 'read-only-reconciliation'],
      [{ status: 'failed', publication: { ...post(7).publication!, status: 'failed', errorCode: 'access-token-expired' } }, 'problem', 'access-token-expired'],
      [{ status: 'skipped' }, 'skipped', null],
      [{ ready: false, assets: [], renderReport: null, createdAt: ago(20_000) }, 'preparing', null],
      [{ ready: false, assets: [], renderReport: null, createdAt: ago(DNESKAI_RENDER_ATTACH_GRACE_MS - 1) }, 'preparing', null],
      // Saved by an edit, never attached: the attach call failed or the route ran out of time after saving.
      [{ ready: false, assets: [], renderReport: null, createdAt: ago(DNESKAI_RENDER_ATTACH_GRACE_MS) }, 'problem', 'render-attach-failed'],
      [{ ready: false, assets: [], renderReport: null, createdAt: ago(10 * 3_600_000) }, 'problem', 'render-attach-failed'],
      // A returned version keeps its owner state; a stored render report is never read as a missing attach.
      [{ status: 'returned', ready: false, assets: [], renderReport: null, createdAt: ago(10 * 3_600_000) }, 'returned', null],
      [{ ready: false, assets: [], renderReport: post(3).renderReport }, 'problem', 'text-clipped'],
      [{ ready: false, renderReport: { ...post(3).renderReport!, status: 'failed', problems: [] } }, 'problem', 'render-unavailable'],
      [{ ready: false, deck: null, renderReport: null }, 'problem', 'revision-not-ready'],
    ];
    for (const [patch, state, code] of cases) expect(dneskaiPostState(base(patch), context), JSON.stringify(patch).slice(0, 80)).toMatchObject({ state, code });
    expect(dneskaiPostState(base({ status: 'publishing', publication: { ...post(5).publication!, status: 'claimed' } }), context).publishing).toBe(true);
    // A version this session saw fail to attach (502 with its id) is a problem at once, inside the grace period too.
    const fresh = base({ ready: false, assets: [], renderReport: null, createdAt: ago(5_000) });
    expect(dneskaiPostState(fresh, { ...context, renderFailed: new Set([fresh.id]) })).toMatchObject({ state: 'problem', code: 'render-attach-failed' });
    expect(dneskaiPostState(fresh, { ...context, renderFailed: new Set(['d0e5ca10-0000-4000-8000-0000000000ee']) }).state).toBe('preparing');
    expect(dneskaiJobState({ status: 'running', errorCode: null }).state).toBe('preparing');
    expect(dneskaiJobState({ status: 'failed', errorCode: null })).toMatchObject({ state: 'problem', code: 'generation-failed' });
    expect(dneskaiJobState({ status: 'reconciliation', errorCode: null })).toMatchObject({ state: 'problem', code: 'worker-lease-expired' });
    for (const lang of ['en', 'cs'] as const) for (const state of DNESKAI_POST_STATES) {
      expect(dneskaiWorkspace[lang].states[state].trim()).not.toBe('');
      expect(DNESKAI_STATE_TONES[state]).toBeTruthy();
    }
    expect(new Set(DNESKAI_POST_STATES.map((state) => dneskaiWorkspace.cs.states[state])).size).toBe(DNESKAI_POST_STATES.length);
  });

  it('builds today’s review queue, the published receipts and seven Prague days across the 25 October clock change', () => {
    const fixture = read();
    expect(fixture.today).toBe('2026-10-24');
    const queue = dneskaiReviewQueue(fixture);
    expect(queue.posts.map((item) => item.title)).toEqual(['Benchmark není žebříček', 'Tip dne: kontext místo proseb', 'Proč verzovat prompty', 'Tři zkratky pro terminál', 'Co stojí jeden dotaz', 'Lokální model na notebooku']);
    // The fixtures show both sides of the grace period, measured from the read's own clock.
    expect(queue.posts.slice(-2).map((item) => dneskaiPostState(item, dneskaiStateContext(fixture)))).toEqual([
      { state: 'problem', code: 'render-attach-failed', publishing: false }, { state: 'preparing', code: null, publishing: false }]);
    expect(dneskaiAwaitingRender(fixture)).toBe(true);
    expect(dneskaiAwaitingRender({ ...fixture, generatedAt: new Date(now.getTime() + DNESKAI_RENDER_ATTACH_GRACE_MS).toISOString() })).toBe(false);
    expect(queue.jobs.map((job) => job.status)).toEqual(['running', 'failed']);
    expect(dneskaiPublished(fixture).map((item) => item.title)).toEqual(['Pět otázek před nasazením asistenta']);
    const days = dneskaiCalendarDays(fixture);
    expect(days.map((day) => day.date)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
    // 25 October has 25 hours: its 08:00 is 07:00 UTC, the day before 06:00 UTC.
    expect(days[1]!.entries.map((entry) => [entry.time, entry.at])).toEqual([['08:00', '2026-10-25T07:00:00.000Z'], ['12:30', '2026-10-25T11:30:00.000Z'], ['17:00', '2026-10-25T16:00:00.000Z'], ['20:00', '2026-10-25T19:00:00.000Z']]);
    expect(days[1]!.entries.filter((entry) => entry.kind === 'post').map((entry) => entry.kind === 'post' && entry.post.title)).toEqual(['Benchmark není žebříček', 'Tip dne: kontext místo proseb', 'Proč verzovat prompty']);
    expect(days[1]!.entries.find((entry) => entry.time === '20:00')?.kind).toBe('job');
    expect(days[0]!.entries.find((entry) => entry.time === '08:00')).toMatchObject({ kind: 'post', state: { state: 'problem', code: 'meta-request-uncertain' } });
    expect(days[3]!.entries.find((entry) => entry.time === '12:30')).toMatchObject({ kind: 'post', state: { state: 'problem', code: 'render-attach-failed' } });
    expect(days[3]!.entries.find((entry) => entry.time === '17:00')).toMatchObject({ kind: 'post', state: { state: 'preparing', code: null } });
    expect(pragueDstDay('2026-10-25')).toBe(true);
    expect(pragueDstDay('2026-10-24')).toBe(false);
    expect(pragueDstDay('2026-03-29')).toBe(true);
    // A post at an owner-edited time keeps its own row; a superseded or skipped revision frees its slot.
    const edited = { ...post(2), id: 'd0e5ca10-0000-4000-8000-0000000000ee', scheduledAt: pragueScheduledAt('2026-10-26', '09:15') };
    const extra = dneskaiCalendarDays({ ...fixture, posts: [...fixture.posts.map((item) => item.title === 'Kdy stačí menší model' ? { ...item, status: 'skipped' as const } : item), edited] });
    expect(extra[2]!.entries.map((entry) => `${entry.time}:${entry.kind}`)).toEqual(['08:00:post', '09:15:post', '12:30:free', '17:00:job', '20:00:free']);
  });
});

describe('the post editor logic', () => {
  it('moves the focal point by 2 % per arrow, clamps it and reads a click as a fraction of the picture', () => {
    expect(moveFocal({ x: 0.5, y: 0.5 }, 'ArrowRight')).toEqual({ x: 0.52, y: 0.5 });
    expect(moveFocal({ x: 0.5, y: 0.5 }, 'ArrowUp')).toEqual({ x: 0.5, y: 0.48 });
    expect(moveFocal({ x: 0.99, y: 0.01 }, 'ArrowRight')).toEqual({ x: 1, y: 0.01 });
    expect(moveFocal({ x: 0.01, y: 0.01 }, 'ArrowUp')).toEqual({ x: 0.01, y: 0 });
    expect(moveFocal({ x: 0.2, y: 0.9 }, 'Home')).toEqual({ x: 0.5, y: 0.5 });
    expect(moveFocal({ x: 0.2, y: 0.9 }, 'Enter')).toBeNull();
    expect(focalFromPoint({ left: 100, top: 50, width: 200, height: 100 }, 150, 75)).toEqual({ x: 0.25, y: 0.25 });
    expect(focalFromPoint({ left: 100, top: 50, width: 200, height: 100 }, 400, 0)).toEqual({ x: 1, y: 0 });
  });

  it('sets the credit line exactly as generation does', () => {
    const sets: Array<[string[], number]> = [[['Foto: @simonwillison.net (Bluesky)'], 80], [['Foto: @simonwillison.net (Bluesky)'], 30], [['Foto: @simonwillison.net (Bluesky)'], 20],
      [['Obrázek: Hugging Face', 'Foto: @mosseri (Instagram)'], 80], [['Obrázek: Hugging Face', 'Foto: @mosseri (Instagram)'], 30], [['Foto: a', 'Foto: a'], 80], [[], 80], [['Obrázek: velmi dlouhý vydavatel s dlouhým jménem'], 10]];
    for (const [credits, limit] of sets) expect(dneskaiCreditLine(credits, limit), `${credits.join('|')} ${limit}`).toBe(fitDneskaiCredit(credits, limit));
  });

  it('builds the minimal edit request: unchanged slides carry only their position, cleared optional text is removed', () => {
    const original = post(1);
    let draft = createDeckDraft(original, 'd0e5ca10-0000-4000-8000-0000000000aa');
    expect(dneskaiEditRequest(original, draft)).toEqual({ action: 'edit', id: original.id, caption: original.caption, scheduledAt: original.scheduledAt });
    draft = setSlideText(draft, 0, 'headline', 'Nový titulek');
    draft = setSlideText(draft, 3, 'body', '   ');
    draft = setImageCrop(draft, 1, 'image-1', { focal: { x: 0.31234, y: 0.7 }, zoom: 1.5 });
    draft = moveSlide(draft, 2, 1);
    draft = removeSlide(draft, 4);
    const request = dneskaiEditRequest(original, { ...draft, caption: 'Nový popisek' }, 'd0e5ca10-0000-4000-8000-0000000000bb');
    expect(request).toEqual({
      action: 'edit', id: original.id, caption: 'Nový popisek', scheduledAt: original.scheduledAt, accountId: 'd0e5ca10-0000-4000-8000-0000000000bb',
      deck: { slides: [
        { from: 0, headline: 'Nový titulek' },
        { from: 2 },
        { from: 1, images: [{ slot: 'image-1', assetSha256: original.deck!.slides[1]!.images[0]!.assetSha256, crop: { focal: { x: 0.312, y: 0.7 }, zoom: 1.5 } }] },
        { from: 3, body: null },
      ] },
    });
    // Text a slide type does not draw never reaches the request, even if it was typed.
    const statement = setSlideText(createDeckDraft(original), 3, 'kicker', 'Nekreslený štítek');
    expect(dneskaiEditRequest(original, statement).deck).toBeUndefined();
  });

  it('swaps a picture from the pool, follows its credit and the sources slide, and flags pictures that cannot fill a cover', () => {
    const original = post(1);
    const pool = orderedMediaPool(original.brief!);
    expect(pool.map((item) => item.assetSha256)).toEqual([assets.photos.p1.sha256, assets.photos.p3.sha256, assets.photos.p5.sha256, assets.photos.p4.sha256, assets.photos.p6.sha256, assets.photos.p2.sha256]);
    const p2 = pool.find((item) => item.assetSha256 === assets.photos.p2.sha256)!;
    const swapped = swapSlideImage(createDeckDraft(original), 0, 'image-1', p2, original.brief!.media);
    expect(swapped.slides[0]!.slide.images).toEqual([{ slot: 'image-1', assetSha256: p2.assetSha256 }]);
    expect(swapped.slides[0]!.slide.credit).toBe('Foto: ukázkový zdroj 2');
    expect(swapped.slides[4]!.slide.images.map((image) => image.assetSha256)).toEqual([p2.assetSha256, assets.photos.p3.sha256]);
    expect(mediaResolution(pool[0]!)).toBe('full-bleed');
    expect(mediaResolution(pool[1]!)).toBe('inset');
    expect(mediaResolution(pool[2]!)).toBe('small');
    expect(mediaFits(pool[1]!, { type: 'cover-photo' })).toBe(false);
    expect(mediaFits(pool[1]!, { type: 'figure' })).toBe(true);
    expect(mediaFits(pool[2]!, { type: 'split' })).toBe(false);
  });

  it('checks the limits each slide type draws, the slide count, the caption and the Prague time', () => {
    const original = post(1);
    let draft = setSlideText(createDeckDraft(original), 0, 'headline', 'x'.repeat(111));
    draft = setSlideText(draft, 3, 'headline', 'y'.repeat(170));
    draft = setSlideText(draft, 1, 'alt', ' ');
    expect(draftProblems(original, draft)).toEqual([{ slide: 0, field: 'headline', code: 'text-too-long' }, { slide: 1, field: 'alt', code: 'alt-missing' }]);
    let short = removeSlide(removeSlide(removeSlide(removeSlide(createDeckDraft(original), 4), 3), 2), 1);
    short = { ...short, caption: 'z'.repeat(2201), scheduledLocal: '2027-03-28T02:30' };
    expect(draftProblems(original, short).map((problem) => problem.code)).toEqual(['deck-edit-slide-count', 'caption-too-long', 'schedule-invalid']);
    expect(scheduledIso('2026-10-25T08:00')).toBe('2026-10-25T07:00:00.000Z');
    expect(scheduledIso('2026-10-25T02:30')).toBeNull();
    expect(scheduledIso('nope')).toBeNull();
  });
});

describe('preview fixtures', () => {
  it('parse as the real read models and use the server’s field limits for every slide', () => {
    const fixture = DneskaiWorkspaceReadSchema.parse(read());
    DneskaiCostsReadSchema.parse(createDneskaiCostsFixture(now));
    for (const item of fixture.posts) for (const [index, slide] of (item.deck?.slides ?? []).entries()) {
      expect(item.fields[index], `${item.title} ${index}`).toEqual(dneskaiSlideFieldLimits(slide));
      expect(demoFieldLimits(slide)).toEqual(dneskaiSlideFieldLimits(slide));
    }
    expect(demoFieldLimits({ type: 'single', variant: 'type', images: [] })).toEqual(dneskaiSlideFieldLimits({ type: 'single', variant: 'type', headline: 'x', images: [], alt: 'x' }));
    expect(demoFieldLimits({ type: 'split', images: [{ slot: 'image-1', assetSha256: 'a'.repeat(64) }, { slot: 'image-2', assetSha256: 'b'.repeat(64) }] }))
      .toEqual(dneskaiSlideFieldLimits({ type: 'split', headline: 'x', images: [{ slot: 'image-1', assetSha256: 'a'.repeat(64) }, { slot: 'image-2', assetSha256: 'b'.repeat(64) }], alt: 'x' }));
  });

  it('ship the committed slide renders and photo previews they name, byte for byte', () => {
    const root = path.resolve(__dirname, '../../public');
    for (const deck of Object.values(assets.decks)) for (const entry of deck) {
      const bytes = readFileSync(path.join(root, entry.render.file));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.render.sha256);
      expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    }
    for (const photo of Object.values(assets.photos)) expect(readFileSync(path.join(root, photo.file)).length).toBeGreaterThan(1000);
  });
});

describe('workspace copy', () => {
  it('has the same keys in English and Czech, with no empty string', () => {
    const shape = (value: unknown, prefix = ''): string[] => value && typeof value === 'object'
      ? Object.entries(value).flatMap(([key, entry]) => shape(entry, `${prefix}${key}.`)) : [`${prefix.slice(0, -1)}:${typeof value}`];
    expect(shape(dneskaiWorkspace.cs)).toEqual(shape(dneskaiWorkspace.en));
    const strings = (value: unknown): string[] => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
    expect(strings(dneskaiWorkspace.cs).filter((text) => !text.trim())).toEqual([]);
    expect(strings(dneskaiWorkspace.en).filter((text) => !text.trim())).toEqual([]);
    expect(dneskaiWorkspace.cs.card.slideCount(1)).toBe('1 slide');
    expect(dneskaiWorkspace.cs.card.slideCount(3)).toBe('3 slidy');
    expect(dneskaiWorkspace.cs.card.slideCount(7)).toBe('7 slidů');
  });
});

describe('render report fields', () => {
  it('keeps the field a renderer problem names so the review can point at it', async () => {
    const revision = { ...deckRevision(), assets: [] };
    const rpc = vi.fn(async () => ({ error: null }));
    const result = await renderAndAttachDneskaiRevision({ rpc } as never, '11111111-1111-4111-8111-111111111111', { revisionId: '33333333-3333-4333-8333-333333333333', revision }, {
      render: async () => ({ status: 'refused', assets: [], renderKeys: [], problems: [{ slide: 1, code: 'text-clipped', blocking: true, message: 'cut', field: 'headline' }, { slide: 2, code: 'x', blocking: true, message: 'm', field: 'Bad Field!' }] }),
      loadMedia: async () => Buffer.alloc(0),
    });
    expect(result.report.problems).toEqual([{ slide: 1, code: 'text-clipped', blocking: true, message: 'cut', field: 'headline' }, { slide: 2, code: 'x', blocking: true, message: 'm' }]);
  });
});
