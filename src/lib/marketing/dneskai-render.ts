import { createHash } from "node:crypto";
import { z } from "zod";
import type { DneskaiImageInput, DneskaiSlideInput, DneskaiSlideProblem } from "@boardlessai/carousel-studio/dneskai-slide";
import { AssetSchema, canonicalJson } from "./contracts";
import { DneskaiDeckSchema, dneskaiKitOf, type DneskaiDeck, type DneskaiKitId, type DneskaiSlide } from "./dneskai-slides";
import { DNESKAI_PLACED_FIELDS, type DneskaiTextField } from "./dneskai-slide-layout";
import type { DneskaiDeckRenderResult, DneskaiRenderProblem, DneskaiRenderedAsset, LoadDneskaiMediaBytes, RenderDneskaiDeck } from "./dneskai-ports";

/**
 * DNESKAi slides through the vendored Design Lab engine (own-dashboard#117, quorum#603).
 *
 * Every slide of a deck goes to `renderDneskaiSlide` in `@boardlessai/carousel-studio`
 * (vendor/carousel-studio). This module owns no layout: it maps the slide contract to the studio
 * input, applies OwnDashboard's stricter gate, encodes the Instagram JPEG and stores it once per
 * render key in the private `marketing-assets` bucket.
 *
 * The gate is the studio's plus three rules, because copy the owner approves must be the copy
 * that prints, whole and legible:
 * - `text-clipped`, which the studio reports without refusing, refuses here: cut Czech copy never ships;
 * - `unsupported-glyph`: a drawn character the field's committed face does not carry. The studio
 *   draws those as a box (or in another face) and reports nothing;
 * - `text-unplaced`: written text the slide type has no place for. The studio leaves it off the
 *   slide without a word, and the deck would still carry it into approval.
 * One blocking problem on any slide refuses the whole deck and nothing is stored.
 */

/** The vendored engine. `tests/lib/carousel-studio-vendor.test.ts` ties these to vendor/carousel-studio/UPSTREAM.md. */
export const DNESKAI_STUDIO = {
  package: "@boardlessai/carousel-studio",
  version: "1.0.0",
  commit: "83bdfb2e1e9ce1114b9b615bd20237f55a7f115a",
  treeSha256: "d257617242e71635c25accc1b1e729b9a3f279e83f11810434c5499c3f15376d",
} as const;
/** OwnDashboard's own rules on top of the studio's: the clip, glyph and placement gates and the JPEG below. Bump on any change. */
export const DNESKAI_RENDER_POLICY = "dneskai-render/2";
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

// The DNESKAi slide API and the face metrics alone (subpath exports of the vendored manifest): the
// package barrel also carries the hook-library reader, whose dynamic file reads make Turbopack
// trace the whole project.
type Studio = typeof import("@boardlessai/carousel-studio/dneskai-slide");
type Fonts = typeof import("@boardlessai/carousel-studio/fonts");
type Sharp = typeof import("sharp");
type Position = { index: number; count: number };
const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

let studioModule: Promise<Studio> | null = null;
let fontsModule: Promise<Fonts> | null = null;
/** Loaded on use, like sharp and resvg in render.ts, so importing this module costs nothing. */
async function studio(): Promise<Studio> {
  studioModule ??= import("@boardlessai/carousel-studio/dneskai-slide");
  try { return await studioModule; }
  catch { studioModule = null; throw new DneskaiRenderError("render-rasterizer-unavailable"); }
}
async function fonts(): Promise<Fonts> {
  fontsModule ??= import("@boardlessai/carousel-studio/fonts");
  try { return await fontsModule; }
  catch { fontsModule = null; throw new DneskaiRenderError("render-rasterizer-unavailable"); }
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

export type { DneskaiTextField };
export { DNESKAI_PLACED_FIELDS };
const TEXT_FIELDS = ["headline", "body", "kicker", "credit"] as const;

/**
 * The face each written field is set in on every DNESKAi template, and whether the template
 * uppercases it first: the caught-up kit's faces (headline Space Grotesk, body Source Serif 4,
 * mono IBM Plex Mono) at the weights of the photo templates' text layers. Source lines are set in
 * the body face. `tests/lib/carousel-studio-vendor.test.ts` derives this table from the vendored
 * templates and fails when the two disagree, so a re-vendor cannot move a field to another face
 * unnoticed.
 */
export const DNESKAI_FIELD_FACES = {
  headline: { family: "Space Grotesk", weight: 700, uppercase: false },
  body: { family: "Source Serif 4", weight: 400, uppercase: false },
  kicker: { family: "IBM Plex Mono", weight: 400, uppercase: true },
  credit: { family: "IBM Plex Mono", weight: 400, uppercase: false },
  sources: { family: "Source Serif 4", weight: 400, uppercase: false },
} as const satisfies Record<DneskaiTextField, { family: string; weight: number; uppercase: boolean }>;

/** The written fields each slide type draws: `DNESKAI_PLACED_FIELDS` in `dneskai-slide-layout.ts`, checked against the vendored templates. */

/**
 * The string the studio draws for a field: trimmed, uppercased in Czech where the template does
 * it, composed (NFC) and with every run of whitespace set as one word space, as its fitter does.
 */
function drawnText(value: string, uppercase: boolean): string {
  const trimmed = value.trim();
  return (uppercase ? trimmed.toLocaleUpperCase("cs") : trimmed).normalize("NFC").replace(/\s+/gu, " ");
}

function characterList(characters: string[]): string {
  const named = characters.slice(0, 8).map((character) => `${character} (U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")})`);
  return characters.length > 8 ? `${named.join(", ")} and ${characters.length - 8} more` : named.join(", ");
}

/**
 * OwnDashboard's text gate for one slide, without media or rendering: written text the slide type
 * does not draw (`text-unplaced`) and drawn characters the field's committed face does not carry
 * (`unsupported-glyph`). The face check uses the studio's own metric tables, which are also what
 * its fitter measures by, so a character outside them could neither be measured nor drawn.
 */
type FieldFaces = Readonly<Record<DneskaiTextField, { family: string; weight: number; uppercase: boolean }>>;

/**
 * The faces a kit sets each written field in, from the vendored studio's own kit registry, so a re-vendor
 * can never leave OwnDashboard checking glyphs against another kit's faces. A kit the studio does not
 * register is refused as invalid input.
 */
async function kitFieldFaces(kit: DneskaiKitId): Promise<FieldFaces> {
  if (kit === "editorial") return DNESKAI_FIELD_FACES;
  const found = (await studio()).dneskaiKit(kit);
  if (!found) throw new DneskaiRenderError("render-input-invalid");
  return found.fieldFaces;
}

function textProblems(slide: DneskaiSlide, index: number, metrics: Fonts, faces: FieldFaces = DNESKAI_FIELD_FACES): DneskaiSlideRenderProblem[] {
  const placed: readonly DneskaiTextField[] = DNESKAI_PLACED_FIELDS[slide.type];
  const written = [
    ...TEXT_FIELDS.flatMap((field) => slide[field]?.trim() ? [{ field, name: field as string, value: slide[field]! }] : []),
    ...(slide.sources ?? []).flatMap((value, line) => value.trim() ? [{ field: "sources" as const, name: `sources[${line}]`, value }] : []),
  ];
  const problems: DneskaiSlideRenderProblem[] = [];
  for (const { field, name, value } of written) {
    if (!placed.includes(field)) {
      problems.push({ slide: index, code: "text-unplaced", blocking: true, field: name, message: `A ${slide.type} slide does not draw a ${field}, so this text would be approved but never shown. Remove it or use a slide type that draws it.` });
      continue;
    }
    const face = faces[field];
    const missing = metrics.missingCommittedGlyphs(metrics.resolveFace(face.family, face.weight), drawnText(value, face.uppercase))
      .filter((character) => !/\s/u.test(character));
    if (missing.length) {
      problems.push({ slide: index, code: "unsupported-glyph", blocking: true, field: name, message: `The ${name} uses ${missing.length === 1 ? "a character" : "characters"} that ${face.family} does not carry: ${characterList(missing)}. ${missing.length === 1 ? "It" : "They"} would print as an empty box; replace or remove ${missing.length === 1 ? "it" : "them"}.` });
    }
  }
  return problems;
}

/**
 * The slide as the studio takes it. Code writes the folio, the sources title and the disclosure;
 * DNESKAi is Czech-only.
 */
export function dneskaiStudioInput(slide: DneskaiSlide, position: Position, images: DneskaiSlideInput["images"] = [], kit: DneskaiKitId = "editorial"): DneskaiSlideInput {
  return {
    // Absent is the editorial kit; naming it would change nothing but is left out like everywhere else.
    ...(kit !== "editorial" ? { kit } : {}),
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
 * inputs lets a cache hit skip loading and decoding the photographs. The words are keyed as the
 * studio takes them, trimmed and with blank source lines dropped, so an edit to the surrounding
 * whitespace is a hit. The alt text is not drawn and is not part of the key.
 */
export function dneskaiRenderKey(slide: DneskaiSlide, position: Position, encoder: { sharp: string; vips: string }, kit: DneskaiKitId = "editorial"): string {
  const images = [...slide.images].sort((left, right) => left.slot < right.slot ? -1 : left.slot > right.slot ? 1 : 0)
    .map((image) => ({ slot: image.slot, assetSha256: image.assetSha256, crop: image.crop ?? null }));
  return sha256(canonicalJson({
    schemaVersion: "dneskai-render-key/2",
    studio: DNESKAI_STUDIO,
    policy: DNESKAI_RENDER_POLICY,
    encoder: { ...encoder, jpeg: DNESKAI_SLIDE_JPEG },
    slide: {
      type: slide.type, variant: slide.variant ?? null, headline: slide.headline.trim(), body: (slide.body ?? "").trim(),
      kicker: (slide.kicker ?? "").trim(), credit: (slide.credit ?? "").trim(),
      sources: (slide.sources ?? []).map((line) => line.trim()).filter(Boolean), images,
    },
    position: { index: position.index, count: position.count },
    locale: "cs",
    // Keyed only when not editorial, so every editorial key stays what it was before kits existed.
    ...(kit !== "editorial" ? { kit } : {}),
  }));
}

/** The input field a cut studio slot is filled from: `source-N` is the N-th non-blank source line. */
function truncatedField(slide: DneskaiSlide, slot: string): string {
  if (!slot.startsWith("source-")) return slot;
  const line = Number(slot.slice("source-".length)) - 1;
  const written = (slide.sources ?? []).flatMap((value, position) => value.trim() ? [position] : []);
  return `sources[${written[line] ?? line}]`;
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

/**
 * The slide's photographs, or the problems that stop it. A loader failure is a visible missing
 * medium, except when the job's time ran out first: that is `worker-timeout`, not a content problem.
 */
async function slideImages(slide: DneskaiSlide, index: number, load: LoadDneskaiMediaBytes, signal?: AbortSignal): Promise<{ images: DneskaiImageInput[]; problems: DneskaiSlideRenderProblem[] }> {
  const images: DneskaiImageInput[] = [];
  const problems: DneskaiSlideRenderProblem[] = [];
  for (const image of slide.images) {
    try {
      const bytes = await load(image.assetSha256);
      images.push({ slot: image.slot, bytes, assetSha256: image.assetSha256, ...(image.crop ? { crop: image.crop } : {}) });
    } catch {
      if (signal?.aborted) throw new DneskaiRenderError("worker-timeout");
      problems.push({ slide: index, code: "media-asset-unavailable", blocking: true, field: image.slot, message: `The stored photograph ${image.assetSha256} for ${image.slot} could not be loaded.` });
    }
  }
  return { images, problems };
}

async function studioProblems(engine: Studio, input: DneskaiSlideInput, index: number): Promise<DneskaiSlideRenderProblem[]> {
  let found: DneskaiSlideProblem[];
  try { found = await engine.validateDneskaiSlide(input); }
  catch { throw new DneskaiRenderError("render-rasterization-failed"); }
  return found.map((problem) => slideProblem(index, problem));
}

/** The problem codes about words, as opposed to pictures, that `dneskaiSlideTextProblems` keeps. */
const TEXT_PROBLEM_CODES = new Set(["text-unplaced", "unsupported-glyph", "text-missing", "text-clipped", "variant-invalid", "position-invalid", "sources-missing", "sources-too-many"]);

/**
 * The text gate alone for one slide, without loading or decoding a photograph: OwnDashboard's
 * placed-field and glyph checks and the studio's own fitter (the same `text-clipped` a render
 * refuses). The Design Lab's fit feedback (`dneskai-fit.ts`) calls it on every pause in typing.
 * Each picture place is handed to the studio as an empty file, so it resolves the template the
 * deck renders with (`split` with `image-2` is the paired one); the image problems that empty
 * file raises are dropped, as are all others about pictures.
 */
export async function dneskaiSlideTextProblems(slide: DneskaiSlide, position: Position, kit: DneskaiKitId = "editorial"): Promise<DneskaiSlideRenderProblem[]> {
  const [engine, metrics, faces] = await Promise.all([studio(), fonts(), kitFieldFaces(kit)]);
  const stand: DneskaiImageInput[] = slide.images.map((image) => ({ slot: image.slot, bytes: new Uint8Array(0) }));
  const found = [...textProblems(slide, position.index, metrics, faces), ...await studioProblems(engine, dneskaiStudioInput(slide, position, stand, kit), position.index)];
  return found.filter((problem) => TEXT_PROBLEM_CODES.has(problem.code));
}

/**
 * Every problem a deck has, the renderer's own gate included, without rendering or storing
 * anything. Generation (#116) uses it to fit copy.
 */
export async function validateDneskaiDeck(value: DneskaiDeck, loadMedia: LoadDneskaiMediaBytes, signal?: AbortSignal): Promise<DneskaiSlideRenderProblem[]> {
  const deck = parseDeck(value);
  const kit = dneskaiKitOf(deck);
  const [engine, metrics, faces] = await Promise.all([studio(), fonts(), kitFieldFaces(kit)]);
  const load = mediaLoader(loadMedia);
  const problems: DneskaiSlideRenderProblem[] = [];
  for (const [index, slide] of deck.slides.entries()) {
    problems.push(...textProblems(slide, index, metrics, faces));
    const loaded = await slideImages(slide, index, load, signal);
    problems.push(...loaded.problems);
    if (loaded.problems.length) continue;
    problems.push(...await studioProblems(engine, dneskaiStudioInput(slide, { index, count: deck.slides.length }, loaded.images, kit), index));
  }
  return problems;
}

function parseDeck(value: DneskaiDeck): DneskaiDeck {
  const parsed = DneskaiDeckSchema.safeParse(value);
  if (!parsed.success) throw new DneskaiRenderError("render-input-invalid");
  return parsed.data;
}

/**
 * One white pixel through the slide encoder's chain, in memory: the worker runs it before a paid generation,
 * so a runtime whose sharp or libvips does not load fails before any copy is paid for. Throws on any failure.
 */
export async function preflightDneskaiJpegEncoder(): Promise<void> {
  const sharp = await sharpModule();
  const jpeg = await sharp({ create: { width: 1, height: 1, channels: 3, background: "#ffffff" } }).toColourspace("srgb")
    .jpeg({ quality: DNESKAI_SLIDE_JPEG.quality, chromaSubsampling: DNESKAI_SLIDE_JPEG.chromaSubsampling, progressive: false })
    .withIccProfile("srgb").toBuffer();
  if ((await sharp(jpeg).metadata()).format !== "jpeg") throw new DneskaiRenderError("render-jpeg-encoding-failed");
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
    const kit = dneskaiKitOf(deck);
    const [metrics, faces] = await Promise.all([fonts(), kitFieldFaces(kit)]);
    const storage = dependencies.storage(input.owner, input.signal);
    const count = deck.slides.length;
    // The text gate needs no media and no render; when it refuses, the slides are only validated.
    const ownProblems = deck.slides.map((slide, index) => textProblems(slide, index, metrics, faces));
    const refusedByText = ownProblems.some((found) => found.length > 0);
    const encoder = await dneskaiEncoderIdentity();
    const renderKeys = deck.slides.map((slide, index) => dneskaiRenderKey(slide, { index, count }, encoder, kit));
    const cached = await Promise.all(renderKeys.map((key) => storageStage(() => storage.find(key))));
    abortCheck();

    const load = mediaLoader(input.loadMedia);
    const problems: DneskaiSlideRenderProblem[] = [];
    const rendered: Array<RenderedSlide | null> = [];
    for (const [index, slide] of deck.slides.entries()) {
      problems.push(...ownProblems[index]!);
      const hit = cached[index];
      if (hit) { problems.push(...cachedProblems(index, hit)); rendered.push(null); continue; }
      const loaded = await slideImages(slide, index, load, input.signal);
      abortCheck();
      problems.push(...loaded.problems);
      if (loaded.problems.length) { rendered.push(null); continue; }
      const engine = await studio();
      const studioInput = dneskaiStudioInput(slide, { index, count }, loaded.images, kit);
      if (refusedByText) {
        // The deck is refused already: report the studio's problems too, without drawing a slide nobody keeps.
        problems.push(...await studioProblems(engine, studioInput, index));
        rendered.push(null);
        continue;
      }
      let result;
      try { result = await engine.renderDneskaiSlide(studioInput); }
      catch { throw new DneskaiRenderError("render-rasterization-failed"); }
      abortCheck();
      const found = result.problems.map((problem) => slideProblem(index, problem));
      // Defence in depth: a slot the renderer cut is refused even if the studio's own report missed it.
      if (result.truncatedSlots.length && !found.some((problem) => problem.code === "text-clipped")) {
        for (const slot of result.truncatedSlots) found.push({ slide: index, code: "text-clipped", blocking: true, field: truncatedField(slide, slot), message: `The renderer cut ${slot}; shorten it.` });
      }
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

/* ---- render-only preview (REN-01) --------------------------------------------------------------------------- */

/** The preview image: the slide's real pixels at 80 % (two device pixels per CSS pixel of the 390 px stage and more), WebP. */
export const DNESKAI_PREVIEW_IMAGE = { width: 864, height: 1080, quality: 82, format: "webp" } as const;
/** Rendered previews kept in memory by render key: a slide the owner returns to is not drawn twice. */
const PREVIEW_CACHE_ENTRIES = 48;
const previewCache = new Map<string, Buffer>();

export type DneskaiSlidePreview = {
  status: "rendered" | "refused";
  /** The downscaled WebP of the draft slide, null when refused. Never stored, never an approval asset. */
  image: Buffer | null;
  renderKey: string;
  problems: DneskaiSlideRenderProblem[];
  cached: boolean;
};

/** Forgets every cached preview (tests). */
export function clearDneskaiPreviewCache() { previewCache.clear(); }

/**
 * One slide of a draft deck rendered in memory for the Design Lab (REN-01): the same text gate, studio render and
 * refusal rules as `createDneskaiDeckRenderer`, at $0 (no model call), with no storage write, no revision and no
 * render key cache in `marketing-assets`. A clean slide comes back as a downscaled WebP; a refused one as its
 * problems. The bytes are a preview only: approval still binds a saved revision's content hash and its stored JPEGs.
 * `signal` bounds the work like the save path's abort budget: an abort between stages is `worker-timeout`.
 */
export async function previewDneskaiSlide(value: DneskaiDeck, index: number, loadMedia: LoadDneskaiMediaBytes, options: { signal?: AbortSignal } = {}): Promise<DneskaiSlidePreview> {
  const deck = parseDeck(value);
  const slide = deck.slides[index];
  if (!slide) throw new DneskaiRenderError("render-input-invalid");
  const abortCheck = () => { if (options.signal?.aborted) throw new DneskaiRenderError("worker-timeout"); };
  abortCheck();
  const position = { index, count: deck.slides.length };
  const kit = dneskaiKitOf(deck);
  const [metrics, faces] = await Promise.all([fonts(), kitFieldFaces(kit)]);
  const encoder = await dneskaiEncoderIdentity();
  const renderKey = dneskaiRenderKey(slide, position, encoder, kit);
  const own = textProblems(slide, index, metrics, faces);
  const hit = previewCache.get(renderKey);
  if (hit && !own.length) {
    previewCache.delete(renderKey); previewCache.set(renderKey, hit);
    return { status: "rendered", image: hit, renderKey, problems: [], cached: true };
  }
  const loaded = await slideImages(slide, index, mediaLoader(loadMedia), options.signal);
  abortCheck();
  const engine = await studio();
  if (loaded.problems.length) return { status: "refused", image: null, renderKey, problems: [...own, ...loaded.problems], cached: false };
  const input = dneskaiStudioInput(slide, position, loaded.images, kit);
  if (own.length) return { status: "refused", image: null, renderKey, problems: [...own, ...await studioProblems(engine, input, index)], cached: false };
  let result;
  try { result = await engine.renderDneskaiSlide(input); }
  catch { throw new DneskaiRenderError("render-rasterization-failed"); }
  abortCheck();
  const found = result.problems.map((problem) => slideProblem(index, problem));
  if (result.truncatedSlots.length && !found.some((problem) => problem.code === "text-clipped")) {
    for (const slot of result.truncatedSlots) found.push({ slide: index, code: "text-clipped", blocking: true, field: truncatedField(slide, slot), message: `The renderer cut ${slot}; shorten it.` });
  }
  if (result.status !== "rendered" || !result.png || found.some((problem) => problem.blocking)) {
    if (!found.some((problem) => problem.blocking)) found.push({ slide: index, code: "render-refused", blocking: true, field: null, message: "The studio refused this slide." });
    return { status: "refused", image: null, renderKey, problems: found, cached: false };
  }
  const sharp = await sharpModule();
  let image: Buffer;
  try {
    image = await sharp(result.png).flatten({ background: "#ffffff" }).toColourspace("srgb")
      .resize(DNESKAI_PREVIEW_IMAGE.width, DNESKAI_PREVIEW_IMAGE.height, { fit: "fill" }).webp({ quality: DNESKAI_PREVIEW_IMAGE.quality }).toBuffer();
  } catch { throw new DneskaiRenderError("render-jpeg-encoding-failed"); }
  abortCheck();
  // Advisory problems (a picture stretched short of refusal) are part of the preview's answer, not of the cache.
  if (!found.length) {
    previewCache.set(renderKey, image);
    while (previewCache.size > PREVIEW_CACHE_ENTRIES) previewCache.delete(previewCache.keys().next().value!);
  }
  return { status: "rendered", image, renderKey, problems: found, cached: false };
}
