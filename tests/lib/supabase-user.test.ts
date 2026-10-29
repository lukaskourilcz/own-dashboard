import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { currentUserId } from '@/lib/supabase/user';
import type { createClient } from '@/lib/supabase/client';
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
type Client = ReturnType<typeof createClient>;
const api = (getUser: () => Promise<unknown>) => ({ auth: { getUser } }) as unknown as Client;
beforeEach(() => { vi.useFakeTimers(); vi.spyOn(AbortSignal, 'timeout').mockImplementation(delay => { const controller = new AbortController(); setTimeout(() => controller.abort(), delay); return controller.signal; }); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });
it('refuses a verification error even if it contains a cached user', async () => {
 expect(await currentUserId(api(async () => ({ data: { user: { id: owner } }, error: Error('PRIVATE TEST') })))).toBeNull();
});
it('bounds uncooperative auth and never adopts its late user', async () => {
 let finish!: (value: unknown) => void, settled = false;
 const pending = currentUserId(api(() => new Promise(resolve => { finish = resolve; }))).then(value => { settled = true; return value; });
 await vi.advanceTimersByTimeAsync(8001); const metDeadline = settled; finish({ data: { user: { id: owner } }, error: null });
 const result = await pending; expect(metDeadline).toBe(true); expect(result).toBeNull();
});
it('verifies the captured intent owner rather than adopting another verified account', async () => {
 expect(await currentUserId(api(async () => ({ data: { user: { id: other } }, error: null })), { ownerId: owner, signal: new AbortController().signal })).toBeNull();
});
it('captures the owner before verification begins', async () => {
 let finish!: (value: unknown) => void; const scope = { ownerId: owner, signal: new AbortController().signal };
 const pending = currentUserId(api(() => new Promise(resolve => { finish = resolve; })), scope); scope.ownerId = other; finish({ data: { user: { id: other } }, error: null }); expect(await pending).toBeNull();
});
it('refuses a disposed owner before starting auth', async () => {
 const controller = new AbortController(); controller.abort(); const verify = vi.fn(async () => ({ data: { user: { id: owner } }, error: null }));
 await expect(currentUserId(api(verify), { ownerId: owner, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' }); expect(verify).not.toHaveBeenCalled();
});
it('retains a successful verified identity and a matching captured owner', async () => {
 const verify = async () => ({ data: { user: { id: owner } }, error: null }); expect(await currentUserId(api(verify))).toBe(owner); expect(await currentUserId(api(verify), { ownerId: owner, signal: new AbortController().signal })).toBe(owner);
});
it.each([null, {}, { user: null }, { user: { id: '' } }, { user: { id: 42 } }, { user: { id: ' padded ' } }])('refuses missing or malformed identity data: %j', async data => {
 expect(await currentUserId(api(async () => ({ data, error: null })))).toBeNull();
});
it('refuses a rejected verification without exposing its diagnostic', async () => {
 expect(await currentUserId(api(async () => { throw Error('PRIVATE TEST'); }))).toBeNull();
});
it('retires an in-flight intent without accepting a late verified owner', async () => {
 let finish!: (value: unknown) => void; const controller = new AbortController();
 const pending = currentUserId(api(() => new Promise(resolve => { finish = resolve; })), { ownerId: owner, signal: controller.signal }); const check = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await check; finish({ data: { user: { id: owner } }, error: null });
});
