import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { createAdminClient } from "@/lib/supabase/admin";
import { DneskaiRenderReportSchema, parseContentRevision } from "./contracts";
import { DNESKAI_REEL, DNESKAI_REEL_POLICY, dneskaiReelDuration, dneskaiReelKey, renderDneskaiReel, type DneskaiReelAudio } from "./dneskai-reel-render";
import { MARKETING_ASSET_BUCKET, MARKETING_ASSET_URL_SECONDS, dneskaiSlideObjectKey } from "./worker-runtime";

/**
 * Stored DNESKAi Reels (#163): renders an approved deck's slides into an MP4 once per reel key and keeps it in the
 * private `marketing-reels` bucket (migration 20261023130000). Instagram receives a signed URL, valid seven days
 * like the slide URLs, which its cURL fetch can read without a session.
 */
type Database = ReturnType<typeof createAdminClient>;

export const DNESKAI_REEL_BUCKET = "marketing-reels";
/** The bucket's own limit (migration). A 10-slide reel at 8 Mbps is about 31 MB. */
export const DNESKAI_REEL_MAX_BYTES = 64 * 1024 * 1024;

/** Server-only switch for everything Reel: the render route and, with #165, publishing a revision as a Reel. */
export function dneskaiReelsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.MARKETING_DNESKAI_REELS_ENABLED === "true";
}

export const DNESKAI_REEL_ERROR_CODES = ["reel-revision-unavailable", "reel-revision-not-deck", "reel-render-required", "reel-slides-unavailable", "reel-audio-unavailable", "reel-storage-failed", "reel-bucket-required"] as const;
export type DneskaiReelErrorCode = typeof DNESKAI_REEL_ERROR_CODES[number];
export class DneskaiReelError extends Error {
  constructor(readonly code: DneskaiReelErrorCode) { super(code); this.name = "DneskaiReelError"; }
}

export function dneskaiReelObjectKey(ownerId: string, reelKey: string): string {
  z.uuid().parse(ownerId);
  if (!/^[a-f0-9]{64}$/.test(reelKey)) throw new DneskaiReelError("reel-storage-failed");
  return `${ownerId}/marketing/dneskai/reels/${reelKey}.mp4`;
}

export type StoredDneskaiReel = { reelKey: string; url: string; sha256: string; bytes: number };

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** One immutable MP4 per owner and reel key, verified (size, type, owner, key, sha256) before it is signed. */
export function createDneskaiReelStorage(db: Database, ownerId: string) {
  z.uuid().parse(ownerId);
  let checked: Promise<void> | null = null;
  const files = async () => {
    checked ??= db.storage.getBucket(DNESKAI_REEL_BUCKET).then(({ data, error }) => {
      if (error || !data || data.public) throw new DneskaiReelError("reel-bucket-required");
    });
    try { await checked; } catch (failure) { checked = null; throw failure; }
    return db.storage.from(DNESKAI_REEL_BUCKET);
  };
  const sign = async (key: string) => {
    const signed = await (await files()).createSignedUrl(key, MARKETING_ASSET_URL_SECONDS);
    if (signed.error || !signed.data?.signedUrl?.startsWith("https://")) throw new DneskaiReelError("reel-storage-failed");
    return signed.data.signedUrl;
  };
  return {
    async find(reelKey: string): Promise<StoredDneskaiReel | null> {
      const key = dneskaiReelObjectKey(ownerId, reelKey);
      const info = await (await files()).info(key);
      if (info.error || !info.data) return null;
      const metadata: Record<string, unknown> = info.data.metadata ?? {};
      const recorded = typeof metadata.sha256 === "string" ? metadata.sha256 : "";
      if (!/^[a-f0-9]{64}$/.test(recorded) || metadata.ownerId !== ownerId || metadata.reelKey !== reelKey || info.data.contentType !== "video/mp4"
        || !Number.isInteger(info.data.size) || !info.data.size || info.data.size > DNESKAI_REEL_MAX_BYTES) throw new DneskaiReelError("reel-storage-failed");
      return { reelKey, url: await sign(key), sha256: recorded, bytes: info.data.size };
    },
    async put(input: { reelKey: string; bytes: Buffer; metadata: Record<string, string> }): Promise<StoredDneskaiReel> {
      const key = dneskaiReelObjectKey(ownerId, input.reelKey);
      if (!input.bytes.length || input.bytes.length > DNESKAI_REEL_MAX_BYTES) throw new DneskaiReelError("reel-storage-failed");
      const digest = sha256(input.bytes);
      const metadata = { ...input.metadata, reelKey: input.reelKey, sha256: digest, ownerId };
      const store = await files();
      await store.upload(key, input.bytes, { upsert: false, contentType: "video/mp4", cacheControl: "3600", metadata });
      // Never rewritten: an upload that lost a race keeps the first object, which must then match byte for byte.
      const info = await store.info(key);
      if (info.error || !info.data || info.data.size !== input.bytes.length || info.data.contentType !== "video/mp4"
        || !Object.entries(metadata).every(([field, value]) => info.data.metadata?.[field] === value)) throw new DneskaiReelError("reel-storage-failed");
      return { reelKey: input.reelKey, url: await sign(key), sha256: digest, bytes: input.bytes.length };
    },
  };
}

/** A rendered slide JPEG from the render-key cache in `marketing-assets`, checked against its recorded sha256. */
export async function loadDneskaiSlideBytes(db: Database, ownerId: string, renderKey: string): Promise<Buffer> {
  const store = db.storage.from(MARKETING_ASSET_BUCKET);
  const key = dneskaiSlideObjectKey(ownerId, renderKey);
  const info = await store.info(key);
  const recorded = info.data?.metadata?.sha256;
  if (info.error || !info.data || typeof recorded !== "string" || info.data.metadata?.ownerId !== ownerId) throw new DneskaiReelError("reel-slides-unavailable");
  const downloaded = await store.download(key);
  if (downloaded.error || !downloaded.data) throw new DneskaiReelError("reel-slides-unavailable");
  const bytes = Buffer.from(await downloaded.data.arrayBuffer());
  if (sha256(bytes) !== recorded) throw new DneskaiReelError("reel-slides-unavailable");
  return bytes;
}

export type DneskaiReelDependencies = {
  loadSlide(renderKey: string): Promise<Buffer>;
  /** The revision's audio, or null for the silent variant. */
  loadAudio(revision: ReturnType<typeof parseContentRevision>): Promise<DneskaiReelAudio | null>;
  storage: ReturnType<typeof createDneskaiReelStorage>;
  render?: typeof renderDneskaiReel;
  signal?: AbortSignal;
};

export type DneskaiReelOutcome = StoredDneskaiReel & { cached: boolean; durationSeconds: number; silent: boolean; revisionHash: string };

/**
 * The reel of one revision: read it, take its rendered slides in order, reuse the stored MP4 for the same reel key
 * or render and store one. Refuses a revision without a clean deck render; never touches approval or publication.
 */
export async function dneskaiReelForRevision(db: Database, ownerId: string, revisionId: string, dependencies: DneskaiReelDependencies): Promise<DneskaiReelOutcome> {
  z.uuid().parse(ownerId);
  if (!z.uuid().safeParse(revisionId).success) throw new DneskaiReelError("reel-revision-unavailable");
  const { data: row, error } = await db.from("marketing_revisions").select("revision,content_hash,render_report").eq("id", revisionId).eq("user_id", ownerId).maybeSingle();
  if (error || !row) throw new DneskaiReelError("reel-revision-unavailable");
  let revision;
  try { revision = parseContentRevision(row.revision); } catch { throw new DneskaiReelError("reel-revision-unavailable"); }
  if (!revision.deck) throw new DneskaiReelError("reel-revision-not-deck");
  const report = DneskaiRenderReportSchema.safeParse(row.render_report);
  const slideCount = revision.deck.slides.length;
  if (!report.success || report.data.status !== "rendered" || report.data.problems.some((problem) => problem.blocking)
    || report.data.renderKeys.length !== slideCount || slideCount > DNESKAI_REEL.maxSlides) throw new DneskaiReelError("reel-render-required");
  const revisionHash = String(row.content_hash);
  const audio = await dependencies.loadAudio(revision);
  const reelKey = dneskaiReelKey({ revisionHash, audioId: audio?.id ?? null });
  const found = await dependencies.storage.find(reelKey);
  const durationSeconds = dneskaiReelDuration(slideCount);
  if (found) return { ...found, cached: true, durationSeconds, silent: !audio, revisionHash };
  let slides: Buffer[];
  try { slides = await Promise.all(report.data.renderKeys.map((key) => dependencies.loadSlide(key))); }
  catch { throw new DneskaiReelError("reel-slides-unavailable"); }
  const rendered = await (dependencies.render ?? renderDneskaiReel)({ slides, audio, signal: dependencies.signal });
  const stored = await dependencies.storage.put({
    reelKey,
    bytes: rendered.bytes,
    metadata: { revisionId, revisionHash, audioId: audio?.id ?? "silent", policy: DNESKAI_REEL_POLICY, durationSeconds: String(rendered.durationSeconds) },
  });
  return { ...stored, cached: false, durationSeconds: rendered.durationSeconds, silent: rendered.silent, revisionHash };
}
