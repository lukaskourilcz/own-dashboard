import "server-only";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
  DNESKAI_AUDIO_MAX_BYTES, DNESKAI_AUDIO_TYPES, DneskaiAudioTrackSchema,
  type DneskaiAudioCreate, type DneskaiAudioPrepared, type DneskaiAudioTrack, type DneskaiAudioType,
} from "./dneskai-audio-contracts";
import { dneskaiFfmpegPath } from "./dneskai-reel-render";
import type { DneskaiReelAudio } from "./dneskai-reel-render";

/**
 * The DNESKAi audio library on the server (#164): Zdroje → Hudba lists, uploads and switches tracks; the Reel renderer
 * (#163) reads the chosen track's bytes. Files sit in the private `marketing-audio` bucket under
 * `<owner>/<track id>.<ext>`; `storage_path` in the table carries the bucket name in front, like `marketing-media`.
 */
type Database = ReturnType<typeof createAdminClient>;

export const DNESKAI_AUDIO_BUCKET = "marketing-audio";
const PREVIEW_URL_SECONDS = 60 * 60;

export const DNESKAI_AUDIO_ERROR_CODES = ["audio-library-unavailable", "audio-upload-missing", "audio-upload-invalid", "audio-track-unavailable", "audio-track-write-failed"] as const;
export type DneskaiAudioErrorCode = typeof DNESKAI_AUDIO_ERROR_CODES[number];
export class DneskaiAudioError extends Error {
  constructor(readonly code: DneskaiAudioErrorCode) { super(code); this.name = "DneskaiAudioError"; }
}

const objectName = (owner: string, id: string, contentType: DneskaiAudioType) => `${owner}/${id}.${DNESKAI_AUDIO_TYPES[contentType]}`;

type TrackRow = {
  id: string; title: string; artist: string; source: string; licence_note: string; source_url: string | null; storage_path: string | null;
  duration_ms: number; mood: string[] | null; enabled: boolean; created_at: string;
};
const TRACK_COLUMNS = "id,title,artist,source,licence_note,source_url,storage_path,duration_ms,mood,enabled,created_at";

function objectFromPath(owner: string, storagePath: string | null): string | null {
  const prefix = `${DNESKAI_AUDIO_BUCKET}/${owner}/`;
  return storagePath?.startsWith(prefix) ? storagePath.slice(DNESKAI_AUDIO_BUCKET.length + 1) : null;
}

/** Owner-only stable pages. New uploads append; tracks are never deleted by this interface. */
export async function listDneskaiAudioPage(db: Database, owner: string, offset = 0): Promise<{ tracks: DneskaiAudioTrack[]; nextOffset: number | null }> {
  z.uuid().parse(owner); z.number().int().min(0).max(1_000_000).parse(offset);
  const { data, error } = await db.from("marketing_audio_tracks").select(TRACK_COLUMNS).eq("user_id", owner)
    .order("created_at", { ascending: true }).order("id", { ascending: true }).range(offset, offset + 200);
  if (error || !data) throw new DneskaiAudioError("audio-library-unavailable");
  return { tracks: await signAudioRows(db, owner, (data as TrackRow[]).slice(0, 200)), nextOffset: data.length > 200 ? offset + 200 : null };
}

/** First management page, or one chosen track regardless of its age or enabled state. */
export async function listDneskaiAudioTracks(db: Database, owner: string, trackId?: string): Promise<DneskaiAudioTrack[]> {
  if (!trackId) return (await listDneskaiAudioPage(db, owner)).tracks;
  z.uuid().parse(owner); z.uuid().parse(trackId);
  const { data, error } = await db.from("marketing_audio_tracks").select(TRACK_COLUMNS).eq("user_id", owner).eq("id", trackId).maybeSingle();
  if (error) throw new DneskaiAudioError("audio-library-unavailable");
  return signAudioRows(db, owner, data ? [data as TrackRow] : []);
}

async function signAudioRows(db: Database, owner: string, rows: TrackRow[]): Promise<DneskaiAudioTrack[]> {
  const names = rows.map((row) => objectFromPath(owner, row.storage_path));
  const wanted = names.filter((name): name is string => !!name);
  const signed = new Map<string, string>();
  if (wanted.length) {
    const { data: urls } = await db.storage.from(DNESKAI_AUDIO_BUCKET).createSignedUrls(wanted, PREVIEW_URL_SECONDS);
    for (const entry of urls ?? []) if (entry.path && entry.signedUrl && !entry.error) signed.set(entry.path, entry.signedUrl);
  }
  return rows.flatMap((row, index) => {
    const parsed = DneskaiAudioTrackSchema.safeParse({
      id: row.id, title: row.title, artist: row.artist, source: row.source, licenceNote: row.licence_note, sourceUrl: row.source_url,
      durationMs: row.duration_ms, mood: row.mood ?? [], enabled: row.enabled, createdAt: new Date(row.created_at).toISOString(),
      previewUrl: names[index] ? signed.get(names[index]!) ?? null : null,
    });
    return parsed.success ? [parsed.data] : [];
  });
}

/** A signed upload URL for exactly one new object. Nothing is recorded until `createDneskaiAudioTrack` checks the file. */
export async function prepareDneskaiAudioUpload(db: Database, owner: string, contentType: DneskaiAudioType): Promise<DneskaiAudioPrepared> {
  z.uuid().parse(owner);
  const uploadId = randomUUID();
  const name = objectName(owner, uploadId, contentType);
  const { data, error } = await db.storage.from(DNESKAI_AUDIO_BUCKET).createSignedUploadUrl(name);
  if (error || !data?.token) throw new DneskaiAudioError("audio-library-unavailable");
  return { uploadId, path: name, token: data.token };
}

/** Reads `Duration: hh:mm:ss.cc` from ffmpeg's probe of the file; null when ffmpeg finds no audio stream. */
export function parseFfmpegAudioProbe(stderr: string): number | null {
  if (!/Stream #\d+:\d+[^:]*: Audio:/.test(stderr)) return null;
  const match = /Duration: (\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
  if (!match) return null;
  return Math.round((Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000);
}

/** The audio's length in milliseconds, measured by the same ffmpeg the renderer uses. */
export async function probeDneskaiAudioDuration(bytes: Buffer, options: { ffmpegPath?: string } = {}): Promise<number | null> {
  const binary = options.ffmpegPath ?? await dneskaiFfmpegPath();
  const dir = await mkdtemp(path.join(tmpdir(), "dneskai-audio-"));
  try {
    const file = path.join(dir, "probe");
    await writeFile(file, bytes);
    const stderr = await new Promise<string>((resolve) => {
      let output = "";
      const child = spawn(binary, ["-hide_banner", "-nostdin", "-i", file], { stdio: ["ignore", "ignore", "pipe"] });
      child.stderr?.on("data", (chunk: Buffer) => { output = (output + chunk.toString()).slice(-8000); });
      child.on("error", () => resolve(""));
      // ffmpeg exits 1 without an output file; the probe text is complete either way.
      child.on("close", () => resolve(output));
    });
    return parseFfmpegAudioProbe(stderr);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Records an uploaded track: the object the signed URL wrote must exist, fit the size cap and decode as audio of
 * 1 s to 15 min. A file that fails is removed, so the bucket keeps only recorded tracks.
 */
export async function createDneskaiAudioTrack(db: Database, owner: string, input: DneskaiAudioCreate, options: { probe?: typeof probeDneskaiAudioDuration } = {}): Promise<DneskaiAudioTrack> {
  z.uuid().parse(owner);
  const files = db.storage.from(DNESKAI_AUDIO_BUCKET);
  const name = objectName(owner, input.uploadId, input.contentType);
  const downloaded = await files.download(name);
  if (downloaded.error || !downloaded.data) throw new DneskaiAudioError("audio-upload-missing");
  const bytes = Buffer.from(await downloaded.data.arrayBuffer());
  const discard = async (code: DneskaiAudioErrorCode): Promise<never> => { await files.remove([name]).catch(() => undefined); throw new DneskaiAudioError(code); };
  if (!bytes.length || bytes.length > DNESKAI_AUDIO_MAX_BYTES) return discard("audio-upload-invalid");
  const durationMs = await (options.probe ?? probeDneskaiAudioDuration)(bytes).catch(() => null);
  if (durationMs === null || durationMs < 1000 || durationMs > 900000) return discard("audio-upload-invalid");
  const { error } = await db.from("marketing_audio_tracks").insert({
    id: input.uploadId, user_id: owner, title: input.title, artist: input.artist, source: input.source, licence_note: input.licenceNote,
    source_url: input.sourceUrl, storage_path: `${DNESKAI_AUDIO_BUCKET}/${name}`, duration_ms: durationMs, mood: [...new Set(input.mood)], enabled: true,
  });
  if (error) return discard("audio-track-write-failed");
  const track = (await listDneskaiAudioTracks(db, owner, input.uploadId)).find((item) => item.id === input.uploadId);
  if (!track) throw new DneskaiAudioError("audio-track-write-failed");
  return track;
}

export async function setDneskaiAudioTrackEnabled(db: Database, owner: string, id: string, enabled: boolean): Promise<void> {
  z.uuid().parse(owner);
  const { data, error } = await db.from("marketing_audio_tracks").update({ enabled, updated_at: new Date().toISOString() }).eq("user_id", owner).eq("id", id).select("id");
  if (error) throw new DneskaiAudioError("audio-track-write-failed");
  if (!data?.length) throw new DneskaiAudioError("audio-track-unavailable");
}

/** The stored bytes of one track for the renderer; a track chosen at approval stays usable even if switched off later. */
export async function loadDneskaiAudioTrack(db: Database, owner: string, trackId: string): Promise<DneskaiReelAudio> {
  z.uuid().parse(owner);
  if (!z.uuid().safeParse(trackId).success) throw new DneskaiAudioError("audio-track-unavailable");
  const { data, error } = await db.from("marketing_audio_tracks").select("id,storage_path").eq("user_id", owner).eq("id", trackId).maybeSingle();
  const name = objectFromPath(owner, (data as { storage_path: string | null } | null)?.storage_path ?? null);
  if (error || !data || !name) throw new DneskaiAudioError("audio-track-unavailable");
  const downloaded = await db.storage.from(DNESKAI_AUDIO_BUCKET).download(name);
  if (downloaded.error || !downloaded.data) throw new DneskaiAudioError("audio-track-unavailable");
  return { id: trackId, bytes: Buffer.from(await downloaded.data.arrayBuffer()) };
}

/** The track rotation picks after `previousId` among the owner's enabled stored tracks, or null for an empty library. */
export async function nextDneskaiAudioTrackId(db: Database, owner: string, previousId: string | null): Promise<string | null> {
  z.uuid().parse(owner);
  const eligible = () => db.from("marketing_audio_tracks").select("id,created_at").eq("user_id", owner)
    .eq("enabled", true).neq("source", "instagram-library").not("storage_path", "is", null);
  // Read the predecessor separately, even if it was disabled after the last publication.
  if (previousId && z.uuid().safeParse(previousId).success) {
    const previous = await db.from("marketing_audio_tracks").select("id,created_at").eq("user_id", owner).eq("id", previousId).maybeSingle();
    if (previous.error) throw new DneskaiAudioError("audio-library-unavailable");
    const at = z.iso.datetime({ offset: true }).safeParse(previous.data?.created_at);
    if (at.success) {
      const next = await eligible().or(`created_at.gt.${at.data},and(created_at.eq.${at.data},id.gt.${previousId})`)
        .order("created_at", { ascending: true }).order("id", { ascending: true }).limit(1).maybeSingle();
      if (next.error) throw new DneskaiAudioError("audio-library-unavailable");
      if (next.data) return next.data.id;
    }
  }
  const first = await eligible().order("created_at", { ascending: true }).order("id", { ascending: true }).limit(1).maybeSingle();
  if (first.error) throw new DneskaiAudioError("audio-library-unavailable");
  return first.data?.id ?? null;
}
