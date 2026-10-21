import type { DneskaiBriefMedia } from './dneskai-brief';
import type { DneskaiImageCrop, DneskaiSlide, DneskaiSlideImage } from './dneskai-slides';
import { pragueLocalInput, pragueScheduledAt } from './clock';
import type { DneskaiFieldLimit, DneskaiWorkspacePost } from './dneskai-workspace';

/**
 * The owner's post editor (#119) as pure functions: a draft built from one revision, the edits the editor allows
 * (written fields the template draws, picture swaps from the topic's pool, focal point and zoom, removing and
 * moving slides, caption, time and account) and the exact `edit` request for POST /api/marketing/revisions.
 * Slide types, variants, picture places and source lines stay as generated; the server enforces the same rules.
 */
export const DNESKAI_CAPTION_MAX = 2200;
export const DNESKAI_ZOOM = { min: 1, max: 2, step: 0.05 } as const;
/** Arrow keys move the focal point by 2 % of the picture. */
export const DNESKAI_FOCAL_STEP = 0.02;

export type DraftSlide = { from: number; slide: DneskaiSlide; fields: DneskaiFieldLimit[] };
export type DeckDraft = { slides: DraftSlide[]; caption: string; scheduledLocal: string; accountId: string | null };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number) => Math.round(value * 1000) / 1000;

export function createDeckDraft(post: DneskaiWorkspacePost, accountId: string | null = null): DeckDraft {
  return {
    slides: (post.deck?.slides ?? []).map((slide, from) => ({ from, slide: structuredClone(slide), fields: post.fields[from] ?? [] })),
    caption: post.caption,
    scheduledLocal: pragueLocalInput(post.scheduledAt),
    accountId,
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

/**
 * The credit line code sets for a slide's pictures, the same three forms as generation (`fitDneskaiCredit` in
 * dneskai-generation.ts): full credits, then without the „Foto:“/„Obrázek:“ label, then also without the platform in
 * brackets. Null when even the shortest form does not fit.
 */
export function dneskaiCreditLine(credits: readonly string[], limit: number): string | null {
  const whitespace = (value: string) => value.replace(/\s+/gu, ' ').trim();
  const distinct = <T>(values: T[]) => [...new Set(values)];
  const characters = (value: string) => [...value.normalize('NFC')].length;
  const full = distinct(credits.map(whitespace).filter(Boolean));
  if (!full.length) return '';
  const unlabelled = full.map((credit) => credit.replace(/^(?:Foto|Obrázek):\s+/u, ''));
  const bare = unlabelled.map((credit) => credit.replace(/\s+\((?:Bluesky|GitHub|Instagram)\)$/u, ''));
  for (const form of [full, unlabelled, bare]) {
    const line = distinct(form).join(' · ');
    if (characters(line) <= limit) return line;
  }
  return null;
}

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

/** Characters as the owner counts them (code points of the composed text). */
export const characterCount = (value: string) => [...value.normalize('NFC')].length;

export type DraftProblem = { slide: number | null; field: string; code: 'text-too-long' | 'text-missing' | 'alt-missing' | 'caption-too-long' | 'caption-missing' | 'deck-edit-slide-count' | 'schedule-invalid' };
/** What the editor itself can see is wrong before sending; the server and the renderer check the rest. */
export function draftProblems(post: Pick<DneskaiWorkspacePost, 'deck'>, draft: DeckDraft): DraftProblem[] {
  const problems: DraftProblem[] = [];
  draft.slides.forEach(({ slide, fields }, index) => {
    for (const { field, max } of fields) {
      const value = slide[field] ?? '';
      if (characterCount(value.trim()) > max) problems.push({ slide: index, field, code: 'text-too-long' });
    }
    if (slide.type !== 'sources' && !slide.headline.trim()) problems.push({ slide: index, field: 'headline', code: 'text-missing' });
    if (!slide.alt.trim()) problems.push({ slide: index, field: 'alt', code: 'alt-missing' });
  });
  if (post.deck?.format === 'carousel' && (draft.slides.length < 2 || draft.slides.length > 10)) problems.push({ slide: null, field: 'slides', code: 'deck-edit-slide-count' });
  if (post.deck?.format === 'single-image' && draft.slides.length !== 1) problems.push({ slide: null, field: 'slides', code: 'deck-edit-slide-count' });
  if (!draft.caption.trim()) problems.push({ slide: null, field: 'caption', code: 'caption-missing' });
  else if (characterCount(draft.caption) > DNESKAI_CAPTION_MAX) problems.push({ slide: null, field: 'caption', code: 'caption-too-long' });
  if (scheduledIso(draft.scheduledLocal) === null) problems.push({ slide: null, field: 'scheduledAt', code: 'schedule-invalid' });
  return problems;
}

/** A `datetime-local` value read as Prague wall-clock time, or null in a DST gap or when malformed. */
export function scheduledIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  try { return pragueScheduledAt(local.slice(0, 10), local.slice(11, 16)); } catch { return null; }
}

export type DneskaiSlideEdit = { from: number; headline?: string; body?: string | null; kicker?: string | null; credit?: string; alt?: string; images?: DneskaiSlideImage[] };
export type DneskaiEditRequest = { action: 'edit'; id: string; caption: string; scheduledAt: string; accountId?: string; deck?: { slides: DneskaiSlideEdit[] } };

const sameImages = (a: readonly DneskaiSlideImage[], b: readonly DneskaiSlideImage[]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The `edit` request for the draft. A slide entry names only what changed, so an untouched slide renders from the
 * same key and a resubmitted draft keeps the approval hash stable. The deck is left out when no slide changed.
 */
export function dneskaiEditRequest(post: DneskaiWorkspacePost, draft: DeckDraft, accountId: string | null = null): DneskaiEditRequest {
  const scheduledAt = scheduledIso(draft.scheduledLocal);
  if (!scheduledAt) throw new Error('schedule-invalid');
  const original = post.deck?.slides ?? [];
  let changed = draft.slides.length !== original.length;
  const slides = draft.slides.map(({ from, slide, fields }, position): DneskaiSlideEdit => {
    const source = original[from];
    if (!source) throw new Error('deck-edit-slide-invalid');
    if (from !== position) changed = true;
    const entry: DneskaiSlideEdit = { from };
    const placed = new Set(fields.map((field) => field.field));
    if (placed.has('headline') && slide.headline !== source.headline) entry.headline = slide.headline;
    for (const field of ['body', 'kicker'] as const) {
      if (!placed.has(field)) continue;
      const next = (slide[field] ?? '').trim() ? slide[field]! : '';
      const before = source[field] ?? '';
      if (next === before) continue;
      if (next) entry[field] = next; else if (source[field] !== undefined) entry[field] = null;
    }
    if (placed.has('credit') && (slide.credit ?? '') !== (source.credit ?? '')) entry.credit = slide.credit ?? '';
    if (slide.alt !== source.alt) entry.alt = slide.alt;
    if (!sameImages(slide.images, source.images)) entry.images = slide.images.map((image) => structuredClone(image));
    if (Object.keys(entry).length > 1) changed = true;
    return entry;
  });
  return {
    action: 'edit', id: post.id, caption: draft.caption, scheduledAt,
    ...(accountId ? { accountId } : {}),
    ...(changed ? { deck: { slides } } : {}),
  };
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
