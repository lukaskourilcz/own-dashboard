import {awaitWithSignal} from "@/lib/abortable";
import {DNESKAI_AUDIO_MAX_BYTES} from "./dneskai-audio-contracts";
import {DNESKAI_REEL_MAX_BYTES} from "./dneskai-reel-format";
import {DNESKAI_SLIDE_JPEG} from "./dneskai-slide-format";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, open,rm, writeFile } from "node:fs/promises";
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
  decoderThreads: 1,
  filterThreads: 1,
  encoderThreads: 2,
} as const;

/** OwnDashboard's encoding settings above. Part of every reel key: bump on any change so old renders are not reused. */
export const DNESKAI_REEL_POLICY = "dneskai-reel/2";

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
export async function composeDneskaiReelFrame(slide: Buffer, parent?: AbortSignal): Promise<Buffer> {
    const signal = AbortSignal.any([AbortSignal.timeout(30000), ...(parent ? [parent] : [])]);
    try {
        signal.throwIfAborted();
        if (!Buffer.isBuffer(slide) || !slide.length || slide.length > DNESKAI_SLIDE_JPEG.maxBytes)
            throw new Error();
        const sharp = (await awaitWithSignal(import('sharp'), signal)).default;
        signal.throwIfAborted();
        const options = { limitInputPixels: DNESKAI_SLIDE_JPEG.width * DNESKAI_SLIDE_JPEG.height, limitInputChannels: 3, failOn: 'warning' as const };
        const meta = await awaitWithSignal(sharp(slide, options).metadata(), signal);
        signal.throwIfAborted();
        if (meta.format !== 'jpeg' || meta.width !== DNESKAI_SLIDE_JPEG.width || meta.height !== DNESKAI_SLIDE_JPEG.height || meta.orientation !== undefined && meta.orientation !== 1)
            throw new Error();
        const { width, height, slideWidth } = DNESKAI_REEL, slideHeight = Math.round(slideWidth * meta.height / meta.width / 2) * 2;
        const [background, foreground] = await awaitWithSignal(Promise.all([
            sharp(slide, options).resize(width, height, { fit: 'cover' }).blur(36).modulate({ brightness: 0.62 }).toColourspace('srgb').timeout({ seconds: 15 }).toBuffer(),
            sharp(slide, options).resize(slideWidth, slideHeight, { fit: 'fill' }).toColourspace('srgb').timeout({ seconds: 15 }).toBuffer(),
        ]), signal);
        signal.throwIfAborted();
        const frame = await awaitWithSignal(sharp(background, { limitInputPixels: width * height, limitInputChannels: 3, failOn: 'warning' }).composite([{ input: foreground, gravity: 'center' }]).jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).timeout({ seconds: 15 }).toBuffer(), signal);
        signal.throwIfAborted();
        if (!frame.length || frame.length > DNESKAI_SLIDE_JPEG.maxBytes)
            throw new Error();
        return frame;
    }
    catch {
        throw new DneskaiReelRenderError(signal.aborted ? 'reel-timeout' : 'reel-compose-failed');
    }
}

/** The ffmpeg arguments for frames `frame-<i>.jpg` and an optional `audio` file in `dir`. Pure, for the tests. */
export function dneskaiReelFfmpegArgs(input: { dir: string; slideCount: number; audioFile: string | null; output: string; }): string[] {
  const { fps, width, height, slideSeconds, crossfadeSeconds, zoomTo, audioFadeSeconds } = DNESKAI_REEL;
  const count = input.slideCount;
  const total = dneskaiReelDuration(count);
  const framesPerSlide = Math.round(slideSeconds * fps);
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-filter_complex_threads", String(DNESKAI_REEL.filterThreads)];
  for (let index = 0; index < count; index++) {
    args.push("-framerate", String(fps), "-loop", "1", "-t", String(slideSeconds), "-threads:v", String(DNESKAI_REEL.decoderThreads), "-i", path.join(input.dir, `frame-${index}.jpg`));
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
    "-c:v", "libx264", "-threads:v", String(DNESKAI_REEL.encoderThreads), "-profile:v", "high", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-r", String(fps),
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
    try { child = spawn(binary, args, { stdio: ["ignore", "ignore", "ignore"] }); }
    catch { reject(new DneskaiReelRenderError("reel-ffmpeg-unavailable")); return; }
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
        console.warn(JSON.stringify({ event: "dneskai-reel-ffmpeg-failed", code }));
        reject(new DneskaiReelRenderError("reel-encode-failed"));
      }
    });
  });
}

/** Read only a confirmed regular output into one bounded Buffer, including a final EOF/size check. */
async function readDneskaiReelOutput(file: string, signal: AbortSignal): Promise<Buffer> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
        signal.throwIfAborted();
        const pending = open(file, 'r');
        void pending.then(value => {
            if (signal.aborted)
                void value.close().catch(() => undefined);
        }, () => undefined);
        handle = await awaitWithSignal(pending, signal);
        signal.throwIfAborted();
        const info = await awaitWithSignal(handle.stat(), signal);
        signal.throwIfAborted();
        if (!info.isFile() || !Number.isSafeInteger(info.size) || info.size < 1 || info.size > DNESKAI_REEL_MAX_BYTES)
            throw new Error();
        const bytes = Buffer.alloc(info.size);
        let offset = 0;
        while (offset < bytes.length) {
            signal.throwIfAborted();
            const result = await awaitWithSignal(handle.read(bytes, offset, Math.min(1024 * 1024, bytes.length - offset), offset), signal);
            signal.throwIfAborted();
            if (result.bytesRead < 1)
                throw new Error();
            offset += result.bytesRead;
        }
        const extra = await awaitWithSignal(handle.read(Buffer.alloc(1), 0, 1, bytes.length), signal), after = await awaitWithSignal(handle.stat(), signal);
        signal.throwIfAborted();
        if (extra.bytesRead !== 0 || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs)
            throw new Error();
        const closing = handle.close();
        handle = undefined;
        await awaitWithSignal(closing, signal);
        signal.throwIfAborted();
        return bytes;
    }
    catch {
        throw new DneskaiReelRenderError(signal.aborted ? 'reel-timeout' : 'reel-encode-failed');
    }
    finally {
        if (handle)
            void handle.close().catch(() => undefined);
    }
}

/** Renders the reel in a temporary directory and returns the MP4 bytes. Nothing is stored. */
export async function renderDneskaiReel(input: DneskaiReelInput): Promise<DneskaiReelResult> {
    const signal = AbortSignal.any([AbortSignal.timeout(280000), ...(input.signal ? [input.signal] : [])]);
    if (signal.aborted)
        throw new DneskaiReelRenderError('reel-timeout');
    const count = input.slides.length;
    if (count < 1 || count > DNESKAI_REEL.maxSlides || input.slides.some((slide) => !Buffer.isBuffer(slide) || !slide.length || slide.length > DNESKAI_SLIDE_JPEG.maxBytes)
        || (input.audio && (!Buffer.isBuffer(input.audio.bytes) || !input.audio.bytes.length || input.audio.bytes.length > DNESKAI_AUDIO_MAX_BYTES || !/^[A-Za-z0-9-]{1,64}$/.test(input.audio.id))))
        throw new DneskaiReelRenderError("reel-input-invalid");
    const binary = input.ffmpegPath ?? await dneskaiFfmpegPath();
    if (signal.aborted)
        throw new DneskaiReelRenderError('reel-timeout');
    const dir = await mkdtemp(path.join(tmpdir(), "dneskai-reel-"));
    try {
        for (let index = 0; index < count; index++) {
            if (signal.aborted)
                throw new DneskaiReelRenderError('reel-timeout');
            const frame = await composeDneskaiReelFrame(input.slides[index]!, signal);
            if (signal.aborted)
                throw new DneskaiReelRenderError('reel-timeout');
            await writeFile(path.join(dir, `frame-${index}.jpg`), frame, { signal });
        }
        if (signal.aborted)
            throw new DneskaiReelRenderError('reel-timeout');
        const audioFile = input.audio ? path.join(dir, "audio") : null;
        if (input.audio && audioFile)
            await writeFile(audioFile, input.audio.bytes, { signal });
        if (signal.aborted)
            throw new DneskaiReelRenderError('reel-timeout');
        const output = path.join(dir, "reel.mp4");
        await runFfmpeg(binary, dneskaiReelFfmpegArgs({ dir, slideCount: count, audioFile, output }), signal);
        if (signal.aborted)
            throw new DneskaiReelRenderError('reel-timeout');
        const bytes = await readDneskaiReelOutput(output, signal);
        if (signal.aborted)
            throw new DneskaiReelRenderError('reel-timeout');
        if (!bytes.length)
            throw new DneskaiReelRenderError("reel-encode-failed");
        return { bytes, sha256: sha256(bytes), durationSeconds: dneskaiReelDuration(count), slideCount: count, silent: !input.audio };
    }
    finally {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
}
