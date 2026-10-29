import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const owner='11111111-1111-4111-8111-111111111111';
const state=vi.hoisted(()=>({auth:vi.fn(),quota:vi.fn(),create:vi.fn(),fetch:vi.fn()}));
vi.mock('server-only',()=>({}));vi.mock('@/lib/supabase/server',()=>({createClient:state.create}));vi.mock('@/lib/rate-limit',()=>({rateLimit:state.quota}));
import {POST} from '@/app/api/jobs/enrich/route';
const request=(body:unknown={url:'https://thehub.io/jobs/synthetic-import'},headers:Record<string,string>={},signal?:AbortSignal)=>new Request('https://app.example/api/jobs/enrich',{method:'POST',headers:{origin:'https://app.example','Content-Type':'application/json','x-own-dashboard-owner':owner,...headers},body:JSON.stringify(body),signal});
beforeEach(()=>{state.auth.mockReset().mockResolvedValue({data:{user:{id:owner}},error:null});state.quota.mockReset().mockResolvedValue({ok:true,retryAfter:60});state.create.mockReset().mockResolvedValue({auth:{getUser:state.auth}});state.fetch.mockReset().mockResolvedValue(Response.json({data:{title:'Synthetic role at Synthetic company',content:'Synthetic description'}}));vi.stubGlobal('fetch',state.fetch);});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('refuses an auth error even if an SDK response carries a cached user',async()=>{
 state.auth.mockResolvedValue({data:{user:{id:owner}},error:{status:503,message:'PRIVATE TEST auth'}});
 expect((await POST(request())).status).toBe(503);expect(state.quota).not.toHaveBeenCalled();expect(state.fetch).not.toHaveBeenCalled();
});
it.each([400,401,403,500])('refuses auth error %s before quota/provider work',async status=>{
 state.auth.mockResolvedValue({data:{user:{id:owner}},error:{status,message:'PRIVATE TEST'}});const result=await POST(request());expect(result.status).toBe(status<500?401:503);expect(state.quota).not.toHaveBeenCalled();expect(state.fetch).not.toHaveBeenCalled();expect(await result.text()).not.toContain('PRIVATE TEST');
});
it('rejects foreign origin, invalid/changed owner, missing user and quota denial',async()=>{
 expect((await POST(request(undefined,{origin:'https://foreign.test'}))).status).toBe(403);
 expect((await POST(request(undefined,{'x-own-dashboard-owner':'invalid'}))).status).toBe(400);expect(state.create).not.toHaveBeenCalled();
 expect((await POST(request(undefined,{'x-own-dashboard-owner':'22222222-2222-4222-8222-222222222222'}))).status).toBe(409);expect(state.quota).not.toHaveBeenCalled();
 state.auth.mockResolvedValueOnce({data:{user:null},error:null});expect((await POST(request())).status).toBe(401);
 state.quota.mockResolvedValueOnce({ok:false,retryAfter:60});expect((await POST(request())).status).toBe(429);expect(state.fetch).not.toHaveBeenCalled();
});
it.each([null,[],{}, {url:42},{url:'javascript:alert(1)'},{url:'https://user:password@example.test/job'},{url:'https://thehub.io/jobs/synthetic',notes:'Private draft'}, {url:'x'.repeat(2049)}])('refuses malformed input before identity or provider work (%j)',async body=>{
 expect((await POST(request(body))).status).toBe(400);expect(state.create).not.toHaveBeenCalled();expect(state.fetch).not.toHaveBeenCalled();
});
it('bounds declared and streamed request bytes and checks content type',async()=>{
 expect((await POST(request(undefined,{'content-length':'16385'}))).status).toBe(400);
 expect((await POST(request(undefined,{'content-type':'text/plain'}))).status).toBe(400);
 const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(' '.repeat(16385)));controller.close();}});
 const input=new Request('https://app.example/api/jobs/enrich',{method:'POST',headers:{origin:'https://app.example','content-type':'application/json'},body:stream,duplex:'half'} as RequestInit);
 expect((await POST(input)).status).toBe(400);expect(state.create).not.toHaveBeenCalled();
});
it('sends only the normalized URL and returns only owned, bounded metadata',async()=>{
 state.fetch.mockResolvedValueOnce(Response.json({code:200,data:{title:'Synthetic role at Synthetic company',content:' x '.repeat(15_000),url:'https://thehub.io/jobs/canonical',usage:{private:'Synthetic ignored metadata'}}}));
 const response=await POST(request({url:'thehub.io/jobs/synthetic-import'}));expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');
 expect(await response.json()).toEqual({ownerId:owner,inputUrl:'https://thehub.io/jobs/synthetic-import',url:'https://thehub.io/jobs/canonical',title:'Synthetic role',company:'Synthetic company',description:' x '.repeat(15_000).trim().slice(0,30_000)});
 expect(state.fetch).toHaveBeenCalledOnce();const [url,init]=state.fetch.mock.calls[0];expect(url).toBe('https://r.jina.ai/https://thehub.io/jobs/synthetic-import');expect(init.body).toBeUndefined();expect(init.headers['X-Respond-With']).toBe('markdown');
 expect(state.quota).toHaveBeenCalledWith(owner,{key:'job-enrich',limit:20,windowSec:60});
});
it.each([null,[],{}, {data:{title:{private:'TEST'}}},{data:{title:''}},{data:{title:'A'.repeat(301)}},{data:{title:'Synthetic role',content:42}},{data:{title:'Synthetic role',url:'https://user:password@example.test'}}])('refuses malformed provider metadata without exposing it (%j)',async data=>{
 state.fetch.mockResolvedValueOnce(Response.json(data));const result=await POST(request());expect(result.status).toBe(502);expect(await result.text()).toBe('{"error":"job-enrichment-unavailable"}');expect(state.fetch).toHaveBeenCalledOnce();
});
it('cancels oversized and failed provider response bodies without retry',async()=>{
 let cancelled=0;const response=new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(1024*1024+1));},cancel(){cancelled++;}}));state.fetch.mockResolvedValueOnce(response);expect((await POST(request())).status).toBe(502);expect(cancelled).toBe(1);
 const failed=new Response(new ReadableStream({cancel(){cancelled++;}}),{status:503});state.fetch.mockResolvedValueOnce(failed);expect((await POST(request())).status).toBe(502);expect(cancelled).toBe(2);expect(state.fetch).toHaveBeenCalledTimes(2);
});
it('makes no work after an already cancelled request',async()=>{
 const stop=new AbortController();stop.abort();expect((await POST(request(undefined,{},stop.signal))).status).toBe(503);expect(state.create).not.toHaveBeenCalled();expect(state.fetch).not.toHaveBeenCalled();
});
it.each(['auth','quota','fetch','body'] as const)('cancellation during %s prevents later phases',async stage=>{
 const stop=new AbortController();let reached=false;
 if(stage==='auth')state.auth.mockImplementation(()=>{reached=true;return new Promise(()=>{});});
 if(stage==='quota')state.quota.mockImplementation(()=>{reached=true;return new Promise(()=>{});});
 if(stage==='fetch')state.fetch.mockImplementation(()=>{reached=true;return new Promise(()=>{});});
 if(stage==='body')state.fetch.mockResolvedValue(new Response(new ReadableStream({start(){reached=true;}})));
 const pending=POST(request(undefined,{},stop.signal));await vi.waitFor(()=>expect(reached).toBe(true));stop.abort();const result=await pending;expect(result.status).toBe(503);if(stage==='auth')expect(state.quota).not.toHaveBeenCalled();if(stage==='auth'||stage==='quota')expect(state.fetch).not.toHaveBeenCalled();
});
it('bounds provider headers and body in the same fifteen-second phase and discards a late body',async()=>{
 const stop=new AbortController();vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>ms===15_000?stop.signal:new AbortController().signal);
 let settle!:(value:Response)=>void;state.fetch.mockImplementation(()=>new Promise(resolve=>{settle=resolve;}));const pending=POST(request());await vi.waitFor(()=>expect(state.fetch).toHaveBeenCalledOnce());stop.abort();expect((await pending).status).toBe(502);
 let cancelled=false;settle(new Response(new ReadableStream({cancel(){cancelled=true;}})));await vi.waitFor(()=>expect(cancelled).toBe(true));
});
it('keeps the provider body inside its original phase deadline',async()=>{
 const stop=new AbortController();vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>ms===15_000?stop.signal:new AbortController().signal);let reading=false,cancelled=false;
 state.fetch.mockResolvedValue(new Response(new ReadableStream({pull(){reading=true;},cancel(){cancelled=true;}})));const pending=POST(request());await vi.waitFor(()=>expect(reading).toBe(true));stop.abort();expect((await pending).status).toBe(502);expect(cancelled).toBe(true);
});
it('ends a stalled request body at three seconds without auth or quota work',async()=>{
 const stop=new AbortController();vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>ms===3_000?stop.signal:new AbortController().signal);let cancelled=false;
 const input=new Request('https://app.example/api/jobs/enrich',{method:'POST',headers:{origin:'https://app.example','content-type':'application/json'},body:new ReadableStream({cancel(){cancelled=true;}}),duplex:'half'} as RequestInit);
 const pending=POST(input);stop.abort();expect((await pending).status).toBe(400);expect(cancelled).toBe(true);expect(state.create).not.toHaveBeenCalled();
});
