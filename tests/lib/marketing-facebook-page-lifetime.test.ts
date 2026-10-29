import { expect, it, vi } from 'vitest';
import { resolveFacebookPage } from '@/lib/marketing/meta-facebook-page';
vi.mock('server-only', () => ({}));
const settings = () => ({ loginMode: 'facebook' as const, apiVersion: 'v24.0', accessToken: 'TEST-ONLY-USER-TOKEN-00000001' });
const id = '17841400000000001';
it('starts no Page lookup for an original retired scope', async () => {
 const caller = new AbortController(); caller.abort(); const fetcher = vi.fn();
 await expect(resolveFacebookPage(settings(), id, { fetcher, signal: caller.signal })).rejects.toMatchObject({ code: 'meta-request-uncertain', uncertain: true }); expect(fetcher).not.toHaveBeenCalled();
});
it('cannot start a fallback lookup after cancellation while reading the first response', async () => {
 const caller = new AbortController(); let finish!: (value: Response) => void;
 const fetcher = vi.fn(() => new Promise<Response>(done => { finish = done; })), outcome = resolveFacebookPage(settings(), id, { fetcher, signal: caller.signal }).catch(error => error);
 caller.abort(); expect(await outcome).toMatchObject({ code: 'meta-request-uncertain' }); finish(Response.json({ error: { code: 100 } }, { status: 400 })); await Promise.resolve(); expect(fetcher).toHaveBeenCalledOnce();
});
it('holds an oversized Page reply without a fallback or subsequent mutation', async () => {
 const fetcher = vi.fn(async () => Response.json({ data: [], padding: 'x'.repeat(131_073) }));
 await expect(resolveFacebookPage(settings(), id, { fetcher })).rejects.toMatchObject({ code: 'meta-invalid-response', uncertain: true }); expect(fetcher).toHaveBeenCalledOnce();
});
it('retains the original API version and token across a valid Page-token fallback', async () => {
 const captured = settings(), original = { ...captured }; let finish!: (value: Response) => void;
 const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(done => { finish = done; })).mockResolvedValueOnce(Response.json({ id: '1010', instagram_business_account: { id } }));
 const outcome = resolveFacebookPage(captured, id, { fetcher }); captured.apiVersion = 'v99.0'; captured.accessToken = 'TEST-ONLY-OTHER-TOKEN-00000001'; finish(Response.json({ error: { code: 100 } }, { status: 400 }));
 expect(await outcome).toEqual({ pageId: '1010', pageToken: original.accessToken });
 expect(fetcher.mock.calls[1][0]).toContain('/v24.0/me?'); expect(fetcher.mock.calls[1][1].headers.Authorization).toBe('Bearer ' + original.accessToken);
});
