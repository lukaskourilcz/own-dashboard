import { createHash } from "node:crypto";
import sharp from "sharp";
import { parseSourcePacket, type SourcePacket } from "@/lib/marketing/contracts";
import { contentHash } from "@/lib/marketing/hashes";
import { DNESKAI_BRIEF_VERSION, DneskaiBriefSchema, type DneskaiBrief } from "@/lib/marketing/dneskai-brief";
import { DNESKAI_DECK_TEMPLATE_VERSION, type DneskaiCopy } from "@/lib/marketing/dneskai-generation";
import type { GenerationInput } from "@/lib/marketing/generation";

/**
 * Test-only DNESKAi brief: synthetic sources, synthetic pictures and a Czech answer written for this test.
 * Never use it as a source, a publication or an editorial example.
 */
export const BRIEF_NOW = new Date("2026-10-20T22:00:00Z");
export const REVISION_ID = "55555555-5555-4555-8555-555555555555";
export const ACCOUNT = { id: "17841400000000000", platform: "instagram" as const, handle: "dneskai" };

export type BriefPicture = { sha256: string; bytes: Buffer; width: number; height: number };
async function picture(width: number, height: number, colour: { r: number; g: number; b: number }): Promise<BriefPicture> {
  const bytes = await sharp({ create: { width, height, channels: 3, background: colour } }).jpeg({ quality: 80 }).toBuffer();
  return { sha256: createHash("sha256").update(bytes).digest("hex"), bytes, width, height };
}
export async function briefPictures() {
  return {
    hero: await picture(1600, 1200, { r: 40, g: 90, b: 200 }),
    figure: await picture(1200, 800, { r: 200, g: 120, b: 40 }),
    post: await picture(1080, 1350, { r: 30, g: 160, b: 90 }),
  };
}
export type BriefPictures = Awaited<ReturnType<typeof briefPictures>>;

export function briefFixture(pictures: BriefPictures, patch: Partial<DneskaiBrief> = {}): DneskaiBrief {
  return DneskaiBriefSchema.parse({
    schemaVersion: DNESKAI_BRIEF_VERSION,
    eventId: "brief:test-only-lightroom",
    memberHash: "c".repeat(64),
    targetDate: "2026-10-21",
    category: "tool",
    title: "Lightroom na mobilu otevírá zavřené oči",
    evidence: [
      { candidateId: "c-verge", sourceId: "the-verge", url: "https://www.theverge.com/test-only/lightroom-open-eyes", title: "Adobe Lightroom mobile can now open closed eyes in photos with a simple tap",
        excerpt: "Adobe is adding a Quick Action called Open Eyes to Lightroom on iOS and Android. It is free for 2 uses, then it needs a Creative Cloud plan with AI credits. Adobe did not say how it handles group photos.",
        publishedAt: "2026-10-20T14:00:00Z", dateEstimated: false, captionOnly: false },
      { candidateId: "c-post", sourceId: "instagram:technology", url: "https://www.instagram.com/p/TESTONLY/", title: "Open Eyes in Lightroom mobile",
        excerpt: "We tried the new Open Eyes action in Lightroom mobile on a portrait.", publishedAt: "2026-10-20T16:00:00Z", dateEstimated: false, captionOnly: true },
    ],
    media: [
      { assetSha256: pictures.hero.sha256, candidateId: "c-verge", position: 0, credit: "Obrázek: The Verge", width: 1600, height: 1200, originKind: "og-image", fullBleedCapable: true, insetCapable: true },
      { assetSha256: pictures.figure.sha256, candidateId: "c-verge", position: 1, credit: "Obrázek: The Verge", width: 1200, height: 800, originKind: "article-figure", fullBleedCapable: false, insetCapable: true },
      { assetSha256: pictures.post.sha256, candidateId: "c-post", position: 0, credit: "Foto: @technology", width: 1080, height: 1350, originKind: "instagram-child", fullBleedCapable: true, insetCapable: true },
    ],
    suggestedFormat: "carousel",
    scheduledAt: "2026-10-21T06:00:00Z",
    timeZone: "Europe/Prague",
    observedAt: "2026-10-20T21:30:00Z",
    expiresAt: "2026-10-22T21:30:00Z",
    ...patch,
  });
}

export function briefPacket(brief: DneskaiBrief): SourcePacket {
  const content = {
    title: brief.title, body: brief.evidence.map((item) => item.excerpt).join("\n\n"), category: brief.category, difficulty: null, code: null, options: [], answer: null, explanation: null,
    evidence: brief.evidence.map((item) => ({ url: item.url, title: item.title, excerpt: item.excerpt, checkedAt: brief.observedAt })), image: null,
  };
  return parseSourcePacket({ schemaVersion: "marketing-source/1", brand: "dneskai", kind: "brief", sourceId: brief.eventId, sourceRevision: brief.memberHash, contentHash: contentHash(content),
    canonicalUrl: brief.evidence[0]!.url, locale: "cs", observedAt: brief.observedAt, expiresAt: brief.expiresAt, eligible: true, eligibilityReason: "test-only", content, brief });
}

export function briefInput(packet: SourcePacket): GenerationInput {
  return { source: packet, account: ACCOUNT, scheduledAt: packet.brief!.scheduledAt, templateVersion: DNESKAI_DECK_TEMPLATE_VERSION, knowledge: [], consent: true, revisionId: REVISION_ID };
}

/** A valid answer for `briefFixture`: four written slides, three of them with pictures, and a cover with its headline alone. */
export function validCopy(pictures: BriefPictures): DneskaiCopy {
  return {
    title: "Lightroom otevře zavřené oči",
    caption: "Adobe přidává do mobilního Lightroomu rychlou akci Open Eyes. Když aplikace na fotce najde zavřené oči, nabídne jejich úpravu jedním klepnutím.\n\nZdarma jsou 2 použití, potom je potřeba předplatné Creative Cloud s kredity na AI nástroje. Jak funkce zvládá skupinové fotky, Adobe zatím neuvedlo.",
    hashtags: ["Adobe", "Lightroom", "úpravy fotek"],
    format: "carousel",
    slides: [
      { type: "cover-photo", headline: "Lightroom na mobilu otevře zavřené oči jedním klepnutím", images: [{ slot: "image-1", assetSha256: pictures.hero.sha256 }], alt: "Titulní slide o nové funkci Lightroomu s obrázkem z článku The Verge." },
      { type: "figure", headline: "Rychlá akce Open Eyes najde zavřené oči sama", body: "Funkce je v aplikaci pro iOS i Android. Úpravu nabídne, když na fotce rozpozná zavřené oči.", images: [{ slot: "image-1", assetSha256: pictures.figure.sha256 }], alt: "Slide s obrázkem z článku The Verge o tom, kde funkci najdete." },
      { type: "statement", headline: "Zdarma jsou 2 použití, pak je potřeba předplatné.", body: "Creative Cloud s kredity na AI nástroje.", images: [], alt: "Textový slide o tom, kolik funkce stojí." },
      { type: "split", kicker: "Na Instagramu", headline: "Účet @technology akci vyzkoušel na portrétu", body: "V popisku příspěvku napsal, že novou akci použil na portrétní fotce.", images: [{ slot: "image-1", assetSha256: pictures.post.sha256 }], alt: "Slide s fotkou z příspěvku účtu @technology na Instagramu." },
    ],
  };
}
