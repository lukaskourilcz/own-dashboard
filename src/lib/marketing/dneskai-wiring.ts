import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { ListBriefAssetHashes, LoadDneskaiMediaBytes, RenderDneskaiDeck } from "./dneskai-ports";

/**
 * Concrete implementations behind the DNESKAi ports, resolved per request by the routes that edit revisions.
 * Until the integrator wires the studio renderer (#117) and media storage (#114), each factory throws, so a deck
 * edit is refused before any revision is written and the current revision keeps its state.
 */
type Database = ReturnType<typeof createAdminClient>;

export function getRenderDneskaiDeck(): RenderDneskaiDeck {
  throw new Error("renderer-unwired");
}

export function getDneskaiMediaLoader(db: Database, owner: string): LoadDneskaiMediaBytes {
  void db; void owner;
  throw new Error("media-unwired");
}

export function getBriefAssetHashLister(db: Database, owner: string): ListBriefAssetHashes {
  void db; void owner;
  throw new Error("media-unwired");
}
