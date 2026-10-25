/** Decode one decimal/hex character reference; preserve malformed publisher text without throwing. */
export function decodeNumericEntity(reference: string): string {
  const hexadecimal = reference[2]?.toLowerCase() === 'x';
  const codePoint = Number.parseInt(reference.slice(hexadecimal ? 3 : 2, -1), hexadecimal ? 16 : 10);
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff && (codePoint < 0xd800 || codePoint > 0xdfff)
    ? String.fromCodePoint(codePoint) : reference;
}
