import { z } from "zod";
import type { ContentRevision } from "./contracts";
import type { DneskaiDeck, DneskaiSlide } from "./dneskai-slides";

/**
 * What the owner changed in a generated post before deciding on it (#122), as counts of edit kinds and never as
 * text. Each save in the review UI (#118) stores a new revision whose `replaces_id` points at the one it edited, so
 * the chain from the generated revision to the decided one is the whole edit history. LangSmith feedback and the
 * owner-edits dataset carry only these counts.
 *
 * - `text-headline`: a slide's headline changed.
 * - `text-body`: a slide's body, kicker, picture credit or alt text changed (one per field).
 * - `caption`, `schedule`: the caption or the publication time changed.
 * - `image-swap`: a slot shows another picture; `crop`: the same picture with another crop.
 * - `reorder`: slides moved (the fewest moves that turn the old order into the new one).
 * - `remove-slide`: a slide was dropped.
 */
export const OWNER_EDIT_KINDS = ["text-headline", "text-body", "caption", "image-swap", "crop", "reorder", "remove-slide", "schedule"] as const;
export type OwnerEditKind = (typeof OWNER_EDIT_KINDS)[number];
export type OwnerEditCounts = Partial<Record<OwnerEditKind, number>>;
const count = z.number().int().min(1).max(10000).optional();
export const OwnerEditCountsSchema = z.strictObject({
  "text-headline": count, "text-body": count, caption: count, "image-swap": count, crop: count, reorder: count, "remove-slide": count, schedule: count,
});

/** The part of a revision an owner edit can change. */
export type EditedRevision = Pick<ContentRevision, "caption" | "scheduledAt"> & { deck?: Pick<DneskaiDeck, "slides"> | undefined };

function add(counts: OwnerEditCounts, kind: OwnerEditKind, by = 1) {
  if (by > 0) counts[kind] = (counts[kind] ?? 0) + by;
}
/** Canonical JSON of a crop, so key order is never a change. */
const cropKey = (crop: DneskaiSlide["images"][number]["crop"]) => crop === undefined ? "" : JSON.stringify({ focal: { x: crop.focal.x, y: crop.focal.y }, zoom: crop.zoom ?? null, fit: crop.fit ?? null });
const slotKey = (slide: DneskaiSlide) => slide.images.map((image) => image.slot).sort().join(",");
/** An edit keeps a slide's type, variant and image slots; only such a pair can be the same slide. */
const sameSlide = (left: DneskaiSlide, right: DneskaiSlide) => left.type === right.type && left.variant === right.variant && slotKey(left) === slotKey(right);
const TEXT_FIELDS = ["body", "kicker", "credit", "alt"] as const;

function slideChanges(before: DneskaiSlide, after: DneskaiSlide): OwnerEditCounts {
  const counts: OwnerEditCounts = {};
  if (before.headline !== after.headline) add(counts, "text-headline");
  for (const field of TEXT_FIELDS) if ((before[field] ?? "") !== (after[field] ?? "")) add(counts, "text-body");
  for (const image of after.images) {
    const previous = before.images.find((candidate) => candidate.slot === image.slot);
    if (!previous) continue;
    if (previous.assetSha256 !== image.assetSha256) add(counts, "image-swap");
    else if (cropKey(previous.crop) !== cropKey(image.crop)) add(counts, "crop");
  }
  return counts;
}
const total = (counts: OwnerEditCounts) => Object.values(counts).reduce((sum, value) => sum + (value ?? 0), 0);
const bitCount = (mask: number) => { let bits = 0; for (let value = mask; value; value &= value - 1) bits += 1; return bits; };

/**
 * Which earlier slide each slide of the edited deck is. The stored decks do not keep the edit's `from` indexes, so
 * the match is the one that explains the edit with the fewest field changes, then with the fewest slides out of
 * order: an exact search over at most ten slides. `null` marks a slide no earlier slide can be.
 */
function matchSlides(before: readonly DneskaiSlide[], after: readonly DneskaiSlide[]): (number | null)[] {
  type Best = { cost: number; inversions: number; picks: (number | null)[] };
  const memo = new Map<string, Best>();
  const UNMATCHED = 1000;
  const solve = (index: number, used: number): Best => {
    if (index === after.length) return { cost: 0, inversions: 0, picks: [] };
    const key = `${index}:${used}`;
    const known = memo.get(key);
    if (known) return known;
    const rest = solve(index + 1, used);
    let best: Best = { cost: UNMATCHED + rest.cost, inversions: rest.inversions, picks: [null, ...rest.picks] };
    before.forEach((candidate, position) => {
      if (used & (1 << position) || !sameSlide(candidate, after[index]!)) return;
      const tail = solve(index + 1, used | (1 << position));
      const cost = total(slideChanges(candidate, after[index]!)) + tail.cost;
      // Earlier picks of a later slide put this one out of order.
      const inversions = bitCount(used & ~((1 << (position + 1)) - 1)) + tail.inversions;
      if (cost < best.cost || (cost === best.cost && inversions < best.inversions)) best = { cost, inversions, picks: [position, ...tail.picks] };
    });
    memo.set(key, best);
    return best;
  };
  return solve(0, 0).picks;
}

/** The fewest moves that restore an order: slides outside its longest increasing run. */
function moves(order: readonly number[]): number {
  const tails: number[] = [];
  for (const value of order) {
    let low = 0, high = tails.length;
    while (low < high) { const middle = (low + high) >> 1; if (tails[middle]! < value) low = middle + 1; else high = middle; }
    tails[low] = value;
  }
  return order.length - tails.length;
}

/** The edit kinds of one save: `after` is the revision stored with `replaces_id` = `before`. */
export function ownerEditKinds(before: EditedRevision, after: EditedRevision): OwnerEditCounts {
  const counts: OwnerEditCounts = {};
  if (before.caption !== after.caption) add(counts, "caption");
  if (Date.parse(before.scheduledAt) !== Date.parse(after.scheduledAt)) add(counts, "schedule");
  const previous = before.deck?.slides ?? [];
  const next = after.deck?.slides ?? [];
  if (!previous.length || !next.length) return counts;
  const picks = matchSlides(previous, next);
  const matched = picks.flatMap((pick, index) => pick === null ? [] : [{ before: previous[pick]!, after: next[index]!, pick }]);
  for (const pair of matched) for (const [kind, value] of Object.entries(slideChanges(pair.before, pair.after))) add(counts, kind as OwnerEditKind, value);
  add(counts, "reorder", moves(matched.map((pair) => pair.pick)));
  add(counts, "remove-slide", previous.length - matched.length);
  return counts;
}

/** Sums of counts, in the fixed kind order. */
export function addOwnerEditCounts(...values: OwnerEditCounts[]): OwnerEditCounts {
  const sum: OwnerEditCounts = {};
  for (const kind of OWNER_EDIT_KINDS) add(sum, kind, values.reduce((result, value) => result + (value[kind] ?? 0), 0));
  return sum;
}

/** Every save of a chain, from the generated revision (`chain[0]`) to the decided one. */
export function ownerEditChainKinds(chain: readonly EditedRevision[]): OwnerEditCounts {
  return addOwnerEditCounts(...chain.slice(1).map((revision, index) => ownerEditKinds(chain[index]!, revision)));
}

export function ownerEditCount(counts: OwnerEditCounts): number {
  return total(counts);
}

export type OwnerDecision = "approved" | "returned" | "skipped" | "edited";
/**
 * The owner-review score of a decision: approved as generated 1, approved after edits 0.5, returned or skipped 0.
 * An edit is not a decision and carries no score; its kinds go with the `owner-edit` feedback instead.
 */
export function ownerFeedbackScore(decision: OwnerDecision, edits: OwnerEditCounts): number | null {
  if (decision === "edited") return null;
  if (decision === "approved") return ownerEditCount(edits) > 0 ? 0.5 : 1;
  return 0;
}

/** Character deltas between the generated and the decided revision: how much the owner rewrote, never what. */
export function ownerEditLengthDeltas(generated: EditedRevision, decided: EditedRevision): { captionLengthDelta: number; slideTextLengthDelta: number } {
  const slideText = (revision: EditedRevision) => (revision.deck?.slides ?? []).reduce((sum, slide) => sum + [slide.headline, ...TEXT_FIELDS.map((field) => slide[field] ?? "")].reduce((length, value) => length + [...value].length, 0), 0);
  return { captionLengthDelta: [...decided.caption].length - [...generated.caption].length, slideTextLengthDelta: slideText(decided) - slideText(generated) };
}
