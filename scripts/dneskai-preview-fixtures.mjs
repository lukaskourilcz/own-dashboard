#!/usr/bin/env node
/**
 * Regenerates the DNESKAi workspace preview fixtures (#119): small JPEG renders of invented DNESKAi slides,
 * drawn once by the vendored studio (`@boardlessai/carousel-studio`, vendor/carousel-studio) from synthetic
 * stand-in photographs, plus downscaled previews of those photographs for the editor's picture pool.
 *
 *   node scripts/dneskai-preview-fixtures.mjs
 *
 * Writes public/demo/dneskai/*.jpg and src/lib/demo/dneskai-preview-assets.json (each deck in the slide contract
 * with its render's file, sha256 and size, and each photograph's sha256 and size). The
 * photographs are abstract gradients drawn by sharp, not pictures of anything; every sentence is invented.
 * The output is deterministic for a given studio and sharp version. Nothing here calls a network or a model.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { renderDneskaiSlide } from '@boardlessai/carousel-studio/dneskai-slide';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public/demo/dneskai');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** An abstract out-of-focus "photograph": a gradient with soft discs, deterministic per seed. */
async function photo(width, height, seed) {
  const palettes = [['#1d3557', '#e76f51', '#f4a261'], ['#264653', '#2a9d8f', '#e9c46a'], ['#3d405b', '#81b29a', '#f2cc8f'], ['#2b2d42', '#8d99ae', '#ef233c'], ['#0b132b', '#5bc0be', '#fca311'], ['#354f52', '#cad2c5', '#e07a5f']];
  const [a, b, c] = palettes[seed % palettes.length];
  let state = seed * 7919 + 17;
  const random = () => { state = (state * 48271) % 2147483647; return state / 2147483647; };
  const discs = Array.from({ length: 14 }, () => `<circle cx="${Math.round(random() * width)}" cy="${Math.round(random() * height)}" r="${Math.round((0.05 + random() * 0.18) * Math.min(width, height))}" fill="${random() > 0.5 ? c : '#ffffff'}" opacity="${(0.12 + random() * 0.3).toFixed(2)}"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>${discs}</svg>`;
  return sharp(Buffer.from(svg)).blur(Math.max(4, Math.round(Math.min(width, height) / 60))).jpeg({ quality: 88 }).toBuffer();
}

const photos = {
  p1: { width: 1600, height: 1200, seed: 1 },
  p2: { width: 1200, height: 1500, seed: 2 },
  p3: { width: 1000, height: 700, seed: 3 },
  p4: { width: 800, height: 800, seed: 4 },
  p5: { width: 520, height: 390, seed: 5 },
  p6: { width: 1440, height: 1080, seed: 6 },
};

const decks = {
  a: [
    { type: 'cover-photo', kicker: 'Prakticky', headline: 'Benchmark není žebříček. Jak ho číst bez omylu', alt: 'Ukázková rozostřená fotografie s titulkem o čtení benchmarků.', credit: 'Foto: ukázkový zdroj', images: [{ slot: 'image-1', photo: 'p1', crop: { focal: { x: 0.42, y: 0.55 } } }] },
    { type: 'figure', headline: 'Nejdřív zjistěte, co test měří', alt: 'Ukázkový obrázek v rámu s vysvětlením, co benchmark měří.', body: 'Jedno číslo shrnuje stovky úloh. Podívejte se, jaké úlohy to jsou a jestli se podobají vaší práci.', credit: 'Obrázek: ukázkový zdroj', images: [{ slot: 'image-1', photo: 'p3' }] },
    { type: 'split', kicker: 'Tip', headline: 'Porovnávejte stejné podmínky', alt: 'Text vlevo a ukázkový obrázek vpravo s radou ke srovnávání.', body: 'Výsledek s jiným promptem nebo počtem pokusů není srovnatelný. Hledejte v metodice, jak byl test spuštěn.', credit: 'Foto: ukázkový zdroj', images: [{ slot: 'image-1', photo: 'p4' }] },
    { type: 'statement', headline: 'Malý rozdíl v procentech často neznamená nic.', alt: 'Výrok na modré ploše o malých rozdílech v procentech.', body: 'Než podle něj vyberete model, ověřte rozptyl mezi běhy.' },
    { type: 'sources', headline: '', alt: 'Seznam ukázkových zdrojů s náhledy použitých obrázků.', sources: ['Ukázkový zdroj: Blog o strojovém učení (21. 10. 2026)', 'Obrázky: ukázkový zdroj'], images: [{ slot: 'image-1', photo: 'p1' }, { slot: 'image-2', photo: 'p3' }] },
  ],
  b: [
    { type: 'single', variant: 'photo', kicker: 'Tip dne', headline: 'Dejte modelu kontext, ne prosby', alt: 'Ukázková fotografie s tipem dne o kontextu v promptech.', body: 'Popište cíl, publikum a formát odpovědi.', credit: 'Foto: ukázka', images: [{ slot: 'image-1', photo: 'p2' }] },
  ],
  c: [
    { type: 'cover-photo', kicker: 'Terminál', headline: 'Tři zkratky, které zrychlí práci v terminálu', alt: 'Ukázková fotografie s titulkem o zkratkách v terminálu.', credit: 'Foto: ukázkový zdroj', images: [{ slot: 'image-1', photo: 'p6' }] },
    { type: 'statement', variant: 'ink', headline: 'Nejrychlejší příkaz je ten, který nemusíte psát.', alt: 'Výrok na tmavé ploše o rychlých příkazech.' },
  ],
  d: [
    { type: 'figure', headline: 'Kdy stačí menší model', alt: 'Ukázkový obrázek v rámu s vysvětlením, kdy stačí menší model.', body: 'Na třídění, shrnutí a hledání v textu často stačí menší model. Bývá levnější a rychlejší.', credit: 'Obrázek: ukázkový zdroj', images: [{ slot: 'image-1', photo: 'p3' }] },
    { type: 'statement', headline: 'Začněte malým modelem a větší přidejte, až když chybí kvalita.', alt: 'Výrok na modré ploše o volbě velikosti modelu.' },
  ],
  e: [
    { type: 'cover-photo', kicker: 'Checklist', headline: 'Pět otázek před nasazením AI asistenta', alt: 'Ukázková fotografie s titulkem o otázkách před nasazením asistenta.', credit: 'Foto: ukázkový zdroj', images: [{ slot: 'image-1', photo: 'p2' }] },
    { type: 'sources', headline: '', alt: 'Seznam ukázkových zdrojů s náhledem použitého obrázku.', sources: ['Ukázkový zdroj: Příručka týmu (20. 10. 2026)'], images: [{ slot: 'image-1', photo: 'p2' }] },
  ],
  f: [
    { type: 'cover-photo', kicker: 'Ověřování', headline: 'Jak poznat, že odpověď modelu potřebuje ověření', alt: 'Ukázková fotografie s titulkem o ověřování odpovědí.', credit: 'Foto: ukázkový zdroj', images: [{ slot: 'image-1', photo: 'p6', crop: { focal: { x: 0.6, y: 0.4 } } }] },
    { type: 'statement', headline: 'Čísla, jména a data si vždy dohledejte ve zdroji.', alt: 'Výrok na modré ploše o dohledávání čísel ve zdroji.' },
  ],
  // The fixed version of the preview's refused post: what the demo shows once its problems are edited away.
  g: [
    { type: 'cover-photo', kicker: 'Prompty', headline: 'Proč se vyplatí verzovat prompty', alt: 'Ukázková fotografie s titulkem o verzování promptů.', credit: 'Foto: ukázkový zdroj', images: [{ slot: 'image-1', photo: 'p6' }] },
    { type: 'figure', headline: 'Každá změna má svůj záznam', alt: 'Ukázkový obrázek v rámu o záznamu změn promptů.', body: 'Když se odpovědi zhorší, víte, která úprava to způsobila, a můžete se vrátit.', credit: 'Obrázek: ukázkový zdroj', images: [{ slot: 'image-1', photo: 'p3' }] },
  ],
};

await mkdir(out, { recursive: true });
const manifest = { photos: {}, decks: {} };
const originals = {};
for (const [name, spec] of Object.entries(photos)) {
  const bytes = await photo(spec.width, spec.height, spec.seed);
  originals[name] = bytes;
  const preview = await sharp(bytes).resize({ width: 480, withoutEnlargement: true }).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
  const meta = await sharp(preview).metadata();
  await writeFile(path.join(out, `photo-${name}.jpg`), preview);
  manifest.photos[name] = { file: `/demo/dneskai/photo-${name}.jpg`, sha256: sha(bytes), width: spec.width, height: spec.height, previewWidth: meta.width, previewHeight: meta.height };
}
for (const [deck, slides] of Object.entries(decks)) {
  manifest.decks[deck] = [];
  for (const [index, slide] of slides.entries()) {
    const images = (slide.images ?? []).map((image) => ({ slot: image.slot, bytes: originals[image.photo], assetSha256: sha(originals[image.photo]), ...(image.crop ? { crop: image.crop } : {}) }));
    const result = await renderDneskaiSlide({ ...slide, images, position: { index, count: slides.length }, locale: 'cs' });
    if (result.status !== 'rendered' || !result.png) throw new Error(`deck ${deck} slide ${index}: ${result.problems.map((problem) => problem.code).join(', ')}`);
    if (result.truncatedSlots.length) throw new Error(`deck ${deck} slide ${index}: cut ${result.truncatedSlots.join(', ')}`);
    const jpeg = await sharp(result.png).resize({ width: 360 }).flatten({ background: '#ffffff' }).jpeg({ quality: 76, mozjpeg: true }).toBuffer();
    const file = `slide-${deck}${index + 1}.jpg`;
    await writeFile(path.join(out, file), jpeg);
    // The slide as the deck contract stores it: pictures by the sha256 of their bytes, never by file.
    const { images: placed = [], ...words } = slide;
    const contract = { ...words, images: placed.map((image) => ({ slot: image.slot, assetSha256: sha(originals[image.photo]), ...(image.crop ? { crop: image.crop } : {}) })) };
    manifest.decks[deck].push({ slide: contract, render: { file: `/demo/dneskai/${file}`, sha256: sha(jpeg), width: 360, height: 450 } });
  }
}
await writeFile(path.join(root, 'src/lib/demo/dneskai-preview-assets.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${Object.keys(manifest.photos).length} photo previews and ${Object.values(manifest.decks).flat().length} slides to ${path.relative(root, out)}`);
