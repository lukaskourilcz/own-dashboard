import metrics from '../../../templates/marketing/font-metrics.json';

/**
 * Text measurement for the Design Studio, browser-safe: the same advance-width table the server renderer uses
 * (`templates/marketing/font-metrics.json`), so the editor and the published JPEG wrap every line at the same word.
 * A character the table does not know is measured at the face's average width and reported, never thrown.
 */
type Face = { familyName: string; rasterFamily: string; weight: number; file: string; average: number; widths: Record<string, string> };
export const STUDIO_FACES = metrics as unknown as Record<string, Face>;
const tables = new Map<string, Map<string, number>>();
function advances(faceId: string): Map<string, number> {
  const known = tables.get(faceId);
  if (known) return known;
  const table = new Map<string, number>();
  for (const [width, chars] of Object.entries(STUDIO_FACES[faceId]!.widths)) for (const character of chars) table.set(character, Number(width) / 1000);
  tables.set(faceId, table);
  return table;
}

export function measureStudioText(value: string, faceId: string, fontSize: number): { width: number; unknown: number } {
  const table = advances(faceId);
  const average = (STUDIO_FACES[faceId]!.average ?? 550) / 1000;
  let width = 0, unknown = 0;
  for (const character of value.normalize('NFC')) {
    const advance = table.get(character);
    if (advance === undefined) { unknown++; width += average * fontSize; } else width += advance * fontSize;
  }
  return { width, unknown };
}
