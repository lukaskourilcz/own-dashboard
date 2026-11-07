import { capacityAverage, measureEm, resolveFace } from "./fonts.js";
import type { FaceMetrics } from "./font-metrics.generated.js";
import type { PublishingLocale } from "./schema.js";

export interface FittedText {
  lines: string[];
  fontSize: number;
  truncated: boolean;
  normalized: string;
  /**
   * A word too long for the measure at every size the layer allows, broken to make it fit.
   *
   * Reported rather than hidden. The old fitter chopped any over-long word into fixed-size
   * fragments with no hyphen and no signal, then treated the chop as a successful fit and stopped
   * stepping down — so `NEJNEOBHOSPODAŘOVÁVATELNĚJŠÍ` set at full size as two fragments, both
   * running off the canvas, and every check said the slide was fine.
   */
  brokenWords: string[];
}

function graphemes(value: string, locale: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    return [...new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(value)]
      .map((part) => part.segment);
  }
  return Array.from(value);
}

/** The measure of one line, in px, for a face at a size with letter-spacing. */
function widthOf(face: FaceMetrics, value: string, fontSize: number, tracking: number): number {
  // Tracking is added after every character, including the last, which is what an SVG renderer
  // does and is a hair conservative rather than a hair optimistic.
  return (measureEm(face, value) + tracking * [...value].length) * fontSize;
}

function breakLongWord(word: string, face: FaceMetrics, widthPx: number, fontSize: number, tracking: number, locale: string): string[] {
  if (widthOf(face, word, fontSize, tracking) <= widthPx) return [word];
  const parts = graphemes(word, locale);
  const chunks: string[] = [];
  let current = "";
  for (const part of parts) {
    if (current && widthOf(face, current + part, fontSize, tracking) > widthPx) {
      chunks.push(current);
      current = part;
      continue;
    }
    current += part;
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [word];
}

interface Wrapped { lines: string[]; truncated: boolean; brokenWords: string[]; overflowed: boolean }

/**
 * Which spaces a line may not break at.
 *
 * Absent, any space breaks, which is what every carousel-template/1 layer has always done and must
 * keep doing: its recorded hashes were drawn that way. `cs` keeps the Czech typesetting ties
 * (ČSN 01 6910): a one-letter preposition or conjunction — v, k, s, z, o, u, a, i, in either
 * case — never ends a line but goes down with the word after it; the digit groups of one number
 * ("10 000") stay together; a number keeps the unit, percent sign or currency after it ("50 %",
 * "3 GB", "100 Kč", "10 mil."); and a no-break space the writer typed is honoured. The lines are
 * still drawn with ordinary spaces.
 */
export type KeepWithNext = "cs";

/** A one-letter preposition or conjunction, after any opening bracket or quote. */
const CS_SINGLE_LETTER = /^[\p{Ps}\p{Pi}"']*[vkszouaiVKSZOUAI]$/u;
/** A number: optional sign, currency or opening mark, then digits with decimal or group marks. */
const CS_NUMBER = /^[\p{Ps}\p{Pi}"'+\-−±~≈\p{Sc}]*\d(?:[\d.,]*\d)?$/u;
/** The next group of a number written with spaces: exactly three digits. */
const CS_DIGIT_GROUP = /^\d{3}(?!\d)/u;
/** Closing marks a unit may carry: "50 %," or "(3 GB)". The dot is kept off "tis." by the list. */
const CS_TRAILING = /[.,;:!?…)\]}"'“”»’]+$/u;
const CS_UNITS = new Set([
  "%", "‰", "‱", "°", "°C", "°F", "×",
  "Kč", "€", "$", "£", "¥", "USD", "EUR", "CZK",
  "tis", "mil", "mld", "bil",
  "km", "m", "cm", "mm", "µm", "μm", "nm", "kg", "g", "mg", "t", "l", "ml",
  "s", "ms", "µs", "μs", "ns", "min", "h",
  "B", "kB", "KB", "MB", "GB", "TB", "PB", "kb", "Mb", "Gb", "Tb",
  "Hz", "kHz", "MHz", "GHz", "W", "kW", "MW", "GW", "kWh", "MWh", "GWh", "TWh", "V", "mAh",
  "px", "pt", "dpi", "fps"
]);
const NO_BREAK_SPACE = /^[   ]+$/u;

/** Whether the space between two words is a tie under `cs`. */
function tiedCs(previous: string, separator: string, next: string): boolean {
  if (NO_BREAK_SPACE.test(separator)) return true;
  if (CS_SINGLE_LETTER.test(previous)) return true;
  if (!CS_NUMBER.test(previous)) return false;
  return CS_DIGIT_GROUP.test(next) || CS_UNITS.has(next.replace(CS_TRAILING, ""));
}

/**
 * The words of a passage, in the groups a line may not break inside.
 *
 * Without `keepWithNext` every word is its own group, split exactly as the fitter always split
 * them, so a v1 layer sets the lines it always set.
 */
function tieGroups(value: string, keepWithNext: KeepWithNext | undefined): string[][] {
  if (keepWithNext === undefined) {
    return value.normalize("NFC").replaceAll(/\s+/gu, " ").trim().split(" ").filter(Boolean).map((word) => [word]);
  }
  // Words at even places, the whitespace between them at odd ones.
  const parts = value.normalize("NFC").trim().split(/(\s+)/u);
  const groups: string[][] = [];
  for (let index = 0; index < parts.length; index += 2) {
    const word = parts[index]!;
    if (!word) continue;
    const group = groups.at(-1);
    const previous = group?.at(-1);
    if (group && previous !== undefined && tiedCs(previous, parts[index - 1] ?? " ", word)) group.push(word);
    else groups.push([word]);
  }
  return groups;
}

function wrap(
  value: string,
  face: FaceMetrics,
  widthPx: number,
  fontSize: number,
  tracking: number,
  maxLines: number,
  locale: string,
  breakWords: boolean,
  keepWithNext?: KeepWithNext
): Wrapped {
  const brokenWords: string[] = [];
  const pieces = tieGroups(value, keepWithNext).flatMap((group) => {
    // A tied group is laid as one word, drawn with its ordinary spaces.
    const joined = group.join(" ");
    if (widthOf(face, joined, fontSize, tracking) <= widthPx) return [joined];
    if (!breakWords) return [joined];
    // A tie wider than the measure is let go before any word in it is broken.
    return group.flatMap((word) => {
      if (widthOf(face, word, fontSize, tracking) <= widthPx) return [word];
      brokenWords.push(word);
      return breakLongWord(word, face, widthPx, fontSize, tracking, locale);
    });
  });
  const lines: string[] = [];
  let truncated = false;
  let overflowed = false;
  for (const piece of pieces) {
    if (widthOf(face, piece, fontSize, tracking) > widthPx) overflowed = true;
    const current = lines.at(-1);
    if (current === undefined) {
      lines.push(piece);
      continue;
    }
    if (widthOf(face, `${current} ${piece}`, fontSize, tracking) <= widthPx) {
      lines[lines.length - 1] = `${current} ${piece}`;
      continue;
    }
    if (lines.length >= maxLines) {
      truncated = true;
      break;
    }
    lines.push(piece);
  }
  if (truncated && lines.length) {
    const last = lines.at(-1)!;
    const parts = graphemes(last, locale);
    let trimmed = last;
    while (parts.length && widthOf(face, `${trimmed}…`, fontSize, tracking) > widthPx) {
      parts.pop();
      trimmed = parts.join("");
    }
    lines[lines.length - 1] = `${trimmed.replace(/…$/u, "")}…`;
  }
  return { lines, truncated, brokenWords, overflowed };
}

/**
 * The largest size at which a string sets inside its frame, and how it breaks there.
 *
 * Measured against the committed advance widths of the face the layer will actually be drawn in,
 * so all-caps is charged what all-caps costs and a condensed face is charged what it saves. A
 * candidate size is accepted only when every line — including the longest single word — fits the
 * measure whole. Falling all the way through, the minimum size is used and the word is broken,
 * which is a worse slide and is reported as one rather than passed off as a fit.
 */
export function fitText(input: {
  value: string;
  locale: "en" | "cs";
  widthPx: number;
  heightPx: number;
  minFontSize: number;
  maxFontSize: number;
  maxLines: number;
  maxChars: number;
  /** The family the layer draws in, as the brand names it. */
  fontFamily: string;
  fontWeight: number;
  /** Letter-spacing in em, which widens every character and so narrows every line. */
  tracking?: number;
  /** Spaces a line may not break at; absent, any space breaks (see `KeepWithNext`). */
  keepWithNext?: KeepWithNext;
}): FittedText {
  const tracking = input.tracking ?? 0;
  const face = resolveFace(input.fontFamily, input.fontWeight);
  const all = graphemes(input.value.normalize("NFC").trim(), input.locale);
  const normalized = all.slice(0, input.maxChars).join("");
  const clippedByContract = all.length > input.maxChars;
  for (let fontSize = input.maxFontSize; fontSize >= input.minFontSize; fontSize -= 1) {
    const wrapped = wrap(normalized, face, input.widthPx, fontSize, tracking, input.maxLines, input.locale, false, input.keepWithNext);
    const fitsHeight = wrapped.lines.length * fontSize * 1.12 <= input.heightPx;
    if (fitsHeight && !wrapped.truncated && !wrapped.overflowed) {
      return { lines: wrapped.lines, fontSize, truncated: clippedByContract, normalized, brokenWords: [] };
    }
  }
  const wrapped = wrap(normalized, face, input.widthPx, input.minFontSize, tracking, input.maxLines, input.locale, true, input.keepWithNext);
  return {
    lines: wrapped.lines,
    fontSize: input.minFontSize,
    truncated: clippedByContract || wrapped.truncated || wrapped.brokenWords.length > 0,
    normalized,
    brokenWords: wrapped.brokenWords
  };
}

/**
 * How many characters of a face fit one line, at a size, tracked, in one language.
 *
 * The overflow check's question, and it needs one number rather than a measured string: it is
 * asking whether a slot's declared character limit *could* fit, not whether one particular
 * passage does. The face's own mean letter width is the honest answer — a condensed headline is
 * charged what it saves, rather than every face being charged one constant fitted to Czech
 * sentence case in a grotesque.
 *
 * The language is part of the question for the same reason the face is. Literata sets Cyrillic
 * eight per cent wider than Latin, so a Ukrainian slot measured against the Latin mean is told it
 * holds twelve characters it cannot. Omitting the language charges the Latin mean, which is what
 * every slot was charged before languages were declared at all.
 */
export function charactersPerLine(input: {
  widthPx: number;
  fontSize: number;
  /** The family the slot draws in, as the brand names it. */
  family: string;
  weight: number;
  /** Letter-spacing in em, which widens every character and so shortens every line. */
  tracking?: number;
  locale?: PublishingLocale;
}): number {
  const face = resolveFace(input.family, input.weight);
  const advance = capacityAverage(face, input.locale ?? "en") / 1_000 + (input.tracking ?? 0);
  return Math.max(1, Math.floor(input.widthPx / (input.fontSize * advance)));
}
