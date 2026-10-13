import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { OFFLINE_IMPORT_MAX_BODY } from '@/lib/marketing/offline-import-validation';
const mocks=vi.hoisted(()=>({user:vi.fn(),admin:vi.fn(),run:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:mocks.user}})}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:mocks.admin}));
vi.mock('@/lib/marketing/offline-import',()=>({importMarketingOfflineDraft:mocks.run,assertMarketingOfflineImportConfiguration:(ownerId:string)=>{if(process.env.MARKETING_OFFLINE_IMPORT_ENABLED!=='true'||process.env.MARKETING_OWNER_ID!==ownerId)throw new Error('disabled');}}));
import { POST } from '@/app/api/marketing/offline-import/route';
const owner='11111111-1111-4111-8111-111111111111';
function request(body='{}',headers:Record<string,string>={}){return new Request('http://localhost/api/marketing/offline-import',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json',...headers},body});}
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('MARKETING_OWNER_ID',owner);vi.stubEnv('MARKETING_OFFLINE_IMPORT_ENABLED','true');mocks.user.mockResolvedValue({data:{user:{id:owner}}});mocks.admin.mockReturnValue({testOnly:true});mocks.run.mockResolvedValue({revisionId:owner,ready:false,status:'review',providerCalls:0,holdCode:'offline-import-review-required'});});
afterEach(()=>vi.unstubAllEnvs());
describe('offline import authenticated bounded API',()=>{
 it('rejects cross origin and unauthenticated requests before admin creation',async()=>{expect((await POST(request('{}',{origin:'https://evil.example'}))).status).toBe(403);mocks.user.mockResolvedValue({data:{user:null}});expect((await POST(request())).status).toBe(401);expect(mocks.admin).not.toHaveBeenCalled();});
 it.each(['flag','owner'])('refuses %s before parsing uploads',async(kind)=>{if(kind==='flag')vi.stubEnv('MARKETING_OFFLINE_IMPORT_ENABLED','false');else mocks.user.mockResolvedValue({data:{user:{id:'foreign'}}});expect((await POST(request())).status).toBe(403);expect(mocks.admin).not.toHaveBeenCalled();expect(mocks.run).not.toHaveBeenCalled();});
 it('rejects declared and streamed oversized bodies without calling import',async()=>{expect((await POST(request('{}',{'content-length':String(OFFLINE_IMPORT_MAX_BODY+1)}))).status).toBe(413);expect((await POST(request('x'.repeat(OFFLINE_IMPORT_MAX_BODY+1)))).status).toBe(413);expect(mocks.admin).not.toHaveBeenCalled();});
 it.each(['not JSON','{"ready":'])('rejects malformed payload',async(body)=>{expect((await POST(request(body))).status).toBe(400);expect(mocks.run).not.toHaveBeenCalled();});
 it('awaits import with request abort signal, returns held result and suppresses all raw errors',async()=>{const response=await POST(request('{"test":true}'));expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');expect(mocks.run).toHaveBeenCalledWith(expect.anything(),owner,{test:true},{signal:expect.any(AbortSignal)});mocks.run.mockRejectedValue(new Error('secret/provider/owner raw error'));const failure=await POST(request());expect(await failure.json()).toEqual({error:'offline-import-save-failed'});});
});
