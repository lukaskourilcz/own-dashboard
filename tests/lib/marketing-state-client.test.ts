import { afterEach, expect, it, vi } from 'vitest';
import { loadMarketingState } from '@/lib/marketing/client';
import { marketingStateFixture, stateOwner, stateId } from './marketing-state-fixture';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const read = (signal = new AbortController().signal, owner = stateOwner) => loadMarketingState(signal, owner);
it('accepts one complete original-owner snapshot with explicit no-store/captured-owner fetch', async () => {
 const value = marketingStateFixture(), fetcher = vi.fn<typeof fetch>(async () => Response.json(value)); vi.stubGlobal('fetch', fetcher);
 const original = new AbortController().signal, state = await read(original);
 const { ownerId, ...expected } = value; expect(ownerId).toBe(stateOwner); expect(state).toEqual(expected);
 expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0]).toEqual(['/api/marketing/state', expect.objectContaining({ cache: 'no-store', redirect: 'error', headers: { 'x-own-dashboard-owner': stateOwner } })]);
 expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true); expect(original.aborted).toBe(false);
});
it.each(['owner', 'row-owner', 'missing-family', 'null-family', 'extra-field', 'bad-date', 'bad-time', 'bad-status', 'duplicate-entry', 'duplicate-account', 'bad-source', 'source-mismatch', 'extra-source-body', 'bad-cost', 'bad-diagnostics', 'health-mismatch'] as const)('refuses %s evidence rather than caching a successful snapshot', async kind => {
 const value = marketingStateFixture();
 if (kind === 'owner') value.ownerId = '99999999-9999-4999-8999-999999999999';
 if (kind === 'row-owner') value.revisions[0].user_id = '99999999-9999-4999-8999-999999999999';
 if (kind === 'missing-family') Reflect.deleteProperty(value, 'campaigns');
 if (kind === 'null-family') Object.assign(value, { publications: null });
 if (kind === 'extra-field') Object.assign(value, { privateField: 'TEST_ONLY_PRIVATE' });
 if (kind === 'bad-date') value.campaigns[0].starts_on = '2026-02-30';
 if (kind === 'bad-time') value.entries[0].local_time = '25:00';
 if (kind === 'bad-status') Object.assign(value.revisions[0], { status: 'unknown' });
 if (kind === 'duplicate-entry') value.entries.push(value.entries[0]);
 if (kind === 'duplicate-account') value.accounts.push(value.accounts[0]);
 if (kind === 'bad-source') value.sources[0].packet.canonicalUrl = 'javascript:alert(1)';
 if (kind === 'source-mismatch') value.sources[0].brand = 'dneskai';
 if (kind === 'extra-source-body') Object.assign(value.sources[0].packet.content, { body: 'TEST_ONLY_UNUSED_BODY' });
 if (kind === 'bad-cost') value.jobs[0].costUsd = -1;
 if (kind === 'bad-diagnostics') value.diagnostics.firstApprovalRate = 2;
 if (kind === 'health-mismatch') value.jobHealth![0].status = 'review';
 vi.stubGlobal('fetch', vi.fn(async () => Response.json(value)));
 await expect(read()).rejects.toMatchObject({ message: 'marketing-unavailable' });
});
it.each(['claimed', 'actual'] as const)('refuses %s bytes above the complete response ceiling', async kind => {
 const response = new Response(JSON.stringify(marketingStateFixture()) + (kind === 'actual' ? ' '.repeat(8 * 1024 * 1024) : ''), { headers: { 'Content-Type': 'application/json', ...(kind === 'claimed' ? { 'Content-Length': String(8 * 1024 * 1024 + 1) } : {}) } });
 vi.stubGlobal('fetch', vi.fn(async () => response)); await expect(read()).rejects.toMatchObject({ message: 'marketing-unavailable' }); expect(response.body?.locked).toBe(false);
});
it('does not replace malformed UTF-8 with accepted authored text', async () => {
 const text = JSON.stringify(marketingStateFixture()), bytes = new TextEncoder().encode(text); bytes[text.indexOf('Authored draft')] = 0xff;
 vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes, { headers: { 'Content-Type': 'application/json' } })));
 await expect(read()).rejects.toMatchObject({ message: 'marketing-unavailable' });
});
it.each(['partial', 'wrong-type', 'redirect'] as const)('refuses %s transport success', async kind => {
 const response = new Response(JSON.stringify(marketingStateFixture()), { status: kind === 'partial' ? 206 : 200, headers: { 'Content-Type': kind === 'wrong-type' ? 'text/plain' : 'application/json' } });
 if (kind === 'redirect') Object.defineProperty(response, 'redirected', { value: true });
 vi.stubGlobal('fetch', vi.fn(async () => response)); await expect(read()).rejects.toMatchObject({ message: 'marketing-unavailable' });
});
it.each(['prior', 'same-turn'] as const)('refuses %s caller retirement before network admission', async kind => {
 const controller = new AbortController(), fetcher = vi.fn(async () => Response.json(marketingStateFixture())); vi.stubGlobal('fetch', fetcher);
 if (kind === 'prior') controller.abort('TEST_ONLY_PRIVATE_REASON'); const pending = read(controller.signal); if (kind === 'same-turn') controller.abort('TEST_ONLY_PRIVATE_REASON');
 await expect(pending).rejects.toMatchObject({ name: 'AbortError', message: 'Request aborted' }); expect(fetcher).not.toHaveBeenCalled();
});
it('does not adopt late headers after the original owner retires and discards the unused body', async () => {
 let finish!: (value: Response) => void;
 const fetcher = vi.fn<typeof fetch>(() => new Promise(resolve => { finish = resolve; })); vi.stubGlobal('fetch', fetcher);
 const controller = new AbortController(), pending = read(controller.signal); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
 const cancelled = vi.fn(); const response = new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(JSON.stringify(marketingStateFixture()))); c.close(); }, cancel: cancelled }), { headers: { 'Content-Type': 'application/json' } });
 controller.abort('TEST_ONLY_PRIVATE_REASON'); finish(response);
 await expect(pending).rejects.toMatchObject({ name: 'AbortError', message: 'Request aborted' }); await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce());
});
it('does not adopt late body data after the original owner retires', async () => {
 let finish!: () => void;
 const response = new Response(new ReadableStream({ start(c) { finish = () => { try { c.enqueue(new TextEncoder().encode(JSON.stringify(marketingStateFixture()))); c.close(); } catch { /* Retirement may already have closed the stream. */ } }; } }), { headers: { 'Content-Type': 'application/json' } });
 vi.stubGlobal('fetch', vi.fn(async () => response));
 const controller = new AbortController(), pending = read(controller.signal); await vi.waitFor(() => expect(response.body?.locked).toBe(true)); controller.abort('TEST_ONLY_PRIVATE_REASON'); finish();
 await expect(pending).rejects.toMatchObject({ name: 'AbortError', message: 'Request aborted' }); expect(response.body?.locked).toBe(false);
});
it.each(['javascript:alert(1)', 'https://test-only-user:test-only-password@example.test/post'])('refuses an unsafe publication link %s', async url => {
 const value = marketingStateFixture(); value.publications[0].remote_url = url;
 vi.stubGlobal('fetch', vi.fn(async () => Response.json(value))); await expect(read()).rejects.toThrow('marketing-unavailable');
});
it.each(['headers', 'body'] as const)('bounds an uncooperative %s consumer at the original thirty-five-second budget', async phase => {
 const deadline = new AbortController(); vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
 const response = new Response(new ReadableStream(), { headers: { 'Content-Type': 'application/json' } });
 const fetcher = vi.fn<typeof fetch>(() => phase === 'headers' ? new Promise(() => {}) : Promise.resolve(response)); vi.stubGlobal('fetch', fetcher);
 const pending = read(); await vi.waitFor(() => phase === 'headers' ? expect(fetcher).toHaveBeenCalledOnce() : expect(response.body?.locked).toBe(true));
 deadline.abort('TEST_ONLY_PRIVATE_REASON'); await expect(pending).rejects.toThrow('marketing-unavailable'); expect(fetcher).toHaveBeenCalledOnce();
 if (phase === 'body') expect(response.body?.locked).toBe(false);
 expect(AbortSignal.timeout).toHaveBeenCalledExactlyOnceWith(35_000);
});
it('accepts exactly the complete response byte ceiling without truncating the final record', async () => {
 const value = marketingStateFixture(), json = JSON.stringify(value);
 vi.stubGlobal('fetch', vi.fn(async () => new Response(json.padEnd(8 * 1024 * 1024, ' '), { headers: { 'Content-Type': 'application/json' } })));
 expect((await read()).entries).toEqual(value.entries);
});

it('accepts the complete 10000-entry selected-head allowance and refuses an extra or orphaned entry', async () => {
 const value=marketingStateFixture();value.entries=Array.from({length:10000},(_,index)=>({...value.entries[0],id:stateId(index+100)}));
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json(value)));expect((await read()).entries).toHaveLength(10000);
 value.entries.push({...value.entries[0],id:stateId(20000)});await expect(read()).rejects.toThrow('marketing-unavailable');
 value.entries=[{...value.entries[0],campaign_id:stateId(30000)}];await expect(read()).rejects.toThrow('marketing-unavailable');
});
