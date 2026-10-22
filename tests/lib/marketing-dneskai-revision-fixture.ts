import { MARKETING_DECK_CONTENT_VERSION, parseContentRevision, type ContentRevision } from "@/lib/marketing/contracts";
import { DNESKAI_SLIDES_VERSION, type DneskaiDeck } from "@/lib/marketing/dneskai-slides";

/** Test-only DNESKAi deck revision: three slides, three rendered JPEG assets, synthetic hashes and signed URLs. */
export const a = "a".repeat(64), b = "b".repeat(64), c = "c".repeat(64), d = "d".repeat(64), e = "e".repeat(64);
export const signed = (n: number, token = "first-test-only-token") =>
  `https://test-only.supabase.co/storage/v1/object/sign/marketing-assets/11111111-1111-4111-8111-111111111111/marketing/dneskai/33333333-3333-4333-8333-333333333333/${"f".repeat(64)}/${n}-${[d, e, c][n - 1]}.jpg?token=${token}`;
export function deck(): DneskaiDeck {
  return { schemaVersion: DNESKAI_SLIDES_VERSION, format: "carousel", slides: [
    { type: "cover-photo", headline: "Nový model umí číst grafy", images: [{ slot: "image-1", assetSha256: a, crop: { focal: { x: 0.5, y: 0.4 } } }], alt: "Titulní fotka" },
    { type: "split", headline: "Dva pohledy", body: "Text slidu.", images: [{ slot: "image-1", assetSha256: b }, { slot: "image-2", assetSha256: a, crop: { focal: { x: 0.2, y: 0.8 }, zoom: 1.5, fit: "cover" } }], alt: "Dvě fotky" },
    { type: "statement", headline: "Výrok k ověření sazby.", images: [], alt: "Výrok" },
  ] };
}
export function deckRevision(): ContentRevision {
  return parseContentRevision({ schemaVersion: MARKETING_DECK_CONTENT_VERSION, brand: "dneskai", title: "Test-only DNESKAi carousel", caption: "Test-only caption.",
    format: "carousel", sources: [{ sourceId: "brief:test-only", sourceRevision: "v1", contentHash: a }], knowledgeIds: [],
    assets: [1, 2, 3].map((n) => ({ url: signed(n), sha256: [d, e, c][n - 1], mimeType: "image/jpeg", width: 1080, height: 1350, alt: `Slide ${n}` })),
    account: { id: "17841400000000000", platform: "instagram", handle: "dneskai" }, scheduledAt: "2099-10-21T06:00:00Z", timeZone: "Europe/Prague",
    templateVersion: "dneskai-photo/1", promptVersion: "marketing-copy/5", model: "claude-sonnet-5-5", traceId: null, deck: deck() });
}
