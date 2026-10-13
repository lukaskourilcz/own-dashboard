import { z } from 'zod';

export const OFFLINE_IMPORT_FILE_LIMIT = 4 * 1024 * 1024;
export const OFFLINE_IMPORT_BATCH_BYTES = 25 * 1024 * 1024;
export const OFFLINE_IMPORT_BATCH_LIMIT = 42;
const Envelope = z.object({
  campaignId: z.uuid(), entryId: z.uuid(), entryVersion: z.number().int().nonnegative(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  role: z.enum(['carousel', 'thread-question', 'thread-answer', 'story-question', 'story-options', 'story-answer']),
}).passthrough();
export type OfflineImportFile = { text: () => Promise<string>; size: number; name: string };
export type OfflineImportPreview = { body: string; entryId: string; date: string; role: z.infer<typeof Envelope>['role'] };

/** Local preview only. The server revalidates every source, byte hash and owned calendar slot. */
export async function previewOfflineImports(files: OfflineImportFile[]): Promise<OfflineImportPreview[]> {
  if (!files.length || files.length > OFFLINE_IMPORT_BATCH_LIMIT || files.some(file => !file.name.toLowerCase().endsWith('.json') || file.size > OFFLINE_IMPORT_FILE_LIMIT)
    || files.reduce((total, file) => total + file.size, 0) > OFFLINE_IMPORT_BATCH_BYTES) throw new Error('offline-import-file-limit');
  const entries = new Set<string>(); const result: OfflineImportPreview[] = [];
  let totalBytes = 0;
  for (const file of files) {
    const body = await file.text(); const size = new TextEncoder().encode(body).byteLength; totalBytes += size;
    if (size > OFFLINE_IMPORT_FILE_LIMIT || totalBytes > OFFLINE_IMPORT_BATCH_BYTES) throw new Error('offline-import-file-limit');
    const envelope = Envelope.parse(JSON.parse(body));
    if (entries.has(envelope.entryId)) throw new Error('offline-import-duplicate-slot');
    entries.add(envelope.entryId);
    result.push({ body, entryId: envelope.entryId, date: envelope.date, role: envelope.role });
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.role.localeCompare(b.role));
}
