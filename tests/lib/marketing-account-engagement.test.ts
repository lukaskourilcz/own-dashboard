import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn(), limit: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.user } }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.admin() }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.limit }));

import { POST } from '@/app/api/marketing/accounts/engagement/route';

/** #160: the per-account switch for replies to keyword comments. Synthetic values only. */
const owner = '11111111-1111-4111-8111-111111111111';
const accountId = '33333333-3333-4333-8333-333333333333';
type Row = Record<string, unknown>;
const baseRow = (): Row => ({ id: accountId, user_id: owner, brand: 'dneskai', platform: 'instagram', handle: 'dneskai', verified_at: '2026-10-20T10:00:00Z', enabled: false,
  engagement_enabled: false, engagement_blocked_code: 'engagement-messaging-disabled', engagement_blocked_at: '2026-10-21T10:00:00Z' });
const tokenRow = (scopes = ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_comments']) =>
  ({ account_id: accountId, brand: 'dneskai', platform: 'instagram', expires_at: '2099-01-01T00:00:00Z', refreshed_at: '2026-10-20T10:00:00Z', scopes, login_mode: 'instagram' });

function database(row: Row, tokens: unknown[] = [tokenRow()]) {
  const state = { row, updates: [] as Row[] };
  const builder = () => {
    let patch: Row | null = null;
    const chain = {
      select: () => chain, eq: () => chain,
      update: (value: Row) => { patch = value; state.updates.push(value); return chain; },
      maybeSingle: async () => ({ data: state.row, error: null }),
      single: async () => { if (patch) state.row = { ...state.row, ...patch }; return { data: state.row, error: null }; },
    };
    return chain;
  };
  return { db: { from: vi.fn(() => builder()), rpc: vi.fn(async () => ({ data: tokens, error: null })) }, state };
}
const post = (body: unknown) => new Request('https://own.example/api/marketing/accounts/engagement', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://own.example' }, body: JSON.stringify(body) });

describe('POST /api/marketing/accounts/engagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MARKETING_OWNER_ID', owner);
    vi.stubEnv('DNESKAI_ENGAGEMENT_ENABLED', 'true');
    mocks.user.mockResolvedValue({ data: { user: { id: owner } } });
    mocks.limit.mockResolvedValue({ ok: true });
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('answers 404 and touches nothing until DNESKAI_ENGAGEMENT_ENABLED=true', async () => {
    vi.stubEnv('DNESKAI_ENGAGEMENT_ENABLED', '');
    const { db } = database(baseRow()); mocks.admin.mockReturnValue(db);
    const response = await POST(post({ accountId, enabled: true }));
    expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: 'engagement-unavailable' });
    expect(db.from).not.toHaveBeenCalled();
  });
  it('turns replies on and clears an earlier block, returning the account without a token value', async () => {
    const { db, state } = database(baseRow()); mocks.admin.mockReturnValue(db);
    const response = await POST(post({ accountId, enabled: true }));
    expect(response.status).toBe(200);
    expect(state.updates).toEqual([{ engagement_enabled: true, engagement_blocked_code: null, engagement_blocked_at: null }]);
    const body = await response.json();
    expect(body.account.engagement).toEqual({ enabled: true, blockedCode: null, blockedAt: null });
    expect(JSON.stringify(body)).not.toMatch(/access_token|TEST-ONLY/);
  });
  it('refuses to turn replies on without the comment scope, and always lets them be turned off', async () => {
    const { db, state } = database(baseRow(), [tokenRow(['instagram_business_basic', 'instagram_business_content_publish'])]); mocks.admin.mockReturnValue(db);
    const refused = await POST(post({ accountId, enabled: true }));
    expect(refused.status).toBe(409); expect(await refused.json()).toEqual({ error: 'engagement-scopes-unverified' });
    expect(state.updates).toEqual([]);
    const off = await POST(post({ accountId, enabled: false }));
    expect(off.status).toBe(200);
    expect(state.updates).toEqual([{ engagement_enabled: false }]);
  });
  it('is for the marketing owner only', async () => {
    vi.stubEnv('MARKETING_OWNER_ID', '22222222-2222-4222-8222-222222222222');
    const { db } = database(baseRow()); mocks.admin.mockReturnValue(db);
    expect((await POST(post({ accountId, enabled: true }))).status).toBe(403);
  });
});
