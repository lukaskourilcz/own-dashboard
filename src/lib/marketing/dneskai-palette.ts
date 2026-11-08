import { DNESKAI_PLAN_ALL_TIMES } from './dneskai-plan-view';

/**
 * Ten key-word colours for DNESKAi (owner request, 8 November 2026): the profile reads more colourful when each post
 * marks its key words (`[[…]]`) in its own colour. Only the marked words change; slides carry no highlight boxes.
 * Every colour is drawn on the near-black ground of the photo kits (#0e0f12) and clears WCAG AA for large text there
 * (3:1, the lowest is violet at about 4.4:1). The first is the brand's icy blue of the new avatar.
 */
export const DNESKAI_EMPHASIS_PALETTE = [
  { id: 'icy', hex: '#6ec1ff', label: 'Ledová modrá' },
  { id: 'violet', hex: '#a78bfa', label: 'Fialová' },
  { id: 'pink', hex: '#f472b6', label: 'Růžová' },
  { id: 'coral', hex: '#ff7a6b', label: 'Korálová' },
  { id: 'amber', hex: '#fbbf24', label: 'Jantarová' },
  { id: 'lime', hex: '#a3e635', label: 'Limetková' },
  { id: 'mint', hex: '#34d399', label: 'Mátová' },
  { id: 'cyan', hex: '#22d3ee', label: 'Tyrkysová' },
  { id: 'yellow', hex: '#fde047', label: 'Citronová' },
  { id: 'lilac', hex: '#e879f9', label: 'Šeříková' },
] as const;
export type DneskaiEmphasisHex = (typeof DNESKAI_EMPHASIS_PALETTE)[number]['hex'];
export const DNESKAI_EMPHASIS_HEXES: readonly string[] = DNESKAI_EMPHASIS_PALETTE.map((entry) => entry.hex);

const DAY_MS = 86_400_000;
const pragueParts = (at: Date) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  .formatToParts(at).map((part) => [part.type, part.value]));

/**
 * The colour of the post that goes out at `scheduledAt`. Posts are numbered by their place in the plan (six times a
 * day: 08:00, 10:00, 12:30, 14:30, 19:00, 21:00) and the number walks the palette, so two posts one after the other
 * never share a colour, and a re-render of the same post keeps its colour. A time off the plan counts by its hour.
 */
export function dneskaiEmphasisFor(scheduledAt: string): DneskaiEmphasisHex {
  const at = new Date(scheduledAt);
  if (!Number.isFinite(at.getTime())) return DNESKAI_EMPHASIS_PALETTE[0].hex;
  const parts = pragueParts(at);
  const day = Math.round((Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) - Date.UTC(2026, 0, 1)) / DAY_MS);
  const time = `${parts.hour}:${parts.minute}`;
  const index = (DNESKAI_PLAN_ALL_TIMES as readonly string[]).indexOf(time);
  const slot = index >= 0 ? index : Math.min(DNESKAI_PLAN_ALL_TIMES.length - 1, Math.floor(Number(parts.hour) / 4));
  const ordinal = day * DNESKAI_PLAN_ALL_TIMES.length + slot;
  const count = DNESKAI_EMPHASIS_PALETTE.length;
  return DNESKAI_EMPHASIS_PALETTE[((ordinal % count) + count) % count]!.hex;
}
