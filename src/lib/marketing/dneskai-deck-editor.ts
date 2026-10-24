import { dneskaiCaptionWithKeyword } from './dneskai-caption';
import { dneskaiAudioChoiceKey } from './dneskai-audio-contracts';
import { ENGAGEMENT_KEYWORD_PATTERN, ENGAGEMENT_PUBLIC_REPLY_MAX, ENGAGEMENT_REPLY_MESSAGE_MAX, type ContentEngagement } from './contracts';
import type { DneskaiBriefMedia } from './dneskai-brief';
import { dneskaiKitOf, type DneskaiImageCrop, type DneskaiKitId, type DneskaiSlide, type DneskaiSlideImage } from './dneskai-slides';
import { pragueLocalInput, pragueScheduledAt } from './clock';
import {
  dneskaiCoverInset, dneskaiCreditLine, dneskaiInsertablePictures, dneskaiPictureFitsShape, dneskaiShapeFromId, dneskaiShapeId, dneskaiShapePictureCounts, dneskaiSlideFieldLimits,
  dneskaiSlideMoves, dneskaiSlideShape, DNESKAI_PLACED_FIELDS, type DneskaiPoolPicture, type DneskaiShapeId, type DneskaiSlideShape,
} from './dneskai-slide-layout';
import type { DneskaiFieldLimit, DneskaiWorkspacePost } from './dneskai-workspace';
import type { DneskaiFitResult } from './dneskai-lab';

/**
 * The owner's post editor (#119) as pure functions: a draft built from one revision, the edits the editor allows
 * (written fields the template draws, picture swaps from the topic's pool, focal point and zoom, removing and
 * moving slides, caption, time and account), and since review-10 a slide's type and variant within the moves its
 * pictures allow and a slide inserted from the brief's pool, plus the exact `edit` request for
 * POST /api/marketing/revisions. Source lines stay code-owned; the server applies the same rules
 * (`applyDneskaiDeckEdit` in dneskai-deck-edit.ts).
 */
export const DNESKAI_CAPTION_MAX = 2200;
/** The owner's cap on hashtags per DNESKAi post (22 October 2026); generation keeps to it and every edit is checked. */
export const DNESKAI_CAPTION_HASHTAG_MAX = 10;
/** The hashtags a caption carries, as Instagram reads them. */
export const dneskaiCaptionHashtags = (caption: string) => caption.match(/#[\p{L}\p{N}_]+/gu)?.length ?? 0;
export const DNESKAI_ZOOM = { min: 1, max: 2, step: 0.05 } as const;
/** Arrow keys move the focal point by 2 % of the picture. */
export const DNESKAI_FOCAL_STEP = 0.02;

/** `from` is the slide's index in the saved revision, or null for a slide the owner inserted. */
export type DraftSlide = { from: number | null; slide: DneskaiSlide; fields: DneskaiFieldLimit[] };
/** `kit`: the kit the post is drawn in (kits are per post); switching it is an edit like any other. */
/**
 * The comment keyword and DM reply as the owner types them (#159): raw text, checked by `draftProblems` and normalised
 * by `dneskaiDraftEngagement`. An empty `publicReply` sends no public reply. `null` on the draft: the post has none.
 */
export type EngagementDraft = { keyword: string; replyMessage: string; publicReply: string };
/** `audioTrackId`: the Reel track (#164); null leaves the choice to the rotation. */
/** `format` (#165): how a carousel deck publishes, as a carousel or as a Reel; other decks keep theirs. */
export type DeckDraft = { slides: DraftSlide[]; caption: string; scheduledLocal: string; accountId: string | null; kit: DneskaiKitId; audioTrackId: string | null; engagement: EngagementDraft | null; format: DneskaiWorkspacePost['format'] };

import { DNESKAI_DEFAULT_PUBLIC_REPLY } from './dneskai-engagement';
export { DNESKAI_DEFAULT_PUBLIC_REPLY };
export function newEngagementDraft(): EngagementDraft {
  return { keyword: '', replyMessage: '', publicReply: DNESKAI_DEFAULT_PUBLIC_REPLY };
}
/** The keyword as the server stores it: trimmed and upper case. */
export const dneskaiEngagementKeyword = (value: string) => value.trim().toUpperCase();
/** The engagement the draft would save: trimmed, keyword upper-cased, an empty public reply left out. Not yet validated. */
export function dneskaiDraftEngagement(draft: EngagementDraft | null): ContentEngagement | null {
  if (!draft) return null;
  const publicReply = draft.publicReply.trim();
  return { keyword: dneskaiEngagementKeyword(draft.keyword), replyMessage: draft.replyMessage.trim(), ...(publicReply ? { publicReply } : {}) };
}
/** The caption the edit server validates, including its code-owned keyword line. */
export function dneskaiDraftCaption(draft: Pick<DeckDraft, 'caption' | 'engagement'>): string {
  return dneskaiCaptionWithKeyword(draft.caption, dneskaiDraftEngagement(draft.engagement)?.keyword ?? null);
}
const engagementKey = (value: ContentEngagement | null | undefined) =>
  value ? JSON.stringify([value.keyword, value.replyMessage, value.publicReply ?? null]) : 'null';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number) => Math.round(value * 1000) / 1000;

/** The server refuses a time that is not in the future or more than six days ahead (`schedule-outside-asset-window`). */
export const DNESKAI_SCHEDULE_WINDOW_MS = 6 * 86_400_000;
/** „Publish now“ moves the post this far ahead, so approval still sees a future time; the next 5-minute tick publishes it. */
export const DNESKAI_PUBLISH_NOW_LEAD_MS = 2 * 60_000;
/** A time the editor offers for an expired post: at least 15 minutes ahead, on a 5-minute mark. */
export function dneskaiNextEditableTime(now: Date = new Date()): string {
  const step = 5 * 60_000;
  return new Date(Math.ceil((now.getTime() + 15 * 60_000) / step) * step).toISOString();
}
/** True when the saved time has passed (or is about to), so the post cannot be approved or saved as it is. */
export function dneskaiScheduleExpired(post: Pick<DneskaiWorkspacePost, 'scheduledAt'>, now: Date = new Date()): boolean {
  return Date.parse(post.scheduledAt) <= now.getTime() + 60_000;
}

/** A draft of the saved revision. A post whose time has passed starts with `dneskaiNextEditableTime` instead, so it can be saved. */
export function createDeckDraft(post: DneskaiWorkspacePost, accountId: string | null = null, now: Date = new Date()): DeckDraft {
  return {
    slides: (post.deck?.slides ?? []).map((slide, from) => ({ from, slide: structuredClone(slide), fields: post.fields[from] ?? [] })),
    caption: post.caption,
    scheduledLocal: pragueLocalInput(dneskaiScheduleExpired(post, now) ? dneskaiNextEditableTime(now) : post.scheduledAt),
    accountId,
    kit: dneskaiKitOf(post.deck),
    audioTrackId: dneskaiAudioChoiceKey(post.audio),
    engagement: post.engagement ? { keyword: post.engagement.keyword, replyMessage: post.engagement.replyMessage, publicReply: post.engagement.publicReply ?? '' } : null,
    format: post.format,
  };
}

/** The focal point of an image, centre when the deck has none. */
export function imageFocal(image: Pick<DneskaiSlideImage, 'crop'>): { x: number; y: number } {
  return image.crop?.focal ?? { x: 0.5, y: 0.5 };
}
export function imageZoom(image: Pick<DneskaiSlideImage, 'crop'>): number {
  return image.crop?.zoom ?? 1;
}

/** A keyboard move of the focal point; null when the key is not an arrow, Home or End. */
export function moveFocal(focal: { x: number; y: number }, key: string, step = DNESKAI_FOCAL_STEP): { x: number; y: number } | null {
  const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (key === 'Home') return { x: 0.5, y: 0.5 };
  const delta = move[key];
  if (!delta) return null;
  return { x: round(clamp(focal.x + delta[0], 0, 1)), y: round(clamp(focal.y + delta[1], 0, 1)) };
}

/** The focal point under a click or tap, from the picture's box on screen. */
export function focalFromPoint(box: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): { x: number; y: number } {
  if (!(box.width > 0) || !(box.height > 0)) return { x: 0.5, y: 0.5 };
  return { x: round(clamp((clientX - box.left) / box.width, 0, 1)), y: round(clamp((clientY - box.top) / box.height, 0, 1)) };
}

function withCrop(image: DneskaiSlideImage, patch: Partial<{ focal: { x: number; y: number }; zoom: number }>): DneskaiSlideImage {
  const focal = patch.focal ?? imageFocal(image);
  const zoom = round(clamp(patch.zoom ?? imageZoom(image), DNESKAI_ZOOM.min, DNESKAI_ZOOM.max));
  const crop: DneskaiImageCrop = { focal: { x: round(focal.x), y: round(focal.y) }, ...(zoom !== 1 ? { zoom } : {}), ...(image.crop?.fit ? { fit: image.crop.fit } : {}) };
  return { ...image, crop };
}

const updateSlide = (draft: DeckDraft, index: number, update: (slide: DneskaiSlide) => DneskaiSlide): DeckDraft =>
  ({ ...draft, slides: draft.slides.map((item, position) => position === index ? { ...item, slide: update(item.slide) } : item) });

export function setSlideText(draft: DeckDraft, index: number, field: 'headline' | 'body' | 'kicker' | 'credit' | 'alt', value: string): DeckDraft {
  return updateSlide(draft, index, (slide) => ({ ...slide, [field]: value }));
}

export function setImageCrop(draft: DeckDraft, index: number, slot: string, patch: Partial<{ focal: { x: number; y: number }; zoom: number }>): DeckDraft {
  return updateSlide(draft, index, (slide) => ({ ...slide, images: slide.images.map((image) => image.slot === slot ? withCrop(image, patch) : image) }));
}

/** The credit line code sets for a slide's pictures (browser-safe in `dneskai-slide-layout.ts`). */
export { dneskaiCreditLine };

/**
 * Swaps the picture in one slot for another from the topic's pool. The crop starts centred, the slide's credit line
 * follows its pictures when the slide draws one, and the sources slide's thumbnail of the old picture follows too.
 */
export function swapSlideImage(draft: DeckDraft, index: number, slot: string, media: Pick<DneskaiBriefMedia, 'assetSha256' | 'credit'>, pool: readonly Pick<DneskaiBriefMedia, 'assetSha256' | 'credit'>[]): DeckDraft {
  const target = draft.slides[index];
  const previous = target?.slide.images.find((image) => image.slot === slot);
  if (!target || !previous || previous.assetSha256 === media.assetSha256) return draft;
  const images = target.slide.images.map((image) => image.slot === slot ? { slot, assetSha256: media.assetSha256, ...(previous.crop?.fit ? { crop: { focal: { x: 0.5, y: 0.5 }, fit: previous.crop.fit } } : {}) } : image);
  const creditLimit = target.fields.find((field) => field.field === 'credit')?.max;
  const credits = images.map((image) => pool.find((item) => item.assetSha256 === image.assetSha256)?.credit ?? '');
  const credit = creditLimit !== undefined ? dneskaiCreditLine(credits, creditLimit) ?? credits.filter(Boolean).join(' · ') : undefined;
  const slides = draft.slides.map((item, position) => {
    if (position === index) return { ...item, slide: { ...item.slide, images, ...(credit !== undefined ? { credit } : {}) } };
    if (item.slide.type !== 'sources' || images.some((image) => image.assetSha256 === previous.assetSha256)) return item;
    // The sources slide shows the pictures used; its thumbnail of the replaced picture becomes the new one.
    if (item.slide.images.some((image) => image.assetSha256 === media.assetSha256)) return item;
    return { ...item, slide: { ...item.slide, images: item.slide.images.map((image) => image.assetSha256 === previous.assetSha256 ? { slot: image.slot, assetSha256: media.assetSha256 } : image) } };
  });
  return { ...draft, slides };
}

/**
 * Adds, replaces or removes (`media` null) the cover's circular inset picture (`image-2`) in a kit that draws one
 * (`dneskaiCoverInset`). The inset is a second picture from the topic's pool; any other slide or kit is unchanged.
 */
export function setCoverInset(draft: DeckDraft, index: number, media: Pick<DneskaiBriefMedia, 'assetSha256'> | null): DeckDraft {
  const target = draft.slides[index];
  if (!target || target.slide.type !== 'cover-photo' || !dneskaiCoverInset(draft.kit)) return draft;
  const main = target.slide.images.filter((image) => image.slot === 'image-1');
  if (media && main.some((image) => image.assetSha256 === media.assetSha256)) return draft;
  const images = media ? [...main, { slot: 'image-2', assetSha256: media.assetSha256 }] : main;
  return { ...draft, slides: draft.slides.map((item, position) => position === index ? { ...item, slide: { ...item.slide, images } } : item) };
}
/** The draft in another kit: a cover inset the new kit cannot draw is dropped with the switch. */
export function setDraftKit(draft: DeckDraft, kit: DneskaiKitId): DeckDraft {
  const next = { ...draft, kit };
  if (dneskaiCoverInset(kit)) return next;
  return { ...next, slides: next.slides.map((item) => item.slide.type === 'cover-photo' && item.slide.images.length > 1
    ? { ...item, slide: { ...item.slide, images: item.slide.images.filter((image) => image.slot === 'image-1') } } : item) };
}

export function removeSlide(draft: DeckDraft, index: number): DeckDraft {
  return { ...draft, slides: draft.slides.filter((_, position) => position !== index) };
}
export function moveSlide(draft: DeckDraft, from: number, to: number): DeckDraft {
  if (from === to || from < 0 || to < 0 || from >= draft.slides.length || to >= draft.slides.length) return draft;
  const slides = [...draft.slides];
  const [moved] = slides.splice(from, 1);
  slides.splice(to, 0, moved!);
  return { ...draft, slides };
}

/** The pool the editor offers: the brief's pictures and its primary source. */
export function draftPool(post: Pick<DneskaiWorkspacePost, 'brief'>): { media: DneskaiBriefMedia[]; primaryCandidateId: string | null } {
  return { media: post.brief?.media ?? [], primaryCandidateId: post.brief?.evidence[0]?.candidateId ?? null };
}

/** The shapes slide `index` of the draft may take while keeping its pictures, the current one first. */
export function draftSlideMoves(post: Pick<DneskaiWorkspacePost, 'brief' | 'deck'>, draft: DeckDraft, index: number): DneskaiSlideShape[] {
  const item = draft.slides[index];
  if (!item) return [];
  const media = new Map(draftPool(post).media.map((entry) => [entry.assetSha256, entry]));
  return dneskaiSlideMoves(item.slide, { index, format: post.deck?.format ?? 'carousel', media });
}

/**
 * Moves slide `index` to another shape within its allowed moves. Text the new type does not draw is dropped (the
 * caller tells the owner which fields went), a type-only single post drops its picture and credit, and the counters
 * follow the new template. Returns the draft unchanged when the move is not allowed.
 */
export function setSlideShape(post: Pick<DneskaiWorkspacePost, 'brief' | 'deck'>, draft: DeckDraft, index: number, id: DneskaiShapeId): { draft: DeckDraft; dropped: Array<'body' | 'kicker' | 'credit'> } {
  const item = draft.slides[index];
  if (!item || !draftSlideMoves(post, draft, index).some((shape) => dneskaiShapeId(shape) === id)) return { draft, dropped: [] };
  const shape = dneskaiShapeFromId(id);
  const slide: DneskaiSlide = { ...structuredClone(item.slide), type: shape.type };
  if ('variant' in shape) slide.variant = shape.variant; else delete slide.variant;
  if (!dneskaiShapePictureCounts(shape).some((count) => count > 0)) slide.images = [];
  const placed: readonly string[] = DNESKAI_PLACED_FIELDS[slide.type];
  const dropped = (['body', 'kicker', 'credit'] as const).filter((field) => (slide[field] ?? '').trim() && (!placed.includes(field) || (field === 'credit' && !slide.images.length)));
  for (const field of ['body', 'kicker', 'credit'] as const) if (!placed.includes(field) || (field === 'credit' && !slide.images.length)) delete slide[field];
  return { draft: { ...draft, slides: draft.slides.map((entry, position) => position === index ? { ...entry, slide, fields: dneskaiSlideFieldLimits(slide) } : entry) }, dropped };
}

/** Pictures an inserted slide may use: unused pool pictures from a source the deck already cites, that fit the shape. */
export function insertablePictures(post: Pick<DneskaiWorkspacePost, 'brief' | 'deck'>, draft: DeckDraft, id: DneskaiShapeId): DneskaiBriefMedia[] {
  const shape = dneskaiShapeFromId(id);
  if (!post.deck || !dneskaiShapePictureCounts(shape).some((count) => count > 0)) return [];
  const pool = draftPool(post);
  // The sources slide cites what the saved deck shows; a picture the draft already shows cannot repeat.
  const cited = dneskaiInsertablePictures(pool.media, post.deck, pool.primaryCandidateId);
  const shown = new Set(draft.slides.filter((item) => item.slide.type !== 'sources').flatMap((item) => item.slide.images.map((image) => image.assetSha256)));
  return cited.filter((item) => !shown.has(item.assetSha256) && dneskaiPictureFitsShape(item, shape));
}

/** Where a new slide goes: after slide `after`, but never after the sources slide. */
export function insertPosition(draft: DeckDraft, after: number): number {
  const sources = draft.slides.findIndex((item) => item.slide.type === 'sources');
  const at = Math.max(0, Math.min(draft.slides.length, after + 1));
  return sources >= 0 ? Math.min(at, sources) : at;
}

/**
 * Inserts a carousel slide (review-10): a framed picture from the pool without a credit line (no slide shows one), or a statement.
 * Its headline and alt text start empty, so the draft cannot be saved until the owner writes them. Returns the draft
 * unchanged when the shape, the picture or the slide count does not allow it.
 */
export function insertSlide(post: Pick<DneskaiWorkspacePost, 'brief' | 'deck'>, draft: DeckDraft, after: number, id: DneskaiShapeId, picture: Pick<DneskaiPoolPicture, 'assetSha256'> | null): { draft: DeckDraft; index: number } {
  const shape = dneskaiShapeFromId(id);
  const unchanged = { draft, index: -1 };
  if (post.deck?.format !== 'carousel' || draft.slides.length >= 10 || !['figure', 'split', 'statement-accent', 'statement-ink'].includes(id)) return unchanged;
  const needsPicture = dneskaiShapePictureCounts(shape).some((count) => count > 0);
  const media = needsPicture ? insertablePictures(post, draft, id).find((item) => item.assetSha256 === picture?.assetSha256) : null;
  if (needsPicture && !media) return unchanged;
  const slide: DneskaiSlide = { type: shape.type, ...('variant' in shape ? { variant: shape.variant } : {}), headline: '', images: media ? [{ slot: 'image-1', assetSha256: media.assetSha256 }] : [], alt: '' };
  const fields = dneskaiSlideFieldLimits(slide);
  const index = insertPosition(draft, after);
  const slides = [...draft.slides];
  slides.splice(index, 0, { from: null, slide, fields });
  return { draft: { ...draft, slides }, index };
}

/**
 * What a slide's pixels depend on, as the renderer keys them (`dneskaiRenderKey`): type, variant, trimmed words,
 * source lines and pictures with their crops. Alt text is not drawn. Two slides with the same key at the same place
 * in a deck of the same length render to the same JPEG, so the Lab can keep showing the saved one.
 */
export function dneskaiSlidePixelsKey(slide: DneskaiSlide): string {
  const images = [...slide.images].sort((left, right) => left.slot < right.slot ? -1 : left.slot > right.slot ? 1 : 0)
    .map((image) => [image.slot, image.assetSha256, image.crop?.focal.x ?? null, image.crop?.focal.y ?? null, image.crop?.zoom ?? null, image.crop?.fit ?? null]);
  return JSON.stringify([slide.type, slide.variant ?? null, slide.headline.trim(), (slide.body ?? '').trim(), (slide.kicker ?? '').trim(), (slide.credit ?? '').trim(),
    (slide.sources ?? []).map((line) => line.trim()).filter(Boolean), images]);
}

/** Characters as the owner counts them (code points of the composed text). */
export const characterCount = (value: string) => [...value.normalize('NFC')].length;

export type DraftProblem = { slide: number | null; field: string; code: 'text-too-long' | 'text-missing' | 'alt-missing' | 'alt-too-long' | 'caption-too-long' | 'caption-missing' | 'caption-hashtags-over-limit' | 'deck-edit-slide-count' | 'schedule-invalid' | 'schedule-outside-asset-window' | 'text-clipped' | 'text-unfit'
  | 'engagement-keyword-invalid' | 'engagement-message-missing' | 'engagement-message-too-long' | 'engagement-reply-too-long' };
/**
 * What the editor itself can see is wrong before sending; the server and the renderer check the rest. With the fit
 * report for this exact draft (POST /api/marketing/dneskai/fit), a field the studio's fitter would cut is a problem
 * too (`text-clipped`), as is any other text problem it names (`text-unfit`: a glyph the face lacks, unplaced text).
 */
export function draftProblems(post: Pick<DneskaiWorkspacePost, 'deck'>, draft: DeckDraft, fit: DneskaiFitResult | null = null, now: Date = new Date()): DraftProblem[] {
  const problems: DraftProblem[] = [];
  draft.slides.forEach(({ slide, fields }, index) => {
    for (const { field, max } of fields) {
      const value = slide[field] ?? '';
      if (characterCount(value.trim()) > max) problems.push({ slide: index, field, code: 'text-too-long' });
    }
    if (slide.type !== 'sources' && !slide.headline.trim()) problems.push({ slide: index, field: 'headline', code: 'text-missing' });
    if (!slide.alt.trim()) problems.push({ slide: index, field: 'alt', code: 'alt-missing' });
    else if (slide.alt.length > 1000) problems.push({ slide: index, field: 'alt', code: 'alt-too-long' });
    const fitted = fit?.slides.length === draft.slides.length ? fit.slides[index] : undefined;
    if (fitted && !fitted.fits) {
      for (const field of fitted.fields) {
        if (field.clipped && field.overBy === 0) problems.push({ slide: index, field: field.field, code: 'text-clipped' });
        else if (field.codes.length && field.overBy === 0) problems.push({ slide: index, field: field.field, code: 'text-unfit' });
      }
      if (fitted.codes.length) problems.push({ slide: index, field: 'slide', code: 'text-unfit' });
    }
  });
  if (post.deck?.format === 'carousel' && (draft.slides.length < 2 || draft.slides.length > 10)) problems.push({ slide: null, field: 'slides', code: 'deck-edit-slide-count' });
  if (post.deck?.format === 'single-image' && draft.slides.length !== 1) problems.push({ slide: null, field: 'slides', code: 'deck-edit-slide-count' });
  if (!draft.caption.trim()) problems.push({ slide: null, field: 'caption', code: 'caption-missing' });
  else if (dneskaiDraftCaption(draft).length > DNESKAI_CAPTION_MAX) problems.push({ slide: null, field: 'caption', code: 'caption-too-long' });
  else if (dneskaiCaptionHashtags(draft.caption) > DNESKAI_CAPTION_HASHTAG_MAX) problems.push({ slide: null, field: 'caption', code: 'caption-hashtags-over-limit' });
  const scheduled = scheduledIso(draft.scheduledLocal);
  if (scheduled === null) problems.push({ slide: null, field: 'scheduledAt', code: 'schedule-invalid' });
  else if (Date.parse(scheduled) <= now.getTime() || Date.parse(scheduled) > now.getTime() + DNESKAI_SCHEDULE_WINDOW_MS) problems.push({ slide: null, field: 'scheduledAt', code: 'schedule-outside-asset-window' });
  // The server's limits (ContentEngagementSchema) count UTF-16 units, so these do too.
  const engagement = dneskaiDraftEngagement(draft.engagement);
  if (engagement) {
    if (!ENGAGEMENT_KEYWORD_PATTERN.test(engagement.keyword)) problems.push({ slide: null, field: 'engagement.keyword', code: 'engagement-keyword-invalid' });
    if (!engagement.replyMessage) problems.push({ slide: null, field: 'engagement.replyMessage', code: 'engagement-message-missing' });
    else if (engagement.replyMessage.length > ENGAGEMENT_REPLY_MESSAGE_MAX) problems.push({ slide: null, field: 'engagement.replyMessage', code: 'engagement-message-too-long' });
    if ((engagement.publicReply?.length ?? 0) > ENGAGEMENT_PUBLIC_REPLY_MAX) problems.push({ slide: null, field: 'engagement.publicReply', code: 'engagement-reply-too-long' });
  }
  return problems;
}

/** A `datetime-local` value read as Prague wall-clock time, or null in a DST gap or when malformed. */
export function scheduledIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  try { return pragueScheduledAt(local.slice(0, 10), local.slice(11, 16)); } catch { return null; }
}

export type DneskaiSlideEdit = { from: number; headline?: string; body?: string | null; kicker?: string | null; credit?: string; alt?: string; images?: DneskaiSlideImage[]; type?: DneskaiSlide['type']; variant?: NonNullable<DneskaiSlide['variant']> | null };
export type DneskaiSlideInsertEdit = { insert: { type: 'figure' | 'split' | 'statement'; variant?: 'accent' | 'ink'; headline: string; body?: string; kicker?: string; alt: string; images: DneskaiSlideImage[] } };
/** `engagement` (#157): left out keeps the saved keyword and messages, null removes them. */
export type DneskaiEditRequest = { action: 'edit'; id: string; caption: string; scheduledAt: string; accountId?: string; audioTrackId?: string | null; format?: 'carousel' | 'reel'; deck?: { kit?: DneskaiKitId; slides: Array<DneskaiSlideEdit | DneskaiSlideInsertEdit> };
  engagement?: ContentEngagement | null };

const sameImages = (a: readonly DneskaiSlideImage[], b: readonly DneskaiSlideImage[]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The `edit` request for the draft. A slide entry names only what changed, so an untouched slide renders from the
 * same key and a resubmitted draft keeps the approval hash stable. The deck is left out when no slide changed, and the
 * engagement when the keyword and both messages are as saved (null when the owner removed them).
 */
export function dneskaiEditRequest(post: DneskaiWorkspacePost, draft: DeckDraft, accountId: string | null = null): DneskaiEditRequest {
  const scheduledAt = scheduledIso(draft.scheduledLocal);
  if (!scheduledAt) throw new Error('schedule-invalid');
  const original = post.deck?.slides ?? [];
  const kitChanged = draft.kit !== dneskaiKitOf(post.deck);
  let changed = kitChanged || draft.slides.length !== original.length;
  const slides = draft.slides.map(({ from, slide, fields }, position): DneskaiSlideEdit | DneskaiSlideInsertEdit => {
    if (from === null) {
      changed = true;
      if (slide.type !== 'figure' && slide.type !== 'split' && slide.type !== 'statement') throw new Error('deck-edit-insert-not-allowed');
      return { insert: {
        type: slide.type, ...(slide.type === 'statement' && (slide.variant === 'accent' || slide.variant === 'ink') ? { variant: slide.variant } : {}),
        headline: slide.headline, ...(slide.body?.trim() ? { body: slide.body } : {}), ...(slide.kicker?.trim() ? { kicker: slide.kicker } : {}),
        alt: slide.alt, images: slide.images.map((image) => structuredClone(image)),
      } };
    }
    const source = original[from];
    if (!source) throw new Error('deck-edit-slide-invalid');
    if (from !== position) changed = true;
    const entry: DneskaiSlideEdit = { from };
    const shape = dneskaiShapeId(dneskaiSlideShape(slide));
    if (shape !== dneskaiShapeId(dneskaiSlideShape(source))) {
      entry.type = slide.type;
      entry.variant = slide.variant ?? null;
      // Text the new type does not draw goes with the move.
      for (const field of ['body', 'kicker'] as const) if (source[field] !== undefined && slide[field] === undefined) entry[field] = null;
    }
    const placed = new Set(fields.map((field) => field.field));
    if (placed.has('headline') && slide.headline !== source.headline) entry.headline = slide.headline;
    for (const field of ['body', 'kicker'] as const) {
      if (!placed.has(field)) continue;
      const next = (slide[field] ?? '').trim() ? slide[field]! : '';
      const before = source[field] ?? '';
      if (next === before) continue;
      if (next) entry[field] = next; else if (source[field] !== undefined) entry[field] = null;
    }
    if (placed.has('credit') && !(entry.type !== undefined && slide.credit === undefined) && (slide.credit ?? '') !== (source.credit ?? '')) entry.credit = slide.credit ?? '';
    if (slide.alt !== source.alt) entry.alt = slide.alt;
    if (!sameImages(slide.images, source.images)) entry.images = slide.images.map((image) => structuredClone(image));
    if (Object.keys(entry).length > 1) changed = true;
    return entry;
  });
  return {
    action: 'edit', id: post.id, caption: draft.caption, scheduledAt,
    ...(accountId ? { accountId } : {}),
    // Sent only when the choice changed, so an untouched post keeps its saved track (or its rotation).
    ...((draft.audioTrackId ?? null) !== dneskaiAudioChoiceKey(post.audio) ? { audioTrackId: draft.audioTrackId ?? null } : {}),
    ...(draft.format !== post.format && (draft.format === 'carousel' || draft.format === 'reel') ? { format: draft.format } : {}),
    ...(changed ? { deck: { ...(kitChanged ? { kit: draft.kit } : {}), slides } } : {}),
    ...(dneskaiEngagementChanged(post, draft) ? { engagement: dneskaiDraftEngagement(draft.engagement) } : {}),
  };
}

/** True when the draft's keyword, DM or public reply differs from the saved post's, after normalising (#159). */
export function dneskaiEngagementChanged(post: Pick<DneskaiWorkspacePost, 'engagement'>, draft: Pick<DeckDraft, 'engagement'>): boolean {
  return engagementKey(dneskaiDraftEngagement(draft.engagement)) !== engagementKey(post.engagement);
}

/** Which picture places a slide type asks for: a full-bleed picture or one that fits a frame. */
export function slotRequirement(slide: Pick<DneskaiSlide, 'type' | 'variant'>): 'full-bleed' | 'inset' {
  return slide.type === 'cover-photo' || slide.type === 'single' ? 'full-bleed' : 'inset';
}
export type MediaResolution = 'full-bleed' | 'inset' | 'small';
export function mediaResolution(media: Pick<DneskaiBriefMedia, 'fullBleedCapable' | 'insetCapable'>): MediaResolution {
  return media.fullBleedCapable ? 'full-bleed' : media.insetCapable ? 'inset' : 'small';
}
/** Whether a pool picture can fill the slot it would go into. */
export function mediaFits(media: Pick<DneskaiBriefMedia, 'fullBleedCapable' | 'insetCapable'>, slide: Pick<DneskaiSlide, 'type' | 'variant'>): boolean {
  return slotRequirement(slide) === 'full-bleed' ? media.fullBleedCapable : media.insetCapable || media.fullBleedCapable;
}

/** The topic's pool in the order of the original posts: evidence order (primary first), then position. */
export function orderedMediaPool(brief: NonNullable<DneskaiWorkspacePost['brief']>): DneskaiBriefMedia[] {
  const rank = new Map(brief.evidence.map((item, index) => [item.candidateId, index]));
  return [...brief.media].sort((a, b) => (rank.get(a.candidateId) ?? 99) - (rank.get(b.candidateId) ?? 99) || a.position - b.position);
}
