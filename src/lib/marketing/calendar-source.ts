import 'server-only';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { MARKETING_CALENDAR_SOURCES } from '@/lib/marketing-calendars';
import type { MarketingBrand } from './contracts';

/** The full marketing calendar for a brand, read from its committed document (migrated out of Quorum, 9 November 2026). */
export async function readFullMarketingCalendar(brand: MarketingBrand) {
  const source = MARKETING_CALENDAR_SOURCES.find(value => value.project === brand);
  if (!source) throw new Error('calendar-source-unavailable');
  let raw: Buffer;
  try { raw = await readFile(path.join(process.cwd(), source.file)); }
  catch { throw new Error('calendar-source-unavailable'); }
  if (raw.length > 1024 * 1024) throw new Error('calendar-too-large');
  let plan: unknown;
  try { plan = JSON.parse(raw.toString('utf8')); }
  catch { throw new Error('calendar-source-unavailable'); }
  return { ...(plan as Record<string, unknown>), _importProvenance: { file: source.file, fileSha256: createHash('sha256').update(raw).digest('hex') } };
}
