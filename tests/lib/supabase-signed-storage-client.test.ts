// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSignedStorageClient } from '@/lib/supabase/client';
beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'fixture-public-key'); document.documentElement.lang = 'en'; });
afterEach(() => { delete document.documentElement.dataset.guestTour; vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it('uses a cancellable Storage-only SDK transport without starting an Auth session or listener', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ Key: 'marketing-audio/fixture/path.mp3' })); vi.stubGlobal('fetch', fetcher); const listeners = vi.spyOn(window, 'addEventListener');
  document.cookie = 'fixture-owner-session=set'; const cookies = document.cookie;
  const client = createSignedStorageClient(new AbortController().signal); const result = await client.from('marketing-audio').uploadToSignedUrl('fixture/path.mp3', 'set', new Uint8Array([1]), { contentType: 'audio/mpeg', upsert: false });
  expect(document.cookie).toBe(cookies); expect(result.error).toBeNull(); expect(fetcher).toHaveBeenCalledOnce(); expect(listeners.mock.calls.filter(([name]) => name === 'visibilitychange')).toHaveLength(0);
  expect(new URL(String(fetcher.mock.calls[0]![0])).pathname).toBe('/storage/v1/object/upload/sign/marketing-audio/fixture/path.mp3');
});
it('refuses a cancelled transport before sending any file', async () => {
  const controller = new AbortController(); controller.abort('synthetic-private-reason'); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const result = await createSignedStorageClient(controller.signal).from('marketing-audio').uploadToSignedUrl('fixture/path.mp3', 'set', new Uint8Array([1])); expect(result.error).not.toBeNull(); expect(fetcher).not.toHaveBeenCalled();
});
it('keeps the signed transport blocked in the guest tour even when called directly', async () => {
  document.documentElement.dataset.guestTour = 'true'; const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const result = await createSignedStorageClient(new AbortController().signal).from('marketing-audio').uploadToSignedUrl('fixture/path.mp3', 'set', new Uint8Array([1])); expect(result.error).not.toBeNull(); expect(fetcher).not.toHaveBeenCalled();
});
