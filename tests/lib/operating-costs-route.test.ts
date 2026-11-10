import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), queries: [] as { table: string; calls: [string,unknown[]][] }[], results: {} as Record<string,{data: unknown[]; count?: number; error?: unknown}> }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.user }, from: (table: string) => {
  const query = { table, calls: [] as [string,unknown[]][] }; mocks.queries.push(query);
  const chain = { select: (...args: unknown[]) => next('select',args), eq: (...args: unknown[]) => next('eq',args), in: (...args: unknown[]) => next('in',args), gte: (...args: unknown[]) => next('gte',args), lt: (...args: unknown[]) => next('lt',args), order: (...args: unknown[]) => next('order',args), limit: (...args: unknown[]) => { query.calls.push(['limit',args]); return Promise.resolve(mocks.results[table] ?? {data: []}); } };
  const next = (method: string,args: unknown[]) => { query.calls.push([method,args]); return chain; }; return chain;
} }) }));
import { GET } from '@/app/api/finances/operating-costs/route';
beforeEach(() => {
  vi.clearAllMocks(); mocks.queries.length=0; mocks.results={}; mocks.user.mockResolvedValue({data:{user:{id:'owner'}}});
  mocks.results.projects={data:[{id:'dne',slug:'dneskai'},{id:'dev',slug:'devshark'}]};
});
describe('operating cost endpoint', () => {
  it('requires a session before reading any ledger',async () => {
    mocks.user.mockResolvedValueOnce({data:{user:null}}); const response=await GET();
    expect(response.status).toBe(401); expect(mocks.queries).toHaveLength(0);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
  it('scopes every query to the owner and separates reserved, unknown and partial usage',async () => {
    mocks.results.marketing_jobs={data:[{brand:'dneskai',status:'review',cost:'1.2'},{brand:'dneskai',status:'failed',cost:'0.4'},{brand:'other',status:'review',cost:'999'}],count:3000};
    mocks.results.marketing_devshark_drafts={data:[{project_id:'dev',status:'planned',cost_usd:null}],count:1};
    const response=await GET(); const body=await response.json();
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(body.items).toEqual(expect.arrayContaining([expect.objectContaining({source:'generation',usd:1.2,partial:true}),expect.objectContaining({source:'generationReserved',usd:0.4}),expect.objectContaining({source:'devshark',usd:null,unknown:1})]));
    for(const query of mocks.queries) expect(query.calls).toContainEqual(['eq',['user_id','owner']]);
    for(const query of mocks.queries.filter(q=>q.table!=='projects')) {
      expect(query.calls).toContainEqual(['select',[expect.any(String),{count:'exact'}]]);
      expect(query.calls).toContainEqual(['gte',['created_at',expect.any(String)]]);
      expect(query.calls).toContainEqual(['lt',['created_at',expect.any(String)]]);
    }
  });
  it('returns a sanitized error instead of private query details',async () => {
    mocks.results.marketing_jobs={data:[],error:{message:'private billing information'}};
    const response=await GET(); expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'operating-costs-unavailable'});
  });
});
