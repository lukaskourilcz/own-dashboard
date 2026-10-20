import { createHash } from "node:crypto";
import { z } from "zod";
import type { DneskaiImageInput, DneskaiSlideInput, DneskaiSlideProblem } from "@boardlessai/carousel-studio/dneskai-slide";
import { AssetSchema, canonicalJson } from "./contracts";
import { DneskaiDeckSchema, type DneskaiDeck, type DneskaiSlide } from "./dneskai-slides";
import type { DneskaiDeckRenderResult, DneskaiRenderProblem, DneskaiRenderedAsset, LoadDneskaiMediaBytes, RenderDneskaiDeck } from "./dneskai-ports";

/**
 * DNESKAi slides through the vendored Design Lab engine (own-dashboard#117, quorum#603).
 *
 * Every slide of a deck goes to `renderDneskaiSlide` in `@boardlessai/carousel-studio`
 * (vendor/carousel-studio). This module owns no layout: it maps the slide contract to the studio
 * input, applies OwnDashboard's stricter gate, encodes the Instagram JPEG and stores it once per
 * render key in the private `marketing-assets` bucket.
 *
 * The gate is the studio's plus one rule: `text-clipped`, which the studio reports without
 * refusing, refuses here, because cut Czech copy must never ship. One blocking problem on any
 * slide refuses the whole deck and nothing is stored.
 */

/** The vendored engine. `tests/lib/carousel-studio-vendor.test.ts` ties these to vendor/carousel-studio/UPSTREAM.md. */
export const DNESKAI_STUDIO = {
  package: "@boardlessai/carousel-studio",
  version: "1.0.0",
  commit: "72b7a5e02a640e6ffcbdd50c5f21f83066004cdf",
  treeSha256: "4c144642f44cbd588e2af13f796305b42be562e6e27129d50a56cdf6b08e9829",
} as const;
/** OwnDashboard's own rules on top of the studio's: the clip gate and the JPEG below. Bump on any change to either. */
export const DNESKAI_RENDER_POLICY = "dneskai-render/1";
export const DNESKAI_RENDERER_VERSION = `carousel-studio/${DNESKAI_STUDIO.version}+${DNESKAI_STUDIO.commit.slice(0, 7)}`;
/** Instagram portrait: exactly 1080 × 1350, baseline JPEG at quality 92 without chroma subsampling, sRGB, at most 8 MiB. */
export const DNESKAI_SLIDE_JPEG = { width: 1080, height: 1350, quality: 92, chromaSubsampling: "4:4:4", maxBytes: 8 * 1024 * 1024 } as const;

export const DNESKAI_RENDER_FAILURE_CODES = ["render-input-invalid", "render-rasterizer-unavailable", "render-rasterization-failed", "render-jpeg-encoding-failed", "asset-too-large", "asset-dimensions-invalid", "asset-storage-failed", "stored-asset-hash-mismatch", "stored-asset-metadata-mismatch", "worker-timeout"] as const;
export type DneskaiRenderFailureCode = typeof DNESKAI_RENDER_FAILURE_CODES[number];
/** An infrastructure failure. Content problems are never thrown; they come back as a refused result. */
export class DneskaiRenderError extends Error {
  constructor(readonly code: DneskaiRenderFailureCode) { super(code); this.name = "DneskaiRenderError"; }
}

/** A deck problem with the input field it is about (`headline`, `sources[2]`, `image-1`, …), when there is one. */
export type DneskaiSlideRenderProblem = DneskaiRenderProblem & { field: string | null };

export type StoredDneskaiSlide = { url: string; sha256: string; metadata: Record<string, string> };
/**
 * The owner's slide store. One object per render key, never rewritten; `find` and `put` both
 * verify the stored bytes against their sha256 before returning a signed URL.
 */
export interface DneskaiSlideStorage {
  find(renderKey: string): Promise<StoredDneskaiSlide | null>;
  put(input: { renderKey: string; bytes: Buffer; sha256: string; metadata: Record<string, string> }): Promise<StoredDneskaiSlide>;
}

// The DNESKAi slide API alone (a subpath export of the vendored manifest): the package barrel also
// carries the hook-library reader, whose dynamic file reads make Turbopack trace the whole project.
type Studio = typeof import("@boardlessai/carousel-studio/dneskai-slide");
type Sharp = typeof import("sharp");
type Position = { index: number; count: number };
const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

let studioModule: Promise<Studio> | null = null;
/** Loaded on use, like sharp and resvg in render.ts, so importing this module costs nothing. */
async function studio(): Promise<Studio> {
  studioModule ??= import("@boardlessai/carousel-studio/dneskai-slide");
  try { return await studioModule; }
  catch { studioModule = null; throw new DneskaiRenderError("render-rasterizer-unavailable"); }
}
async function sharpModule(): Promise<Sharp["default"]> {
  try { return (await import("sharp")).default; }
  catch { throw new DneskaiRenderError("render-jpeg-encoding-failed"); }
}

/** The encoder the JPEG bytes depend on. Part of every render key, so an upgrade re-renders once. */
export async function dneskaiEncoderIdentity(): Promise<{ sharp: string; vips: string }> {
  const sharp = await sharpModule();
  return { sharp: String(sharp.versions.sharp ?? ""), vips: String(sharp.versions.vips) };
}

/**
 * The slide as the studio takes it. Code writes the folio, the sources title and the disclosure;
 * DNESKAi is Czech-only.
 */
export function dneskaiStudioInput(slide: DneskaiSlide, position: Position, images: DneskaiSlideInput["images"] = []): DneskaiSlideInput {
  return {
    type: slide.type,
    ...(slide.variant ? { variant: slide.variant } : {}),
    headline: slide.headline,
    ...(slide.body !== undefined ? { body: slide.body } : {}),
    ...(slide.kicker !== undefined ? { kicker: slide.kicker } : {}),
    ...(slide.credit !== undefined ? { credit: slide.credit } : {}),
    ...(slide.sources !== undefined ? { sources: slide.sources } : {}),
    images,
    position,
    locale: "cs",
  };
}

/**
 * sha256 of everything a slide's JPEG depends on: the vendored engine (version, commit and tree
 * hash, which pin every template and the payload the studio derives), OwnDashboard's policy, the
 * encoder, the words, the variant, each photograph's asset hash and crop, and the slide's place in
 * the deck. The studio's template and payload are pure functions of exactly these, so hashing the
 * inputs lets a cache hit skip loading and decoding the photographs. The alt text is not drawn and
 * is not part of the key.
 */
export function dneskaiRenderKey(slide: DneskaiSlide, position: Position, encoder: { sharp: string; vips: string }): string {
  const images = [...slide.images].sort((left, right) => left.slot < right.slot ? -1 : left.slot > right.slot ? 1 : 0)
    .map((image) => ({ slot: image.slot, assetSha256: image.assetSha256, crop: image.crop ?? null }));
  return sha256(canonicalJson({
    schemaVersion: "dneskai-render-key/1",
    studio: DNESKAI_STUDIO,
    policy: DNESKAI_RENDER_POLICY,
    encoder: { ...encoder, jpeg: DNESKAI_SLIDE_JPEG },
    slide: {
      type: slide.type, variant: slide.variant ?? null, headline: slide.headline, body: slide.body ?? null,
      kicker: slide.kicker ?? null, credit: slide.credit ?? null, sources: slide.sources ?? null, images,
    },
    position: { index: position.index, count: position.count },
    locale: "cs",
  }));
}

function slideProblem(slide: number, problem: DneskaiSlideProblem): DneskaiSlideRenderProblem {
  // Cut copy is reported by the studio and refused here.
  return { slide, code: problem.code, blocking: problem.blocking || problem.code === "text-clipped", field: problem.field, message: problem.message };
}

function mediaLoader(load: LoadDneskaiMediaBytes): LoadDneskaiMediaBytes {
  const loaded = new Map<string, Promise<Buffer>>();
  return (asset) => {
    let bytes = loaded.get(asset);
    if (!bytes) { bytes = load(asset); loaded.set(asset, bytes); }
    return bytes;
  };
}

/** The slide's photographs, or the problems that stop it. A loader failure is a visible missing medium. */
async function slideImages(slide: DneskaiSlide, index: number, load: LoadDneskaiMediaBytes): Promise<{ images: DneskaiImageInput[]; problems: DneskaiSlideRenderProblem[] }> {
  const images: DneskaiImageInput[] = [];
  const problems: DneskaiSlideRenderProblem[] = [];
  for (const image of slide.images) {
    try {
      const bytes = await load(image.assetSha256);
      images.push({ slot: image.slot, bytes, assetSha256: image.assetSha256, ...(image.crop ? { crop: image.crop } : {}) });
    } catch {
      problems.push({ slide: index, code: "media-asset-unavailable", blocking: true, field: image.slot, message: `The stored photograph ${image.assetSha256} for ${image.slot} could not be loaded.` });
    }
  }
  return { images, problems };
}

/** Every problem a deck has, without rendering or storing anything. Generation (#116) uses it to fit copy. */
export async function validateDneskaiDeck(value: DneskaiDeck, loadMedia: LoadDneskaiMediaBytes): Promise<DneskaiSlideRenderProblem[]> {
  const deck = parseDeck(value);
  const engine = await studio();
  const load = mediaLoader(loadMedia);
  const problems: DneskaiSlideRenderProblem[] = [];
  for (const [index, slide] of deck.slides.entries()) {
    const loaded = await slideImages(slide, index, load);
    problems.push(...loaded.problems);
    if (loaded.problems.length) continue;
    let found: DneskaiSlideProblem[];
    try { found = await engine.validateDneskaiSlide(dneskaiStudioInput(slide, { index, count: deck.slides.length }, loaded.images)); }
    catch { throw new DneskaiRenderError("render-rasterization-failed"); }
    problems.push(...found.map((problem) => slideProblem(index, problem)));
  }
  return problems;
}

function parseDeck(value: DneskaiDeck): DneskaiDeck {
  const parsed = DneskaiDeckSchema.safeParse(value);
  if (!parsed.success) throw new DneskaiRenderError("render-input-invalid");
  return parsed.data;
}

/** Baseline sRGB JPEG for Instagram, checked after encoding: format, exact size, 4:4:4, colour space and byte cap. */
export async function encodeDneskaiSlideJpeg(png: Buffer): Promise<Buffer> {
  const sharp = await sharpModule();
  let jpeg: Buffer;
  try {
    jpeg = await sharp(png).flatten({ background: "#ffffff" }).toColourspace("srgb")
      .jpeg({ quality: DNESKAI_SLIDE_JPEG.quality, chromaSubsampling: DNESKAI_SLIDE_JPEG.chromaSubsampling, progressive: false })
      .withIccProfile("srgb").toBuffer();
  } catch { throw new DneskaiRenderError("render-jpeg-encoding-failed"); }
  if (jpeg.length > DNESKAI_SLIDE_JPEG.maxBytes) throw new DneskaiRenderError("asset-too-large");
  let info;
  try { info = await sharp(jpeg).metadata(); }
  catch { throw new DneskaiRenderError("asset-dimensions-invalid"); }
  if (info.format !== "jpeg" || info.width !== DNESKAI_SLIDE_JPEG.width || info.height !== DNESKAI_SLIDE_JPEG.height
    || info.chromaSubsampling !== DNESKAI_SLIDE_JPEG.chromaSubsampling || info.space !== "srgb" || info.isProgressive) throw new DneskaiRenderError("asset-dimensions-invalid");
  return jpeg;
}

const StoredProblemsSchema = z.array(z.strictObject({ code: z.string().min(1).max(80), field: z.string().max(80).nullable(), message: z.string().max(600) })).max(20);
function cachedProblems(slide: number, stored: StoredDneskaiSlide): DneskaiSlideRenderProblem[] {
  let parsed;
  try { parsed = StoredProblemsSchema.parse(JSON.parse(stored.metadata.problems ?? "[]")); }
  catch { throw new DneskaiRenderError("stored-asset-metadata-mismatch"); }
  return parsed.map((problem) => ({ slide, code: problem.code, blocking: false, field: problem.field, message: problem.message }));
}

function storageStage<T>(run: () => Promise<T>): Promise<T> {
  return run().catch((failure: unknown) => {
    const code = failure instanceof Error ? (failure as { code?: unknown }).code : undefined;
    if (code === "stored-asset-hash-mismatch" || code === "stored-asset-metadata-mismatch" || code === "worker-timeout") throw new DneskaiRenderError(code);
    throw new DneskaiRenderError("asset-storage-failed");
  });
}

type RenderedSlide = { png: Buffer; pngHash: string; svgHash: string; template: { id: string; version: string }; problems: DneskaiSlideRenderProblem[] };

/**
 * The `RenderDneskaiDeck` port (dneskai-ports.ts). `storage` returns the owner's slide store; the
 * worker runtime passes `createDneskaiSlideStorage`.
 */
export function createDneskaiDeckRenderer(dependencies: { storage(owner: string, signal?: AbortSignal): DneskaiSlideStorage }): RenderDneskaiDeck {
  return async (input): Promise<DneskaiDeckRenderResult> => {
    if (!z.uuid().safeParse(input.owner).success || !z.uuid().safeParse(input.revisionId).success) throw new DneskaiRenderError("render-input-invalid");
    const deck = parseDeck(input.deck);
    const abortCheck = () => { if (input.signal?.aborted) throw new DneskaiRenderError("worker-timeout"); };
    abortCheck();
    const storage = dependencies.storage(input.owner, input.signal);
    const count = deck.slides.length;
    const encoder = await dneskaiEncoderIdentity();
    const renderKeys = deck.slides.map((slide, index) => dneskaiRenderKey(slide, { index, count }, encoder));
    const cached = await Promise.all(renderKeys.map((key) => storageStage(() => storage.find(key))));
    abortCheck();

    const load = mediaLoader(input.loadMedia);
    const problems: DneskaiSlideRenderProblem[] = [];
    const rendered: Array<RenderedSlide | null> = [];
    for (const [index, slide] of deck.slides.entries()) {
      const hit = cached[index];
      if (hit) { problems.push(...cachedProblems(index, hit)); rendered.push(null); continue; }
      const loaded = await slideImages(slide, index, load);
      abortCheck();
      problems.push(...loaded.problems);
      if (loaded.problems.length) { rendered.push(null); continue; }
      const engine = await studio();
      let result;
      try { result = await engine.renderDneskaiSlide(dneskaiStudioInput(slide, { index, count }, loaded.images)); }
      catch { throw new DneskaiRenderError("render-rasterization-failed"); }
      abortCheck();
      const found = result.problems.map((problem) => slideProblem(index, problem));
      if (result.status !== "rendered" && !found.some((problem) => problem.blocking)) found.push({ slide: index, code: "render-refused", blocking: true, field: null, message: "The studio refused this slide." });
      problems.push(...found);
      rendered.push(result.status === "rendered" && result.png && result.pngHash && result.template
        ? { png: result.png, pngHash: result.pngHash, svgHash: result.svgHash ?? "", template: result.template, problems: found }
        : null);
    }
    if (problems.some((problem) => problem.blocking)) return { status: "refused", assets: [], renderKeys: [], problems };

    const assets: DneskaiRenderedAsset[] = [];
    for (const [index, slide] of deck.slides.entries()) {
      abortCheck();
      let stored = cached[index];
      if (!stored) {
        const slideRender = rendered[index]!;
        const bytes = await encodeDneskaiSlideJpeg(slideRender.png);
        const digest = sha256(bytes);
        const metadata = {
          renderKey: renderKeys[index]!, rendererVersion: DNESKAI_RENDERER_VERSION, renderPolicy: DNESKAI_RENDER_POLICY,
          templateId: slideRender.template.id, templateVersion: slideRender.template.version, pngHash: slideRender.pngHash, svgHash: slideRender.svgHash,
          problems: JSON.stringify(slideRender.problems.map(({ code, field, message }) => ({ code, field, message }))),
        };
        stored = await storageStage(() => storage.put({ renderKey: renderKeys[index]!, bytes, sha256: digest, metadata }));
        if (stored.sha256 !== digest) throw new DneskaiRenderError("stored-asset-hash-mismatch");
      }
      const asset = AssetSchema.safeParse({ url: stored.url, sha256: stored.sha256, mimeType: "image/jpeg", width: DNESKAI_SLIDE_JPEG.width, height: DNESKAI_SLIDE_JPEG.height, alt: slide.alt });
      if (!asset.success) throw new DneskaiRenderError("asset-storage-failed");
      assets.push(asset.data);
    }
    return { status: "rendered", assets, renderKeys, problems };
  };
}
