import { afterEach, expect, it, vi } from 'vitest';
import { activateMarketingCampaign } from '@/lib/marketing/campaign-activation';
const ownerId = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222', expectedHash = 'a'.repeat(64);
const ack = () => ({ ownerId, campaignId: id, sourceHash: expectedHash, status: 'active' });
const call = (signal = new AbortController().signal) => activateMarketingCampaign({ ownerId, signal }, { id, expectedHash });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
it('accepts only the captured owner/plan/hash receipt and retires its own transport', async () => {
 const fetcher = vi.fn<typeof fetch>(async () => Response.json(ack())); vi.stubGlobal('fetch', fetcher); const parent = new AbortController().signal;
 expect(await call(parent)).toEqual(ack()); expect(fetcher).toHaveBeenCalledOnce();
 expect(fetcher.mock.calls[0]).toEqual(['/api/marketing/campaigns', expect.objectContaining({ method: 'POST', cache: 'no-store', redirect: 'error', headers: { 'Content-Type': 'application/json', 'x-own-dashboard-owner': ownerId }, body: JSON.stringify({ id, expectedHash }) })]);
 expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true); expect(parent.aborted).toBe(false);
});
it.each(['owner', 'campaign', 'hash', 'status', 'extra', 'old-ok', 'null', 'redirect', 'content-type', 'oversized', 'utf8', 'status-201'] as const)('does not claim activation for %s acknowledgement', async kind => {
 const receipt = ack(); if (kind === 'owner') receipt.ownerId = id; if (kind === 'campaign') receipt.campaignId = ownerId; if (kind === 'hash') receipt.sourceHash = 'b'.repeat(64); if (kind === 'status') receipt.status = 'draft'; if (kind === 'extra') Object.assign(receipt, { extra: true });
 const response = kind === 'utf8' ? new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }) : kind === 'oversized' ? new Response(JSON.stringify(receipt).padEnd(1025, ' '), { headers: { 'content-type': 'application/json' } }) : kind === 'content-type' ? new Response(JSON.stringify(receipt)) : Response.json(kind === 'old-ok' ? { ok: true } : kind === 'null' ? null : receipt, { status: kind === 'status-201' ? 201 : 200 });
 if (kind === 'redirect') Object.defineProperty(response, 'redirected', { value: true }); const fetcher = vi.fn(async () => response); vi.stubGlobal('fetch', fetcher);
 await expect(call()).rejects.toMatchObject({ reason: 'unconfirmed' }); expect(fetcher).toHaveBeenCalledOnce();
});
it('accepts the exact success byte ceiling and refuses known changed plans without replay', async () => {
 const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(ack()).padEnd(1024, ' '), { headers: { 'content-type': 'application/json' } })).mockResolvedValueOnce(Response.json({ error: 'campaign-unavailable' }, { status: 409 })); vi.stubGlobal('fetch', fetcher);
 expect(await call()).toEqual(ack()); await expect(call()).rejects.toMatchObject({ reason: 'changed' }); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('starts no request when the original scope retires before HTTP admission', async () => {
 const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); const parent = new AbortController(), pending = call(parent.signal); parent.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(fetcher).not.toHaveBeenCalled();
});
it.each(['headers', 'body'] as const)('ends a held %s consumer within the original allowance and refuses late data', async phase => {
 vi.useFakeTimers(); vi.spyOn(AbortSignal, 'timeout').mockImplementation(milliseconds => { const controller = new AbortController(); setTimeout(() => controller.abort(), milliseconds); return controller.signal; });
 let release!: (response: Response) => void; const cancel = vi.fn();
 const fetcher = vi.fn(() => phase === 'headers' ? new Promise<Response>(resolve => { release = resolve; }) : Promise.resolve(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel }), { headers: { 'content-type': 'application/json' } })));
 vi.stubGlobal('fetch', fetcher); const pending = call(); const observed = expect(pending).rejects.toMatchObject({ reason: 'unconfirmed' }); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce()); await vi.advanceTimersByTimeAsync(35_001); await observed;
 if (phase === 'headers') { release(new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'application/json' } })); await Promise.resolve(); } expect(cancel).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce();
});
