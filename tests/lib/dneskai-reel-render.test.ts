import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import ffmpegPath from "ffmpeg-static";
import { afterAll, beforeAll, describe, expect, it,vi } from "vitest";
import {
  composeDneskaiReelFrame,DNESKAI_REEL, DneskaiReelRenderError, dneskaiReelDuration, dneskaiReelFfmpegArgs, dneskaiReelKey, renderDneskaiReel,
} from "@/lib/marketing/dneskai-reel-render";

const ffprobe = process.env.FFPROBE_PATH ?? "ffprobe";
const ffprobeAvailable = spawnSync(ffprobe, ["-version"], { stdio: "ignore" }).status === 0;
// CI installs ffprobe (ci.yml); a laptop without it skips the encode checks rather than failing.
const encodeSuite = ffprobeAvailable || process.env.CI ? describe : describe.skip;

const hash = "a".repeat(64);

describe("reel layout", () => {
  it("lasts 3.5 s per slide minus each 0.5 s crossfade", () => {
    expect(dneskaiReelDuration(1)).toBe(3.5);
    expect(dneskaiReelDuration(2)).toBe(6.5);
    expect(dneskaiReelDuration(7)).toBe(21.5);
  });

  it("keys a reel by ordered JPEG bytes, exact audio bytes and encoding policy", () => {
    const slides = [hash, 'b'.repeat(64)];
    const silent = dneskaiReelKey({ slideSha256s: slides, audio: null });
    const audio = { id: '11111111-1111-4111-8111-111111111111', sha256: 'c'.repeat(64) };
    expect(silent).toMatch(/^[a-f0-9]{64}$/);
    expect(dneskaiReelKey({ slideSha256s: [...slides], audio: null })).toBe(silent);
    expect(dneskaiReelKey({ slideSha256s: [...slides].reverse(), audio: null })).not.toBe(silent);
    expect(dneskaiReelKey({ slideSha256s: [hash], audio: null })).not.toBe(silent);
    const audible = dneskaiReelKey({ slideSha256s: slides, audio });
    expect(audible).not.toBe(silent);
    expect(dneskaiReelKey({ slideSha256s: slides, audio: { ...audio, sha256: 'd'.repeat(64) } })).not.toBe(audible);
    expect(() => dneskaiReelKey({ slideSha256s: ['nope'], audio: null })).toThrow(DneskaiReelRenderError);
    expect(() => dneskaiReelKey({ slideSha256s: [], audio: null })).toThrow(DneskaiReelRenderError);
    expect(() => dneskaiReelKey({ slideSha256s: Array(11).fill(hash), audio: null })).toThrow(DneskaiReelRenderError);
    expect(() => dneskaiReelKey({ slideSha256s: slides, audio: { ...audio, id: '../x' } })).toThrow(DneskaiReelRenderError);
    expect(() => dneskaiReelKey({ slideSha256s: slides, audio: { ...audio, sha256: 'nope' } })).toThrow(DneskaiReelRenderError);
  });

  it("crossfades each slide into the next at 3 s steps and encodes to the Reels spec", () => {
    const args = dneskaiReelFfmpegArgs({ dir: "/tmp/r", slideCount: 3, audioFile: null, output: "/tmp/r/out.mp4" });
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(graph).toContain("xfade=transition=fade:duration=0.5:offset=3.000");
    expect(graph).toContain("xfade=transition=fade:duration=0.5:offset=6.000");
    expect(graph).toContain("zoompan=");
    expect(graph).toContain("afade=t=out:st=7.500:d=2");
    expect(args).toEqual(expect.arrayContaining(["anullsrc=r=48000:cl=stereo", "+faststart", "-shortest", "libx264", "high", "yuv420p", "+cgop", "aac", "128k"]));
    expect(args.slice(args.indexOf("-g"), args.indexOf("-g") + 2)).toEqual(["-g", "60"]);
  });

  it("refuses an empty deck, too many slides and an unsafe audio id", async () => {
    await expect(renderDneskaiReel({ slides: [], audio: null, ffmpegPath: "/bin/false" })).rejects.toMatchObject({ code: "reel-input-invalid" });
    await expect(renderDneskaiReel({ slides: Array.from({ length: 11 }, () => Buffer.from("x")), audio: null, ffmpegPath: "/bin/false" })).rejects.toMatchObject({ code: "reel-input-invalid" });
    await expect(renderDneskaiReel({ slides: [Buffer.from("x")], audio: { id: "a/b", bytes: Buffer.from("x") }, ffmpegPath: "/bin/false" })).rejects.toMatchObject({ code: "reel-input-invalid" });
  });

  it("reports a missing ffmpeg as unavailable", async () => {
    const slide = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#2050e0" } }).jpeg().toBuffer();
    await expect(renderDneskaiReel({ slides: [slide], audio: null, ffmpegPath: "/nonexistent/ffmpeg" })).rejects.toMatchObject({ code: "reel-ffmpeg-unavailable" });
  });
});

type Probe = { streams: Array<Record<string, string | number>>; format: { duration: string; format_name: string } };
function probe(file: string): Probe {
  return JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file]).toString()) as Probe;
}
/** Top-level MP4 boxes in order. */
function topLevelBoxes(bytes: Buffer): string[] {
  const boxes: string[] = [];
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    let size = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    if (size === 1) size = Number(bytes.readBigUInt64BE(offset + 8));
    if (size < 8) break;
    boxes.push(type);
    offset += size;
  }
  return boxes;
}

encodeSuite("renderDneskaiReel with ffmpeg-static", () => {
  let dir: string;
  let slides: Buffer[];
  let audio: Buffer;
  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "reel-test-"));
    slides = await Promise.all(["#2050e0", "#f2efe8"].map((background) => sharp({ create: { width: 1080, height: 1350, channels: 3, background } }).jpeg({ quality: 92 }).toBuffer()));
    // Three seconds of tone, shorter than the video, so the track must loop and fade.
    const audioFile = path.join(dir, "tone.m4a");
    execFileSync(ffmpegPath as unknown as string, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:a", "aac", audioFile]);
    audio = readFileSync(audioFile);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  for (const withAudio of [true, false]) {
    it(`renders two slides ${withAudio ? "with a looped track" : "silent"} as a 1080 × 1920 H.264/AAC MP4 with moov first`, async () => {
      const result = await renderDneskaiReel({ slides, audio: withAudio ? { id: "11111111-1111-4111-8111-111111111111", bytes: audio } : null });
      expect(result.silent).toBe(!withAudio);
      const file = path.join(dir, `reel-${withAudio}.mp4`);
      writeFileSync(file, result.bytes);
      const info = probe(file);
      expect(info.format.format_name).toContain("mp4");
      const video = info.streams.find((stream) => stream.codec_type === "video")!;
      const sound = info.streams.find((stream) => stream.codec_type === "audio")!;
      expect(video).toMatchObject({ codec_name: "h264", profile: "High", pix_fmt: "yuv420p", width: DNESKAI_REEL.width, height: DNESKAI_REEL.height, r_frame_rate: "30/1" });
      expect(sound).toMatchObject({ codec_name: "aac", sample_rate: "48000", channels: 2 });
      expect(Math.abs(Number(info.format.duration) - dneskaiReelDuration(2))).toBeLessThanOrEqual(0.2);
      const boxes = topLevelBoxes(result.bytes);
      expect(boxes.indexOf("moov")).toBeGreaterThanOrEqual(0);
      expect(boxes.indexOf("moov")).toBeLessThan(boxes.indexOf("mdat"));
    }, 60_000);
  }
});

it.each([{width:1080,height:1350,format:'png'},{width:100,height:100,format:'jpeg'},{width:2160,height:2700,format:'jpeg'}] as const)('refuses a frame outside the approved JPEG canvas: %#',async({width,height,format})=>{const slide=await sharp({create:{width,height,channels:3,background:'#2050e0'}}).toFormat(format).toBuffer();await expect(composeDneskaiReelFrame(slide)).rejects.toMatchObject({code:'reel-compose-failed',message:'reel-compose-failed'});});

it('refuses an oversized JPEG buffer before native decoding',async()=>{await expect(composeDneskaiReelFrame(Buffer.alloc(8*1024*1024+1))).rejects.toHaveProperty('code','reel-compose-failed');});
it('retires native input before decoder or encoder work starts',async()=>{const scope=new AbortController();scope.abort('TEST_ONLY_PRIVATE_REASON');await expect(composeDneskaiReelFrame(Buffer.from('fixture'),scope.signal)).rejects.toMatchObject({code:'reel-timeout',message:'reel-timeout'});await expect(renderDneskaiReel({slides:[Buffer.from('fixture')],audio:null,signal:scope.signal,ffmpegPath:process.execPath})).rejects.toMatchObject({code:'reel-timeout',message:'reel-timeout'});});

it('keeps native failure diagnostics to a fixed event and exit status',async()=>{const slide=await sharp({create:{width:1080,height:1350,channels:3,background:'#2050e0'}}).jpeg().toBuffer(),warning=vi.spyOn(console,'warn').mockImplementation(()=>{});try{await expect(renderDneskaiReel({slides:[slide],audio:null,ffmpegPath:process.execPath})).rejects.toHaveProperty('code','reel-encode-failed');expect(warning.mock.calls.map(([line])=>JSON.parse(String(line)))).toEqual([{event:'dneskai-reel-ffmpeg-failed',code:expect.any(Number)}]);}finally{warning.mockRestore();}});
