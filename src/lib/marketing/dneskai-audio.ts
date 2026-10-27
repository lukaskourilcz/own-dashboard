import "server-only";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { awaitWithSignal } from "@/lib/abortable";
import { databaseTimestamp, databaseVersion } from "@/lib/database-version";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
  DNESKAI_AUDIO_MAX_BYTES, DNESKAI_AUDIO_TYPES, DneskaiAudioCreateSchema, DneskaiAudioTrackSchema, DneskaiAudioCursorSchema,
  type DneskaiAudioCreate, type DneskaiAudioPrepared, type DneskaiAudioTrack, type DneskaiAudioType, type DneskaiAudioCursor,
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

const TrackRowSchema = z.strictObject({
  id: z.uuid(), user_id: z.uuid(), title: DneskaiAudioTrackSchema.shape.title, artist: DneskaiAudioTrackSchema.shape.artist,
  source: DneskaiAudioTrackSchema.shape.source, licence_note: DneskaiAudioTrackSchema.shape.licenceNote,
  source_url: DneskaiAudioTrackSchema.shape.sourceUrl, storage_path: z.string().max(300).nullable(),
  instagram_audio_id: z.string().regex(/^\d{1,40}$/).nullable(), duration_ms: DneskaiAudioTrackSchema.shape.durationMs,
  mood: DneskaiAudioTrackSchema.shape.mood, enabled: z.boolean(), created_at: databaseTimestamp,
});
type TrackRow = z.infer<typeof TrackRowSchema>;
const TRACK_COLUMNS = "id,user_id,title,artist,source,licence_note,source_url,storage_path,instagram_audio_id,duration_ms,mood,enabled,created_at";
const readBudget = (parent?: AbortSignal) => AbortSignal.any([AbortSignal.timeout(15_000), ...(parent ? [parent] : [])]);
const unavailable = () => new DneskaiAudioError("audio-library-unavailable");

function objectFromPath(owner: string, storagePath: string | null, id?: string): string | null {
  if (!storagePath || !id) return null;
  const prefix = `${DNESKAI_AUDIO_BUCKET}/${owner}/${id}.`;
  return storagePath.startsWith(prefix) && /^(?:mp3|m4a|aac|wav|ogg)$/.test(storagePath.slice(prefix.length))
    ? storagePath.slice(DNESKAI_AUDIO_BUCKET.length + 1) : null;
}
function readAudioRow(owner: string, value: unknown): TrackRow {
  const parsed = TrackRowSchema.safeParse(value);
  if (!parsed.success) throw unavailable();
  const row = parsed.data;
  if (row.user_id !== owner || (row.source === "instagram-library" ? row.storage_path !== null || row.instagram_audio_id === null
    : row.source_url === null || !objectFromPath(owner, row.storage_path, row.id))) throw unavailable();
  return row;
}
function readAudioRows(owner: string, data: unknown[]): TrackRow[] {
  const rows = data.map(value => readAudioRow(owner, value));
  for (let at = 1; at < rows.length; at++) {
    const before = rows[at - 1]!, row = rows[at]!;
    const previousVersion = databaseVersion(before.created_at)!, version = databaseVersion(row.created_at)!;
    if (version < previousVersion || (version === previousVersion && row.id <= before.id)) throw unavailable();
  }
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw unavailable();
  return rows;
}

/** One validated owner page after the exact created-time/id tuple. The offset
 * counts displayed rows for continuity; the database never skips that count.
 * Exact remaining counts and a sentinel still detect truncated REST pages. */
export async function listDneskaiAudioPage(db: Database, owner: string, offset = 0, parent?: AbortSignal, after?: DneskaiAudioCursor): Promise<{ tracks: DneskaiAudioTrack[]; nextOffset: number | null; nextCursor?: DneskaiAudioCursor }> {
  z.uuid().parse(owner); z.number().int().min(0).max(1_000_000).parse(offset);
  const cursor = after === undefined ? undefined : DneskaiAudioCursorSchema.parse(after);
  if ((offset > 0) !== !!cursor) throw unavailable();
  const signal = readBudget(parent); if (signal.aborted) throw new DOMException("Request aborted", "AbortError");
  let query = db.from("marketing_audio_tracks").select(TRACK_COLUMNS, {count: "exact"}).eq("user_id", owner);
  if (cursor) query = query.or(`created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`);
  const {data, error, count} = await awaitWithSignal(query.order("created_at", {ascending: true}).order("id", {ascending: true}).range(0, 200).retry(false).abortSignal(signal), signal);
  if (error || !Array.isArray(data) || !Number.isSafeInteger(count) || count === null || count < 0 || data.length !== Math.min(201, count)) throw unavailable();
  const rows = readAudioRows(owner, data), nextOffset = rows.length > 200 ? offset + 200 : null;
  if (cursor && rows[0]) {
    const boundary = databaseVersion(cursor.createdAt)!, firstVersion = databaseVersion(rows[0].created_at)!;
    if (firstVersion < boundary || (firstVersion === boundary && rows[0].id <= cursor.id)) throw unavailable();
  }
  if (nextOffset !== null && nextOffset > 1_000_000) throw unavailable();
  const tracks = await signAudioRows(db, owner, rows.slice(0, 200), signal);
  const last = tracks.at(-1);
  return {tracks, nextOffset, ...(nextOffset !== null && last ? {nextCursor: {id: last.id, createdAt: last.createdAt}} : {})};
}

/** One owned chosen track, even off-page or disabled; confirmed absence stays distinct from a failed read. */
export async function listDneskaiAudioTracks(db: Database, owner: string, trackId?: string, parent?: AbortSignal): Promise<DneskaiAudioTrack[]> {
  if (trackId === undefined) return (await listDneskaiAudioPage(db, owner, 0, parent)).tracks;
  z.uuid().parse(owner); z.uuid().parse(trackId);
  const signal = readBudget(parent); if (signal.aborted) throw new DOMException("Request aborted", "AbortError");
  const { data, error, count } = await awaitWithSignal(db.from("marketing_audio_tracks").select(TRACK_COLUMNS, { count: "exact" }).eq("user_id", owner).eq("id", trackId).retry(false).abortSignal(signal).maybeSingle(), signal);
  if (error || count !== (data ? 1 : 0)) throw unavailable();
  const rows = data ? readAudioRows(owner, [data]) : [];
  if (rows.some(row => row.id !== trackId)) throw unavailable();
  return signAudioRows(db, owner, rows, signal);
}

async function signAudioRows(db: Database, owner: string, values: unknown[], signal?: AbortSignal): Promise<DneskaiAudioTrack[]> {
  const rows = readAudioRows(owner, values);
  const names = rows.map(row => objectFromPath(owner, row.storage_path, row.id));
  const wanted = names.filter((name): name is string => name !== null), signed = new Map<string, string | null>();
  if (wanted.length) {
    const { data: urls, error } = await awaitWithSignal(db.storage.from(DNESKAI_AUDIO_BUCKET).createSignedUrls(wanted, PREVIEW_URL_SECONDS), signal);
    if (error || !Array.isArray(urls) || urls.length !== wanted.length) throw unavailable();
    const expected = new Set(wanted);
    for (const entry of urls) {
      if (!entry || typeof entry.path !== "string" || !expected.has(entry.path) || signed.has(entry.path)) throw unavailable();
      if (typeof entry.error === "string" && entry.error.length > 0) {
        // Preserve the management row when this individual preview is unavailable.
        signed.set(entry.path, null);
      } else {
        if (entry.error != null || typeof entry.signedUrl !== "string" || !DneskaiAudioTrackSchema.shape.previewUrl.safeParse(entry.signedUrl).success) throw unavailable();
        const url = new URL(entry.signedUrl);
        if (!url.pathname.endsWith(`/object/sign/${DNESKAI_AUDIO_BUCKET}/${entry.path}`) || !url.searchParams.get("token")) throw unavailable();
        signed.set(entry.path, entry.signedUrl);
      }
    }
  }
  return rows.map((row, index) => DneskaiAudioTrackSchema.parse({
    id: row.id, title: row.title, artist: row.artist, source: row.source, licenceNote: row.licence_note, sourceUrl: row.source_url,
    durationMs: row.duration_ms, mood: row.mood, enabled: row.enabled, createdAt: row.created_at,
    previewUrl: names[index] ? signed.get(names[index]!) ?? null : null,
  }));
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
  if (!/^[ \t]*Stream #\d+:\d+[^:\r\n]*: Audio:/m.test(stderr)) return null;
  const match = /^[ \t]*Duration: (\d{2}):([0-5]\d):([0-5]\d(?:\.\d+)?)(?:,|[ \t]*$)/m.exec(stderr);
  if (!match) return null;
  return Math.round((Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000);
}

/** Probe only supported local audio containers, decoding one second under a 15s process cap. */
export const DNESKAI_AUDIO_PROBE_TIMEOUT_MS = 15_000;
export async function probeDneskaiAudioDuration(bytes: Buffer, options: { ffmpegPath?: string; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<number | null> {
  const check = () => { if (options.signal?.aborted) throw new DOMException("Request aborted", "AbortError"); };
  check();
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > DNESKAI_AUDIO_MAX_BYTES) return null;
  const timeout = options.timeoutMs ?? DNESKAI_AUDIO_PROBE_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > DNESKAI_AUDIO_PROBE_TIMEOUT_MS) throw new DneskaiAudioError("audio-library-unavailable");
  const binary = options.ffmpegPath ?? await dneskaiFfmpegPath(); check();
  const dir = await mkdtemp(path.join(tmpdir(), "dneskai-audio-"));
  try {
    const file = path.join(dir, "probe");
    await writeFile(file, bytes); check();
    return await new Promise<number | null>((resolve, reject) => {
      let output = "", failed = false;
      const child = spawn(binary, ["-hide_banner", "-nostdin", "-max_alloc", "67108864", "-threads", "1",
        "-protocol_whitelist", "file,pipe", "-format_whitelist", "aac,mp3,mov,mp4,m4a,3gp,3g2,mj2,wav,ogg",
        "-probesize", "1048576", "-analyzeduration", "5000000", "-max_streams", "8",
        "-i", file, "-map", "0:a:0", "-t", "1", "-f", "null", "-"],
      { stdio: ["ignore", "ignore", "pipe"], timeout, killSignal: "SIGKILL", signal: options.signal });
      child.stderr?.on("data", (chunk: Buffer) => { output = (output + chunk.toString()).slice(-8000); });
      // Wait for close, including after an abort/error, before removing its files.
      child.on("error", () => { failed = true; });
      child.on("close", (code, signal) => {
        if (options.signal?.aborted) reject(new DOMException("Request aborted", "AbortError"));
        else if (failed || signal) reject(new DneskaiAudioError("audio-library-unavailable"));
        else resolve(code === 0 ? parseFfmpegAudioProbe(output) : null);
      });
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** An existing upload identity may only confirm its exact captured metadata. */
async function confirmedAudioCreation(db: Database, owner: string, input: DneskaiAudioCreate, signal?: AbortSignal): Promise<DneskaiAudioTrack | null> {
  const { data, error } = await awaitWithSignal(db.from("marketing_audio_tracks").select(TRACK_COLUMNS).eq("user_id", owner).eq("id", input.uploadId).maybeSingle(), signal);
  if (error) throw new DneskaiAudioError("audio-library-unavailable");
  if (!data) return null;
  const row = data as TrackRow, wantedMood = [...new Set(input.mood)];
  if (row.id !== input.uploadId || row.title !== input.title || row.artist !== input.artist || row.source !== input.source
    || row.licence_note !== input.licenceNote || row.source_url !== input.sourceUrl
    || row.storage_path !== `${DNESKAI_AUDIO_BUCKET}/${objectName(owner, input.uploadId, input.contentType)}`
    || !Array.isArray(row.mood) || row.mood.length !== wantedMood.length || row.mood.some((tag, index) => tag !== wantedMood[index])) throw new DneskaiAudioError("audio-track-write-failed");
  const track = (await signAudioRows(db, owner, [row], signal))[0];
  if (!track) throw new DneskaiAudioError("audio-track-write-failed");
  return track;
}

/**
 * Records a decodable 1 s–15 min upload and confirms its captured metadata.
 * Identical retries preserve the stored track, including a later disable.
 * Failed requests never delete the object: another request may have committed it.
 */
export async function createDneskaiAudioTrack(db: Database, owner: string, value: DneskaiAudioCreate, options: { probe?: typeof probeDneskaiAudioDuration; signal?: AbortSignal } = {}): Promise<DneskaiAudioTrack> {
  z.uuid().parse(owner);
  const signal = options.signal;
  const check = () => { if (signal?.aborted) throw new DOMException("Request aborted", "AbortError"); };
  check();
  const input = DneskaiAudioCreateSchema.parse(value);
  const existing = await confirmedAudioCreation(db, owner, input, signal);
  check();
  if (existing) return existing;
  const files = db.storage.from(DNESKAI_AUDIO_BUCKET), name = objectName(owner, input.uploadId, input.contentType);
  const downloaded = await awaitWithSignal(files.download(name), signal);
  check();
  if (downloaded.error || !downloaded.data) throw new DneskaiAudioError("audio-upload-missing");
  if (!downloaded.data.size || downloaded.data.size > DNESKAI_AUDIO_MAX_BYTES) throw new DneskaiAudioError("audio-upload-invalid");
  const bytes = Buffer.from(await awaitWithSignal(downloaded.data.arrayBuffer(), signal));
  check();
  if (!bytes.length || bytes.length > DNESKAI_AUDIO_MAX_BYTES) throw new DneskaiAudioError("audio-upload-invalid");
  const durationMs = await awaitWithSignal((options.probe ?? probeDneskaiAudioDuration)(bytes, { signal }), signal).catch(error => {
    if (error instanceof DneskaiAudioError || (error instanceof DOMException && error.name === "AbortError")) throw error;
    throw new DneskaiAudioError("audio-library-unavailable");
  });
  check();
  if (durationMs === null || !Number.isSafeInteger(durationMs) || durationMs < 1000 || durationMs > 900000) throw new DneskaiAudioError("audio-upload-invalid");
  // A duplicate or ambiguous insert can already be the winning request. Read
  // its persisted metadata; never clean up an object on a write error.
  await awaitWithSignal(db.from("marketing_audio_tracks").insert({
    id: input.uploadId, user_id: owner, title: input.title, artist: input.artist, source: input.source, licence_note: input.licenceNote,
    source_url: input.sourceUrl, storage_path: `${DNESKAI_AUDIO_BUCKET}/${name}`, duration_ms: durationMs, mood: [...new Set(input.mood)], enabled: true,
  }), signal);
  check();
  const track = await confirmedAudioCreation(db, owner, input, signal);
  if (!track || track.durationMs !== durationMs) throw new DneskaiAudioError("audio-track-write-failed");
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
  const name = objectFromPath(owner, (data as { storage_path: string | null } | null)?.storage_path ?? null, trackId);
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
