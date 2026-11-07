import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { MASTER_CANVAS } from "./canvas.js";
import { DNESKAI_THUMBNAIL_GRID } from "./dneskai-layout.js";
import { renderDneskaiSlide, type DneskaiSlideInput } from "./dneskai-slide.js";
import { GOLDEN_DIRECTORY } from "./golden.js";

/**
 * The golden renders of the DNESKAi photo kit: one pinned slide per template, hashed and committed.
 *
 * The same receipt `golden.ts` keeps for the shared families, through the API OwnDashboard calls
 * rather than through the bare renderer, so the slot mapping, the folio, the fixed strings and the
 * crop path are pinned with the composition.
 *
 * The stand-in photographs are drawn from integer arithmetic and are exactly the size of the frame
 * they are laid out in — a contained picture's frame is the rectangle it is drawn at, so a picture
 * that fits its column at 1× keeps its size — and the crop's resample is the identity: the pinned
 * bytes do not lean on a resize kernel. `cover-photo-crop` pins the crop arithmetic the same way: a
 * picture twice the frame at zoom 2 around an off-centre focal point cuts a frame-sized region, so
 * the extract offsets are pinned and the resample is still the identity. `single-photo-focal` pins
 * the band moved to the top for a focal point under it. Only the PNG hash is pinned: the SVG embeds
 * sharp's PNG encoding of each picture, which is a property of the zlib build rather than of the
 * slide.
 */

export const DNESKAI_GOLDEN_PATH = path.join(GOLDEN_DIRECTORY, "dneskai-photo.json");

/**
 * A deterministic stand-in photograph: two gradients and a block grid, from integer arithmetic.
 *
 * Bright at the top and in its blocks, so a slide that sets words over it without a shade would
 * be visibly wrong in the render a reviewer opens, not only in the contrast check.
 */
export async function syntheticPhoto(width: number, height: number, seed: number): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      const block = ((Math.floor(x / 90) + Math.floor(y / 90) + seed) % 5) * 24;
      data[offset] = (Math.floor((x * 200) / width) + seed * 37 + block) % 256;
      data[offset + 1] = (Math.floor((y * 180) / height) + seed * 61 + 40) % 256;
      data[offset + 2] = (Math.floor(((width - x) * 150) / width) + Math.floor((y * 90) / height) + block) % 256;
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

/** The pinned slides. Every sentence is invented and says so; a baseline is not an article. */
export async function dneskaiGoldenCases(): Promise<Array<{ name: string; input: DneskaiSlideInput }>> {
  const bleed = await syntheticPhoto(1_080, 1_350, 1);
  const double = await syntheticPhoto(2 * 1_080, 2 * 1_350, 10);
  const wide = await syntheticPhoto(936, 560, 2);
  const tall = await syntheticPhoto(468, 600, 3);
  const pairOne = await syntheticPhoto(468, 300, 4);
  const pairTwo = await syntheticPhoto(468, 280, 5);
  const thumbs = await Promise.all([6, 7, 8, 9].map((seed) => syntheticPhoto(DNESKAI_THUMBNAIL_GRID.width, DNESKAI_THUMBNAIL_GRID.height, seed)));
  const at = (index: number, count = 7) => ({ index, count });
  return [
    { name: "cover-photo", input: { type: "cover-photo", position: at(0), kicker: "Smyšlené téma · 20. 10. 2026", headline: "Smyšlený titulek stojí na spodním okraji fotky a nese jednu větu", credit: "Foto: smyšlený zdroj", images: [{ slot: "image-1", bytes: bleed }] } },
    { name: "cover-photo-crop", input: { type: "cover-photo", position: at(0), kicker: "Smyšlené téma · 20. 10. 2026", headline: "Tentýž cover z výřezu: zoom 2 kolem bodu mimo střed", credit: "Foto: smyšlený zdroj", images: [{ slot: "image-1", bytes: double, crop: { focal: { x: 0.3, y: 0.7 }, zoom: 2 } }] } },
    { name: "figure", input: { type: "figure", position: at(1), headline: "Smyšlený graf v rámu pod titulkem o dvou řádcích", body: "Popis pod obrázkem vysvětluje, co graf ukazuje. Žluťoučký kůň úpěl ďábelské ódy.", credit: "Graf: smyšlený zdroj", images: [{ slot: "image-1", bytes: wide }] } },
    { name: "split", input: { type: "split", position: at(2), kicker: "Smyšlená rada", headline: "Text vlevo, jeden obrázek vpravo a modrý hřbet", body: "Odstavec pod oběma sloupci dokončí myšlenku jednou nebo dvěma větami.", credit: "Foto: smyšlený zdroj", images: [{ slot: "image-1", bytes: tall }] } },
    { name: "split-pair", input: { type: "split", position: at(3), kicker: "Smyšlené srovnání", headline: "Dva obrázky vpravo nad sebou", body: "Levý sloupec nese titulek i vysvětlení, pravý dva rámečky.", credit: "Schémata: smyšlený zdroj", images: [{ slot: "image-1", bytes: pairOne }, { slot: "image-2", bytes: pairTwo }] } },
    { name: "statement", input: { type: "statement", position: at(4), headline: "„Smyšlený výrok na modré ploše, který se vejde do pár řádků.“", body: "Tišší poznámka pod výrokem říká, čí to je nabídka." } },
    { name: "statement-ink", input: { type: "statement", variant: "ink", position: at(5), headline: "Tentýž výrok na inkoustové ploše.", body: "Varianta pro slide, který potřebuje klid." } },
    { name: "sources", input: { type: "sources", position: at(6), sources: ["Smyšlený blog: Smyšlený článek o smyšleném modelu (20. 10. 2026)", "Obrázky: smyšlený zdroj"], images: thumbs.map((bytes, index) => ({ slot: `image-${index + 1}`, bytes })) } },
    { name: "single-photo", input: { type: "single", variant: "photo", position: { index: 0, count: 1 }, kicker: "Smyšlené oznámení", headline: "Jeden obrázek, jedna věta na modrém panelu", body: "Řádek pod panelem doplní, co se změnilo.", credit: "Foto: smyšlený zdroj", images: [{ slot: "image-1", bytes: bleed }] } },
    { name: "single-photo-focal", input: { type: "single", variant: "photo", position: { index: 0, count: 1 }, kicker: "Smyšlené oznámení", headline: "Tentýž panel nahoře, protože ohnisko je dole", body: "Řádek pod panelem jde s ním.", credit: "Foto: smyšlený zdroj", images: [{ slot: "image-1", bytes: bleed, crop: { focal: { x: 0.5, y: 0.8 } } }] } },
    { name: "single-type", input: { type: "single", variant: "type", position: { index: 0, count: 1 }, kicker: "Smyšlené oznámení", headline: "Oznámení jen z písma, bez fotky", body: "Odstavec dole vysvětlí, co oznámení znamená pro čtenáře.", credit: "Zdroj: smyšlený" } }
  ];
}

export const DneskaiGoldenSchema = z.object({
  schemaVersion: z.literal("dneskai-photo-golden/1"),
  canvas: z.object({ width: z.literal(MASTER_CANVAS.width), height: z.literal(MASTER_CANVAS.height) }),
  updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entries: z.array(z.object({
    name: z.string().min(1),
    templateId: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    pngHash: z.string().regex(/^[0-9a-f]{64}$/)
  })).min(1)
});
export type DneskaiGolden = z.infer<typeof DneskaiGoldenSchema>;

/** Render every pinned slide. Throws if one is refused: a golden case is a slide that ships. */
export async function buildDneskaiGolden(updatedAt: string): Promise<DneskaiGolden> {
  const entries: DneskaiGolden["entries"] = [];
  for (const { name, input } of await dneskaiGoldenCases()) {
    const result = await renderDneskaiSlide(input);
    if (result.status !== "rendered" || !result.pngHash || !result.template) {
      throw new Error(`Golden case ${name} was refused: ${result.problems.map((entry) => entry.message).join("; ")}`);
    }
    entries.push({ name, templateId: result.template.id, version: result.template.version, pngHash: result.pngHash });
  }
  return DneskaiGoldenSchema.parse({ schemaVersion: "dneskai-photo-golden/1", canvas: { width: MASTER_CANVAS.width, height: MASTER_CANVAS.height }, updatedAt, entries });
}

export function readDneskaiGolden(): DneskaiGolden {
  return DneskaiGoldenSchema.parse(JSON.parse(readFileSync(DNESKAI_GOLDEN_PATH, "utf8")));
}
