import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { DneskaiRenderReportSchema, type MarketingRevisionRow } from "./contracts";
import { DNESKAI_SLIDE_VIDEO, DNESKAI_SLIDE_VIDEO_POLICY, dneskaiSlideVideoKey, dneskaiVideoSlideIndexes, renderDneskaiSlideVideo } from "./dneskai-slide-video";
import { createDneskaiReelStorage, loadDneskaiSlideBytes } from "./dneskai-reel";

type Database = ReturnType<typeof createAdminClient>;

/**
 * The stored clips of a video-first carousel (owner decision, 8 November 2026), behind
 * `MARKETING_DNESKAI_SLIDE_VIDEOS_ENABLED`. Off, a video-first post publishes its slide JPEGs like any carousel.
 *
 * Each clip is made from the approved slide JPEG (the render-key cache) and kept once per revision hash and slide in
 * the private `marketing-reels` bucket, under the same storage rules as a Reel. Before a claim the orchestrator asks
 * for them: what is stored is reused, at most `maxRenders` missing clips are made in this run (about 2 s each), and a
 * post still missing one stays queued as `slide-videos-pending` for the next tick.
 */
export function dneskaiSlideVideosEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.MARKETING_DNESKAI_SLIDE_VIDEOS_ENABLED === "true";
}

export type DneskaiSlideVideos = Record<number, { url: string; sha256: string; bytes: number }>;
export type DneskaiSlideVideoDependencies = {
  storage?: ReturnType<typeof createDneskaiReelStorage>;
  loadSlide?: (renderKey: string) => Promise<Buffer>;
  render?: typeof renderDneskaiSlideVideo;
  env?: Record<string, string | undefined>;
};

export async function prepareDneskaiSlideVideos(db: Database, owner: string, row: Pick<MarketingRevisionRow, "id" | "revision" | "content_hash" | "render_report">,
  options: { dryRun: boolean; maxRenders?: number; signal?: AbortSignal } & DneskaiSlideVideoDependencies): Promise<{ videos: DneskaiSlideVideos | null; hold: string | null }> {
  const deck = row.revision.deck;
  if (!deck || !dneskaiSlideVideosEnabled(options.env)) return { videos: null, hold: null };
  const indexes = dneskaiVideoSlideIndexes(deck);
  if (!indexes.length) return { videos: null, hold: null };
  const report = DneskaiRenderReportSchema.safeParse(row.render_report);
  if (!report.success || report.data.renderKeys.length !== deck.slides.length) return { videos: null, hold: "slide-videos-unavailable" };
  const storage = options.storage ?? createDneskaiReelStorage(db, owner);
  const loadSlide = options.loadSlide ?? ((key: string) => loadDneskaiSlideBytes(db, owner, key));
  const render = options.render ?? renderDneskaiSlideVideo;
  const revisionHash = String(row.content_hash);
  const videos: DneskaiSlideVideos = {};
  let budget = options.dryRun ? 0 : options.maxRenders ?? 2;
  try {
    for (const index of indexes) {
      const key = dneskaiSlideVideoKey({ revisionHash, index });
      const found = await storage.find(key);
      if (found) { videos[index] = { url: found.url, sha256: found.sha256, bytes: found.bytes }; continue; }
      if (budget <= 0 || options.signal?.aborted) continue;
      budget -= 1;
      const clip = await render({ slide: await loadSlide(report.data.renderKeys[index]!), signal: options.signal });
      const stored = await storage.put({ reelKey: key, bytes: clip.bytes, metadata: { revisionId: row.id, revisionHash, slide: String(index), policy: DNESKAI_SLIDE_VIDEO_POLICY, durationSeconds: String(DNESKAI_SLIDE_VIDEO.seconds) } });
      videos[index] = { url: stored.url, sha256: stored.sha256, bytes: stored.bytes };
    }
  } catch { return { videos: null, hold: "slide-videos-unavailable" }; }
  return indexes.every((index) => videos[index]) ? { videos, hold: null } : { videos: null, hold: "slide-videos-pending" };
}
