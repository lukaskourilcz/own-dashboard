import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { parseContentRevision, type ContentRevision } from '@/lib/marketing/contracts';
import { dneskaiDeckLacksPhoto, dneskaiPhotoSlides, dneskaiRenderStale, dneskaiNewsPlacement, dneskaiPlanAction, dneskaiSeriesOutOfDate, dneskaiPlanEmptySlots, dneskaiPlanEnabled, dneskaiPlanSlotAt, type DneskaiPlanHead, type DneskaiPlanRow } from '@/lib/marketing/dneskai-plan';
import { deck } from './marketing-dneskai-revision-fixture';
import { dneskaiEmphasisFor } from '@/lib/marketing/dneskai-palette';

/** The plan step's decisions (owner decision, 7 November 2026), one slot at a time. Synthetic values only. */
const now = new Date('2026-11-07T14:00:00Z'); // 15:00 in Prague
const slot = (patch: Partial<DneskaiPlanRow> = {}): DneskaiPlanRow => ({ id: '11111111-1111-4111-8111-111111111111', user_id: 'u', project_id: 'p', date: '2026-11-08', local_time: '08:00', instagram: true, threads: true,
  kind: 'news', revision_id: '22222222-2222-4222-8222-222222222222', topic_id: null, head_revision_id: null, threads_revision_id: null, written_revision_id: null, threads_base_revision_id: null, status: 'planned', code: null, ...patch });
// Every deck carries the key-word colour of its time unless a test sets one (owner request, 8 November 2026).
const withColour = (value: ContentRevision): ContentRevision => value.deck && !value.deck.emphasis ? { ...value, deck: { ...value.deck, emphasis: dneskaiEmphasisFor(value.scheduledAt) } } : value;
// The fixture deck shows two photos; the owner's rule wants three, so a third framed photo is added unless a test says otherwise.
const third = { type: 'figure' as const, headline: 'Třetí fotka', images: [{ slot: 'image-1', assetSha256: 'd'.repeat(64) }], alt: 'Fotka' };
const withPhotos = (value: ContentRevision): ContentRevision => value.deck?.format === 'carousel' && dneskaiPhotoSlides(value) !== null && dneskaiPhotoSlides(value)! < 3 && value.deck.slides[0]?.images.length
  ? { ...value, deck: { ...value.deck, slides: [...value.deck.slides, third] } } : value;
const withEmphasis = (value: ContentRevision): ContentRevision => withColour(withPhotos(value));
const revision = (patch: Partial<ContentRevision> = {}): ContentRevision => withEmphasis(parseContentRevision({ schemaVersion: 'marketing-content/2', brand: 'dneskai', title: 'Titulek', caption: 'Text.', format: 'carousel',
  sources: [{ sourceId: 'a'.repeat(64), sourceRevision: 'b'.repeat(64), contentHash: 'c'.repeat(64) }], knowledgeIds: [],
  assets: [1, 2, 3].map((n) => ({ url: `https://assets.example.invalid/${n}.jpg`, sha256: String(n).repeat(64), mimeType: 'image/jpeg', width: 1080, height: 1350, alt: `Slide ${n}` })),
  account: { id: '17841400000000001', platform: 'instagram', handle: 'dneskai' }, scheduledAt: dneskaiPlanSlotAt(slot()), timeZone: 'Europe/Prague',
  templateVersion: 'qa/1', promptVersion: 'qa/1', model: 'none', traceId: null, deck: { ...deck(), kit: 'spotlight' }, ...patch } as never));
const head = (patch: Partial<DneskaiPlanHead> = {}, content: Partial<ContentRevision> = {}): DneskaiPlanHead => ({ id: '33333333-3333-4333-8333-333333333333', status: 'review', ready: true, content_hash: 'h', revision: revision(content), render_report: null, ...patch });

describe('dneskaiPlanAction', () => {
  it('lets a post whose render just failed wait half an hour, so the posts behind it get the render (9 November 2026)', () => {
    const failed = { schemaVersion: 'dneskai-render-report/1', status: 'failed', problems: [{ slide: -1, code: 'render-unavailable', blocking: true, message: 'x' }], renderKeys: [], renderedAt: '2026-11-07T13:50:00.000Z' };
    const own = slot({ written_revision_id: '33333333-3333-4333-8333-333333333333' });
    const unrendered = (report: unknown) => { const value = head({ ready: false, render_report: report }); return { ...value, revision: { ...value.revision, assets: [] } }; };
    expect(dneskaiPlanAction(own, unrendered(failed), null, true, now)).toEqual({ kind: 'wait', status: 'failed', code: 'render-retry-later' });
    expect(dneskaiPlanAction(own, unrendered({ ...failed, renderedAt: '2026-11-07T13:00:00.000Z' }), null, true, now)).toEqual({ kind: 'rerender', status: 'ready' });
  });

  it('moves an approved post whose slot moved to 19:00 or 21:00 while the slot is ahead (8 November 2026)', () => {
    const moved = slot({ local_time: '19:00' });
    expect(dneskaiPlanAction(moved, head({ status: 'approved' }, { scheduledAt: '2026-11-08T16:00:00.000Z' }), null, true, now)).toEqual({ kind: 'move', status: 'ready' });
  });

  it('re-tags an Instagram post whose hashtags break the current rule while its slot is ahead (8 November 2026)', () => {
    const old = 'Text.\n\n#dneskai #openai #ai #aitech #gemini #nvidia';
    expect(dneskaiPlanAction(slot(), head({}, { caption: old }), null, true, now)).toEqual({ kind: 'retag', status: 'ready' });
    expect(dneskaiPlanAction(slot(), head({ status: 'approved' }, { caption: old }), null, true, now)).toEqual({ kind: 'retag', status: 'ready' });
    expect(dneskaiPlanAction(slot(), head({}, { caption: 'Text.\n\n#dneskai #ai #zpravy #nvidia #cipy' }), null, true, now)).toEqual({ kind: 'approve', status: 'approved' });
    // A slot already past is left as it is.
    expect(dneskaiPlanAction(slot(), head({}, { caption: old }), null, true, new Date('2026-11-08T08:00:00Z')).kind).not.toBe('retag');
  });

  it('draws again a post rendered before the icy blue and new logo, approved or not, while its slot is ahead (8 November 2026)', () => {
    const stale = { schemaVersion: 'dneskai-render-report/1', status: 'rendered', problems: [], renderKeys: [], renderedAt: '2026-11-08T15:55:00.000Z' };
    const fresh = { ...stale, renderedAt: '2026-11-09T01:00:00.000Z' };
    expect(dneskaiRenderStale(stale)).toBe(true);
    expect(dneskaiRenderStale(fresh)).toBe(false);
    expect(dneskaiRenderStale(null)).toBe(false);
    expect(dneskaiPlanAction(slot(), head({ render_report: stale }), null, true, now)).toEqual({ kind: 'redraw', status: 'ready' });
    expect(dneskaiPlanAction(slot(), head({ status: 'approved', render_report: stale }), null, true, now)).toEqual({ kind: 'redraw', status: 'ready' });
    expect(dneskaiPlanAction(slot(), head({ render_report: fresh }), null, true, now)).toEqual({ kind: 'approve', status: 'approved' });
  });

  it('writes a short carousel again once, drops a house-style one that is still short, and leaves single posts alone (8 November 2026)', () => {
    const short = (promptVersion: string) => { const value = head({}, { promptVersion }); return { ...value, revision: { ...value.revision, deck: { ...value.revision.deck!, slides: value.revision.deck!.slides.filter((item) => item.headline !== 'Třetí fotka') } } }; };
    expect(dneskaiPhotoSlides(short('qa/1').revision)).toBe(2);
    expect(dneskaiPlanAction(slot(), short('qa/1'), null, true, now)).toEqual({ kind: 'restyle', status: 'planned' });
    expect(dneskaiPlanAction(slot(), short('marketing-copy/8+abc'), null, true, now)).toEqual({ kind: 'drop', status: 'skipped', code: 'plan-photos-short' });
    expect(dneskaiPlanAction(slot({ code: 'restyle-failed' }), short('qa/1'), null, true, now)).toEqual({ kind: 'drop', status: 'skipped', code: 'plan-photos-short' });
    expect(dneskaiPlanAction(slot(), { ...short('qa/1'), status: 'approved' }, null, true, now).kind).toBe('restyle');
    expect(dneskaiPhotoSlides(head().revision)).toBe(3);
    const single = head({}, { format: 'post' as never, deck: { schemaVersion: deck().schemaVersion, format: 'single-image', slides: [{ type: 'single', variant: 'photo', headline: 'Jedna fotka', images: [{ slot: 'image-1', assetSha256: 'a'.repeat(64) }], alt: 'Fotka' }] } as never });
    expect(dneskaiPhotoSlides(single.revision)).toBeNull();
  });

  it('drops a post whose first slide shows no photo, approved or not, but never one already going out (8 November 2026)', () => {
    const text = { ...deck(), kit: 'spotlight' as const, slides: deck().slides.map((item, index) => index === 0 ? { ...item, type: 'statement' as const, images: [] } : item) };
    expect(dneskaiDeckLacksPhoto({ deck: text } as never)).toBe(true);
    expect(dneskaiDeckLacksPhoto(revision())).toBe(false);
    expect(dneskaiPlanAction(slot(), head({}, { deck: text } as never), null, true, now)).toEqual({ kind: 'drop', status: 'skipped', code: 'plan-photo-missing' });
    expect(dneskaiPlanAction(slot(), head({ status: 'approved' }, { deck: text } as never), null, true, now)).toMatchObject({ kind: 'drop' });
    expect(dneskaiPlanAction(slot(), head({ status: 'publishing' }, { deck: text } as never), null, true, now)).toMatchObject({ kind: 'wait', status: 'approved' });
  });
  it('waits for a topic still generating and fails a news slot without its post', () => {
    expect(dneskaiPlanAction(slot({ kind: 'education', revision_id: null, topic_id: 't' }), null, null, true, now)).toEqual({ kind: 'wait', status: 'generating', code: null });
    expect(dneskaiPlanAction(slot(), null, null, true, now)).toMatchObject({ kind: 'wait', status: 'failed', code: 'plan-post-missing' });
  });

  it('puts the series heading on a series post before approving it, and renumbers an approved one while there is time (8 November 2026)', () => {
    const heading = 'Slovník AI #2';
    const fresh = revision();
    expect(fresh.deck!.slides[0]!.type).toBe('cover-photo');
    expect(dneskaiSeriesOutOfDate(fresh, heading)).toBe(true);
    const numbered = { caption: `${heading}\nText.`, deck: { ...fresh.deck!, slides: [{ ...fresh.deck!.slides[0]!, series: heading }, ...fresh.deck!.slides.slice(1)] } };
    expect(dneskaiSeriesOutOfDate(numbered as never, heading)).toBe(false);
    expect(dneskaiSeriesOutOfDate(numbered as never, 'Slovník AI #3')).toBe(true);
    expect(dneskaiPlanAction(slot(), head(), null, true, now, null, heading)).toEqual({ kind: 'series', status: 'ready' });
    expect(dneskaiPlanAction(slot(), head({}, numbered as never), null, true, now, null, heading)).toEqual({ kind: 'approve', status: 'approved' });
    expect(dneskaiPlanAction(slot(), head(), null, true, now)).toEqual({ kind: 'approve', status: 'approved' });
    expect(dneskaiPlanAction(slot(), head({ status: 'approved' }, numbered as never), null, true, now, null, 'Slovník AI #1')).toEqual({ kind: 'series', status: 'ready' });
    // Under half an hour before its slot an approved post goes out as it is.
    const late = new Date(Date.parse(dneskaiPlanSlotAt(slot())) - 20 * 60_000);
    expect(dneskaiPlanAction(slot(), head({ status: 'approved' }, numbered as never), null, true, late, null, 'Slovník AI #1').kind).not.toBe('series');
  });

  it('moves an older-kit post to Spotlight, then to the slot time, then approves it', () => {
    const { deck: _deck, ...rest } = revision(); void _deck;
    expect(dneskaiPlanAction(slot(), head({}, { deck: { ...deck() } }), null, true, now).kind).toBe('spotlight');
    expect(dneskaiPlanAction(slot(), head({}, { scheduledAt: '2026-10-31T07:00:00.000Z' }), null, true, now).kind).toBe('move');
    expect(dneskaiPlanAction(slot(), head(), null, true, now)).toEqual({ kind: 'approve', status: 'approved' });
    expect(rest.title).toBe('Titulek');
  });

  it('redraws a post whose key words are not in the colour of its slot (8 November 2026)', () => {
    const other = dneskaiEmphasisFor('2026-11-08T08:00:00.000Z');
    expect(other).not.toBe(dneskaiEmphasisFor(dneskaiPlanSlotAt(slot())));
    expect(dneskaiPlanAction(slot(), head({}, { deck: { ...deck(), kit: 'plakat', emphasis: other } }), null, true, now)).toEqual({ kind: 'move', status: 'ready' });
  });

  it('keeps a Plakát post in its kit instead of redrawing it in Spotlight', () => {
    expect(dneskaiPlanAction(slot(), head({}, { deck: { ...deck(), kit: 'plakat' } }), null, true, now)).toEqual({ kind: 'approve', status: 'approved' });
  });

  it('redraws a Video-first post in a rotating style (owner, 8 November 2026: two styles only)', () => {
    expect(dneskaiPlanAction(slot(), head({}, { deck: { ...deck(), kit: 'videofirst' } }), null, true, now).kind).toBe('spotlight');
  });

  it('keeps the kit and time of a revision the owner saved in the Design Lab', () => {
    const owned = slot({ written_revision_id: '44444444-4444-4444-8444-444444444444' });
    expect(dneskaiPlanAction(owned, head({}, { deck: { ...deck() }, scheduledAt: '2026-11-08T09:00:00.000Z' }), null, true, now)).toEqual({ kind: 'approve', status: 'approved' });
  });

  it('turns a Threads-only post into Threads once the account exists', () => {
    const evening = slot({ local_time: '21:00', instagram: false });
    const at = dneskaiPlanSlotAt(evening);
    expect(dneskaiPlanAction(evening, head({}, { scheduledAt: at }), null, true, now).kind).toBe('to-threads');
    expect(dneskaiPlanAction(evening, head({}, { scheduledAt: at }), null, false, now)).toMatchObject({ kind: 'wait', code: 'threads-account-missing' });
    expect(dneskaiPlanAction(evening, head({}, { scheduledAt: at, account: { id: '26000000000000001', platform: 'threads', handle: 'dneskai' }, caption: 'Krátce.' }), null, true, now).kind).toBe('approve');
  });

  it('derives the Threads twin of an approved Instagram post, approves it and renews it after an owner edit', () => {
    const approved = head({ status: 'approved' });
    expect(dneskaiPlanAction(slot(), approved, null, true, now).kind).toBe('twin');
    const withStory = { ...slot(), story_revision_id: 's', story_base_revision_id: approved.id };
    expect(dneskaiPlanAction(withStory, approved, null, false, now, { id: 's', status: 'approved', ready: true, content_hash: 'y' })).toMatchObject({ kind: 'wait', code: 'threads-account-missing' });
    const twinned = slot({ threads_revision_id: '55555555-5555-4555-8555-555555555555', threads_base_revision_id: approved.id });
    expect(dneskaiPlanAction(twinned, approved, { id: 't', status: 'review', ready: true, content_hash: 'x' }, true, now).kind).toBe('approve-twin');
    const doneStory = { id: 's', status: 'approved', ready: true, content_hash: 'y' };
    const storied = { ...twinned, story_revision_id: 's', story_base_revision_id: approved.id };
    expect(dneskaiPlanAction(storied, approved, { id: 't', status: 'approved', ready: true, content_hash: 'x' }, true, now, doneStory)).toEqual({ kind: 'wait', status: 'approved', code: null });
    expect(dneskaiPlanAction({ ...twinned, threads_base_revision_id: 'older' }, approved, { id: 't', status: 'approved', ready: true, content_hash: 'x' }, true, now).kind).toBe('twin');
  });

  it('draws its own cut-off render again but leaves a refused one to the owner', () => {
    const own = slot({ written_revision_id: '33333333-3333-4333-8333-333333333333' });
    expect(dneskaiPlanAction(own, head({ ready: false, render_report: { status: 'failed' } }, { assets: [] }), null, true, now).kind).toBe('rerender');
    expect(dneskaiPlanAction(own, head({ ready: false, render_report: { status: 'refused' } }, { assets: [] }), null, true, now)).toMatchObject({ code: 'render-blocked' });
    expect(dneskaiPlanAction(slot(), head({ ready: false, render_report: { status: 'failed' } }, { assets: [] }), null, true, now)).toMatchObject({ code: 'render-blocked' });
  });

  it('makes the story from the approved post, approves it and renews it after an owner edit (7 November 2026)', () => {
    const approved = head({ status: 'approved' });
    const twin = { id: 't', status: 'approved', ready: true, content_hash: 'x' };
    const twinned = slot({ threads_revision_id: 't', threads_base_revision_id: approved.id });
    expect(dneskaiPlanAction(twinned, approved, twin, true, now).kind).toBe('story');
    const storied = { ...twinned, story_revision_id: 's', story_base_revision_id: approved.id };
    expect(dneskaiPlanAction(storied, approved, twin, true, now, { id: 's', status: 'review', ready: true, content_hash: 'y' }).kind).toBe('approve-story');
    expect(dneskaiPlanAction({ ...storied, story_base_revision_id: 'older' }, approved, twin, true, now, { id: 's', status: 'approved', ready: true, content_hash: 'y' }).kind).toBe('story');
    // Without the Threads account the story still goes out; the slot keeps the Threads code.
    expect(dneskaiPlanAction(slot(), approved, null, false, now).kind).toBe('story');
    expect(dneskaiPlanAction({ ...slot(), story_revision_id: 's', story_base_revision_id: approved.id }, approved, null, false, now, { id: 's', status: 'approved', ready: true, content_hash: 'y' })).toMatchObject({ code: 'threads-account-missing' });
  });

  it('leaves owner decisions, render problems and passed slots to the owner', () => {
    expect(dneskaiPlanAction(slot(), head({ status: 'skipped' }), null, true, now)).toMatchObject({ status: 'skipped', code: 'owner-skipped' });
    expect(dneskaiPlanAction(slot(), head({ ready: false }), null, true, now)).toMatchObject({ status: 'failed', code: 'render-blocked' });
    expect(dneskaiPlanAction(slot(), head({ status: 'published' }), null, true, now)).toMatchObject({ status: 'published' });
    const late = slot({ date: '2026-11-07', local_time: '12:30' });
    expect(dneskaiPlanAction(late, head({}, { scheduledAt: dneskaiPlanSlotAt(late) }), null, true, now)).toMatchObject({ status: 'failed', code: 'slot-passed' });
  });
});

describe('dneskaiPlanEmptySlots', () => {
  it('lists the four daily times, Threads alone at 21:00, minus the taken ones', () => {
    const empty = dneskaiPlanEmptySlots([{ date: '2026-11-08', local_time: '08:00' }], '2026-11-08', '2026-11-09');
    expect(empty).toHaveLength(7);
    expect(empty[0]).toEqual({ date: '2026-11-08', time: '12:30', instagram: true });
    expect(empty.find((item) => item.time === '21:00')).toEqual({ date: '2026-11-08', time: '21:00', instagram: false });
  });

  it('is off unless DNESKAI_PLAN_ENABLED is true', () => {
    expect(dneskaiPlanEnabled({})).toBe(false);
    expect(dneskaiPlanEnabled({ DNESKAI_PLAN_ENABLED: 'true' })).toBe(true);
  });
});

describe('the night\'s news in the plan (7 November 2026)', () => {
  it('keeps the news times free ahead when news is on', () => {
    const empty = dneskaiPlanEmptySlots([], '2026-11-20', '2026-11-20', ['08:00', '19:00', '21:00']);
    expect(empty.map((slot) => slot.time)).toEqual(['12:30']);
  });

  it('places news topics best rank first into their day\'s free news times, only while they can still be generated', () => {
    const evening = new Date('2026-11-19T22:00:00Z'); // 23:00 in Prague
    const placed = dneskaiNewsPlacement([
      { id: 'b', date: '2026-11-20', rank: 2 }, { id: 'a', date: '2026-11-20', rank: 1 }, { id: 'c', date: '2026-11-20', rank: 3 }, { id: 'd', date: '2026-11-20', rank: 4 },
    ], [{ date: '2026-11-20', local_time: '19:00' }], evening);
    expect(placed).toEqual([
      { topicId: 'a', date: '2026-11-20', time: '08:00', instagram: true },
      { topicId: 'b', date: '2026-11-20', time: '21:00', instagram: false },
    ]);
    const morning = new Date('2026-11-20T06:00:00Z'); // 07:00 in Prague: 08:00 is too close
    // Friday 19:00 is a series slot from 16 November 2026, so the news takes Threads at 21:00.
    expect(dneskaiNewsPlacement([{ id: 'a', date: '2026-11-20', rank: 1 }], [], morning)[0]).toMatchObject({ time: '21:00' });
    // Sunday 19:00 stays with the news.
    expect(dneskaiNewsPlacement([{ id: 'a', date: '2026-11-22', rank: 1 }], [], new Date('2026-11-22T06:00:00Z'))[0]).toMatchObject({ time: '19:00' });
  });
});
