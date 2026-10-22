import { describe, expect, it, vi } from "vitest";
import { OWNER_EDIT_KINDS, OwnerEditCountsSchema, addOwnerEditCounts, ownerEditChainKinds, ownerEditCount, ownerEditKinds, ownerEditLengthDeltas, ownerFeedbackScore, type EditedRevision } from "@/lib/marketing/owner-edits";
import { applyDneskaiDeckEdit } from "@/lib/marketing/dneskai-revision-edit";
import { DNESKAI_SLIDES_VERSION, type DneskaiDeck } from "@/lib/marketing/dneskai-slides";
import { a, b, c, deck } from "./marketing-dneskai-revision-fixture";

vi.mock("server-only", () => ({}));
const base = (): EditedRevision => ({ caption: "Test-only caption.", scheduledAt: "2099-10-21T06:00:00Z", deck: deck() });
const withDeck = (revision: EditedRevision, edit: Parameters<typeof applyDneskaiDeckEdit>[1]): EditedRevision => ({ ...revision, deck: applyDneskaiDeckEdit(revision.deck as DneskaiDeck, edit) });
const statements = (): DneskaiDeck => ({ schemaVersion: DNESKAI_SLIDES_VERSION, format: "carousel", slides: [
  { type: "statement", variant: "accent", headline: "První věta.", images: [], alt: "První textový slide." },
  { type: "statement", variant: "accent", headline: "Druhá věta.", body: "Doplnění.", images: [], alt: "Druhý textový slide." },
  { type: "statement", variant: "ink", headline: "Třetí věta.", images: [], alt: "Třetí textový slide." },
] });

describe("edit kinds between two saved revisions (#122)", () => {
  it("counts a caption and a schedule change, never the same instant written with another offset", () => {
    expect(ownerEditKinds(base(), { ...base(), caption: "Jiný caption." })).toEqual({ caption: 1 });
    expect(ownerEditKinds(base(), { ...base(), scheduledAt: "2099-10-21T08:00:00+02:00" })).toEqual({});
    expect(ownerEditKinds(base(), { ...base(), scheduledAt: "2099-10-21T07:00:00Z" })).toEqual({ schedule: 1 });
    expect(ownerEditKinds(base(), base())).toEqual({});
  });
  it("counts headline and secondary text per field", () => {
    const edited = withDeck(base(), { slides: [{ from: 0, headline: "Nový titulek" }, { from: 1, kicker: "Nový kicker", body: "Jiný text.", alt: "Jiný alt." }, { from: 2 }] });
    expect(ownerEditKinds(base(), edited)).toEqual({ "text-headline": 1, "text-body": 3 });
  });
  it("tells a picture swap from a new crop of the same picture", () => {
    const original = base().deck!.slides[1]!.images;
    const edited = withDeck(base(), { slides: [{ from: 0 }, { from: 1, images: [{ slot: "image-1", assetSha256: c }, { ...original[1]!, crop: { focal: { x: 0.6, y: 0.5 } } }] }, { from: 2 }] });
    expect(ownerEditKinds(base(), edited)).toEqual({ "image-swap": 1, crop: 1 });
    // Same values in another key order are no crop change.
    const reordered = withDeck(base(), { slides: [{ from: 0 }, { from: 1, images: [original[0]!, { ...original[1]!, crop: { zoom: 1.5, fit: "cover", focal: { y: 0.8, x: 0.2 } } }] }, { from: 2 }] });
    expect(ownerEditKinds(base(), reordered)).toEqual({});
  });
  it("counts moved and removed slides from the stored decks alone", () => {
    expect(ownerEditKinds(base(), withDeck(base(), { slides: [{ from: 1 }, { from: 0 }, { from: 2 }] }))).toEqual({ reorder: 1 });
    expect(ownerEditKinds(base(), withDeck(base(), { slides: [{ from: 0 }, { from: 2 }] }))).toEqual({ "remove-slide": 1 });
    const four: EditedRevision = { ...base(), deck: { ...statements(), slides: [...statements().slides, { type: "sources", headline: "", sources: ["Zdroj"], images: [], alt: "Zdroje" }] } };
    expect(ownerEditKinds(four, withDeck(four, { slides: [{ from: 2 }, { from: 0 }, { from: 1 }, { from: 3 }] }))).toEqual({ reorder: 1 });
  });
  it("explains a swap of two slides of the same type as a move, not as rewritten text", () => {
    const revision: EditedRevision = { ...base(), deck: statements() };
    expect(ownerEditKinds(revision, withDeck(revision, { slides: [{ from: 1 }, { from: 0 }, { from: 2 }] }))).toEqual({ reorder: 1 });
    expect(ownerEditKinds(revision, withDeck(revision, { slides: [{ from: 1, headline: "Upravená druhá věta." }, { from: 0 }] }))).toEqual({ "text-headline": 1, reorder: 1, "remove-slide": 1 });
  });
  it("counts only caption and schedule on revisions without a deck", () => {
    expect(ownerEditKinds({ caption: "A", scheduledAt: "2099-10-21T06:00:00Z" }, { caption: "B", scheduledAt: "2099-10-22T06:00:00Z" })).toEqual({ caption: 1, schedule: 1 });
  });
  it("sums a replaces_id chain from the generated revision and scores the decision", () => {
    const generated = base();
    const first = { ...generated, caption: "Druhý caption." };
    const second = withDeck(first, { slides: [{ from: 0, headline: "Nový titulek" }, { from: 1, images: [{ slot: "image-1", assetSha256: a }, { slot: "image-2", assetSha256: b }] }, { from: 2 }] });
    const third = { ...second, caption: "Třetí caption." };
    const kinds = ownerEditChainKinds([generated, first, second, third]);
    expect(kinds).toEqual({ "text-headline": 1, caption: 2, "image-swap": 2 });
    expect(OwnerEditCountsSchema.parse(kinds)).toEqual(kinds);
    expect(Object.keys(kinds)).toEqual(OWNER_EDIT_KINDS.filter((kind) => kind in kinds));
    expect(ownerEditCount(kinds)).toBe(5);
    expect(ownerEditChainKinds([generated])).toEqual({});
    expect(addOwnerEditCounts({ caption: 1 }, { caption: 2, crop: 1 })).toEqual({ caption: 3, crop: 1 });
    expect(ownerFeedbackScore("approved", {})).toBe(1);
    expect(ownerFeedbackScore("approved", kinds)).toBe(0.5);
    expect(ownerFeedbackScore("returned", {})).toBe(0);
    expect(ownerFeedbackScore("skipped", kinds)).toBe(0);
    expect(ownerFeedbackScore("edited", kinds)).toBeNull();
  });
  it("measures how much text changed, in characters, without keeping it", () => {
    const edited = withDeck({ ...base(), caption: "Test-only caption, longer." }, { slides: [{ from: 0, headline: "Krátký" }, { from: 1 }, { from: 2 }] });
    expect(ownerEditLengthDeltas(base(), edited)).toEqual({ captionLengthDelta: 8, slideTextLengthDelta: "Krátký".length - "Nový model umí číst grafy".length });
  });
});
