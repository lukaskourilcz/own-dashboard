import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
const mocks=vi.hoisted(()=>({admin:vi.fn(),tick:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>mocks.admin()}));
vi.mock('@/lib/marketing/dneskai-collection',async original=>({...await original<typeof import('@/lib/marketing/dneskai-collection')>(),tickDneskaiCollection:mocks.tick}));
import { POST } from '@/app/api/marketing/dneskai/collect/route';
const owner='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222',secret='offline-collection-only-secret'.repeat(2);
const values={VERCEL_ENV:'preview',MARKETING_OWNER_ID:owner,MARKETING_DNESKAI_COLLECTION_SECRET:secret,MARKETING_DNESKAI_COLLECTION_ENABLED:'false',MARKETING_PILOT_OWNER_ID:owner,MARKETING_PILOT_STARTS_AT:'2026-10-01T00:00:00Z',MARKETING_PILOT_EXPIRES_AT:'2026-10-03T00:00:00Z',MARKETING_DNESKAI_COLLECTION_PILOT_ENABLED:'true',MARKETING_DNESKAI_COLLECTION_PILOT_OWNER_ID:owner,MARKETING_DNESKAI_COLLECTION_PILOT_PROJECT_ID:project,MARKETING_DNESKAI_COLLECTION_PILOT_STARTS_AT:'2026-10-13T10:00:00Z',MARKETING_DNESKAI_COLLECTION_PILOT_EXPIRES_AT:'2026-10-14T10:00:00Z'};
const request=(body:unknown,token=secret)=>new Request('https://own.example/api/marketing/dneskai/collect',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));for(const [key,value]of Object.entries(values))vi.stubEnv(key,value);const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:{id:project,user_id:owner,portfolio_key:'aifirst',parent_id:null},error:null})};mocks.admin.mockReturnValue({from:()=>query});mocks.tick.mockResolvedValue({runId:project,status:'running',continue:true});});
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();});
describe('manual-only collection pilot route, no providers',()=>{
 it('allows exact pilot body with scoped secret while ordinary collection and expired generation stay disabled',async()=>{expect((await POST(request({projectId:project,pilot:true}))).status).toBe(200);expect(mocks.tick).toHaveBeenCalledWith(owner,{projectId:project,pilot:true},{store:expect.anything(),signal:expect.any(AbortSignal)});expect((await POST(request({projectId:project}))).status).toBe(401);expect(mocks.tick).toHaveBeenCalledTimes(1);});
 it.each(['production','foreign-project','wrong-secret','expired'])('rejects %s before privileged access',async kind=>{if(kind==='production')vi.stubEnv('VERCEL_ENV','production');if(kind==='expired')vi.setSystemTime(new Date(values.MARKETING_DNESKAI_COLLECTION_PILOT_EXPIRES_AT));expect((await POST(request({projectId:kind==='foreign-project'?owner:project,pilot:true},kind==='wrong-secret'?'general-publishing-secret':secret))).status).toBe(401);expect(mocks.admin).not.toHaveBeenCalled();expect(mocks.tick).not.toHaveBeenCalled();});
 it('rejects caller budget/window overrides before access',async()=>{expect((await POST(request({projectId:project,pilot:true,budgetUsd:100}))).status).toBe(400);expect(mocks.admin).not.toHaveBeenCalled();});
});
