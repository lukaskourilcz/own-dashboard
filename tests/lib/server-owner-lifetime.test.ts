import { createClient as createSdkClient } from '@supabase/supabase-js';
import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: (signal: AbortSignal) => mocks.create(signal) }));
import { fetchWithSignal } from '@/lib/abortable';
import { readVerifiedServerContext } from '@/lib/supabase/server-owner';
const owner = '11111111-1111-4111-8111-111111111111', project = '22222222-2222-4222-8222-222222222222';
const user = { id: owner, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-10-28T00:00:00Z' };
afterEach(() => { vi.restoreAllMocks(); mocks.create.mockReset(); });
it('keeps the verified database transport alive after the authentication-only allowance expires', async () => {
  const parent = new AbortController(), authDeadline = new AbortController(); vi.spyOn(AbortSignal, 'timeout').mockReturnValue(authDeadline.signal);
  const fetcher = vi.fn(async () => Response.json({ id: project }));
  mocks.create.mockImplementation((signal: AbortSignal) => {
    const db = createSdkClient('https://owner-lifetime.supabase.co', 'TEST-ONLY-PUBLISHABLE', { global: { fetch: fetchWithSignal(signal, fetcher) }, auth: { persistSession: false, autoRefreshToken: false } });
    vi.spyOn(db.auth, 'getUser').mockResolvedValue({ data: { user }, error: null }); return db;
  });
  const context = await readVerifiedServerContext(parent.signal); expect(context?.ownerId).toBe(owner);
  authDeadline.abort();
  const result = await context!.db.from('projects').select('id').retry(false).abortSignal(parent.signal).maybeSingle();
  expect(result.error).toBeNull(); expect(result.data).toEqual({ id: project }); expect(fetcher).toHaveBeenCalledOnce();
});
it('starts no authentication call when retirement wins immediately after client setup', async () => {
  const parent = new AbortController(), getUser = vi.fn(async () => ({ data: { user }, error: null }));
  mocks.create.mockImplementation(() => new Promise(resolve => { queueMicrotask(() => { resolve({ auth: { getUser } }); queueMicrotask(() => parent.abort('TEST_ONLY_PRIVATE_REASON')); }); }));
  await expect(readVerifiedServerContext(parent.signal)).rejects.toMatchObject({ name: 'AbortError', message: 'Request aborted' });
  expect(getUser).not.toHaveBeenCalled();
});
it('retains original parent cancellation in the actual SDK after authentication', async () => {
  const parent = new AbortController(), fetcher = vi.fn(async () => Response.json({ id: project }));
  mocks.create.mockImplementation((signal: AbortSignal) => {
    const db = createSdkClient('https://owner-lifetime.supabase.co', 'TEST-ONLY-PUBLISHABLE', { global: { fetch: fetchWithSignal(signal, fetcher) }, auth: { persistSession: false, autoRefreshToken: false } });
    vi.spyOn(db.auth, 'getUser').mockResolvedValue({ data: { user }, error: null }); return db;
  });
  const context = await readVerifiedServerContext(parent.signal); parent.abort();
  const result = await context!.db.from('projects').select('id').retry(false).maybeSingle();
  expect(result.error).not.toBeNull(); expect(result.data).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
});
it('bounds a held authentication consumer and never grants its late result', async () => {
  const parent = new AbortController(), authDeadline = new AbortController(), clock = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(authDeadline.signal);
  let finish!: (value: { data: { user: typeof user }; error: null }) => void;
  const getUser = vi.fn(() => new Promise(resolve => { finish = resolve; })); mocks.create.mockResolvedValue({ auth: { getUser } });
  const pending = readVerifiedServerContext(parent.signal).catch(error => error);
  await vi.waitFor(() => expect(getUser).toHaveBeenCalledOnce()); authDeadline.abort('TEST_ONLY_PRIVATE_REASON');
  expect(await pending).toMatchObject({ name: 'ServerOwnerUnavailableError', message: 'Owner session unavailable' });
  finish({ data: { user }, error: null }); await Promise.resolve(); expect(clock).toHaveBeenCalledExactlyOnceWith(10_000);
});
it.each([400, 401, 403, 503])('a cached user accompanying auth status %i grants no context', async status => {
  mocks.create.mockResolvedValue({ auth: { getUser: async () => ({ data: { user }, error: { status, message: 'TEST_ONLY_PRIVATE_DIAGNOSTIC' } }) } });
  if (status === 503) await expect(readVerifiedServerContext(new AbortController().signal)).rejects.toMatchObject({ name: 'ServerOwnerUnavailableError', message: 'Owner session unavailable' });
  else expect(await readVerifiedServerContext(new AbortController().signal)).toBeNull();
});
it('starts no client for a retired caller', async () => {
  const parent = new AbortController(); parent.abort('TEST_ONLY_PRIVATE_REASON');
  await expect(readVerifiedServerContext(parent.signal)).rejects.toMatchObject({ name: 'AbortError', message: 'Request aborted' }); expect(mocks.create).not.toHaveBeenCalled();
});
it('contains setup rejection and invalid/missing verified identities', async () => {
  mocks.create.mockRejectedValueOnce(Error('TEST_ONLY_PRIVATE_SETUP'));
  await expect(readVerifiedServerContext(new AbortController().signal)).rejects.toMatchObject({ name: 'ServerOwnerUnavailableError', message: 'Owner session unavailable' });
  mocks.create.mockResolvedValueOnce({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } });
  expect(await readVerifiedServerContext(new AbortController().signal)).toBeNull();
  mocks.create.mockResolvedValueOnce({ auth: { getUser: async () => ({ data: { user: { id: 'invalid' } }, error: null }) } });
  await expect(readVerifiedServerContext(new AbortController().signal)).rejects.toMatchObject({ name: 'ServerOwnerUnavailableError', message: 'Owner session unavailable' });
});
