import { brandConfig } from '@/lib/brand';
import { awaitWithSignal, fetchWithSignal } from '@/lib/abortable';
import { EXPORT_MAX_BYTES } from '@/lib/data-export-limits';
import { exportScopes, type ExportScope } from '@/lib/data-export-scopes';
export class DataDownloadError extends Error {
 constructor(readonly reason: 'unavailable' | 'too-large' | 'account' = 'unavailable') { super('Download unavailable'); }
}
/** No persistence: the caller holds the bounded file in memory only long
 * enough to start its browser download. Never treats a login page as a file. */
export async function fetchDataExport(ownerId: string, scope: ExportScope | 'transactions-csv', parent: AbortSignal, fetcher: typeof fetch = fetch) {
 const lifetime = new AbortController();
 const signal = AbortSignal.any([parent, lifetime.signal, AbortSignal.timeout(40_000)]);
 let response: Response | undefined;
 try {
  signal.throwIfAborted();
  if (!ownerId || (scope !== 'transactions-csv' && !exportScopes.includes(scope))) throw new DataDownloadError();
  const csv = scope === 'transactions-csv', type = csv ? 'text/csv' : 'application/json';
  const pending = fetchWithSignal(signal, fetcher)(csv ? '/api/export/financial?format=csv&table=transactions' : `/api/export/${scope}`, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { 'x-export-owner': ownerId } });
  void pending.then(late => { if (signal.aborted) void late.body?.cancel().catch(() => undefined); }, () => undefined);
  response = await awaitWithSignal(pending, signal);
  if (!response.ok) throw new DataDownloadError(response.status === 413 ? 'too-large' : [401, 409].includes(response.status) ? 'account' : 'unavailable');
  // Accept only the expected export name, extension and date.
  const disposition = response.headers.get('content-disposition');
  const prefix = `${brandConfig.fileNamePrefix}-${csv ? 'transactions' : scope}-`;
  const match = disposition?.match(/^attachment; filename="([^"\r\n]+)"$/);
  const name = match?.[1];
  if (!name || !name.startsWith(prefix) || !/^\d{4}-\d{2}-\d{2}\.(json|csv)$/.test(name.slice(prefix.length)) || !name.endsWith(csv ? '.csv' : '.json') || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== type || !response.body) throw new DataDownloadError();
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > EXPORT_MAX_BYTES)) throw new DataDownloadError('too-large');
  const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = []; let bytes = 0;
  try {
   while (true) {
    const part = await awaitWithSignal(reader.read(), signal); signal.throwIfAborted();
    if (part.done) break;
    bytes += part.value.byteLength; if (bytes > EXPORT_MAX_BYTES) throw new DataDownloadError('too-large');
    chunks.push(new Uint8Array(part.value));
   }
  } finally { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
  signal.throwIfAborted(); if (!bytes) throw new DataDownloadError();
  return { name, blob: new Blob(chunks, { type: `${type};charset=utf-8` }) };
 } catch (error) {
  if (parent.aborted) throw new DOMException('Request aborted', 'AbortError');
  throw error instanceof DataDownloadError ? error : new DataDownloadError();
 } finally { lifetime.abort(); if (response?.body && !response.body.locked) void response.body.cancel().catch(() => undefined); }
}
