import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
const mocks=vi.hoisted(()=>({user:vi.fn(),admin:vi.fn(),tick:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:mocks.user},from:mocks.admin().from})}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>mocks.admin()}));
vi.mock('@/lib/marketing/dneskai-collection',async importOriginal=>({...await importOriginal<typeof import('@/lib/marketing/dneskai-collection')>(),tickDneskaiCollection:mocks.tick}));
import { GET } from '@/app/api/marketing/dneskai/sources/route';
import { POST } from '@/app/api/marketing/dneskai/collect/route';
const owner='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222',secret='test-only-n8n-secret'.repeat(3);
function database(projectRow:Record<string,unknown>|null={id:project,user_id:owner,portfolio_key:'aifirst',repo_full_name:null,parent_id:null}){
 const filters:Array<[string,string,unknown]>=[];
 const db={from:(table:string)=>{const query={select:()=>query,eq:(field:string,value:unknown)=>{filters.push([table,field,value]);return query;},in:()=>query,order:()=>query,limit:()=>query,maybeSingle:async()=>({data:projectRow,error:null}),then:(resolve:(result:{data:unknown[];error:null})=>unknown)=>Promise.resolve({data:[],error:null}).then(resolve)};return query;}};
 return{db,filters};
}
function post(body:unknown,authorized=true){return new Request('https://own.example/api/marketing/dneskai/collect',{method:'POST',headers:{'Content-Type':'application/json',...(authorized?{Authorization:`Bearer ${secret}`}:{})},body:JSON.stringify(body)});}
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('MARKETING_OWNER_ID',owner);vi.stubEnv('MARKETING_N8N_SECRET','other-publishing-secret'.repeat(3));vi.stubEnv('MARKETING_DNESKAI_COLLECTION_SECRET',secret);vi.stubEnv('MARKETING_DNESKAI_COLLECTION_ENABLED','true');for(const key of ['MARKETING_PILOT_OWNER_ID','MARKETING_PILOT_STARTS_AT','MARKETING_PILOT_EXPIRES_AT'])vi.stubEnv(key,undefined);mocks.user.mockResolvedValue({data:{user:{id:owner}}});mocks.admin.mockReturnValue(database().db);mocks.tick.mockResolvedValue({runId:project,status:'held',continue:false});});
afterEach(()=>vi.unstubAllEnvs());
describe('DNESKAi collection owned API boundaries',()=>{
 it('accepts only the dedicated collection credential, never the general publisher credential',async()=>{
  const request=post({projectId:project});request.headers.set('Authorization',`Bearer ${'other-publishing-secret'.repeat(3)}`);
  expect((await POST(request)).status).toBe(401);expect(mocks.admin).not.toHaveBeenCalled();expect(mocks.tick).not.toHaveBeenCalled();
  vi.stubEnv('MARKETING_DNESKAI_COLLECTION_SECRET',undefined);
  expect((await POST(post({projectId:project}))).status).toBe(401);expect(mocks.admin).not.toHaveBeenCalled();
 });
 it('rejects caller-supplied owners and invalid run identities before privileged access',async()=>{
  for(const body of [{projectId:project,ownerId:owner},{projectId:project,runId:'invalid'}])expect((await POST(post(body))).status).toBe(400);
  expect(mocks.admin).not.toHaveBeenCalled();expect(mocks.tick).not.toHaveBeenCalled();
 });
 it('reports real empty state,42 never-run sources, unknown costs and no fabricated topics',async()=>{vi.stubEnv('MARKETING_DNESKAI_COLLECTION_ENABLED','false');const d=database();mocks.admin.mockReturnValue(d.db);const response=await GET(new Request(`https://own.example/api/marketing/dneskai/sources?projectId=${project}`));expect(response.status).toBe(200);const result=await response.json();expect(result).toMatchObject({enabled:false,approvalRequired:true,dailyTarget:4,candidates:[],runs:[]});expect(result.sources).toHaveLength(42);expect(result.sourceStates.every((row:{status:string;costUsd:number|null})=>row.status==='never'&&row.costUsd===null)).toBe(true);expect(response.headers.get('cache-control')).toBe('private, no-store');expect(d.filters).toContainEqual(['projects','user_id',owner]);});
 it.each(['missing','foreign','wrong-brand','unauthenticated'])('refuses %s source state',async kind=>{if(kind==='unauthenticated')mocks.user.mockResolvedValue({data:{user:null}});if(kind==='foreign')mocks.admin.mockReturnValue(database({id:project,user_id:'foreign',portfolio_key:'aifirst',parent_id:null}).db);if(kind==='wrong-brand')mocks.admin.mockReturnValue(database({id:project,user_id:owner,portfolio_key:'own-dashboard',parent_id:null}).db);const query=kind==='missing'?'':`?projectId=${project}`;expect((await GET(new Request(`https://own.example/api/marketing/dneskai/sources${query}`))).status).toBe(kind==='unauthenticated'?401:kind==='missing'?400:404);});
 it('requires native n8n auth, bounded input and default-disabled gate before collection',async()=>{expect((await POST(post({projectId:project},false))).status).toBe(401);vi.stubEnv('MARKETING_DNESKAI_COLLECTION_ENABLED','false');expect((await POST(post({projectId:project}))).status).toBe(403);vi.stubEnv('MARKETING_DNESKAI_COLLECTION_ENABLED','true');expect((await POST(post({projectId:project,padding:'x'.repeat(5000)}))).status).toBe(400);expect(mocks.tick).not.toHaveBeenCalled();});
 it('passes only verified owned project and exact resumed run to the awaited tick',async()=>{const run='33333333-3333-4333-8333-333333333333',response=await POST(post({projectId:project,runId:run}));expect(response.status).toBe(200);expect(mocks.tick).toHaveBeenCalledWith(owner,{projectId:project,runId:run},{store:expect.anything(),signal:expect.any(AbortSignal)});mocks.admin.mockReturnValue(database({id:project,user_id:owner,portfolio_key:'own-dashboard',parent_id:null}).db);expect((await POST(post({projectId:project}))).status).toBe(404);expect(mocks.tick).toHaveBeenCalledTimes(1);});
 it('never sends exception text or provider/private data to callers',async()=>{mocks.tick.mockRejectedValue(new Error('private secret source body MUST NOT ESCAPE'));const response=await POST(post({projectId:project}));expect(await response.json()).toEqual({error:'collection-unavailable'});});
});
