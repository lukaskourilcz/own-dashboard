import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { canonicalJson } from "./contracts";

/**
 * DNESKAi Reels (#163, plan C1): the approved 1080 × 1350 slide JPEGs of a post become one 1080 × 1920 MP4 that
 * Instagram accepts as a Reel.
 *
 * Each slide is set centred, at 94 % of the frame width, over a blurred and darkened copy of itself that fills the
 * frame (sharp builds that still). ffmpeg then gives every still a gentle zoom (`zoompan`, 1.00 to 1.06 over the
 * slide; at 1.06 the visible width is still wider than the slide, so the zoom never cuts slide text), joins the
 * stills with a 0.5 s crossfade (`xfade`) and adds the audio: looped if shorter, cut at the video's end with a 2 s
 * fade-out. A post without a track gets a silent stereo track instead, for C5, where Instagram lays its own audio
 * over a silent video.
 *
 * Encoding follows Instagram's Reels spec: H.264 High, yuv420p, 30 fps, closed GOP of 60 frames, about 8 Mbps;
 * AAC 128 kbps at 48 kHz stereo; `moov` before `mdat` (`+faststart`) so the Graph API's cURL fetch can stream it.
 */

export const DNESKAI_REEL = {
  width: 1080,
  height: 1920,
  fps: 30,
  slideSeconds: 3.5,
  crossfadeSeconds: 0.5,
  zoomTo: 1.06,
  /** The slide's width inside the frame. 1080 / 1.06 = 1019 px stay visible at full zoom, so 1016 px is never cut. */
  slideWidth: 1016,
  audioFadeSeconds: 2,
  videoBitrate: "8M",
  audioBitrate: "128k",
  audioRate: 48000,
  gop: 60,
  maxSlides: 10,
} as const;

/** OwnDashboard's encoding settings above. Part of every reel key: bump on any change so old renders are not reused. */
export const DNESKAI_REEL_POLICY = "dneskai-reel/1";

export const DNESKAI_REEL_FAILURE_CODES = ["reel-input-invalid", "reel-ffmpeg-unavailable", "reel-compose-failed", "reel-encode-failed", "reel-timeout"] as const;
export type DneskaiReelFailureCode = typeof DNESKAI_REEL_FAILURE_CODES[number];
export class DneskaiReelRenderError extends Error {
  constructor(readonly code: DneskaiReelFailureCode) { super(code); this.name = "DneskaiReelRenderError"; }
}

export type DneskaiReelAudio = {
  /** The library track's id (`marketing_audio_tracks.id`); part of the reel key. */
  id: string;
  bytes: Buffer;
};

export type DneskaiReelInput = {
  /** The approved slide JPEGs in slide order. */
  slides: Buffer[];
  /** null renders the silent variant. */
  audio: DneskaiReelAudio | null;
  signal?: AbortSignal;
  /** The ffmpeg binary; defaults to `ffmpeg-static`. */
  ffmpegPath?: string;
  /** ffmpeg worker threads; 0 lets ffmpeg choose. */
  threads?: number;
};

export type DneskaiReelResult = { bytes: Buffer; sha256: string; durationSeconds: number; slideCount: number; silent: boolean };

/** Seconds of video for a deck: every slide shows 3.5 s and each crossfade overlaps two slides by 0.5 s. */
export function dneskaiReelDuration(slideCount: number): number {
  return Math.round((slideCount * DNESKAI_REEL.slideSeconds - Math.max(0, slideCount - 1) * DNESKAI_REEL.crossfadeSeconds) * 1000) / 1000;
}

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

/**
 * Physical MP4 identity: ordered JPEG hashes, exact audio bytes (or silence) and encoding policy.
 * Caption, schedule, alt text and approval belong to the revision record, not to the encoded media.
 */
export function dneskaiReelKey(input: { slideSha256s: readonly string[]; audio: { id: string; sha256: string } | null }): string {
  const hash = /^[a-f0-9]{64}$/;
  if (!input.slideSha256s.length || input.slideSha256s.length > DNESKAI_REEL.maxSlides || input.slideSha256s.some(value => !hash.test(value))
    || (input.audio && (!/^[A-Za-z0-9-]{1,64}$/.test(input.audio.id) || !hash.test(input.audio.sha256)))) throw new DneskaiReelRenderError("reel-input-invalid");
  return sha256(canonicalJson({ schemaVersion: "dneskai-reel-key/2", policy: DNESKAI_REEL_POLICY, reel: DNESKAI_REEL, slides: input.slideSha256s, audio: input.audio ?? "silent" }));
}

/** The ffmpeg-static executable, or `reel-ffmpeg-unavailable`. */
export async function dneskaiFfmpegPath(): Promise<string> {
  try {
    const found = (await import("ffmpeg-static")).default as unknown;
    if (typeof found === "string" && found) return found;
  } catch { /* reported below */ }
  throw new DneskaiReelRenderError("reel-ffmpeg-unavailable");
}

/** One frame of the reel for a slide: the blurred, darkened slide filling 1080 × 1920 with the sharp slide centred on it. */
export async function composeDneskaiReelFrame(slide: Buffer): Promise<Buffer> {
  let sharp;
  try { sharp = (await import("sharp")).default; }
  catch { throw new DneskaiReelRenderError("reel-compose-failed"); }
  try {
    const { width, height, slideWidth } = { ...DNESKAI_REEL };
    const meta = await sharp(slide).metadata();
    if (!meta.width || !meta.height) throw new Error("no-size");
    const slideHeight = Math.round(slideWidth * meta.height / meta.width / 2) * 2;
    const [background, foreground] = await Promise.all([
      sharp(slide).resize(width, height, { fit: "cover" }).blur(36).modulate({ brightness: 0.62 }).toColourspace("srgb").toBuffer(),
      sharp(slide).resize(slideWidth, slideHeight, { fit: "fill" }).toColourspace("srgb").toBuffer(),
    ]);
    return await sharp(background).composite([{ input: foreground, gravity: "center" }]).jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer();
  } catch { throw new DneskaiReelRenderError("reel-compose-failed"); }
}

/** The ffmpeg arguments for frames `frame-<i>.jpg` and an optional `audio` file in `dir`. Pure, for the tests. */
export function dneskaiReelFfmpegArgs(input: { dir: string; slideCount: number; audioFile: string | null; output: string; threads?: number }): string[] {
  const { fps, width, height, slideSeconds, crossfadeSeconds, zoomTo, audioFadeSeconds } = DNESKAI_REEL;
  const count = input.slideCount;
  const total = dneskaiReelDuration(count);
  const framesPerSlide = Math.round(slideSeconds * fps);
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y"];
  if (input.threads) args.push("-threads", String(input.threads));
  for (let index = 0; index < count; index++) {
    args.push("-framerate", String(fps), "-loop", "1", "-t", String(slideSeconds), "-i", path.join(input.dir, `frame-${index}.jpg`));
  }
  if (input.audioFile) args.push("-stream_loop", "-1", "-i", input.audioFile);
  else args.push("-f", "lavfi", "-t", String(total), "-i", `anullsrc=r=${DNESKAI_REEL.audioRate}:cl=stereo`);

  const filters: string[] = [];
  const step = (zoomTo - 1) / Math.max(1, framesPerSlide - 1);
  for (let index = 0; index < count; index++) {
    filters.push(`[${index}:v]zoompan=z='min(1+${step.toFixed(6)}*on,${zoomTo})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${fps},setsar=1,format=yuv420p[s${index}]`);
  }
  let last = "s0";
  for (let index = 1; index < count; index++) {
    const offset = (index * (slideSeconds - crossfadeSeconds)).toFixed(3);
    const out = index === count - 1 ? "vjoined" : `x${index}`;
    filters.push(`[${last}][s${index}]xfade=transition=fade:duration=${crossfadeSeconds}:offset=${offset}[${out}]`);
    last = out;
  }
  filters.push(`[${count === 1 ? "s0" : "vjoined"}]fps=${fps},format=yuv420p[vout]`);
  const fadeStart = Math.max(0, total - audioFadeSeconds).toFixed(3);
  filters.push(`[${count}:a]atrim=0:${total},asetpts=PTS-STARTPTS,afade=t=out:st=${fadeStart}:d=${audioFadeSeconds},aresample=${DNESKAI_REEL.audioRate},aformat=sample_fmts=fltp:channel_layouts=stereo[aout]`);

  args.push(
    "-filter_complex", filters.join(";"),
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-profile:v", "high", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-r", String(fps),
    "-g", String(DNESKAI_REEL.gop), "-keyint_min", String(DNESKAI_REEL.gop), "-sc_threshold", "0", "-flags", "+cgop",
    "-b:v", DNESKAI_REEL.videoBitrate, "-maxrate", DNESKAI_REEL.videoBitrate, "-bufsize", "16M",
    "-c:a", "aac", "-b:a", DNESKAI_REEL.audioBitrate, "-ar", String(DNESKAI_REEL.audioRate), "-ac", "2",
    "-movflags", "+faststart", "-shortest", "-t", String(total),
    input.output,
  );
  return args;
}

function runFfmpeg(binary: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DneskaiReelRenderError("reel-timeout")); return; }
    let child;
    try { child = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"] }); }
    catch { reject(new DneskaiReelRenderError("reel-ffmpeg-unavailable")); return; }
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4000); });
    const abort = () => { child.kill("SIGKILL"); };
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", (error: NodeJS.ErrnoException) => {
      signal?.removeEventListener("abort", abort);
      reject(new DneskaiReelRenderError(error.code === "ENOENT" || error.code === "EACCES" ? "reel-ffmpeg-unavailable" : "reel-encode-failed"));
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) reject(new DneskaiReelRenderError("reel-timeout"));
      else if (code === 0) resolve();
      else {
        // ffmpeg's own words stay in the function log only; the caller sees a fixed code.
        console.warn(JSON.stringify({ event: "dneskai-reel-ffmpeg-failed", code, stderr: stderr.slice(-800) }));
        reject(new DneskaiReelRenderError("reel-encode-failed"));
      }
    });
  });
}

/** Renders the reel in a temporary directory and returns the MP4 bytes. Nothing is stored. */
export async function renderDneskaiReel(input: DneskaiReelInput): Promise<DneskaiReelResult> {
  const count = input.slides.length;
  if (count < 1 || count > DNESKAI_REEL.maxSlides || input.slides.some((slide) => !Buffer.isBuffer(slide) || !slide.length)
    || (input.audio && (!input.audio.bytes.length || !/^[A-Za-z0-9-]{1,64}$/.test(input.audio.id)))) throw new DneskaiReelRenderError("reel-input-invalid");
  const binary = input.ffmpegPath ?? await dneskaiFfmpegPath();
  const dir = await mkdtemp(path.join(tmpdir(), "dneskai-reel-"));
  try {
    const frames = await Promise.all(input.slides.map((slide) => composeDneskaiReelFrame(slide)));
    if (input.signal?.aborted) throw new DneskaiReelRenderError("reel-timeout");
    await Promise.all(frames.map((frame, index) => writeFile(path.join(dir, `frame-${index}.jpg`), frame)));
    const audioFile = input.audio ? path.join(dir, "audio") : null;
    if (input.audio && audioFile) await writeFile(audioFile, input.audio.bytes);
    const output = path.join(dir, "reel.mp4");
    await runFfmpeg(binary, dneskaiReelFfmpegArgs({ dir, slideCount: count, audioFile, output, threads: input.threads }), input.signal);
    const bytes = await readFile(output).catch(() => { throw new DneskaiReelRenderError("reel-encode-failed"); });
    if (!bytes.length) throw new DneskaiReelRenderError("reel-encode-failed");
    return { bytes, sha256: sha256(bytes), durationSeconds: dneskaiReelDuration(count), slideCount: count, silent: !input.audio };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
