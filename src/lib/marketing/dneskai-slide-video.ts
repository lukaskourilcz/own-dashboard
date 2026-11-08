import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { canonicalJson } from "./contracts";
import { dneskaiFfmpegPath } from "./dneskai-reel-render";
import type { DneskaiDeck } from "./dneskai-slides";

/**
 * Video-first slides (owner decision, 8 November 2026): in a `videofirst` carousel every slide with a photograph goes
 * out as a short video item of the carousel, made with ffmpeg from the approved slide JPEG itself, so the video shows
 * exactly the words and picture that were approved and needs no outside video source. The clip opens on a blurred,
 * darkened copy of the slide (the words cannot be read yet), the sharp slide fades in over it, and the whole frame
 * zooms in slowly. The text-only slide stays a picture. A carousel stays a carousel: never a Reel.
 *
 * Instagram takes carousel videos of 3 to 60 seconds at 4:5; the clip is 1080 × 1350, H.264 High, 30 fps, about
 * 6 Mbps, with a silent AAC track, `moov` first.
 */
export const DNESKAI_SLIDE_VIDEO = {
  width: 1080,
  height: 1350,
  fps: 30,
  seconds: 5.5,
  /** When the sharp slide starts to fade in over the blurred one, and how long the fade takes. */
  revealAt: 0.4,
  revealSeconds: 0.8,
  /** 1080 / 1.06 = 1019 px stay visible at full zoom, so the kits' 72 px margins keep every word whole. */
  zoomTo: 1.06,
  videoBitrate: "6M",
  audioRate: 48_000,
  gop: 60,
} as const;
export const DNESKAI_SLIDE_VIDEO_POLICY = "dneskai-slide-video/1";

/** The slides of a deck that go out as videos: in a `videofirst` carousel, every slide that carries a picture. */
export function dneskaiVideoSlideIndexes(deck: Pick<DneskaiDeck, "kit" | "format" | "slides">): number[] {
  if (deck.kit !== "videofirst" || deck.format !== "carousel") return [];
  return deck.slides.flatMap((slide, index) => slide.images.length ? [index] : []);
}

/** One clip's identity: the approved revision's hash and the slide's place under this policy. */
export function dneskaiSlideVideoKey(input: { revisionHash: string; index: number }): string {
  if (!/^[a-f0-9]{64}$/.test(input.revisionHash) || !Number.isInteger(input.index) || input.index < 0 || input.index > 9) throw new Error("slide-video-input-invalid");
  return createHash("sha256").update(canonicalJson({ schemaVersion: "dneskai-slide-video-key/1", policy: DNESKAI_SLIDE_VIDEO_POLICY, video: DNESKAI_SLIDE_VIDEO, ...input })).digest("hex");
}

/** The ffmpeg arguments for `blur.jpg` and `sharp.jpg` in `dir`. Pure, for the tests. */
export function dneskaiSlideVideoFfmpegArgs(input: { dir: string; output: string; threads?: number }): string[] {
  const { fps, width, height, seconds, revealAt, revealSeconds, zoomTo, videoBitrate, gop, audioRate } = DNESKAI_SLIDE_VIDEO;
  const frames = Math.round(seconds * fps);
  const step = ((zoomTo - 1) / Math.max(1, frames - 1)).toFixed(6);
  const zoom = `zoompan=z='min(1+${step}*on,${zoomTo})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${fps},setsar=1,format=yuv420p`;
  return [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    ...(input.threads ? ["-threads", String(input.threads)] : []),
    "-framerate", String(fps), "-loop", "1", "-t", String(seconds), "-i", path.join(input.dir, "blur.jpg"),
    "-framerate", String(fps), "-loop", "1", "-t", String(seconds), "-i", path.join(input.dir, "sharp.jpg"),
    "-f", "lavfi", "-t", String(seconds), "-i", `anullsrc=r=${audioRate}:cl=stereo`,
    "-filter_complex", `[0:v]${zoom}[a];[1:v]${zoom}[b];[a][b]xfade=transition=fade:duration=${revealSeconds}:offset=${revealAt}[v]`,
    "-map", "[v]", "-map", "2:a",
    "-c:v", "libx264", "-profile:v", "high", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-r", String(fps),
    "-g", String(gop), "-keyint_min", String(gop), "-sc_threshold", "0",
    "-b:v", videoBitrate, "-maxrate", videoBitrate, "-bufsize", "12M",
    "-c:a", "aac", "-b:a", "64k", "-ar", String(audioRate), "-ac", "2",
    "-movflags", "+faststart", "-t", String(seconds), input.output,
  ];
}

function run(binary: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("slide-video-timeout")); return; }
    const child = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2000); });
    const abort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", () => { signal?.removeEventListener("abort", abort); reject(new Error("slide-video-ffmpeg-unavailable")); });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (code === 0) resolve();
      else { console.warn(JSON.stringify({ event: "dneskai-slide-video-failed", code, stderr: stderr.slice(-600) })); reject(new Error(signal?.aborted ? "slide-video-timeout" : "slide-video-encode-failed")); }
    });
  });
}

/** One slide's clip from its approved JPEG. Nothing is stored. */
export async function renderDneskaiSlideVideo(input: { slide: Buffer; signal?: AbortSignal; ffmpegPath?: string; threads?: number }): Promise<{ bytes: Buffer; sha256: string; seconds: number }> {
  if (!Buffer.isBuffer(input.slide) || !input.slide.length) throw new Error("slide-video-input-invalid");
  const sharp = (await import("sharp")).default;
  const { width, height } = DNESKAI_SLIDE_VIDEO;
  const binary = input.ffmpegPath ?? await dneskaiFfmpegPath();
  const dir = await mkdtemp(path.join(tmpdir(), "dneskai-slide-video-"));
  try {
    const [blur, sharpSlide] = await Promise.all([
      sharp(input.slide).resize(width, height, { fit: "cover" }).blur(28).modulate({ brightness: 0.7 }).jpeg({ quality: 92 }).toBuffer(),
      sharp(input.slide).resize(width, height, { fit: "cover" }).jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer(),
    ]);
    await Promise.all([writeFile(path.join(dir, "blur.jpg"), blur), writeFile(path.join(dir, "sharp.jpg"), sharpSlide)]);
    const output = path.join(dir, "slide.mp4");
    await run(binary, dneskaiSlideVideoFfmpegArgs({ dir, output, threads: input.threads }), input.signal);
    const bytes = await readFile(output);
    if (!bytes.length) throw new Error("slide-video-encode-failed");
    return { bytes, sha256: createHash("sha256").update(bytes).digest("hex"), seconds: DNESKAI_SLIDE_VIDEO.seconds };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
