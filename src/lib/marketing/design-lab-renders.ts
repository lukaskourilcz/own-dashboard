import type { DneskaiPreviewRequest } from './dneskai-lab';
import type { DevsharkDeck } from './devshark-deck';

/**
 * What the Design Lab draws for a saved revision, shared with the publishing calendar (owner request, 9 November 2026:
 * the calendar shows exactly what the Lab shows, the same picture source of the same revision, never a stand-in).
 * Browser-safe and pure: the Lab, the calendar's server read and the /dev-preview calendar all call these.
 *
 * DNESKAi: the slides are the revision's stored JPEGs, but only when the render attached one per slide (otherwise
 * none, never a partial or older set); the cover is the first. The 9:16 story is drawn on demand from the cover through
 * the Lab's preview route (`POST /api/marketing/dneskai/preview`, `format: instagram-story`), so the request is shared.
 *
 * devShark: the Studio draws each slide of a concept in the browser as the exact SVG the renderer publishes
 * (`devsharkStudioSlideSvg` in `src/lib/design-studio/devshark-studio-slide.ts`, kept apart so the DNESKAi Lab does not
 * load the devShark layout); once the plan has stored the post and story revisions (rendered from the same deck, which
 * the Studio no longer edits), those JPEGs are the version that goes out.
 */
export type DesignLabPicture = { url: string; width: number; height: number; alt: string };

type DneskaiRevisionLike<A extends DesignLabPicture> = { deck: { slides: readonly unknown[] } | null | undefined; assets: readonly A[] };

/** One entry per deck slide: its stored render, or null for every slide when the set is incomplete. */
export function dneskaiRevisionRenders<A extends DesignLabPicture>(revision: DneskaiRevisionLike<A>): { slides: Array<A | null>; cover: A | null } {
  const slides = revision.deck?.slides ?? [];
  const complete = slides.length > 0 && revision.assets.length === slides.length;
  const renders = slides.map((_, index) => complete ? revision.assets[index] ?? null : null);
  return { slides: renders, cover: renders[0] ?? null };
}

type DneskaiStoryDeck = { kit?: string | null; slides: readonly unknown[] };

/**
 * The Lab's story request for a revision: its cover as a native 1080 × 1920 story. `editDeck` is the Lab's unsaved
 * edit (the same `edit` deck a save would send); without one the saved deck is drawn as it is.
 */
export function dneskaiStoryPreviewRequest(revision: { id: string; deck: DneskaiStoryDeck | null | undefined }, editDeck?: DneskaiPreviewRequest['deck']): DneskaiPreviewRequest | null {
  const deck = editDeck ?? (revision.deck && revision.deck.slides.length
    ? { ...(revision.deck.kit ? { kit: revision.deck.kit } : {}), slides: revision.deck.slides.map((_, from) => ({ from })) } as DneskaiPreviewRequest['deck']
    : null);
  return deck ? { id: revision.id, deck, slide: 0, format: 'instagram-story' } : null;
}

/** The Studio's server render request for a devShark concept (its Render button). */
export const devsharkStudioRenderRequest = (concept: { deck: DevsharkDeck }) => ({ deck: concept.deck });
