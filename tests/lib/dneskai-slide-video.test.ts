import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { DNESKAI_SLIDE_VIDEO, dneskaiSlideVideoFfmpegArgs, dneskaiSlideVideoKey, dneskaiVideoSlideIndexes } from "@/lib/marketing/dneskai-slide-video";
import { prepareDneskaiSlideVideos } from "@/lib/marketing/dneskai-slide-videos";
import { dneskaiClosingSlide } from "@/lib/marketing/dneskai-closing";
import type { DneskaiDeck } from "@/lib/marketing/dneskai-slides";

const sha = "a".repeat(64);
const photo = (headline: string) => ({ type: "figure" as const, headline, images: [{ slot: "image-1", assetSha256: sha }], alt: "Popis." });
const deck = (kit: DneskaiDeck["kit"]): DneskaiDeck => ({ schemaVersion: "dneskai-slides/1", format: "carousel", kit,
  slides: [{ type: "cover-photo", headline: "Titulek", images: [{ slot: "image-1", assetSha256: sha }], alt: "Titulní." }, photo("Druhý"), { type: "statement", variant: "accent", headline: "Jen text", images: [], alt: "Text." }, photo("Čtvrtý"), dneskaiClosingSlide()] });

describe("video-first slides (8 November 2026)", () => {
  it("makes a clip of every slide with a picture in a video-first carousel, and none in another kit", () => {
    expect(dneskaiVideoSlideIndexes(deck("videofirst"))).toEqual([0, 1, 3, 4]);
    expect(dneskaiVideoSlideIndexes(deck("plakat"))).toEqual([]);
  });

  it("encodes a 4:5 H.264 clip that opens blurred and reveals the slide, with a silent track and moov first", () => {
    const args = dneskaiSlideVideoFfmpegArgs({ dir: "/tmp/x", output: "/tmp/x/slide.mp4" });
    const filter = args[args.indexOf("-filter_complex") + 1]!;
    expect(filter).toContain(`s=${DNESKAI_SLIDE_VIDEO.width}x${DNESKAI_SLIDE_VIDEO.height}`);
    expect(filter).toContain(`xfade=transition=fade:duration=${DNESKAI_SLIDE_VIDEO.revealSeconds}:offset=${DNESKAI_SLIDE_VIDEO.revealAt}`);
    expect(args).toEqual(expect.arrayContaining(["libx264", "+faststart", "aac", String(DNESKAI_SLIDE_VIDEO.seconds)]));
    expect(DNESKAI_SLIDE_VIDEO.seconds).toBeGreaterThanOrEqual(3);
  });

  it("keys a clip by the approved revision and slide", () => {
    expect(dneskaiSlideVideoKey({ revisionHash: sha, index: 1 })).not.toBe(dneskaiSlideVideoKey({ revisionHash: sha, index: 3 }));
    expect(() => dneskaiSlideVideoKey({ revisionHash: "x", index: 1 })).toThrow();
  });

  it("reuses stored clips, makes at most two per run and holds the post until all are stored; off, it does nothing", async () => {
    const stored = new Map<string, { url: string; sha256: string; bytes: number }>();
    const storage = {
      find: vi.fn(async (key: string) => stored.get(key) ? { reelKey: key, ...stored.get(key)! } : null),
      put: vi.fn(async ({ reelKey, bytes }: { reelKey: string; bytes: Buffer }) => { const entry = { url: `https://store.example/${reelKey}.mp4`, sha256: sha, bytes: bytes.length }; stored.set(reelKey, entry); return { reelKey, ...entry }; }),
    };
    const render = vi.fn(async () => ({ bytes: Buffer.from("mp4"), sha256: sha, seconds: 5.5 }));
    const row = { id: "11111111-1111-4111-8111-111111111111", content_hash: sha, revision: { deck: deck("videofirst") } as never,
      render_report: { schemaVersion: "dneskai-render-report/1", status: "rendered", renderKeys: Array.from({ length: 5 }, (_, n) => String(n).repeat(64)), problems: [], renderedAt: "2026-11-08T12:00:00.000Z" } as never };
    const on = { MARKETING_DNESKAI_SLIDE_VIDEOS_ENABLED: "true" };
    const options = { storage: storage as never, render, loadSlide: async () => Buffer.from("jpg"), env: on };
    expect(await prepareDneskaiSlideVideos({} as never, "u", row, { dryRun: false, ...options, env: {} })).toEqual({ videos: null, hold: null });
    expect(await prepareDneskaiSlideVideos({} as never, "u", row, { dryRun: false, ...options })).toEqual({ videos: null, hold: "slide-videos-pending" });
    expect(render).toHaveBeenCalledTimes(2);
    const done = await prepareDneskaiSlideVideos({} as never, "u", row, { dryRun: false, ...options });
    expect(render).toHaveBeenCalledTimes(4);
    expect(Object.keys(done.videos ?? {})).toEqual(["0", "1", "3", "4"]);
    expect(done.hold).toBeNull();
    // A dry run never renders; it only reports what is stored.
    expect((await prepareDneskaiSlideVideos({} as never, "u", row, { dryRun: true, ...options })).hold).toBeNull();
    expect(render).toHaveBeenCalledTimes(4);
  });
});
