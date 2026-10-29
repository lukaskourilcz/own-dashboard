import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AuthChangeEvent, Session, SupabaseClient, User } from '@supabase/supabase-js';
import { watchOwnerSession } from '@/lib/owner-session';
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const user = (id: string): User => ({ id, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-25T12:00:00Z' });
const session = (id = owner): Session => ({ user: user(id), access_token: 'TEST-ONLY', refresh_token: 'TEST-ONLY', token_type: 'bearer', expires_in: 3600 });
let callback: (event: AuthChangeEvent, session: Session | null) => void, getUser: ReturnType<typeof vi.fn>, subscribe: ReturnType<typeof vi.fn>, unsubscribe: ReturnType<typeof vi.fn>, retire: ReturnType<typeof vi.fn<() => void>>, parent: AbortController, db: SupabaseClient;
beforeEach(() => {
 vi.useFakeTimers(); vi.spyOn(AbortSignal, 'timeout').mockImplementation(delay => { const controller = new AbortController(); setTimeout(() => controller.abort(), delay); return controller.signal; });
 parent = new AbortController(); retire = vi.fn(); unsubscribe = vi.fn(); getUser = vi.fn().mockResolvedValue({ data: { user: user(owner) }, error: null });
 subscribe = vi.fn(cb => { callback = cb; return { data: { subscription: { unsubscribe } } }; }); db = { auth: { getUser, onAuthStateChange: subscribe } } as unknown as SupabaseClient;
});
afterEach(() => { parent.abort(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });
it.each(['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED', 'PASSWORD_RECOVERY'] as const)('retains the server owner on repeated same-owner %s without another verification', async event => {
 const stop = watchOwnerSession(db, owner, parent.signal, retire); callback(event, session()); callback(event, session()); await vi.advanceTimersByTimeAsync(0); expect(retire).not.toHaveBeenCalled(); expect(getUser).not.toHaveBeenCalled(); stop(); expect(unsubscribe).toHaveBeenCalledOnce();
});
it.each(['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'] as const)('retires a different %s identity even with a valid-looking client session', event => {
 watchOwnerSession(db, owner, parent.signal, retire); callback(event, session(other)); expect(retire).toHaveBeenCalledOnce(); expect(unsubscribe).toHaveBeenCalledOnce(); callback('SIGNED_IN', session()); expect(retire).toHaveBeenCalledOnce(); expect(getUser).not.toHaveBeenCalled();
});
it('retires sign-out once and never grants access again from a later session', () => {
 watchOwnerSession(db, owner, parent.signal, retire); callback('SIGNED_OUT', null); callback('SIGNED_OUT', null); callback('SIGNED_IN', session()); expect(retire).toHaveBeenCalledOnce(); expect(unsubscribe).toHaveBeenCalledOnce();
});
it('verifies a null startup outside the synchronous SDK callback and retains only the same verified owner', async () => {
 watchOwnerSession(db, owner, parent.signal, retire); callback('INITIAL_SESSION', null); callback('INITIAL_SESSION', null); expect(getUser).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(0); expect(getUser).toHaveBeenCalledOnce(); expect(retire).not.toHaveBeenCalled();
});
it.each(['missing', 'foreign', 'error-with-user', 'rejected'])('retires an unverified null startup: %s', async kind => {
 getUser.mockImplementation(() => kind === 'rejected' ? Promise.reject(Error('PRIVATE TEST')) : Promise.resolve({ data: { user: kind === 'missing' ? null : user(kind === 'foreign' ? other : owner) }, error: kind === 'error-with-user' ? Error('PRIVATE TEST') : null }));
 watchOwnerSession(db, owner, parent.signal, retire); callback('INITIAL_SESSION', null); await vi.advanceTimersByTimeAsync(0); expect(retire).toHaveBeenCalledOnce();
});
it('bounds uncooperative startup verification to eight seconds', async () => {
 getUser.mockImplementation(() => new Promise(() => {})); watchOwnerSession(db, owner, parent.signal, retire); callback('INITIAL_SESSION', null); await vi.advanceTimersByTimeAsync(7999); expect(retire).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(2); expect(retire).toHaveBeenCalledOnce();
});
it('ignores a superseded null-start verification after a newer same-owner event', async () => {
 let finish!: (value: unknown) => void; getUser.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
 watchOwnerSession(db, owner, parent.signal, retire); callback('INITIAL_SESSION', null); await vi.advanceTimersByTimeAsync(0); callback('SIGNED_IN', session()); finish({ data: { user: user(other) }, error: null }); await vi.advanceTimersByTimeAsync(8001); expect(retire).not.toHaveBeenCalled();
});
it('cannot reopen after sign-out when an old verification finishes successfully', async () => {
 let finish!: (value: unknown) => void; getUser.mockImplementation(() => new Promise(resolve => { finish = resolve; })); watchOwnerSession(db, owner, parent.signal, retire); callback('INITIAL_SESSION', null); await vi.advanceTimersByTimeAsync(0); callback('SIGNED_OUT', null); finish({ data: { user: user(owner) }, error: null }); await vi.advanceTimersByTimeAsync(0); expect(retire).toHaveBeenCalledOnce();
});
it('removes a scheduled verification and subscription on disposal without retiring a future scope', async () => {
 const stop = watchOwnerSession(db, owner, parent.signal, retire); callback('INITIAL_SESSION', null); stop(); callback('SIGNED_OUT', null); await vi.advanceTimersByTimeAsync(8001); expect(getUser).not.toHaveBeenCalled(); expect(retire).not.toHaveBeenCalled(); expect(unsubscribe).toHaveBeenCalledOnce();
});
it('does not register an already disposed owner', () => {
 parent.abort(); watchOwnerSession(db, owner, parent.signal, retire); expect(subscribe).not.toHaveBeenCalled(); expect(retire).not.toHaveBeenCalled();
});
it('retires when subscription setup fails without exposing its diagnostic', () => {
 subscribe.mockImplementation(() => { throw Error('PRIVATE TEST'); }); expect(() => watchOwnerSession(db, owner, parent.signal, retire)).not.toThrow(); expect(retire).toHaveBeenCalledOnce();
});
