import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { verifyThreadsAccount } from '@/lib/marketing/meta-account';

/** Threads profile verification (7 November 2026): /me on graph.threads.net, then the stored account. Synthetic values. */
const owner = '11111111-1111-4111-8111-111111111111';
const now = new Date('2026-11-07T18:00:00Z');
const env = (patch: Record<string, string> = {}) => ({ MARKETING_OWNER_ID: owner, MARKETING_DNESKAI_THREADS_ACCESS_TOKEN: 'TEST-ONLY-THREADS-TOKEN-000001',
  MARKETING_DNESKAI_THREADS_TOKEN_EXPIRES_AT: '2027-01-05T18:00:00Z', MARKETING_DNESKAI_THREADS_VERIFIED_SCOPES: 'threads_basic,threads_content_publish',
  MARKETING_DNESKAI_THREADS_API_VERSION: 'v1.0', ...patch });
const stored = { accountId: '22222222-2222-4222-8222-222222222222', remoteAccountId: '26000000000000001', handle: 'dneskai', verifiedAt: now.toISOString(), enabled: false, tokenStored: true,
  token: { expiresAt: '2027-01-05T18:00:00.000Z', refreshedAt: now.toISOString(), scopes: ['threads_basic', 'threads_content_publish'], loginMode: 'threads' } };
function db() { const rpc = vi.fn(async () => ({ data: stored, error: null })); return { db: { rpc } as never, rpc }; }

describe('verifyThreadsAccount', () => {
  it('reads /me with the token in the header and stores the Threads profile', async () => {
    const fetcher = vi.fn(async () => Response.json({ id: '26000000000000001', username: 'dneskai' }));
    const { db: client, rpc } = db();
    const verified = await verifyThreadsAccount(client, owner, 'dneskai', { env: env(), fetcher: fetcher as never, now });
    expect(verified).toMatchObject({ platform: 'threads', handle: 'dneskai', enabled: false });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://graph.threads.net/v1.0/me?fields=id%2Cusername');
    expect(url).not.toContain('TEST-ONLY');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer TEST-ONLY-THREADS-TOKEN-000001');
    expect(rpc).toHaveBeenCalledWith('marketing_verify_account', expect.objectContaining({ p_platform: 'threads', p_login_mode: 'threads', p_remote_account_id: '26000000000000001' }));
  });

  it('refuses a missing scope, an unknown expiry and a different profile before storing anything', async () => {
    const fetcher = vi.fn(async () => Response.json({ id: '26000000000000001', username: 'someone' }));
    const { db: client, rpc } = db();
    await expect(verifyThreadsAccount(client, owner, 'dneskai', { env: env({ MARKETING_DNESKAI_THREADS_VERIFIED_SCOPES: 'threads_basic' }), fetcher: fetcher as never, now })).rejects.toMatchObject({ code: 'publishing-scopes-unverified' });
    await expect(verifyThreadsAccount(client, owner, 'dneskai', { env: env({ MARKETING_DNESKAI_THREADS_TOKEN_EXPIRES_AT: '' }), fetcher: fetcher as never, now })).rejects.toMatchObject({ code: 'access-token-expiry-unverified' });
    await expect(verifyThreadsAccount(client, owner, 'dneskai', { env: env(), fetcher: fetcher as never, now })).rejects.toMatchObject({ code: 'remote-account-handle-mismatch' });
    expect(rpc).not.toHaveBeenCalled();
  });
});
