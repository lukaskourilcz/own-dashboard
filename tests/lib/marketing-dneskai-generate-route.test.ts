import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), generate: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.user } }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ admin: true }) }));
vi.mock('@/lib/marketing/dneskai-paid-actions', () => ({
  generateDneskaiBriefNow: mocks.generate,
  DneskaiPaidActionError: class DneskaiPaidActionError extends Error { constructor(readonly code: string, readonly status = 409) { super(code); } },
}));
import { POST } from '@/app/api/marketing/dneskai/generate/route';
import { DneskaiPaidActionError } from '@/lib/marketing/dneskai-paid-actions';

const owner = '11111111-1111-4111-8111-111111111111', brief = '22222222-2222-4222-8222-222222222222';
const post = (body: unknown, origin = 'https://own.example') => POST(new Request('https://own.example/api/marketing/dneskai/generate', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ data: { user: { id: owner } } }); });

describe('POST /api/marketing/dneskai/generate (owner decision 9)', () => {
  it('generates the owner’s waiting brief now and answers 202 with the job', async () => {
    mocks.generate.mockResolvedValue({ briefId: brief, jobId: brief, status: 'review', revisionId: null });
    const response = await post({ action: 'generate-now', briefId: brief });
    expect(response.status).toBe(202);
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ owner, briefId: brief, admin: { admin: true } }));
  });
  it('refuses no session, a cross-origin post, a malformed body and passes a refusal code on', async () => {
    mocks.user.mockResolvedValueOnce({ data: { user: null } });
    expect((await post({ action: 'generate-now', briefId: brief })).status).toBe(401);
    expect((await post({ action: 'generate-now', briefId: brief }, 'https://evil.example')).status).toBe(403);
    expect((await post({ action: 'generate-now', briefId: 'x' })).status).toBe(400);
    mocks.generate.mockRejectedValueOnce(new DneskaiPaidActionError('dneskai-daily-generation-budget-exhausted'));
    const refused = await post({ action: 'generate-now', briefId: brief });
    expect(refused.status).toBe(409); expect(await refused.json()).toEqual({ error: 'dneskai-daily-generation-budget-exhausted' });
    mocks.generate.mockRejectedValueOnce(new Error('PRIVATE detail'));
    const failed = await post({ action: 'generate-now', briefId: brief });
    expect(failed.status).toBe(503); expect(await failed.json()).toEqual({ error: 'generate-now-unavailable' });
    expect(mocks.generate).toHaveBeenCalledTimes(2);
  });
});
