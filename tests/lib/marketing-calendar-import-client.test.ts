import { afterEach, expect, it, vi } from 'vitest';
import { applyCalendarImport, previewCalendarImport } from '@/lib/marketing/calendar-import-client';
import { importOwner, importPreview, importSaved } from './calendar-import-fixture';
const intent = { brand: 'dneskai' as const, startsOn: '2026-10-29' };
const scope = () => ({ ownerId: importOwner, signal: new AbortController().signal });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('uses one captured no-store preview and accepts only matching complete owner/brand/week/count fields', async () => {
 const fetcher = vi.fn<typeof fetch>(async () => Response.json(importPreview())); vi.stubGlobal('fetch', fetcher);
 expect(await previewCalendarImport(scope(), intent)).toEqual(importPreview()); expect(fetcher).toHaveBeenCalledOnce();
 const init = fetcher.mock.calls[0][1] as RequestInit;
 expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error', headers: { 'Content-Type': 'application/json', 'x-own-dashboard-owner': importOwner } });
 expect(JSON.parse(String(init.body))).toEqual({ source: 'repository', ...intent, apply: false }); expect(init.signal?.aborted).toBe(true);
});
it.each(['owner', 'brand', 'start', 'end', 'count', 'held', 'duplicate-title', 'extra-source'] as const)('refuses a preview with mismatching %s', async kind => {
 const value = importPreview();
 if (kind === 'owner') value.ownerId = '33333333-3333-4333-8333-333333333333';
 if (kind === 'brand') value.campaign.brand = 'devshark';
 if (kind === 'start') value.campaign.starts_on = '2026-10-30';
 if (kind === 'end') value.campaign.ends_on = '2026-11-05';
 if (kind === 'count') value.report.outputCount--;
 if (kind === 'held') value.report.held = 157;
 if (kind === 'duplicate-title') value.report.unmatchedTipTitles.push(value.report.unmatchedTipTitles[0]);
 vi.stubGlobal('fetch', vi.fn(async () => Response.json(kind === 'extra-source' ? { ...value, source_snapshot: { private: 'TEST_ONLY_PRIVATE' } } : value)));
 await expect(previewCalendarImport(scope(), intent)).rejects.toMatchObject({ reason: 'unavailable' });
});
it('captures both preview fingerprints for one save without an extra read', async () => {
 const fetcher = vi.fn<typeof fetch>(async () => Response.json(importSaved())); vi.stubGlobal('fetch', fetcher);
 expect(await applyCalendarImport(scope(), intent, importPreview())).toEqual(importSaved()); expect(fetcher).toHaveBeenCalledOnce();
 expect(JSON.parse(String(fetcher.mock.calls[0][1]!.body))).toEqual({ source: 'repository', ...intent, apply: true, expectedHash: 'a'.repeat(64), expectedImportHash: 'b'.repeat(64) });
});
it.each(['owner', 'hash', 'source', 'report', 'id'] as const)('never acknowledges a mismatching saved %s', async kind => {
 const value = importSaved();
 if (kind === 'owner') value.ownerId = '33333333-3333-4333-8333-333333333333';
 if (kind === 'hash') value.importHash = 'c'.repeat(64);
 if (kind === 'source') value.sourceHash = 'c'.repeat(64);
 if (kind === 'report') value.report.held++;
 if (kind === 'id') value.id = 'not-a-uuid';
 vi.stubGlobal('fetch', vi.fn(async () => Response.json(value)));
 await expect(applyCalendarImport(scope(), intent, importPreview())).rejects.toMatchObject({ reason: 'unconfirmed' });
});
it('refuses a foreign preview before any write request', () => {
 const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); const foreign = importPreview(); foreign.ownerId = '33333333-3333-4333-8333-333333333333';
 expect(() => applyCalendarImport(scope(), intent, foreign)).toThrow(); expect(fetcher).not.toHaveBeenCalled();
});
it.each(['before', 'same-turn'] as const)('refuses %s retirement before network admission', async kind => {
 const controller = new AbortController(), fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
 if (kind === 'before') controller.abort();
 const pending = previewCalendarImport({ ownerId: importOwner, signal: controller.signal }, intent); if (kind === 'same-turn') controller.abort();
 await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(fetcher).not.toHaveBeenCalled();
});
it('retires a held header consumer and disposes its late body without retry', async () => {
 let finish!: (value: Response) => void;
 const controller = new AbortController(), fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })); vi.stubGlobal('fetch', fetcher);
 const pending = applyCalendarImport({ ownerId: importOwner, signal: controller.signal }, intent, importPreview()); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
 const refused = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); controller.abort('TEST_ONLY_PRIVATE'); await refused;
 const cancel = vi.fn(); finish(new Response(new ReadableStream({ cancel }))); await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce()); expect(fetcher).toHaveBeenCalledOnce();
});
it.each(['claimed-size', 'actual-size', 'utf8', 'html', 'partial', 'malformed'] as const)('refuses %s response bytes without a positive receipt', async kind => {
 const response = kind === 'html' ? new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } })
   : kind === 'partial' ? Response.json(importPreview(), { status: 206 })
   : kind === 'utf8' ? new Response(new Uint8Array([255]), { headers: { 'Content-Type': 'application/json' } })
   : kind === 'malformed' ? new Response('{', { headers: { 'Content-Type': 'application/json' } })
   : new Response(kind === 'actual-size' ? 'x'.repeat(1_100_001) : '{}', { headers: { 'Content-Type': 'application/json', ...(kind === 'claimed-size' ? { 'Content-Length': '1100001' } : {}) } });
 vi.stubGlobal('fetch', vi.fn(async () => response));
 await expect(previewCalendarImport(scope(), intent)).rejects.toMatchObject({ reason: 'unavailable' }); expect(response.body?.locked).toBe(false);
});
it('keeps one original header/body deadline and never exposes private refusal prose', async () => {
 const deadline = new AbortController(); vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
 const cancel = vi.fn(), response = new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'application/json' } });
 vi.stubGlobal('fetch', vi.fn(async () => response));
 const pending = applyCalendarImport(scope(), intent, importPreview()); await vi.waitFor(() => expect(response.body?.locked).toBe(true));
 const refused = expect(pending).rejects.toMatchObject({ reason: 'unconfirmed', message: 'Calendar import unavailable' }); deadline.abort('TEST_ONLY_PRIVATE'); await refused;
 expect(AbortSignal.timeout).toHaveBeenCalledExactlyOnceWith(65_000); expect(response.body?.locked).toBe(false); expect(cancel).toHaveBeenCalledOnce();
});
it('distinguishes a refused changed preview from an uncertain save', async () => {
 const fetcher = vi.fn(async () => Response.json({ error: 'calendar-import-preview-changed' }, { status: 409 })); vi.stubGlobal('fetch', fetcher);
 await expect(applyCalendarImport(scope(), intent, importPreview())).rejects.toMatchObject({ reason: 'changed' });
 fetcher.mockResolvedValueOnce(Response.json({ error: 'TEST_ONLY_PRIVATE' }, { status: 503 }));
 await expect(applyCalendarImport(scope(), intent, importPreview())).rejects.toMatchObject({ reason: 'unconfirmed', message: 'Calendar import unavailable' }); expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each([false, true])('explains a positively refused invalid source without treating apply=%s as a network problem', async apply => {
 const fetcher = vi.fn(async () => Response.json({ error: 'calendar-import-plan-invalid' }, { status: 400 })); vi.stubGlobal('fetch', fetcher);
 await expect(apply ? applyCalendarImport(scope(), intent, importPreview()) : previewCalendarImport(scope(), intent)).rejects.toMatchObject({ reason: 'invalid-source' }); expect(fetcher).toHaveBeenCalledOnce();
});
it('accepts the inclusive last seven-day window without requiring an unrepresentable eighth day', async () => {
 const value = importPreview(); value.campaign.starts_on = '9999-12-25'; value.campaign.ends_on = '9999-12-31';
 vi.stubGlobal('fetch', vi.fn(async () => Response.json(value)));
 expect(await previewCalendarImport(scope(), { brand: 'dneskai', startsOn: '9999-12-25' })).toEqual(value);
});
it('refuses year zero or an overflowing chosen week before any request', () => {
 const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
 for (const startsOn of ['0000-01-01', '9999-12-31']) expect(() => previewCalendarImport(scope(), { brand: 'dneskai', startsOn })).toThrow(); expect(fetcher).not.toHaveBeenCalled();
});
it('does not display empty review references from a malformed reply', async () => {
 const value = importPreview(); value.report.unmatchedTipTitles = ['   ']; vi.stubGlobal('fetch', vi.fn(async () => Response.json(value)));
 await expect(previewCalendarImport(scope(), intent)).rejects.toMatchObject({ reason: 'unavailable' });
});
