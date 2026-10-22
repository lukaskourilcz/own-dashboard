import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), rpc: vi.fn(), project: vi.fn(), read: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.user }, rpc: mocks.rpc }) }));
vi.mock('@/lib/marketing/dneskai-store', () => ({ requireDneskaiProject: mocks.project }));
vi.mock('@/lib/marketing/dneskai-workspace-read', () => ({ readDneskaiTopics: mocks.read }));
import { GET, POST } from '@/app/api/marketing/dneskai/topics/route';

const owner = '11111111-1111-4111-8111-111111111111', project = '22222222-2222-4222-8222-222222222222';
const topic = '33333333-3333-4333-8333-333333333333', second = '44444444-4444-4444-8444-444444444444';
const url = 'https://own.example/api/marketing/dneskai/topics';
const get = (query = `?projectId=${project}`) => GET(new Request(`${url}${query}`));
const post = (body: unknown, origin = 'https://own.example') => POST(new Request(url, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('DNESKAI_TOPICS_ENABLED', 'true');
  mocks.user.mockResolvedValue({ data: { user: { id: owner } } });
  mocks.project.mockResolvedValue({ id: project });
  mocks.read.mockResolvedValue({ schemaVersion: 'dneskai-topics/1' });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('/api/marketing/dneskai/topics (#150)', () => {
  it('answers 404 for GET and POST while the switch is off, before any session or database call', async () => {
    vi.stubEnv('DNESKAI_TOPICS_ENABLED', '');
    expect((await get()).status).toBe(404);
    expect((await post({ action: 'approve', projectId: project, topicIds: [topic] })).status).toBe(404);
    expect(mocks.user).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });

  it('reads the owner’s topics for a DNESKAi project', async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.read).toHaveBeenCalledWith(expect.anything(), owner, project, expect.any(Date), { enabled: true });
    mocks.user.mockResolvedValueOnce({ data: { user: null } });
    expect((await get()).status).toBe(401);
    expect((await get('?projectId=x')).status).toBe(400);
    mocks.project.mockRejectedValueOnce(new Error('collection-project-unavailable'));
    expect((await get()).status).toBe(404);
    mocks.read.mockRejectedValueOnce(new Error('PRIVATE'));
    const failed = await get();
    expect(failed.status).toBe(503); expect(await failed.json()).toEqual({ error: 'dneskai-topics-unavailable' });
  });

  it('approves several topics one call each and reports a topic that changed meanwhile', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { id: topic, status: 'approved' }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'topic status' } });
    const response = await post({ action: 'approve', projectId: project, topicIds: [topic, second, topic] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, results: [{ id: topic, status: 'approved' }, { id: second, error: 'topic-status-changed' }] });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'marketing_dneskai_topic_decide', { p_topic: topic, p_action: 'approve' });
  });

  it('rejects, restores, edits and creates through the owner functions', async () => {
    mocks.rpc.mockResolvedValue({ data: { id: topic, status: 'rejected' }, error: null });
    expect((await post({ action: 'reject', projectId: project, topicIds: [topic] })).status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith('marketing_dneskai_topic_decide', { p_topic: topic, p_action: 'reject' });
    mocks.rpc.mockResolvedValue({ data: { id: topic, status: 'proposed' }, error: null });
    expect((await post({ action: 'restore', projectId: project, topicIds: [topic] })).status).toBe(200);
    expect((await post({ action: 'edit', projectId: project, topicId: topic, title: 'Nový titulek', keyword: 'Claude' })).status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith('marketing_dneskai_topic_edit', { p_topic: topic, p_title: 'Nový titulek', p_keyword: 'Claude' });
    const created = await post({ action: 'create', projectId: project, kind: 'education', url: 'https://example.test/tool' });
    expect(created.status).toBe(201);
    expect(mocks.rpc).toHaveBeenLastCalledWith('marketing_dneskai_topic_create', { p_project: project, p_kind: 'education', p_title: null, p_url: 'https://example.test/tool', p_keyword: null });
  });

  it('refuses a cross-origin post, no session, a malformed body, a foreign project and passes SQL refusals on as codes', async () => {
    expect((await post({ action: 'approve', projectId: project, topicIds: [topic] }, 'https://evil.example')).status).toBe(403);
    mocks.user.mockResolvedValueOnce({ data: { user: null } });
    expect((await post({ action: 'approve', projectId: project, topicIds: [topic] })).status).toBe(401);
    expect((await post({ action: 'approve', projectId: project, topicIds: ['x'] })).status).toBe(400);
    mocks.project.mockRejectedValueOnce(new Error('collection-project-unavailable'));
    expect((await post({ action: 'approve', projectId: project, topicIds: [topic] })).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
    for (const [message, status, code] of [['topic exists', 409, 'topic-exists'], ['topic unavailable', 404, 'topic-unavailable'], ['topic status', 409, 'topic-status-changed'], ['new row violates check constraint', 400, 'invalid-topic'], ['PRIVATE detail', 503, 'dneskai-topics-unavailable']] as const) {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { message } });
      const response = await post({ action: 'create', projectId: project, kind: 'news', title: 'Titulek' });
      expect(response.status, message).toBe(status); expect(await response.json()).toEqual({ error: code });
    }
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'PRIVATE detail' } });
    expect((await post({ action: 'approve', projectId: project, topicIds: [topic] })).status).toBe(503);
  });
});
