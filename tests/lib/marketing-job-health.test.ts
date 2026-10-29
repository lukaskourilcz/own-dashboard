import { beforeEach, describe, expect, it, vi } from 'vitest';
import { safeMarketingJobs, marketingJobHealth } from '@/lib/marketing/job-health';
import { loadMarketingState } from '@/lib/marketing/client';
import { GET } from '@/app/api/marketing/state/route';

const { context } = vi.hoisted(() => ({ context: { owner: '11111111-1111-4111-8111-111111111111' as string | null, rows: [] as unknown[], queries: [] as Array<{ table: string; select: string; owner?: string; limit?: number }>, error: false } }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: context.owner ? { id: context.owner } : null } }) },
  from: (table: string) => {
    const record = { table, select: '' } as typeof context.queries[number]; context.queries.push(record);
    const query = { select: (value: string) => { record.select = value; return query; },
      eq: (field: string, value: string) => { if (field === 'user_id') record.owner = value; return query; },
      order: () => query, neq: () => query, in: () => query, retry: () => query, abortSignal: () => query, limit: (value: number) => { record.limit = value; return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: table === 'marketing_jobs' ? context.rows : [], error: context.error ? { message: 'PRIVATE-ERROR' } : null })) };
    return query;
  },
}) }));
const job = (index = 1) => ({ user_id: context.owner, id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, status: 'failed', error_code: 'provider-failed', brand: 'devshark', created_at: '2026-10-13T12:00:00Z', cost_usd: null });
const get = () => GET(new Request('https://own.example/api/marketing/state'));
beforeEach(() => { context.owner = '11111111-1111-4111-8111-111111111111'; context.rows = []; context.queries = []; context.error = false; vi.restoreAllMocks(); });

describe('owner-scoped bounded job health', () => {
  it('returns failure brand without a result and only allowlisted metadata for the latest ten jobs', async () => {
    context.rows = Array.from({ length: 12 }, (_, index) => ({ ...job(index + 1),
      request: { apiKey: 'PRIVATE-REQUEST', generation: { source: { content: { body: 'PRIVATE-SOURCE' } } } },
      result: { revision: { caption: 'PRIVATE-COPY' } } }));
    const response = await get(); const body = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(body.jobHealth).toHaveLength(10);
    expect(body.jobHealth[0]).toEqual({ id: job().id, status: 'failed', errorCode: 'provider-failed', brand: 'devshark', createdAt: job().created_at });
    expect(JSON.stringify(body)).not.toContain('PRIVATE-');
    const jobsQuery = context.queries.find(query => query.table === 'marketing_jobs')!;
    expect(jobsQuery.select).toBe('user_id,id,status,error_code,created_at,brand:request->generation->source->>brand,cost_usd:result->usage->>estimatedCostUsd');
    expect(jobsQuery.limit).toBe(100);
    expect(context.queries.every(query => query.owner === context.owner)).toBe(true);
    expect(body.jobs[0].costUsd).toBeNull();
  });
  it('replaces arbitrary errors/status/brands, drops malformed identifiers and never invents zero cost', () => {
    const rows = safeMarketingJobs([{ ...job(), status: 'PRIVATE-STATE', brand: 'PRIVATE-BRAND', error_code: 'Authorization Bearer PRIVATE-KEY', cost_usd: 'PRIVATE-COST' },
      { ...job(2), id: 'PRIVATE-ID' }, { ...job(3), created_at: 'PRIVATE-TIME' }, { ...job(4), error_code: 'provider-bad-request', cost_usd: '0.012' }]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ status: 'unavailable', brand: null, errorCode: 'generation-failed', costUsd: null });
    expect(rows[1]).toMatchObject({ errorCode: 'provider-bad-request', costUsd: 0.012 });
    expect(marketingJobHealth(rows)[0]).not.toHaveProperty('costUsd');
    expect(JSON.stringify(rows)).not.toContain('PRIVATE-');
  });
  it('refuses unauthenticated reads before queries and hides database error text', async () => {
    context.owner = null; expect((await get()).status).toBe(401); expect(context.queries).toEqual([]);
    context.owner = '11111111-1111-4111-8111-111111111111'; context.error = true; const response = await get();
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('PRIVATE-ERROR');
  });
  it('validates the React Query boundary and preserves cancellation without accepting extra job payload', async () => {
    const safe = marketingJobHealth(safeMarketingJobs([job()]));
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ revisions: [], jobHealth: [...safe, { ...safe[0], request: 'PRIVATE-COPY' }] }));
    const signal = new AbortController().signal;
    expect((await loadMarketingState(signal)).jobHealth).toEqual(safe);
    expect(fetcher).toHaveBeenCalledWith('/api/marketing/state', { cache: 'no-store', signal });
  });
});
