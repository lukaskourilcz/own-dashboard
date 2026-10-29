import { z } from 'zod';
import { BrandSchema } from './contracts';

export const CALENDAR_IMPORT_MAX_ENTRIES = 1000;
export const CALENDAR_IMPORT_MAX_PRELAUNCH = 200;
export const CALENDAR_IMPORT_MAX_REFERENCES = 10_000;
export const CALENDAR_IMPORT_MAX_TEXT = 10_000;
export const CALENDAR_IMPORT_MAX_SOURCE_ID = 300;
export const CALENDAR_IMPORT_MAX_TYPE = 100;
/** The four-digit API/SQL date contract has no year zero. */
export const CalendarImportDateSchema = z.iso.date().refine(value => value >= '0001-01-01');
export const CalendarImportStartSchema = CalendarImportDateSchema.refine(value => value <= '9999-12-25');
export function calendarImportEndDate(start: string) {
  CalendarImportStartSchema.parse(start);
  return CalendarImportDateSchema.parse(new Date(Date.parse(`${start}T12:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10));
}
export const CalendarImportSelectionSchema = z.strictObject({ brand: BrandSchema, startsOn: CalendarImportStartSchema });
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().min(0).max(CALENDAR_IMPORT_MAX_ENTRIES);
const titles = z.array(z.string().min(1).max(CALENDAR_IMPORT_MAX_TEXT).refine(value => value.trim().length > 0)).max(CALENDAR_IMPORT_MAX_REFERENCES).refine(rows => new Set(rows).size === rows.length);
export const CalendarImportReportSchema = z.strictObject({ inputCount: count, outputCount: count, shiftDays: z.number().int().min(-3_652_425).max(3_652_425), held: count, backlog: count, completed: count, unmatchedTipTitles: titles, ambiguousTipTitles: titles })
  .refine(value => value.inputCount === value.outputCount && [value.held, value.backlog, value.completed].every(n => n <= value.inputCount));
export const CalendarImportPreviewSchema = z.strictObject({ ownerId: z.uuid(), importHash: hash, campaign: z.strictObject({ brand: BrandSchema, starts_on: CalendarImportStartSchema, ends_on: CalendarImportDateSchema, source_hash: hash }), report: CalendarImportReportSchema });
export const CalendarImportSavedSchema = z.strictObject({ id: z.uuid(), ownerId: z.uuid(), importHash: hash, sourceHash: hash, report: CalendarImportReportSchema });
