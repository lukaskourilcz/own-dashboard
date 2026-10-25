import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { awaitWithSignal } from '@/lib/abortable';
import { exportColumns, EXPORT_MAX_BYTES, EXPORT_MAX_ROWS, type ExportTable } from '@/lib/data-export-columns';
export class DataExportError extends Error { constructor(readonly reason: 'unavailable' | 'too-large' = 'unavailable') { super('Data export unavailable'); } }
export type ExportRows = Record<string, unknown>[];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const sameKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const accountTables = new Set(['invoice_settings', 'user_preferences', 'legacy_personal_archives', 'profiles']);

/** SQL owns completeness and its byte bound. The SDK parses before this receipt
 * validation; this helper does not claim streaming response limits. */
export async function readExportRecords(db: SupabaseClient, ownerId: string, requestedTables: readonly string[], signal: AbortSignal): Promise<Record<string, ExportRows>> {
 const tables = [...requestedTables];
 try {
  z.uuid().parse(ownerId); signal.throwIfAborted();
  if (!tables.length || tables.length > 46 || new Set(tables).size !== tables.length || tables.some(table => !Object.hasOwn(exportColumns, table))) throw new DataExportError();
  const { data, error } = await awaitWithSignal(db.rpc('export_owned_records', { p_tables: [...tables], p_expected_owner: ownerId }).retry(false).abortSignal(signal), signal);
  signal.throwIfAborted();
  if (error) throw new DataExportError(error.code === '54000' ? 'too-large' : 'unavailable');
  if (!object(data) || !sameKeys(data, ['version', 'owner_id', 'tables', 'columns']) || data.version !== 1 || data.owner_id !== ownerId || !object(data.tables) || !object(data.columns) || !sameKeys(data.tables, tables) || !sameKeys(data.columns, tables)) throw new DataExportError();
  if (new TextEncoder().encode(JSON.stringify(data)).byteLength > EXPORT_MAX_BYTES) throw new DataExportError('too-large');
  const result: Record<string, ExportRows> = {};
  for (const table of tables) {
   const expected = exportColumns[table as ExportTable], columns = data.columns[table], rows = data.tables[table];
   if (!Array.isArray(columns) || columns.length !== expected.length || columns.some((key, index) => key !== expected[index]) || !Array.isArray(rows) || rows.length > EXPORT_MAX_ROWS || (accountTables.has(table) && rows.length > 1)) throw new DataExportError();
   const ids = new Set<string>();
   for (const row of rows) {
    if (!object(row) || !sameKeys(row, expected) || row[table === 'profiles' ? 'id' : 'user_id'] !== ownerId) throw new DataExportError();
    const id = row[table === 'invoice_settings' || table === 'user_preferences' || table === 'legacy_personal_archives' ? 'user_id' : 'id'];
    if (!z.uuid().safeParse(id).success || ids.has(id as string)) throw new DataExportError();
    ids.add(id as string);
   }
   result[table] = rows;
  }
  signal.throwIfAborted(); return result;
 } catch (error) {
  if (signal.aborted) throw new DOMException('Request aborted', 'AbortError');
  throw error instanceof DataExportError ? error : new DataExportError();
 }
}
