import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { JobListing } from '@/lib/types';
import type { ScrapedJob } from '@/lib/jobs/types';
vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({ feed: vi.fn(), verify: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: '11111111-1111-4111-8111-111111111111' } }, error: null }) }, from: (table: string) => state.from(table) }) }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ ok: true }) }));
vi.mock('@/lib/jobs/employer-sources', () => ({ EMPLOYER_BOARDS: [{ id: 'ashby-sanity' }], fetchEmployerBoard: (...args: unknown[]) => state.feed(...args) }));
vi.mock('@/lib/jobs/availability', async original => ({ ...await original<typeof import('@/lib/jobs/availability')>(), verifyListings: (...args: unknown[]) => state.verify(...args) }));
import { POST } from '@/app/api/jobs/available/route';
const stored: JobListing = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', source: 'ashby-sanity', external_id: 'synthetic-job', title: 'Frontend Engineer React', company: 'Synthetic', url: 'https://jobs.ashbyhq.com/sanity/synthetic', location: 'Oslo', role: 'frontend', remote: false, salary: null, tags: ['React'], seniority: null, description: 'React TypeScript', posted_at: null, first_seen_at: '2026-10-25T12:00:00Z', last_seen_at: '2026-10-25T12:00:00Z' };
const native = (patch: Partial<ScrapedJob> = {}): ScrapedJob => ({ source: stored.source, externalId: stored.external_id, title: stored.title, company: stored.company, url: stored.url, location: stored.location, role: stored.role, remote: stored.remote, salary: stored.salary, tags: [...stored.tags], seniority: stored.seniority, description: stored.description, postedAt: stored.posted_at, ...patch });
const query = (value: unknown) => { const builder = { select: () => builder, eq: () => builder, order: () => builder, limit: () => builder, maybeSingle: () => builder, then: (resolve: (data: unknown) => unknown) => Promise.resolve({ data: value, error: null }).then(resolve) }; return builder; };
beforeEach(() => { vi.clearAllMocks(); state.feed.mockResolvedValue([native()]); state.verify.mockResolvedValue({}); state.from.mockImplementation((table: string) => query(table === 'job_listings' ? [stored] : { show_czech_career: false })); });
afterEach(() => { vi.restoreAllMocks(); });
const check = async () => { const response = await POST(new Request('https://own.example/api/jobs/available', { method: 'POST', headers: { origin: 'https://own.example' } })); expect(response.status).toBe(200); return await response.json(); };
it.each(['omitted', 'url', 'title', 'duplicate'] as const)('keeps %s native discovery evidence unknown instead of inventing closure or openness', async kind => {
 state.feed.mockResolvedValue(kind === 'omitted' ? [] : kind === 'url' ? [native({ url: stored.url + '?position=another' })] : kind === 'title' ? [native({ title: 'Different React position' })] : [native(), native({ url: stored.url + '/other' })]);
 const result = await check(); expect(result.states[stored.id]).toBe('unknown'); expect(state.feed).toHaveBeenCalledOnce();
});
it('confirms a matching native identity without an additional page probe', async () => { const result = await check(); expect(result.states[stored.id]).toBe('open'); expect(state.feed).toHaveBeenCalledOnce(); expect(state.verify.mock.calls[0][0]).toEqual([]); });
it('keeps a failed native feed unknown', async () => { state.feed.mockRejectedValue(Error('PRIVATE TEST')); const result = await check(); expect(result.states[stored.id]).toBe('unknown'); expect(JSON.stringify(result)).not.toContain('PRIVATE TEST'); });

it('accepts canonical title spacing/case and a harmless fragment while preserving query identity', async () => {
 state.feed.mockResolvedValue([native({ title: 'Ｆrontend  Engineer  React', url: stored.url + '#application' })]); expect((await check()).states[stored.id]).toBe('open'); expect(state.feed).toHaveBeenCalledOnce();
});
it('keeps a foreign-source row unknown even if its external id matches', async () => { state.feed.mockResolvedValue([native({ source: 'other-source' })]); expect((await check()).states[stored.id]).toBe('unknown'); });
