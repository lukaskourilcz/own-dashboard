import { devsharkStudioRenderRequest, dneskaiRevisionRenders, dneskaiStoryPreviewRequest, type DesignLabPicture } from "@/lib/marketing/design-lab-renders";
import type { DevsharkDeck } from "@/lib/marketing/devshark-deck";
import type { PublishingLive, PublishingPicture } from "@/lib/publishing-calendar";

/**
 * The publishing calendar's picture adapters (owner request, 9 November 2026). Each brand's versions take their
 * pictures from the Design Lab's own resolver (`design-lab-renders.ts`), for the revision the Lab shows, so a card, a
 * carousel, a Threads picture or a story is never a placeholder, an older render or a different crop. Used by the
 * server read and by the /dev-preview calendar.
 */
const picture = (asset: DesignLabPicture, fallbackAlt: string): PublishingPicture =>
  ({ url: asset.url, alt: (asset.alt || fallbackAlt).slice(0, 500), width: asset.width, height: asset.height });

export type DneskaiCalendarRenders = { thumbnail: PublishingPicture | null; slides: PublishingPicture[]; story: { pictures: PublishingPicture[]; live: PublishingLive | null } };

/** A DNESKAi revision as the Lab draws it: all slides or none, the cover as the card, the Lab's story request. */
export function dneskaiCalendarRenders(revision: { id: string; deck: { kit?: string | null; slides: readonly unknown[] } | null | undefined; assets: readonly DesignLabPicture[] }, title: string): DneskaiCalendarRenders {
  const renders = dneskaiRevisionRenders(revision);
  const slides = renders.slides.every((slide) => slide !== null) ? (renders.slides as DesignLabPicture[]).slice(0, 10).map((slide) => picture(slide, title)) : [];
  const request = dneskaiStoryPreviewRequest(revision);
  return { thumbnail: slides[0] ?? null, slides, story: { pictures: [], live: request ? { kind: "dneskai-story", request } : null } };
}

export type DevsharkCalendarRenders = { thumbnail: PublishingPicture | null; slides: PublishingPicture[]; threads: PublishingPicture[]; story: PublishingPicture[]; live: PublishingLive | null };

/**
 * A devShark slot: the stored post, Threads and story JPEGs once the plan made them from the concept, which the
 * Studio no longer edits after that. Before then the post is drawn from the concept the way the Studio draws it; the
 * story has no Studio view, so it shows only once stored.
 */
export function devsharkCalendarRenders(concept: { title: string; deck: DevsharkDeck } | null, stored: { post: readonly DesignLabPicture[]; threads: readonly DesignLabPicture[]; story: readonly DesignLabPicture[] }): DevsharkCalendarRenders {
  const title = concept?.title ?? "devShark";
  const slides = (stored.post.length ? stored.post : stored.threads).slice(0, 10).map((item) => picture(item, title));
  const threads = (stored.threads.length ? stored.threads : stored.post).slice(0, 10).map((item) => picture(item, title));
  const story = stored.story.slice(0, 1).map((item) => picture(item, title));
  const live: PublishingLive | null = !slides.length && concept ? { kind: "devshark-deck", ...devsharkStudioRenderRequest(concept) } : null;
  return { thumbnail: slides[0] ?? null, slides, threads, story, live };
}
