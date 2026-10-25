import { NextResponse } from 'next/server';
import { z } from 'zod';
import { brandConfig } from '@/lib/brand';
import { createClient } from '@/lib/supabase/server';
import { awaitWithSignal, fetchWithSignal } from '@/lib/abortable';
import { exportScopes, exportTables, type ExportScope } from '@/lib/data-export-scopes';
import { exportColumns, EXPORT_MAX_BYTES, type ExportTable } from '@/lib/data-export-columns';
import { DataExportError, readExportRecords } from '@/lib/data-export-records';
import { exportCsv } from '@/lib/data-export-csv';
const privateHeaders = { 'cache-control': 'private, no-store, max-age=0', vary: 'Cookie', 'x-content-type-options': 'nosniff' };
const failure = (status: number, error: string) => NextResponse.json({ error }, { status, headers: privateHeaders });
export async function GET(request: Request, { params }: { params: Promise<{ scope: string }> }) {
 const lifetime = new AbortController();
 const total = AbortSignal.any([request.signal, lifetime.signal, AbortSignal.timeout(30_000)]);
 try {
  const { scope: rawScope } = await awaitWithSignal(params, total);
  if (!exportScopes.includes(rawScope as ExportScope)) return failure(404, 'Unknown export scope.');
  const scope = rawScope as ExportScope, query = new URL(request.url).searchParams;
  if ([...query.keys()].some(key => !['format', 'table'].includes(key) || query.getAll(key).length !== 1)) return failure(400, 'Invalid export options.');
  const format = query.get('format') ?? 'json';
  if (!['json', 'csv'].includes(format) || (format === 'json' && query.has('table')) || (format === 'csv' && (scope === 'full' || scope === 'legacy'))) return failure(400, 'Invalid export options.');
  const supported = scope === 'legacy' ? ['legacy_personal_archives'] : scope === 'full' ? [...new Set([...exportTables.financial, ...exportTables.professional, ...exportTables.knowledge, 'profiles', 'user_preferences'])] : exportTables[scope];
  const csvTable = format === 'csv' ? query.get('table') ?? supported[0] : null;
  if (csvTable !== null && !supported.includes(csvTable)) return failure(400, 'Table is not available in this scope.');
  let phase = AbortSignal.any([total, AbortSignal.timeout(8_000)]);
  const phaseFetch: typeof fetch = (input, init) => fetchWithSignal(phase)(input, init);
  const db = await awaitWithSignal(createClient(total, phaseFetch), phase);
  const auth = await awaitWithSignal(db.auth.getUser(), phase);
  phase.throwIfAborted();
  if (auth.error || !auth.data.user) return failure(401, 'Not authenticated.');
  const owner = auth.data.user.id;
  if (!z.uuid().safeParse(owner).success) return failure(401, 'Not authenticated.');
  const expectedOwner = request.headers.get('x-export-owner');
  if (expectedOwner !== null && expectedOwner !== owner) return failure(409, 'Account changed. Reload before exporting.');
  phase = AbortSignal.any([total, AbortSignal.timeout(15_000)]);
  const records = await readExportRecords(db, owner, csvTable ? [csvTable] : supported, phase);
  phase.throwIfAborted();
  let data: Record<string, unknown>;
  if (scope === 'legacy') {
   const archive = records.legacy_personal_archives[0];
   data = { archive: archive ? { payload: archive.payload, archived_at: archive.archived_at } : null };
  } else if (scope === 'full') {
   const group = (tables: readonly string[]) => Object.fromEntries(tables.map(table => [table, records[table]]));
   data = { account: { profile: records.profiles[0] ?? null, preferences: records.user_preferences[0] ?? null }, financial: group(exportTables.financial), professional: group(exportTables.professional), knowledge: group(exportTables.knowledge) };
  } else data = records;
  const exportedAt = new Date().toISOString();
  const body = csvTable ? exportCsv(records[csvTable], exportColumns[csvTable as ExportTable]) : JSON.stringify({ product: brandConfig.name, schema_version: 1, scope, exported_at: exportedAt, data }, null, 2);
  // The public grouping/pretty JSON and CSV escaping can exceed the RPC size.
  if (new TextEncoder().encode(body).byteLength > EXPORT_MAX_BYTES) return failure(413, 'Export exceeds the download limit. Choose a smaller scope.');
  total.throwIfAborted();
  return new NextResponse(body, { headers: { ...privateHeaders, 'content-type': csvTable ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="${brandConfig.fileNamePrefix}-${csvTable ?? scope}-${exportedAt.slice(0, 10)}.${csvTable ? 'csv' : 'json'}"` } });
 } catch (error) {
  if (error instanceof DataExportError && error.reason === 'too-large') return failure(413, 'Export exceeds the download limit. Choose a smaller scope.');
  return failure(503, 'Data export unavailable. Try again.');
 } finally { lifetime.abort(); }
}
