import { capacityAverage, measureEm, resolveFace } from "./fonts.js";
function graphemes(value, locale) {
    if (typeof Intl.Segmenter === "function") {
        return [...new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(value)]
            .map((part) => part.segment);
    }
    return Array.from(value);
}
/** The measure of one line, in px, for a face at a size with letter-spacing. */
function widthOf(face, value, fontSize, tracking) {
    // Tracking is added after every character, including the last, which is what an SVG renderer
    // does and is a hair conservative rather than a hair optimistic.
    return (measureEm(face, value) + tracking * [...value].length) * fontSize;
}
function breakLongWord(word, face, widthPx, fontSize, tracking, locale) {
    if (widthOf(face, word, fontSize, tracking) <= widthPx)
        return [word];
    const parts = graphemes(word, locale);
    const chunks = [];
    let current = "";
    for (const part of parts) {
        if (current && widthOf(face, current + part, fontSize, tracking) > widthPx) {
            chunks.push(current);
            current = part;
            continue;
        }
        current += part;
    }
    if (current)
        chunks.push(current);
    return chunks.length ? chunks : [word];
}
function wrap(value, face, widthPx, fontSize, tracking, maxLines, locale, breakWords) {
    const words = value.normalize("NFC").replaceAll(/\s+/gu, " ").trim().split(" ").filter(Boolean);
    const brokenWords = [];
    const pieces = words.flatMap((word) => {
        if (widthOf(face, word, fontSize, tracking) <= widthPx)
            return [word];
        if (!breakWords)
            return [word];
        brokenWords.push(word);
        return breakLongWord(word, face, widthPx, fontSize, tracking, locale);
    });
    const lines = [];
    let truncated = false;
    let overflowed = false;
    for (const piece of pieces) {
        if (widthOf(face, piece, fontSize, tracking) > widthPx)
            overflowed = true;
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
        const last = lines.at(-1);
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
export function fitText(input) {
    const tracking = input.tracking ?? 0;
    const face = resolveFace(input.fontFamily, input.fontWeight);
    const all = graphemes(input.value.normalize("NFC").trim(), input.locale);
    const normalized = all.slice(0, input.maxChars).join("");
    const clippedByContract = all.length > input.maxChars;
    for (let fontSize = input.maxFontSize; fontSize >= input.minFontSize; fontSize -= 1) {
        const wrapped = wrap(normalized, face, input.widthPx, fontSize, tracking, input.maxLines, input.locale, false);
        const fitsHeight = wrapped.lines.length * fontSize * 1.12 <= input.heightPx;
        if (fitsHeight && !wrapped.truncated && !wrapped.overflowed) {
            return { lines: wrapped.lines, fontSize, truncated: clippedByContract, normalized, brokenWords: [] };
        }
    }
    const wrapped = wrap(normalized, face, input.widthPx, input.minFontSize, tracking, input.maxLines, input.locale, true);
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
export function charactersPerLine(input) {
    const face = resolveFace(input.family, input.weight);
    const advance = capacityAverage(face, input.locale ?? "en") / 1_000 + (input.tracking ?? 0);
    return Math.max(1, Math.floor(input.widthPx / (input.fontSize * advance)));
}
//# sourceMappingURL=text.js.map