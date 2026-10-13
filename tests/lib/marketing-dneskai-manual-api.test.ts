import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
const mocks=vi.hoisted(()=>({admin:vi.fn(),tick:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>mocks.admin()}));
vi.mock('@/lib/marketing/dneskai-collection',async original=>({...await original<typeof import('@/lib/marketing/dneskai-collection')>(),tickDneskaiCollection:mocks.tick}));
import { POST } from '@/app/api/marketing/dneskai/collect/route';
const owner='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222',runId='33333333-3333-4333-8333-333333333333';
const secret='offline-manual-only-secret'.repeat(2),general='offline-ordinary-secret'.repeat(2);
const scope={version:'dneskai-manual/1',ownerId:owner,projectId:project,runId,startsAt:'2026-10-13T20:00:00Z',expiresAt:'2026-10-13T21:00:00Z'};
const body={projectId:project,runId,manual:true};
const request=(value:unknown,token=secret)=>new Request('https://own.example/api/marketing/dneskai/collect',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify(value)});
beforeEach(()=>{
 vi.clearAllMocks();vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-13T20:30:00Z'));
 for(const [key,value] of Object.entries({VERCEL_ENV:'production',MARKETING_OWNER_ID:owner,MARKETING_DNESKAI_MANUAL_SECRET:secret,MARKETING_DNESKAI_COLLECTION_SECRET:general,MARKETING_DNESKAI_COLLECTION_ENABLED:'false',MARKETING_DNESKAI_MANUAL_RUN:JSON.stringify(scope)}))vi.stubEnv(key,value);
 const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:{id:project,user_id:owner,portfolio_key:'aifirst',parent_id:null},error:null})};mocks.admin.mockReturnValue({from:()=>query});mocks.tick.mockResolvedValue({runId,status:'running',continue:true});
});
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();});
describe('production single-run API authorization',()=>{
 it('uses a separate secret and keeps the ordinary admission gate disabled',async()=>{
  expect((await POST(request(body))).status).toBe(200);
  expect((await POST(request(body,general))).status).toBe(401);
  expect((await POST(request({projectId:project},secret))).status).toBe(401);
  expect((await POST(request({projectId:project},general))).status).toBe(403);
  expect(mocks.tick).toHaveBeenCalledTimes(1);
 });
 it.each(['foreign-run','foreign-project','expired','preview','missing-scope'])('denies %s before privileged database access',async kind=>{
  if(kind==='expired')vi.setSystemTime(new Date(scope.expiresAt));
  if(kind==='preview')vi.stubEnv('VERCEL_ENV','preview');
  if(kind==='missing-scope')vi.stubEnv('MARKETING_DNESKAI_MANUAL_RUN','');
  const value={...body,...(kind==='foreign-run'?{runId:owner}:{}),...(kind==='foreign-project'?{projectId:owner}:{})};
  expect((await POST(request(value))).status).toBe(403);expect(mocks.admin).not.toHaveBeenCalled();expect(mocks.tick).not.toHaveBeenCalled();
 });
});
