import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), project: vi.fn(), read: vi.fn(), rpc: vi.fn(), insert: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.user }, rpc: mocks.rpc, from: () => ({ insert: mocks.insert }) }) }));
vi.mock('@/lib/marketing/strategy/server', () => ({ requireStrategyProject: mocks.project, readStrategy: mocks.read }));
import { GET, POST } from '@/app/api/marketing/strategy/route';
import { POST as draft } from '@/app/api/marketing/strategy/drafts/route';
const owner = '11111111-1111-4111-8111-111111111111', project = '22222222-2222-4222-8222-222222222222', publication = '33333333-3333-4333-8333-333333333333';
const url = 'https://own.example/api/marketing/strategy';
const request = (body: unknown, origin = 'https://own.example') => new Request(url, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const result = { projectId: project, brand: 'devshark', publicationId: publication, publishedAt: '2026-11-01T12:00:00Z', observedAt: '2026-11-04T12:00:00Z', experiment: 'hook', variant: 'A', evidence: 'Native Insights', metrics: { reach: 100, views: null, saves: 0, shares: null, replies: null, follows: null, profileVisits: null, linkVisits: null, productionMinutes: null } };
beforeEach(() => {
  vi.clearAllMocks(); mocks.user.mockResolvedValue({ data: { user: { id: owner } } }); mocks.project.mockResolvedValue(true);
  mocks.read.mockResolvedValue({ links: [], results: [], publications: [], partial: false }); mocks.insert.mockResolvedValue({ error: null });
});
describe('strategy routes', () => {
  it('requires a session, validates scope and hides foreign/unknown projects', async () => {
    mocks.user.mockResolvedValueOnce({ data: { user: null } });
    expect((await GET(new Request(url))).status).toBe(401);
    expect((await GET(new Request(`${url}?projectId=x&brand=devshark`))).status).toBe(400);
    mocks.project.mockResolvedValueOnce(false);
    expect((await GET(new Request(`${url}?projectId=${project}&brand=devshark`))).status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
    const response = await GET(new Request(`${url}?projectId=${project}&brand=devshark`));
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    mocks.read.mockRejectedValueOnce(new Error('private error details'));
    expect(await (await GET(new Request(`${url}?projectId=${project}&brand=devshark`))).json()).toEqual({ error: 'strategy-unavailable' });
  });
  it('rejects cross-origin writes and arbitrary draft content before invoking an RPC', async () => {
    const idea = { projectId: project, brand: 'devshark', ideaId: 'promise-order' };
    expect((await draft(request(idea, 'https://foreign.example'))).status).toBe(403);
    expect((await draft(request({ ...idea, caption: 'publish this' }))).status).toBe(400);
    mocks.project.mockResolvedValueOnce(false);
    expect((await draft(request(idea))).status).toBe(404); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: { idea_id: idea.ideaId, draft_id: publication, topic_id: null }, error: null });
    expect((await draft(request(idea))).status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith('marketing_strategy_draft', expect.objectContaining({ p_title: 'Which log runs first?', p_project: project }));
    expect(mocks.rpc).not.toHaveBeenCalledWith(expect.stringContaining('approve'), expect.anything());
  });
  it('validates native snapshots, stamps the session owner and reports duplicate writes', async () => {
    expect((await POST(request(result, 'https://foreign.example'))).status).toBe(403);
    expect((await POST(request({ ...result, observedAt: '2099-01-01T12:00:00Z' }))).status).toBe(400);
    expect((await POST(request({ ...result, metrics: { ...result.metrics, saves: -1 } }))).status).toBe(400);
    expect((await POST(request(result))).status).toBe(201);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: owner, publication_id: publication, metrics: result.metrics }));
    mocks.insert.mockResolvedValueOnce({ error: { code: '23505' } });
    const duplicate = await POST(request(result)); expect(duplicate.status).toBe(409); expect(await duplicate.json()).toEqual({ error: 'snapshot-exists' });
  });
});
