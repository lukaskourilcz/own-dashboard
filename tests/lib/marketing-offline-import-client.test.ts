import { describe, expect, it, vi } from 'vitest';
import { OFFLINE_IMPORT_FILE_LIMIT, previewOfflineImports } from '@/lib/marketing/offline-import-client';
const envelope = { campaignId: '11111111-1111-4111-8111-111111111111', entryId: '22222222-2222-4222-8222-222222222222', entryVersion: 0, date: '2026-10-18', role: 'carousel', manifestBase64: 'aGVsbG8=' };
const file = (value: unknown, overrides = {}) => ({ name: 'draft.json', size: JSON.stringify(value).length, text: async () => JSON.stringify(value), ...overrides });
describe('local offline-import preview', () => {
  it('retains the exact request without sending data and gives a small review summary', async () => {
    const result = await previewOfflineImports([file(envelope)]);
    expect(result).toEqual([{ body: JSON.stringify(envelope), entryId: envelope.entryId, date: envelope.date, role: 'carousel' }]);
  });
  it('rejects duplicate slots instead of letting an owner submit the same slot twice', async () => {
    await expect(previewOfflineImports([file(envelope), file({ ...envelope, role: 'thread-answer' })])).rejects.toThrow('duplicate-slot');
  });
  it('rejects oversized selections before reading file contents and bounds actual bytes too', async () => {
    const read = vi.fn();
    await expect(previewOfflineImports([file(envelope, { size: OFFLINE_IMPORT_FILE_LIMIT + 1, text: read })])).rejects.toThrow('file-limit');
    expect(read).not.toHaveBeenCalled();
    await expect(previewOfflineImports([file(envelope, { size: 1, text: async () => 'x'.repeat(OFFLINE_IMPORT_FILE_LIMIT + 1) })])).rejects.toThrow('file-limit');
    await expect(previewOfflineImports(Array.from({ length: 43 }, () => file(envelope)))).rejects.toThrow('file-limit');
  });
  it('rejects unsupported roles, executable markup and missing slot version', async () => {
    await expect(previewOfflineImports([file({ ...envelope, role: 'publish' })])).rejects.toThrow();
    await expect(previewOfflineImports([file(envelope, { text: async () => '<script>alert(1)</script>' })])).rejects.toThrow();
    await expect(previewOfflineImports([file({ ...envelope, entryVersion: undefined })])).rejects.toThrow();
  });
});
