import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { ContentRevision } from "./contracts";
import type { CreateDneskaiBriefs, ListBriefAssetHashes, LoadDneskaiMediaBytes, RenderDneskaiDeck } from "./dneskai-ports";
import { createDneskaiDeckRenderer } from "./dneskai-render";
import { createDneskaiMediaLoader } from "./dneskai-media";
import { createDneskaiSlideStorage } from "./worker-runtime";
import { createDneskaiBriefs, listDneskaiBriefAssetHashes } from "./dneskai-briefs";

/**
 * Concrete implementations behind the DNESKAi ports, resolved per request by the routes that edit and render
 * revisions: the carousel studio renderer over the render-key cache in `marketing-assets` (#117) and the
 * verified source media loader over `marketing-media` (#114).
 */
type Database = ReturnType<typeof createAdminClient>;

export function getRenderDneskaiDeck(db: Database): RenderDneskaiDeck {
  return createDneskaiDeckRenderer({ storage: (owner, signal) => createDneskaiSlideStorage(db, owner, { signal }) });
}

export function getDneskaiMediaLoader(db: Database, owner: string): LoadDneskaiMediaBytes {
  return createDneskaiMediaLoader(db, owner);
}

/**
 * The media pool an owner edit may draw from: the pictures of the brief the revision was generated from
 * (`revision.sources[0]`, #115) plus the pictures the deck already places, never another brief's.
 */
export function getBriefAssetHashLister(db: Database, owner: string): ListBriefAssetHashes {
  return async (revision: ContentRevision) => listDneskaiBriefAssetHashes(db, owner, revision);
}

/** Brief creation for a finished run (#115): events become briefs and guarded generation jobs. */
export function getCreateDneskaiBriefs(db: Database): CreateDneskaiBriefs {
  return createDneskaiBriefs(db);
}
