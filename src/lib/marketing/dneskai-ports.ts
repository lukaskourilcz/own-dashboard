import type { z } from "zod";
import type { AssetSchema, ContentRevision } from "./contracts";
import type { DneskaiDeck } from "./dneskai-slides";

/**
 * Seams between the DNESKAi modules that are built in parallel:
 * - media storage (#114) provides `LoadDneskaiMediaBytes`;
 * - the studio renderer (#117) provides a `RenderDneskaiDeck` implementation;
 * - revisions and edits (#118) and generation (#116) call through these types only.
 * The integrator wires the concrete implementations; nothing here performs I/O.
 */

/** Returns the exact stored source bytes whose sha256 equals the argument, or throws `media-asset-unavailable`. */
export type LoadDneskaiMediaBytes = (sha256: string) => Promise<Buffer>;

export type DneskaiRenderedAsset = z.infer<typeof AssetSchema>;

export interface DneskaiRenderProblem {
  /** Zero-based slide index, or -1 for a deck-level problem. */
  slide: number;
  code: string;
  blocking: boolean;
  message: string;
}

export type DneskaiDeckRenderResult =
  | { status: "rendered"; assets: DneskaiRenderedAsset[]; renderKeys: string[]; problems: DneskaiRenderProblem[] }
  | { status: "refused"; assets: []; renderKeys: []; problems: DneskaiRenderProblem[] };

/**
 * Renders every slide of a deck to a 1080x1350 JPEG, stores it in the private `marketing-assets` bucket
 * (reusing a stored JPEG when the slide's render key is unchanged) and returns assets in slide order with
 * signed delivery URLs. Blocking problems (missing or low-resolution image, clipped text) refuse the deck.
 */
export type RenderDneskaiDeck = (input: {
  owner: string;
  revisionId: string;
  deck: DneskaiDeck;
  loadMedia: LoadDneskaiMediaBytes;
  signal?: AbortSignal;
}) => Promise<DneskaiDeckRenderResult>;

/**
 * The sha256 of every stored medium in the media pool of the brief a revision was generated from (#114, #115).
 * An owner edit may only place images from this pool; an unknown brief resolves to an empty list, never to
 * another brief's media.
 */
export type ListBriefAssetHashes = (revision: ContentRevision) => Promise<string[]>;
