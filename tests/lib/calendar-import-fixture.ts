import type { CalendarImportPreview } from '@/lib/marketing/calendar-import-client';
export const importOwner = '11111111-1111-4111-8111-111111111111';
export const importPreview = (): CalendarImportPreview => ({ ownerId: importOwner, importHash: 'b'.repeat(64), campaign: { brand: 'dneskai', starts_on: '2026-10-29', ends_on: '2026-11-04', source_hash: 'a'.repeat(64) }, report: { inputCount: 156, outputCount: 156, shiftDays: 11, held: 30, backlog: 100, completed: 2, unmatchedTipTitles: ['A useful reference'], ambiguousTipTitles: [] } });
export const importSaved = () => ({ id: '22222222-2222-4222-8222-222222222222', ownerId: importOwner, importHash: importPreview().importHash, sourceHash: importPreview().campaign.source_hash, report: importPreview().report });
