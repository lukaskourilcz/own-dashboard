import { z } from "zod";

/**
 * IG Kolekce (owner request, 9 November 2026): the posts the owner saved on Instagram, stored as
 * `marketing_knowledge_sources` rows (`20261109120000_ig_collection.sql`, docs/ig-kolekce.md). This half is pure and
 * browser-safe: the export parser, URL parsing, the digest contract and the list filters. The paid half is
 * `ig-collection-runner.ts`. No cookies, sessions or private Saved collection URLs: only the owner's own export file
 * and public post/Reel URLs.
 */

export const COLLECTION_STATUSES = ["queued", "scraping", "summarizing", "done", "restricted", "failed"] as const;
export type CollectionStatus = (typeof COLLECTION_STATUSES)[number];
export const COLLECTION_PROJECTS = ["DNESKAi", "devShark", "heyDarlink", "personal"] as const;
export type CollectionProject = (typeof COLLECTION_PROJECTS)[number];
/** One import request: the RPC and the 1 MB body limit both hold at this size. */
export const COLLECTION_IMPORT_CHUNK = 500;
/** Owner cap for one post: Apify scrape plus Claude digest. */
export const COLLECTION_POST_CAP_USD = 0.05;
export const COLLECTION_APIFY_CAP_USD = 0.02;
/** One Process click handles at most this many queued posts. */
export const COLLECTION_PROCESS_LIMIT = 20;

export type CollectionImportRow = { shortcode: string; saved_at: string | null; author: string | null; collections: string[] };

const HOSTS = new Set(["instagram.com", "www.instagram.com", "m.instagram.com"]);
/** A public post or Reel URL to its shortcode; profiles, Saved collections and anything else are null. */
export function collectionShortcode(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port || !HOSTS.has(url.hostname.toLowerCase())) return null;
    // `/<user>/p/<code>/` is the newer share form; `/<user>/saved/...` never matches.
    const match = /^\/(?:[A-Za-z0-9._]{1,30}\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{1,80})\/?$/.exec(url.pathname);
    return match ? match[1] : null;
  } catch { return null; }
}
export const collectionPostUrl = (shortcode: string) => `https://www.instagram.com/p/${shortcode}/`;

/** Every post/Reel URL in pasted text, once each, in order. At most 500. */
export function shortcodesFromText(text: string): { shortcodes: string[]; rejected: number } {
  const candidates = text.match(/https:\/\/[^\s<>"')]+/g) ?? [];
  const seen = new Set<string>(); let rejected = 0;
  for (const candidate of candidates) {
    const code = collectionShortcode(candidate);
    if (!code) { rejected++; continue; }
    seen.add(code);
  }
  if (seen.size > COLLECTION_IMPORT_CHUNK) throw new Error("collection-too-many-urls");
  return { shortcodes: [...seen], rejected };
}

const obj = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const epoch = (value: unknown): string | null => typeof value === "number" && Number.isFinite(value) && value > 946_684_800 && value < 4_102_444_800 ? new Date(Math.round(value) * 1000).toISOString() : null;

/** The post URL, save time and author anywhere in one export entry (string_map_data and label_values forms). */
function scanEntry(entry: unknown): { shortcode: string | null; savedAt: string | null } {
  let shortcode: string | null = null; let savedAt: string | null = null;
  const walk = (value: unknown, key: string, depth: number) => {
    if (depth > 6) return;
    if (typeof value === "string") { if (!shortcode && value.startsWith("https://")) shortcode = collectionShortcode(value); return; }
    if (typeof value === "number") { if (!savedAt && /timestamp/i.test(key)) savedAt = epoch(value); return; }
    if (Array.isArray(value)) { for (const item of value.slice(0, 50)) walk(item, key, depth + 1); return; }
    if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, k, depth + 1);
  };
  walk(entry, "", 0);
  return { shortcode, savedAt };
}

export type ParsedSavedExport = { kind: "saved-media" | "collections"; rows: CollectionImportRow[]; entries: number; rejected: number };

/**
 * Instagram's "Export your information" JSON, Saved section: the saved posts file (`saved_saved_media`) or the
 * collections file (`saved_saved_collections`, a header entry per collection followed by its posts). The file name
 * varies between export versions, so the content decides.
 */
export function parseSavedExport(json: unknown): ParsedSavedExport {
  const root = obj(json);
  const media = root.saved_saved_media; const collections = root.saved_saved_collections;
  const list = Array.isArray(media) ? media : Array.isArray(collections) ? collections : Array.isArray(json) ? json : null;
  if (!list) throw new Error("collection-export-unsupported");
  if (list.length > 20000) throw new Error("collection-export-too-large");
  const kind = Array.isArray(collections) ? "collections" : "saved-media";
  const rows = new Map<string, CollectionImportRow>(); let rejected = 0; let collection: string | null = null;
  for (const raw of list) {
    const entry = obj(raw); const map = obj(entry.string_map_data);
    const name = obj(map.Name);
    const scan = scanEntry(raw);
    if (!scan.shortcode) {
      // A collections-file header: {"title":"Collection","string_map_data":{"Name":{"value":"Tips"}}}.
      if (kind === "collections" && typeof name.value === "string" && name.value.trim()) { collection = name.value.trim().slice(0, 120); continue; }
      rejected++; continue;
    }
    const title = typeof entry.title === "string" && entry.title.trim() && entry.title !== "Collection" ? entry.title.trim() : null;
    const author = title ?? (typeof name.value === "string" && name.value.trim() ? name.value.trim() : null);
    const known = rows.get(scan.shortcode);
    if (known) { if (collection && !known.collections.includes(collection)) known.collections.push(collection); continue; }
    rows.set(scan.shortcode, { shortcode: scan.shortcode, saved_at: scan.savedAt, author: author?.slice(0, 120) ?? null, collections: kind === "collections" && collection ? [collection] : [] });
  }
  return { kind, rows: [...rows.values()], entries: list.length, rejected };
}

/** Saved posts and collections files together: one row per shortcode, the earliest save time, all collection names. */
export function mergeSavedExports(parts: readonly ParsedSavedExport[]): CollectionImportRow[] {
  const merged = new Map<string, CollectionImportRow>();
  for (const part of parts) for (const row of part.rows) {
    const known = merged.get(row.shortcode);
    if (!known) { merged.set(row.shortcode, { ...row, collections: [...row.collections] }); continue; }
    if (row.saved_at && (!known.saved_at || (part.kind === "saved-media" && row.saved_at < known.saved_at))) known.saved_at = row.saved_at;
    known.author ??= row.author;
    for (const name of row.collections) if (!known.collections.includes(name)) known.collections.push(name);
  }
  return [...merged.values()].sort((a, b) => (b.saved_at ?? "").localeCompare(a.saved_at ?? ""));
}

export function chunkRows<T>(rows: readonly T[], size = COLLECTION_IMPORT_CHUNK): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}

export const CollectionImportRowSchema = z.strictObject({
  shortcode: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), saved_at: z.iso.datetime({ offset: true }).nullable(),
  author: z.string().min(1).max(120).nullable(), collections: z.array(z.string().min(1).max(120)).max(20),
});

/** What Claude returns for one saved post. Procedures follow the existing knowledge contract and need owner review. */
export const CollectionDigestSchema = z.strictObject({
  summary: z.string().min(1).max(800), tips: z.array(z.string().min(1).max(300)).max(8),
  tags: z.array(z.string().min(1).max(40)).max(8), project: z.enum(COLLECTION_PROJECTS).nullable(),
});
export type CollectionDigest = z.infer<typeof CollectionDigestSchema> & { model?: string; apifyUsd?: number | null; claudeUsd?: number; droppedProcedures?: number };

export type CollectionPost = {
  id: string; shortcode: string; url: string; author: string | null; saved_at: string | null; published_at: string | null;
  collections: string[]; status: CollectionStatus; error: string | null; thumbnail: string | null; media_type: string | null;
  digest: CollectionDigest | null; processed_at: string | null;
};
export type CollectionOverview = { highWater: string | null; count: number; lastRun: string | null; lastImport: string | null; queued: number; hasShareToken: boolean; shareTokenCreatedAt: string | null };
export type CollectionFilter = { status: CollectionStatus | "all"; project: CollectionProject | "all"; tag: string | "all"; search: string };

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export function filterCollection(posts: readonly CollectionPost[], filter: CollectionFilter): CollectionPost[] {
  const words = fold(filter.search).split(/\s+/).filter(Boolean);
  return posts.filter((post) => (filter.status === "all" || post.status === filter.status) &&
    (filter.project === "all" || post.digest?.project === filter.project) &&
    (filter.tag === "all" || (post.digest?.tags ?? []).includes(filter.tag) || post.collections.includes(filter.tag)) &&
    words.every((word) => fold([post.author ?? "", post.shortcode, post.digest?.summary ?? "", ...(post.digest?.tips ?? []), ...(post.digest?.tags ?? []), ...post.collections].join(" ")).includes(word)));
}
export function collectionTags(posts: readonly CollectionPost[]): string[] {
  return [...new Set(posts.flatMap((post) => [...(post.digest?.tags ?? []), ...post.collections]))].sort((a, b) => a.localeCompare(b));
}

/** A database row to the list shape the panel shows. */
export function collectionPostFromRow(row: Record<string, unknown>): CollectionPost {
  const media = obj(row.media);
  const status = COLLECTION_STATUSES.includes(row.collection_status as CollectionStatus) ? row.collection_status as CollectionStatus : "queued";
  const digest = row.digest && typeof row.digest === "object" ? row.digest as CollectionDigest : null;
  return { id: String(row.id), shortcode: String(row.shortcode), url: String(row.canonical_url), author: typeof row.author === "string" ? row.author : null,
    saved_at: typeof row.saved_at === "string" ? row.saved_at : null, published_at: typeof row.published_at === "string" ? row.published_at : null,
    collections: Array.isArray(row.collections) ? row.collections.map(String) : [], status, error: typeof row.collection_error === "string" ? row.collection_error : null,
    thumbnail: typeof media.thumbnailUrl === "string" && media.thumbnailUrl.startsWith("https://") ? media.thumbnailUrl : null,
    media_type: typeof media.type === "string" ? media.type : null, digest, processed_at: typeof row.processed_at === "string" ? row.processed_at : null };
}
