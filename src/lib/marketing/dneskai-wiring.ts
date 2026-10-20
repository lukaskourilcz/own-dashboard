import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { ContentRevision } from "./contracts";
import type { CreateDneskaiBriefs, ListBriefAssetHashes, LoadDneskaiMediaBytes, RenderDneskaiDeck } from "./dneskai-ports";
import { createDneskaiDeckRenderer } from "./dneskai-render";
import { createDneskaiMediaLoader } from "./dneskai-media";
import { createDneskaiSlideStorage } from "./worker-runtime";
import { dneskaiDeckAssetHashes } from "./dneskai-slides";

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
 * The media pool an owner edit may draw from. Until briefs exist (#115) the pool is the set of pictures the
 * revision already places, so an edit can reorder, recrop or drop images but never introduce a foreign one.
 */
export function getBriefAssetHashLister(db: Database, owner: string): ListBriefAssetHashes {
  void db; void owner;
  return async (revision: ContentRevision) => {
    return revision.deck ? dneskaiDeckAssetHashes(revision.deck) : [];
  };
}

/** Brief creation for a finished run (#115). Until it is wired the scheduler records `briefs-unwired` and moves on. */
export function getCreateDneskaiBriefs(db: Database): CreateDneskaiBriefs {
  void db;
  return async () => { throw new Error("briefs-unwired"); };
}
