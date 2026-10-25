import "server-only";
import { marketingStorageObjectMissing } from "./storage-errors";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { createAdminClient } from "@/lib/supabase/admin";
import { DneskaiRenderReportSchema, parseContentRevision } from "./contracts";
import { DNESKAI_REEL, DNESKAI_REEL_POLICY, dneskaiReelDuration, dneskaiReelKey, renderDneskaiReel, type DneskaiReelAudio } from "./dneskai-reel-render";
import { revisionContentHash } from "./hashes";
import { signAutomationBody } from "./automation-auth";
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
      if (info.error) {
        if (marketingStorageObjectMissing(info.error)) return null;
        throw new DneskaiReelError("reel-storage-failed");
      }
      if (!info.data) throw new DneskaiReelError("reel-storage-failed");
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

export type DneskaiReelOutcome = StoredDneskaiReel & { cached: boolean; durationSeconds: number; silent: boolean; revisionHash: string; audioId: string | null };

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
  if (row.content_hash !== revisionContentHash(revision)) throw new DneskaiReelError("reel-revision-unavailable");
  const report = DneskaiRenderReportSchema.safeParse(row.render_report);
  const slideCount = revision.deck.slides.length;
  if (!report.success || report.data.status !== "rendered" || report.data.problems.some((problem) => problem.blocking)
    || report.data.renderKeys.length !== slideCount || revision.assets.length !== slideCount || revision.assets.some(asset => asset.mimeType !== "image/jpeg")
    || report.data.renderKeys.some(key => !/^[a-f0-9]{64}$/.test(key)) || slideCount > DNESKAI_REEL.maxSlides) throw new DneskaiReelError("reel-render-required");
  const revisionHash = String(row.content_hash);
  const audio = await dependencies.loadAudio(revision);
  if (audio && !audio.bytes.length) throw new DneskaiReelError("reel-audio-unavailable");
  const audioIdentity = audio ? { id: audio.id, sha256: sha256(audio.bytes) } : null;
  const reelKey = dneskaiReelKey({ slideSha256s: revision.assets.map(asset => asset.sha256), audio: audioIdentity });
  const found = await dependencies.storage.find(reelKey);
  const durationSeconds = dneskaiReelDuration(slideCount);
  if (found) return { ...found, cached: true, durationSeconds, silent: !audio, revisionHash, audioId: audio?.id ?? null };
  let slides: Buffer[];
  try { slides = await Promise.all(report.data.renderKeys.map((key) => dependencies.loadSlide(key))); }
  catch { throw new DneskaiReelError("reel-slides-unavailable"); }
  if (slides.some((bytes, index) => sha256(bytes) !== revision.assets[index]!.sha256)) throw new DneskaiReelError("reel-slides-unavailable");
  const rendered = await (dependencies.render ?? renderDneskaiReel)({ slides, audio, signal: dependencies.signal });
  const stored = await dependencies.storage.put({
    reelKey,
    bytes: rendered.bytes,
    metadata: { audioId: audio?.id ?? "silent", audioSha256: audioIdentity?.sha256 ?? "silent", policy: DNESKAI_REEL_POLICY, durationSeconds: String(rendered.durationSeconds) },
  });
  return { ...stored, cached: false, durationSeconds: rendered.durationSeconds, silent: rendered.silent, revisionHash, audioId: audio?.id ?? null };
}

/* ---- the render record (#165) --------------------------------------------------------------------------------- */

/**
 * Every stored Reel is recorded as a `marketing_events` row (`dneskai-reel-rendered`, delivered at once, so nothing
 * treats it as a pending notice) on its revision. The publisher finds a revision's Reel through it, whatever track the
 * rotation picked, and the rotation reads the track of the last Reel from it. No schema change.
 */
export const DNESKAI_REEL_EVENT = "dneskai-reel-rendered";
const ReelRecordSchema = z.object({
  reelKey: z.string().regex(/^[a-f0-9]{64}$/), revisionHash: z.string().regex(/^[a-f0-9]{64}$/),
  audioId: z.uuid().nullable(), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive(),
});
export type DneskaiReelRecord = z.infer<typeof ReelRecordSchema>;

export async function recordDneskaiReel(db: Database, ownerId: string, revisionId: string, reel: DneskaiReelRecord): Promise<void> {
  z.uuid().parse(ownerId);
  const existing = await db.from("marketing_events").select("id").eq("user_id", ownerId).eq("revision_id", revisionId).eq("kind", DNESKAI_REEL_EVENT)
    .eq("payload->>reelKey", reel.reelKey).limit(1);
  if (existing.error) throw new DneskaiReelError("reel-storage-failed");
  if (existing.data?.length) return;
  const { error } = await db.from("marketing_events").insert({ user_id: ownerId, revision_id: revisionId, kind: DNESKAI_REEL_EVENT, payload: ReelRecordSchema.parse(reel), delivered_at: new Date().toISOString() });
  if (error) throw new DneskaiReelError("reel-storage-failed");
}

/** The newest Reel recorded for this revision and content hash, re-checked and signed from storage; null if none. */
export async function findDneskaiReelForRevision(db: Database, ownerId: string, revisionId: string, revisionHash: string, storage = createDneskaiReelStorage(db, ownerId)): Promise<(StoredDneskaiReel & { audioId: string | null }) | null> {
  z.uuid().parse(ownerId);
  const { data, error } = await db.from("marketing_events").select("payload").eq("user_id", ownerId).eq("revision_id", revisionId).eq("kind", DNESKAI_REEL_EVENT)
    .order("created_at", { ascending: false }).limit(5);
  if (error) throw new DneskaiReelError("reel-storage-failed");
  for (const row of data ?? []) {
    const record = ReelRecordSchema.safeParse((row as { payload: unknown }).payload);
    if (!record.success || record.data.revisionHash !== revisionHash) continue;
    const stored = await storage.find(record.data.reelKey);
    if (stored && stored.sha256 === record.data.sha256) return { ...stored, audioId: record.data.audioId };
  }
  return null;
}

/** The track of the most recent Reel of another revision, for the rotation; null before the first Reel. */
export async function lastDneskaiReelAudio(db: Database, ownerId: string, exceptRevisionId: string): Promise<string | null> {
  const { data, error } = await db.from("marketing_events").select("revision_id,payload").eq("user_id", ownerId).eq("kind", DNESKAI_REEL_EVENT)
    .neq("revision_id", exceptRevisionId).order("created_at", { ascending: false }).limit(1);
  if (error) throw new DneskaiReelError("reel-storage-failed");
  const record = ReelRecordSchema.safeParse((data?.[0] as { payload?: unknown } | undefined)?.payload);
  return record.success ? record.data.audioId : null;
}

/**
 * Asks this deployment's render route for a revision's Reel, signed as the scheduler, and returns once the route has
 * accepted the job (202): the render itself runs in that function's own 300 s, not in the 60 s tick (#165).
 */
export async function requestDneskaiReelRender(input: { origin: string; revisionId: string; audioTrackId: string | null; env?: Record<string, string | undefined>; fetcher?: typeof fetch }): Promise<boolean> {
  const secret = (input.env ?? process.env).MARKETING_SCHEDULER_SECRET;
  let origin: URL;
  try { origin = new URL(input.origin); } catch { return false; }
  if (!secret || secret.length < 32 || origin.protocol !== "https:" && origin.hostname !== "localhost" && origin.hostname !== "127.0.0.1") return false;
  const body = JSON.stringify({ revisionId: input.revisionId, audioTrackId: input.audioTrackId, async: true });
  try {
    const response = await (input.fetcher ?? fetch)(new URL("/api/marketing/dneskai/render-reel", origin).href, {
      method: "POST", body, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000), headers: signAutomationBody(body, secret),
    });
    return response.status === 202 || response.ok;
  } catch { return false; }
}
