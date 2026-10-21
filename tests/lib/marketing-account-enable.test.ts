import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn(), limit: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.user } }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.admin() }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.limit }));

import { POST } from '@/app/api/marketing/accounts/enable/route';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const accountId = '33333333-3333-4333-8333-333333333333';
type Row = { id: string; user_id: string; brand: string; platform: string; handle: string; verified_at: string | null; enabled: boolean };
const baseRow = (): Row => ({ id: accountId, user_id: owner, brand: 'dneskai', platform: 'instagram', handle: 'dneskai', verified_at: '2026-10-20T10:00:00Z', enabled: false });
const tokenRow = (expires = '2099-01-01T00:00:00Z') => ({ account_id: accountId, brand: 'dneskai', platform: 'instagram', expires_at: expires, refreshed_at: '2026-10-20T10:00:00Z', scopes: ['instagram_business_basic', 'instagram_business_content_publish'], login_mode: 'instagram' });

function database(row: Row | null, tokens: unknown[] = [tokenRow()]) {
  const state = { row, updates: [] as unknown[] };
  const builder = () => {
    const filters: Record<string, unknown> = {};
    let patch: Record<string, unknown> | null = null;
    const chain = {
      select: () => chain,
      update: (value: Record<string, unknown>) => { patch = value; state.updates.push(value); return chain; },
      eq: (column: string, value: unknown) => { filters[column] = value; return chain; },
      maybeSingle: async () => ({ data: state.row && filters.id === state.row.id && filters.user_id === state.row.user_id ? state.row : null, error: null }),
      single: async () => {
        if (!state.row || filters.id !== state.row.id || filters.user_id !== state.row.user_id) return { data: null, error: { message: 'no row' } };
        if (patch) state.row = { ...state.row, ...patch } as Row;
        return { data: state.row, error: null };
      },
    };
    return chain;
  };
  const db = { from: vi.fn(() => builder()), rpc: vi.fn(async () => ({ data: tokens, error: null })) };
  return { db, state };
}
const post = (body: unknown, origin = 'https://own.example') => new Request('https://own.example/api/marketing/accounts/enable', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });

describe('owner publishing switch for a verified account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MARKETING_OWNER_ID', owner);
    mocks.user.mockResolvedValue({ data: { user: { id: owner } } });
    mocks.limit.mockResolvedValue({ ok: true, retryAfter: 0 });
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('enables a verified account with a valid stored token and returns non-secret status', async () => {
    const { db, state } = database(baseRow()); mocks.admin.mockReturnValue(db);
    const response = await POST(post({ accountId, enabled: true }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.account).toMatchObject({ id: accountId, enabled: true, token: { expiresAt: '2099-01-01T00:00:00Z', loginMode: 'instagram' } });
    expect(state.updates).toEqual([{ enabled: true }]);
    expect(mocks.limit).toHaveBeenCalledWith(owner, { key: 'marketing-account-enable', limit: 10, windowSec: 600 });
  });

  it('refuses to enable an unverified account or one without a usable token, and changes nothing', async () => {
    for (const [row, tokens, code] of [
      [{ ...baseRow(), verified_at: null }, [tokenRow()], 'account-not-verified'],
      [baseRow(), [], 'access-token-missing'],
      [baseRow(), [tokenRow('2020-01-01T00:00:00Z')], 'access-token-expired'],
    ] as const) {
      const { db, state } = database(row as Row, [...tokens] as unknown[]); mocks.admin.mockReturnValue(db);
      const response = await POST(post({ accountId, enabled: true }));
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: code });
      expect(state.updates).toEqual([]);
    }
  });

  it('always allows turning publishing off', async () => {
    const { db, state } = database({ ...baseRow(), enabled: true }, []); mocks.admin.mockReturnValue(db);
    const response = await POST(post({ accountId, enabled: false }));
    expect(response.status).toBe(200);
    expect((await response.json()).account.enabled).toBe(false);
    expect(state.updates).toEqual([{ enabled: false }]);
  });

  it('refuses anonymous, cross-origin, non-owner, foreign and malformed requests', async () => {
    const { db, state } = database(baseRow()); mocks.admin.mockReturnValue(db);
    mocks.user.mockResolvedValueOnce({ data: { user: null } });
    expect((await POST(post({ accountId, enabled: true }))).status).toBe(401);
    expect((await POST(post({ accountId, enabled: true }, 'https://evil.example'))).status).toBe(403);
    vi.stubEnv('MARKETING_OWNER_ID', other);
    expect(await (await POST(post({ accountId, enabled: true }))).json()).toEqual({ error: 'marketing-owner-required' });
    vi.stubEnv('MARKETING_OWNER_ID', owner);
    expect((await POST(post({ accountId: other, enabled: true }))).status).toBe(404);
    for (const body of [{ accountId, enabled: 'yes' }, { accountId: 'x', enabled: true }, { accountId, enabled: true, owner }]) expect((await POST(post(body))).status).toBe(400);
    expect(state.updates).toEqual([]);
  });
});
