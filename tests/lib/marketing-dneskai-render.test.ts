import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { createDneskaiDeckRenderer, dneskaiEncoderIdentity, dneskaiRenderKey, validateDneskaiDeck, DNESKAI_SLIDE_JPEG, type DneskaiSlideRenderProblem, type DneskaiSlideStorage, type StoredDneskaiSlide } from "@/lib/marketing/dneskai-render";
import { DneskaiDeckSchema, type DneskaiDeck } from "@/lib/marketing/dneskai-slides";
import type { DneskaiDeckRenderResult } from "@/lib/marketing/dneskai-ports";

const owner = "6a4f1c2e-9b7d-4e3a-8c5f-1d2e3f4a5b6c";
const revisionId = "0b9e8d7c-6a5f-4e3d-9c2b-1a0f9e8d7c6b";
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Deterministic stand-in photographs drawn with sharp; every sentence below is invented. */
async function photo(width: number, height: number, seed: number, format: "jpeg" | "png" | "webp") {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 3, block = ((Math.floor(x / 60) + Math.floor(y / 60) + seed) % 4) * 30;
    data[offset] = (Math.floor((x * 180) / width) + seed * 41 + block) % 256;
    data[offset + 1] = (Math.floor((y * 160) / height) + seed * 23 + 30) % 256;
    data[offset + 2] = (Math.floor(((width - x) * 140) / width) + block) % 256;
  }
  const image = sharp(data, { raw: { width, height, channels: 3 } });
  return format === "jpeg" ? image.jpeg({ quality: 90 }).toBuffer() : format === "png" ? image.png().toBuffer() : image.webp({ quality: 90 }).toBuffer();
}

async function fixtures() {
  const files = {
    bleed: await photo(1080, 1350, 1, "jpeg"),
    wide: await photo(936, 560, 2, "png"),
    tall: await photo(468, 600, 3, "webp"),
    pairOne: await photo(468, 300, 4, "png"),
    pairTwo: await photo(468, 280, 5, "jpeg"),
    small: await photo(800, 600, 6, "jpeg"),
  };
  const bySha = new Map(Object.values(files).map((bytes) => [sha(bytes), bytes]));
  const loadMedia = vi.fn(async (asset: string) => {
    const bytes = bySha.get(asset);
    if (!bytes) throw new Error("media-asset-unavailable");
    return bytes;
  });
  const asset = (name: keyof typeof files) => sha(files[name]);
  return { files, asset, loadMedia };
}

function carousel(asset: (name: "bleed" | "wide" | "tall" | "pairOne" | "pairTwo" | "small") => string): DneskaiDeck {
  return DneskaiDeckSchema.parse({ schemaVersion: "dneskai-slides/1", format: "carousel", slides: [
    { type: "cover-photo", headline: "Smyšlený titulek nese jednu větu přes fotku", images: [{ slot: "image-1", assetSha256: asset("bleed"), crop: { focal: { x: 0.4, y: 0.6 } } }], alt: "Smyšlená fotografie s titulkem." },
    { type: "figure", headline: "Smyšlený graf v rámu pod titulkem", body: "Popis vysvětluje, co graf ukazuje. Žluťoučký kůň úpěl ďábelské ódy.", images: [{ slot: "image-1", assetSha256: asset("wide") }], alt: "Smyšlený graf." },
    { type: "split", kicker: "Smyšlená rada", headline: "Text vlevo a obrázek vpravo", body: "Odstavec dokončí myšlenku jednou větou.", images: [{ slot: "image-1", assetSha256: asset("tall") }], alt: "Smyšlený obrázek vpravo." },
    { type: "split", kicker: "Smyšlené srovnání", headline: "Dva obrázky nad sebou", body: "Levý sloupec nese vysvětlení.", images: [{ slot: "image-1", assetSha256: asset("pairOne") }, { slot: "image-2", assetSha256: asset("pairTwo") }], alt: "Dvě smyšlená schémata." },
    { type: "statement", headline: "„Smyšlený výrok na modré ploše.“", body: "Tišší poznámka pod výrokem.", images: [], alt: "Smyšlený výrok." },
    { type: "statement", variant: "ink", headline: "Tentýž výrok na inkoustové ploše.", images: [], alt: "Smyšlený výrok na tmavé ploše." },
    // No new post carries a sources slide (owner rule, 22 October 2026); the studio still draws one for a deck saved before it.
    { type: "sources", headline: "", sources: ["Smyšlený blog: Smyšlený článek (20. 10. 2026)", "Obrázky: smyšlený zdroj"], images: [{ slot: "image-1", assetSha256: asset("wide") }, { slot: "image-2", assetSha256: asset("tall") }], alt: "Seznam smyšlených zdrojů." },
  ] });
}

function memoryStorage() {
  const objects = new Map<string, { bytes: Buffer; stored: StoredDneskaiSlide }>();
  const storage: DneskaiSlideStorage = {
    find: vi.fn(async (renderKey: string) => objects.get(renderKey)?.stored ?? null),
    put: vi.fn(async ({ renderKey, bytes, sha256, metadata }) => {
      if (objects.has(renderKey)) throw new Error("existing-asset-conflict");
      const stored = { url: `https://storage.test/marketing-assets/${owner}/marketing/dneskai/slides/${renderKey}.jpg?token=test-only`, sha256, metadata: { ...metadata, renderKey, sha256, ownerId: owner } };
      objects.set(renderKey, { bytes, stored });
      return stored;
    }),
  };
  return { storage, objects };
}

async function render(deck: DneskaiDeck, storage: DneskaiSlideStorage, loadMedia: (asset: string) => Promise<Buffer>): Promise<DneskaiDeckRenderResult> {
  return createDneskaiDeckRenderer({ storage: () => storage })({ owner, revisionId, deck, loadMedia });
}

describe("DNESKAi deck renderer on the vendored studio", () => {
  it("renders one slide of every type to an Instagram JPEG in slide order", async () => {
    const { asset, loadMedia } = await fixtures();
    const deck = carousel(asset);
    const single = DneskaiDeckSchema.parse({ schemaVersion: "dneskai-slides/1", format: "single-image", slides: [{ type: "single", variant: "photo", headline: "Jeden obrázek a jedna věta", images: [{ slot: "image-1", assetSha256: asset("bleed") }], alt: "Smyšlené oznámení s fotkou." }] });
    const typeOnly = DneskaiDeckSchema.parse({ schemaVersion: "dneskai-slides/1", format: "single-image", slides: [{ type: "single", variant: "type", headline: "Oznámení jen z písma", images: [], alt: "Smyšlené oznámení bez fotky." }] });
    const { storage, objects } = memoryStorage();
    const results = [await render(deck, storage, loadMedia), await render(single, storage, loadMedia), await render(typeOnly, storage, loadMedia)];
    expect(results.map((result) => [result.status, result.problems.filter((problem) => problem.blocking)])).toEqual([["rendered", []], ["rendered", []], ["rendered", []]]);
    const decks = [deck, single, typeOnly];
    expect(new Set(decks.flatMap((entry) => entry.slides.map((slide) => slide.type)))).toEqual(new Set(["cover-photo", "figure", "split", "statement", "sources", "single"]));
    for (const [deckIndex, result] of results.entries()) {
      if (result.status !== "rendered") throw new Error("refused");
      expect(result.assets).toHaveLength(decks[deckIndex].slides.length);
      expect(result.renderKeys).toHaveLength(decks[deckIndex].slides.length);
      for (const [index, item] of result.assets.entries()) {
        const bytes = objects.get(result.renderKeys[index])!.bytes;
        const info = await sharp(bytes).metadata();
        expect({ format: info.format, width: info.width, height: info.height, chroma: info.chromaSubsampling, space: info.space, progressive: info.isProgressive })
          .toEqual({ format: "jpeg", width: 1080, height: 1350, chroma: "4:4:4", space: "srgb", progressive: false });
        expect(bytes.length).toBeLessThanOrEqual(DNESKAI_SLIDE_JPEG.maxBytes);
        expect(item).toEqual({ url: expect.stringMatching(/^https:\/\//), sha256: sha(bytes), mimeType: "image/jpeg", width: 1080, height: 1350, alt: decks[deckIndex].slides[index].alt });
      }
    }
  }, 60000);

  it("is deterministic: the same deck renders the same bytes and render keys in a fresh store", async () => {
    const { asset, loadMedia } = await fixtures();
    const deck = carousel(asset);
    const [first, second] = [await render(deck, memoryStorage().storage, loadMedia), await render(deck, memoryStorage().storage, loadMedia)];
    expect(first.status).toBe("rendered");
    expect(second.assets.map((item) => item.sha256)).toEqual(first.assets.map((item) => item.sha256));
    expect(second.renderKeys).toEqual(first.renderKeys);
    expect(new Set(first.renderKeys).size).toBe(deck.slides.length);
  }, 60000);

  it("reuses stored slides: an unchanged deck loads, renders and uploads nothing; an edit re-renders only its slide", async () => {
    const { asset, loadMedia } = await fixtures();
    const deck = carousel(asset);
    const { storage } = memoryStorage();
    const first = await render(deck, storage, loadMedia);
    expect(storage.put).toHaveBeenCalledTimes(deck.slides.length);
    loadMedia.mockClear(); vi.mocked(storage.put).mockClear();
    const started = performance.now();
    const repeat = await render(structuredClone(deck), storage, loadMedia);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(repeat).toEqual(first);
    expect(loadMedia).not.toHaveBeenCalled(); expect(storage.put).not.toHaveBeenCalled();

    // Alt text is not drawn: changing it is a cache hit with the new alt.
    const relabelled = structuredClone(deck); relabelled.slides[1].alt = "Jiný popis téhož grafu.";
    const relabel = await render(relabelled, storage, loadMedia);
    expect(storage.put).not.toHaveBeenCalled();
    expect(relabel.assets[1]).toEqual({ ...first.assets[1], alt: "Jiný popis téhož grafu." });

    const edited = structuredClone(deck); edited.slides[4].headline = "„Jiný smyšlený výrok.“";
    const edit = await render(edited, storage, loadMedia);
    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(edit.renderKeys.map((key, index) => key === first.renderKeys[index])).toEqual([true, true, true, true, false, true, true]);
    expect(loadMedia).not.toHaveBeenCalled();

    const recropped = structuredClone(deck); recropped.slides[0].images[0].crop = { focal: { x: 0.5, y: 0.5 }, zoom: 1.2 };
    const recrop = await render(recropped, storage, loadMedia);
    expect(recrop.renderKeys[0]).not.toBe(first.renderKeys[0]); expect(recrop.assets[0].sha256).not.toBe(first.assets[0].sha256);
    expect(loadMedia).toHaveBeenCalledTimes(1);
  }, 60000);

  it("keys every input the pixels depend on and nothing else", async () => {
    const { asset } = await fixtures();
    const deck = carousel(asset);
    const encoder = await dneskaiEncoderIdentity();
    const key = (slide = deck.slides[0], position = { index: 0, count: 7 }, identity = encoder) => dneskaiRenderKey(slide, position, identity);
    const base = key();
    expect(key({ ...deck.slides[0], alt: "Jiný popis." })).toBe(base);
    for (const changed of [
      key({ ...deck.slides[0], headline: "Jiný titulek" }), key(deck.slides[0], { index: 1, count: 7 }), key(deck.slides[0], { index: 0, count: 6 }),
      key({ ...deck.slides[0], images: [{ ...deck.slides[0].images[0], assetSha256: asset("small") }] }),
      key({ ...deck.slides[0], images: [{ ...deck.slides[0].images[0], crop: { focal: { x: 0.4, y: 0.6 }, zoom: 2 } }] }),
      key(deck.slides[0], undefined, { ...encoder, vips: "0.0.0" }),
    ]) expect(changed).not.toBe(base);
    // The kit is keyed only when it is not editorial, so every editorial key is the one it was before kits existed.
    expect(dneskaiRenderKey(deck.slides[0], { index: 0, count: 7 }, encoder, "editorial")).toBe(base);
    expect(dneskaiRenderKey(deck.slides[0], { index: 0, count: 7 }, encoder, "bold")).not.toBe(base);
  });

  it("writes editorial by leaving the kit out and refuses an explicit one", () => {
    const base = { schemaVersion: "dneskai-slides/1", format: "carousel", slides: [{ type: "statement", headline: "A", images: [], alt: "A" }, { type: "statement", headline: "B", images: [], alt: "B" }] };
    expect(DneskaiDeckSchema.safeParse(base).success).toBe(true);
    expect(DneskaiDeckSchema.safeParse({ ...base, kit: "bold" }).success).toBe(true);
    expect(DneskaiDeckSchema.safeParse({ ...base, kit: "editorial" }).success).toBe(false);
    expect(DneskaiDeckSchema.safeParse({ ...base, kit: "clipping" }).success).toBe(false);
  });

  it("refuses the whole deck on clipped Czech copy and stores nothing", async () => {
    const { asset, loadMedia } = await fixtures();
    const deck = carousel(asset);
    deck.slides[0].headline = "Příliš žluťoučký kůň úpěl ďábelské ódy a pak pokračoval dál přes celou stránku, aby se titulek určitě nevešel do vymezeného místa ani ve třech řádcích sazby.";
    const { storage } = memoryStorage();
    const result = await render(deck, storage, loadMedia);
    expect(result).toEqual({ status: "refused", assets: [], renderKeys: [], problems: [expect.objectContaining({ slide: 0, code: "text-clipped", blocking: true, field: "headline" })] });
    expect(storage.put).not.toHaveBeenCalled();
    expect(await validateDneskaiDeck(deck, loadMedia)).toEqual([expect.objectContaining({ slide: 0, code: "text-clipped", blocking: true })]);
  }, 60000);

  it("refuses the whole deck on a character the field's face does not carry and stores nothing", async () => {
    const { asset, loadMedia } = await fixtures();
    const deck = carousel(asset);
    // The studio draws these as boxes and reports nothing; the gate names each one.
    deck.slides[4].headline = "Žraloci 🦈 a modely 中文";
    deck.slides[6].sources = ["Smyšlený blog: Smyšlený článek (20. 10. 2026)", "Ověřeno ✓"];
    deck.slides[2].kicker = "Smyšlené téma · 20. 10. 2026";
    const { storage } = memoryStorage();
    const result = await render(deck, storage, loadMedia);
    expect(result).toEqual({ status: "refused", assets: [], renderKeys: [], problems: [
      { slide: 4, code: "unsupported-glyph", blocking: true, field: "headline", message: expect.stringContaining("🦈 (U+1F988), 中 (U+4E2D), 文 (U+6587)") },
      { slide: 6, code: "unsupported-glyph", blocking: true, field: "sources[1]", message: expect.stringContaining("✓ (U+2713)") },
    ] });
    expect(result.problems[0]!.message).toContain("Space Grotesk");
    expect(storage.put).not.toHaveBeenCalled();
    expect(await validateDneskaiDeck(deck, loadMedia)).toEqual(result.problems);

    // Czech, its quotation marks and the kicker's uppercase pass; one bad glyph in one slide still refuses all of it.
    const czech = carousel(asset);
    czech.slides[1].body = "„Příliš žluťoučký kůň“ – úpěl ďábelské ódy… 5 × 3 = 15 % (§ 2)";
    expect((await validateDneskaiDeck(czech, loadMedia)).filter((problem) => problem.blocking)).toEqual([]);
    czech.slides[2].kicker = "Smyšlená rada ™";
    expect(await validateDneskaiDeck(czech, loadMedia)).toEqual([expect.objectContaining({ slide: 2, code: "unsupported-glyph", field: "kicker" })]);
  }, 60000);

  it("refuses written text the slide type does not draw instead of dropping it from the picture", async () => {
    const { asset, loadMedia } = await fixtures();
    const deck = carousel(asset);
    deck.slides[0].body = "Cover nemá místo pro odstavec.";
    // The first slide shows its headline alone and no slide draws a picture credit (owner rule, 22 October 2026).
    deck.slides[0].kicker = "Smyšlené téma";
    deck.slides[1].credit = "Graf: smyšlený zdroj";
    deck.slides[4].credit = "Výrok: smyšlený zdroj";
    deck.slides[6].headline = "Zdroje k vydání";
    deck.slides[5].sources = ["Smyšlený zdroj na výroku"];
    const { storage } = memoryStorage();
    const result = await render(deck, storage, loadMedia);
    expect(result.status).toBe("refused");
    expect((result.problems as DneskaiSlideRenderProblem[]).map(({ slide, code, blocking, field }) => ({ slide, code, blocking, field }))).toEqual([
      { slide: 0, code: "text-unplaced", blocking: true, field: "body" },
      { slide: 0, code: "text-unplaced", blocking: true, field: "kicker" },
      { slide: 1, code: "text-unplaced", blocking: true, field: "credit" },
      { slide: 4, code: "text-unplaced", blocking: true, field: "credit" },
      { slide: 5, code: "text-unplaced", blocking: true, field: "sources[0]" },
      { slide: 6, code: "text-unplaced", blocking: true, field: "headline" },
    ]);
    expect(storage.put).not.toHaveBeenCalled();
    // Blank text is no text: whitespace in a field the slide does not draw is not a problem.
    const blank = carousel(asset); blank.slides[4].credit = "   "; blank.slides[0].body = "";
    expect(await validateDneskaiDeck(blank, loadMedia)).toEqual([]);
  }, 60000);

  it("keys the words as the studio draws them: surrounding whitespace and blank source lines are a cache hit", async () => {
    const { asset } = await fixtures();
    const deck = carousel(asset);
    const encoder = await dneskaiEncoderIdentity();
    const key = (slide: DneskaiDeck["slides"][number], index: number) => dneskaiRenderKey(slide, { index, count: 7 }, encoder);
    expect(key({ ...deck.slides[1], headline: `  ${deck.slides[1].headline}\n`, body: ` ${deck.slides[1].body} ` }, 1)).toBe(key(deck.slides[1], 1));
    expect(key({ ...deck.slides[6], sources: ["  ", ...deck.slides[6].sources!, " "] }, 6)).toBe(key(deck.slides[6], 6));
    expect(key({ ...deck.slides[4], body: undefined }, 4)).toBe(key({ ...deck.slides[4], body: "  " }, 4));
    expect(key({ ...deck.slides[1], headline: `${deck.slides[1].headline}!` }, 1)).not.toBe(key(deck.slides[1], 1));
  });

  it("reports a media load that fails after the job's time ran out as worker-timeout, not as missing media", async () => {
    const { asset } = await fixtures();
    const controller = new AbortController();
    const loadMedia = vi.fn(async () => { controller.abort(); throw new Error("aborted"); });
    const { storage } = memoryStorage();
    const renderer = createDneskaiDeckRenderer({ storage: () => storage });
    await expect(renderer({ owner, revisionId, deck: carousel(asset), loadMedia, signal: controller.signal })).rejects.toThrow("worker-timeout");
    const late = new AbortController();
    await expect(validateDneskaiDeck(carousel(asset), async () => { late.abort(); throw new Error("aborted"); }, late.signal)).rejects.toThrow("worker-timeout");
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("refuses a full-bleed photograph under 900 px and a missing medium as visible problems", async () => {
    const { asset, loadMedia } = await fixtures();
    const deck = carousel(asset);
    deck.slides[0].images = [{ slot: "image-1", assetSha256: asset("small") }];
    deck.slides[1].images = [{ slot: "image-1", assetSha256: "e".repeat(64) }];
    const { storage } = memoryStorage();
    const result = await render(deck, storage, loadMedia);
    expect(result.status).toBe("refused");
    expect(result.problems).toEqual([
      expect.objectContaining({ slide: 0, code: "image-low-resolution", blocking: true, field: "image-1" }),
      expect.objectContaining({ slide: 1, code: "media-asset-unavailable", blocking: true, field: "image-1" }),
    ]);
    expect(storage.put).not.toHaveBeenCalled();
  }, 60000);

  it("rejects malformed decks, owners and revisions before touching storage or media", async () => {
    const { asset, loadMedia } = await fixtures();
    const { storage } = memoryStorage();
    const renderer = createDneskaiDeckRenderer({ storage: () => storage });
    await expect(renderer({ owner: "not-a-uuid", revisionId, deck: carousel(asset), loadMedia })).rejects.toThrow("render-input-invalid");
    await expect(renderer({ owner, revisionId, deck: { ...carousel(asset), format: "single-image" }, loadMedia })).rejects.toThrow("render-input-invalid");
    const aborted = new AbortController(); aborted.abort();
    await expect(renderer({ owner, revisionId, deck: carousel(asset), loadMedia, signal: aborted.signal })).rejects.toThrow("worker-timeout");
    expect(storage.find).not.toHaveBeenCalled(); expect(loadMedia).not.toHaveBeenCalled();
  });
});
