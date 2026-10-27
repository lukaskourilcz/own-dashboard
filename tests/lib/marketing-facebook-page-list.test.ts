import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { readFacebookPages } from '@/lib/marketing/facebook-page-list';
vi.mock('server-only', () => ({}));
const start = () => new URL('https://graph.facebook.com/v24.0/me/accounts?fields=id%2Cname');
const row = z.object({ id: z.string().regex(/^\d+$/), name: z.string().max(200).optional() });
const signal = () => new AbortController().signal;
const page = (data: unknown[], next?: unknown) => ({ status: 200, body: { data, ...(next === undefined ? {} : { paging: next }) } });
const next = (after = 'cursorA') => ({ next: `https://graph.facebook.com/v24.0/123/accounts?after=${after}&access_token=TEST_ONLY_IGNORED_PROVIDER_VALUE`, cursors: { after } });
it('uses the next-page cursor on the original endpoint and never copies provider credentials or fields', async () => {
 const get = vi.fn().mockResolvedValueOnce(page([{ id: '1' }], next())).mockResolvedValueOnce(page([{ id: '2' }]));
 expect(await readFacebookPages(start(), row, get, signal())).toEqual({ kind: 'complete', pages: [{ id: '1' }, { id: '2' }] });
 const request = get.mock.calls[1][0] as URL; expect(request.origin + request.pathname).toBe('https://graph.facebook.com/v24.0/me/accounts'); expect([...request.searchParams]).toEqual([['fields', 'id,name'], ['limit', '25'], ['after', 'cursorA']]);
});
it('follows a valid empty continued page instead of inferring completion from its row count', async () => {
 const get = vi.fn().mockResolvedValueOnce(page([], next())).mockResolvedValueOnce(page([{ id: '2' }])); expect(await readFacebookPages(start(), row, get, signal())).toEqual({ kind: 'complete', pages: [{ id: '2' }] });
});
it('accepts a cursor from a validated next URL when cursors are omitted', async () => {
 const get = vi.fn().mockResolvedValueOnce(page([], { next: next().next })).mockResolvedValueOnce(page([])); expect(await readFacebookPages(start(), row, get, signal())).toEqual({ kind: 'complete', pages: [] });
});
it.each([
 { next: 'https://foreign.example/v24.0/123/accounts?after=x', cursors: { after: 'x' } },
 { next: 'https://graph.facebook.com/v24x0/123/accounts?after=x', cursors: { after: 'x' } },
 { next: 'https://graph.facebook.com/v24.0/123/messages?after=x', cursors: { after: 'x' } },
 { next: 'https://user@graph.facebook.com/v24.0/123/accounts?after=x', cursors: { after: 'x' } },
 { next: 'https://graph.facebook.com/v24.0/123/accounts?after=x#fragment', cursors: { after: 'x' } },
 { next: 'https://graph.facebook.com/v24.0/123/accounts?after=x&after=y', cursors: { after: 'x' } },
 { ...next('x'), cursors: { after: 'y' } }, { next: '' }, { next: null }, { next: 'not a URL', cursors: { after: 'x' } },
 { next: 'https://graph.facebook.com/v24.0/123/accounts', cursors: {} },
])('refuses contradictory or unsafe continuation without another request: %#', async paging => {
 const get = vi.fn(async () => page([], paging)); await expect(readFacebookPages(start(), row, get, signal())).rejects.toMatchObject({ code: 'meta-invalid-response' }); expect(get).toHaveBeenCalledOnce();
});
it('refuses a repeated cursor rather than looping or returning a prefix', async () => {
 const get = vi.fn(async () => page([], next())); await expect(readFacebookPages(start(), row, get, signal())).rejects.toMatchObject({ code: 'meta-invalid-response' }); expect(get).toHaveBeenCalledTimes(2);
});
it('refuses overlapping ids across pages and duplicate ids within a page', async () => {
 const get = vi.fn().mockResolvedValueOnce(page([{ id: '1' }], next())).mockResolvedValueOnce(page([{ id: '1' }])); await expect(readFacebookPages(start(), row, get, signal())).rejects.toMatchObject({ code: 'meta-invalid-response' });
 await expect(readFacebookPages(start(), row, async () => page([{ id: '1' }, { id: '1' }]), signal())).rejects.toMatchObject({ code: 'meta-invalid-response' });
});
it.each([null, {}, { data: null }, { data: [], error: { code: 190 } }, { data: [{ id: 'wrong' }] }, { data: Array.from({ length: 26 }, (_, i) => ({ id: String(i) })) }])('refuses malformed or excessive pages rather than filtering rows: %#', async body => {
 await expect(readFacebookPages(start(), row, async () => ({ status: 200, body }), signal())).rejects.toMatchObject({ code: 'meta-invalid-response' });
});
it('keeps first and later HTTP refusals distinct so only the initial Page-token failure may fall back', async () => {
 expect(await readFacebookPages(start(), row, async () => ({ status: 400, body: null }), signal())).toEqual({ kind: 'http', status: 400, first: true });
 const get = vi.fn().mockResolvedValueOnce(page([], next())).mockResolvedValueOnce({ status: 400, body: null }); expect(await readFacebookPages(start(), row, get, signal())).toEqual({ kind: 'http', status: 400, first: false });
});
it('refuses a continued eleventh page instead of labelling a capped prefix complete', async () => {
 let index = 0; const get = vi.fn(async () => page([], next('cursor' + index++))); await expect(readFacebookPages(start(), row, get, signal())).rejects.toMatchObject({ code: 'meta-invalid-response' }); expect(get).toHaveBeenCalledTimes(10);
});
it('starts no page request after original retirement', async () => {
 const caller = new AbortController(); caller.abort(); const get = vi.fn(); await expect(readFacebookPages(start(), row, get, caller.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(get).not.toHaveBeenCalled();
});
it('bounds an uncooperative page callback under the original signal', async () => {
 const caller = new AbortController(), get = vi.fn(() => new Promise<never>(() => {})), result = readFacebookPages(start(), row, get, caller.signal).catch(error => error); caller.abort(); expect(await result).toMatchObject({ name: 'AbortError' }); expect(get).toHaveBeenCalledOnce();
});
it('returns all 250 rows when the tenth page positively ends', async () => {
 let index = 0; const get = vi.fn(async () => { const current = index++; return page(Array.from({ length: 25 }, (_, i) => ({ id: String(current * 25 + i) })), current === 9 ? undefined : next('cursor' + current)); });
 const result = await readFacebookPages(start(), row, get, signal()); expect(result.kind).toBe('complete'); if (result.kind === 'complete') expect(result.pages).toHaveLength(250); expect(get).toHaveBeenCalledTimes(10);
});
it('cannot start the next page after cancellation during the current request', async () => {
 const caller = new AbortController(), get = vi.fn(async () => { caller.abort(); return page([], next()); });
 await expect(readFacebookPages(start(), row, get, caller.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(get).toHaveBeenCalledOnce();
});
it.each(['https://foreign.example/v24.0/me/accounts?fields=id', 'https://graph.facebook.com/v24.0/me/accounts?fields=id&after=old', 'https://graph.facebook.com/v24.0/me/accounts?fields=id&access_token=TEST_ONLY_INPUT'])('refuses an unsafe or already partial initial request without starting it: %s', async value => {
 const get = vi.fn(); await expect(readFacebookPages(new URL(value), row, get, signal())).rejects.toMatchObject({ code: 'meta-invalid-response' }); expect(get).not.toHaveBeenCalled();
});
