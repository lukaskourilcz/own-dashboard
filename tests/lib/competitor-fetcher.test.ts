import { afterEach, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { fetchCompetitors } from '@/lib/queries/fetchers';
const backend = vi.hoisted(() => ({ api: null as unknown as SupabaseClient }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => backend.api }));
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const project = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const stamp = '2026-10-25T11:00:00Z';
const scope = () => ({ ownerId: owner, signal: new AbortController().signal });
function record(index: number, identity = owner) {
  return { id: `${index.toString(16).padStart(8, '0')}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`, user_id: identity, project_id: project, name: 'Synthetic research', url: null, summary: '', category: 'direct', useful_features: [], social_content: '', pricing_model: '', lessons: '', relevance_score: null, score_rationale: '', social_links: [], source_urls: [], reviewed_at: null, sort_order: 0, created_at: stamp, updated_at: stamp };
}
function wire(data: unknown, status = 200) {
  const transport = vi.fn<typeof fetch>(async input => Response.json(Array.isArray(data) && !String(input).includes('/rpc/') ? data.slice(0, 1000) : data, { status }));
  backend.api = createClient('https://example.supabase.co', 'TEST-ONLY-public', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: transport } });
  return transport;
}
afterEach(() => vi.restoreAllMocks());
it('returns every captured owned record past a REST page in one request', async () => {
  const transport = wire(Array.from({ length: 1201 }, (_, index) => record(index)));
  expect(await fetchCompetitors(scope())).toHaveLength(1201);
  expect(transport).toHaveBeenCalledOnce();
});
it('rejects another owner rather than populating the captured cache', async () => {
  wire([record(1, other)]);
  await expect(fetchCompetitors(scope())).rejects.toThrow(/^Competition unavailable$/);
});
it('refuses malformed successful data rather than calling it an empty collection', async () => {
  wire(null);
  await expect(fetchCompetitors(scope())).rejects.toThrow(/^Competition unavailable$/);
});
it('returns a fixed diagnostic without database details or a hidden retry', async () => {
  const transport = wire({ message: 'PRIVATE TEST database detail' }, 503);
  await expect(fetchCompetitors(scope())).rejects.toThrow(/^Competition unavailable$/);
  expect(transport).toHaveBeenCalledOnce();
});
