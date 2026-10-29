import { createClient } from '@supabase/supabase-js';
import { afterEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: (...args: unknown[]) => m.session(...args) }));
import { GET } from '@/app/api/marketing/accounts/route';
const owner = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222', other = '33333333-3333-4333-8333-333333333333';
const account = () => ({ id, updated_at:'2026-10-27T10:00:00.000001Z', user_id: owner, brand: 'dneskai', platform: 'instagram', handle: 'dneskai', verified_at: '2026-10-27T10:00:00Z', enabled: false });
const token = () => ({
    account_id: id, brand: 'dneskai', platform: 'instagram', expires_at: '2026-12-01T10:00:00Z', refreshed_at: '2026-10-27T10:00:00Z', scopes: ['instagram_business_basic'], login_mode: 'instagram'
});
function fixture(accounts: unknown, tokens: unknown) {
    const fetcher = vi.fn(async (input: unknown,init?:RequestInit) => {if(new URL(String(input)).pathname!=='/rest/v1/rpc/read_owned_marketing_accounts'||JSON.parse(String(init?.body)).p_owner!==owner)throw new Error('TEST_ONLY_UNEXPECTED_SNAPSHOT_REQUEST');return Response.json({ownerId:owner,accounts,tokens});}), db = createClient('https://account-read.supabase.co', 'TEST-ONLY-session', { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } });
    vi.spyOn(db.auth, 'getUser').mockResolvedValue({ data: { user: { id: owner } }, error: null } as never);
    m.session.mockResolvedValue(db);
    return { fetcher, db };
}
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});
it.each([
    { name: 'null accounts', accounts: null, tokens: [] },
    { name: 'foreign accounts', accounts: [{ ...account(), user_id: other }], tokens: [] },
    { name: 'duplicate accounts', accounts: [account(), account()], tokens: [token()] },
    { name: 'null token metadata', accounts: [account()], tokens: null },
    { name: 'duplicate token metadata', accounts: [account()], tokens: [token(), token()] },
    { name: 'mismatched token brand', accounts: [account()], tokens: [{ ...token(), brand: 'devshark' }] },
    { name: 'orphan token metadata', accounts: [account()], tokens: [{ ...token(), account_id: other }] },
])('refuses $name instead of inventing empty or missing account state', async ({ accounts, tokens }) => {
    fixture(accounts, tokens);
    const response = await GET(new Request('https://own.example/api/marketing/accounts'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'accounts-unavailable' });
});
it('returns a confirmed empty account list without inventing missing data', async () => {
    const { fetcher } = fixture([], []), response = await GET(new Request('https://own.example/api/marketing/accounts'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accounts: [] });
    expect(fetcher).toHaveBeenCalledOnce();
});
it('keeps a positively owned account without stored metadata readable with token null', async () => {
    fixture([{ ...account(), verified_at: null }], []);
    const response = await GET(new Request('https://own.example/api/marketing/accounts'));
    expect(response.status).toBe(200);
    expect((await response.json()).accounts[0]).toMatchObject({ id, verifiedAt: null, token: null });
});
it('reads all four supported account tuples and matches each token once under the verified owner', async () => {
    const rows = ['dneskai', 'devshark'].flatMap((brand, i) => ['instagram', 'threads'].map((platform, n) => ({ ...account(), id: `44444444-4444-4444-8444-44444444444${i * 2 + n}`, brand, platform, handle: brand + platform }))), tokens = rows.map(row => ({ ...token(), account_id: row.id, brand: row.brand, platform: row.platform, login_mode: row.platform === 'threads' ? 'threads' : row.brand === 'dneskai' ? 'instagram' : 'facebook' })), { fetcher } = fixture(rows, tokens), response = await GET(new Request('https://own.example/api/marketing/accounts'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accounts).toHaveLength(4);
    expect(body.accounts.map((row: {
        token: {
            loginMode: string;
        };
    }) => row.token.loginMode)).toEqual(['instagram', 'threads', 'facebook', 'threads']);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(new URL(String(fetcher.mock.calls[0][0])).pathname).toBe('/rest/v1/rpc/read_owned_marketing_accounts');
    expect(fetcher).toHaveBeenCalledOnce();
});
it.each([
    { rows: [{ ...account(), unexpected: 'TEST_ONLY_PRIVATE_DETAIL' }], tokens: [token()] },
    { rows: [account()], tokens: [{ ...token(), unexpected: 'TEST_ONLY_PRIVATE_DETAIL' }] },
    { rows: [account(), { ...account(), id: other }], tokens: [] },
    { rows: [{ ...account(), verified_at: 'infinity' }], tokens: [] },
    { rows: [{ ...account(), handle: '' }], tokens: [] },
    { rows: [account()], tokens: [{ ...token(), expires_at: 'infinity' }] },
    { rows: [account()], tokens: [{ ...token(), refreshed_at: 'bad' }] },
    { rows: [account()], tokens: [{ ...token(), scopes: ['scope', 'scope'] }] },
    { rows: [account()], tokens: [{ ...token(), login_mode: 'threads' }] },
    { rows: [{ ...account(), platform: 'threads' }], tokens: [{ ...token(), platform: 'threads', login_mode: 'instagram' }] },
    { rows: Array.from({ length: 5 }, () => account()), tokens: [] },
    { rows: [account()], tokens: Array.from({ length: 5 }, () => token()) },
])('refuses malformed, contradictory or excessive projected account metadata: %#', async ({ rows, tokens }) => {
    fixture(rows, tokens);
    const response = await GET(new Request('https://own.example/api/marketing/accounts'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'accounts-unavailable' });
});
it('returns explicit engagement proof and refuses missing selected engagement fields', async () => {
    vi.stubEnv('DNESKAI_ENGAGEMENT_ENABLED', 'true');
    fixture([{ ...account(), engagement_enabled: false, engagement_blocked_code: null, engagement_blocked_at: null }], [token()]);
    const response = await GET(new Request('https://own.example/api/marketing/accounts'));
    expect(response.status).toBe(200);
    expect((await response.json()).accounts[0].engagement).toEqual({ enabled: false, blockedCode: null, blockedAt: null, webhook: false });
    fixture([{ ...account(), engagement_enabled: false }], [token()]);
    expect((await GET(new Request('https://own.example/api/marketing/accounts'))).status).toBe(503);
});

it.each([null,{}, {ownerId:other,accounts:[],tokens:[]},{ownerId:owner,accounts:[],tokens:[],extra:true}])('refuses malformed or foreign snapshot receipts: %#',async value=>{
 const {fetcher}=fixture([],[]);fetcher.mockResolvedValueOnce(Response.json(value));const response=await GET(new Request('https://own.example/api/marketing/accounts'));expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'accounts-unavailable'});expect(fetcher).toHaveBeenCalledOnce();
});
it('makes one exact original-owner RPC with no retry after unavailable database transport',async()=>{
 const {fetcher}=fixture([],[]);fetcher.mockResolvedValueOnce(Response.json({message:'TEST_ONLY_PRIVATE_DATABASE_DETAIL'},{status:503}));const response=await GET(new Request('https://own.example/api/marketing/accounts'));expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'accounts-unavailable'});expect(fetcher).toHaveBeenCalledOnce();expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({p_owner:owner});
});
