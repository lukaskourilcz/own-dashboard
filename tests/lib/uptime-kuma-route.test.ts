import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {POST} from '@/app/api/webhooks/uptime-kuma/route';
vi.mock('server-only',()=>({}));
const gate=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn(),admin:vi.fn(),rate:vi.fn()}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:gate.admin}));
vi.mock('@/lib/rate-limit',()=>({rateLimit:gate.rate}));
const owner='11111111-1111-4111-8111-111111111111';
const body=()=>({monitor:{id:3,name:'Synthetic monitor'},heartbeat:{monitorID:3,status:0,time:new Date().toISOString().replace('T',' ').replace('Z','')}});
const request=()=>new Request('https://example.test/api/webhooks/uptime-kuma',{method:'POST',headers:{authorization:'Bearer TEST-ONLY-monitor'},body:JSON.stringify(body())});
beforeEach(()=>{
 vi.stubEnv('UPTIME_KUMA_WEBHOOK_TOKEN','TEST-ONLY-monitor');vi.stubEnv('DASHBOARD_OWNER_ID',owner);
 for(const mock of [gate.from,gate.rpc,gate.admin,gate.rate])mock.mockReset();
 gate.rate.mockResolvedValue({ok:true});gate.admin.mockImplementation(()=>({from:gate.from,rpc:gate.rpc}));
 const failed={data:null,error:{code:'503'}};
 const builder={select:()=>builder,eq:()=>builder,is:()=>builder,limit:()=>Promise.resolve(failed),insert:()=>Promise.resolve(failed),retry:()=>builder,abortSignal:()=>Promise.resolve(failed)};
 gate.from.mockReturnValue(builder);gate.rpc.mockReturnValue(builder);
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();vi.restoreAllMocks();vi.clearAllMocks();});
it('does not acknowledge an unrecorded monitor transition',async()=>{
 const reply=await POST(request());expect(reply.status).toBe(503);expect(await reply.json()).toEqual({error:'Heartbeat recording unconfirmed.'});
});

it.each([null,{},[],{monitor:{id:3},heartbeat:{status:2}},{monitor:{name:'Synthetic only name'},heartbeat:{status:0}}])('ignores unverifiable/test/pending payloads without a write %j',async value=>{
 const req=request();const reply=await POST(new Request(req.url,{method:'POST',headers:req.headers,body:JSON.stringify(value)}));expect(reply.status).toBe(200);expect(await reply.json()).toMatchObject({ok:true,ignored:'unverifiable monitor event'});expect(gate.admin).not.toHaveBeenCalled();
});
it('ignores oversized malformed bodies and cancels their producer without awaiting cancellation',async()=>{
 const cancel=vi.fn(()=>new Promise<void>(()=>{}));let delivered=false;const req=new Request('https://example.test/api/webhooks/uptime-kuma',{method:'POST',headers:{authorization:'Bearer TEST-ONLY-monitor'},body:new ReadableStream({pull(controller){if(!delivered){delivered=true;controller.enqueue(new Uint8Array(65_537));}},cancel}),duplex:'half'} as RequestInit);
 const reply=await POST(req);expect(reply.status).toBe(200);expect(await reply.json()).toMatchObject({ok:true,ignored:'unreadable body'});expect(cancel).toHaveBeenCalledOnce();expect(gate.admin).not.toHaveBeenCalled();
});
it.each(['authorization','query'])('refuses %s-only invalid authentication and releases the unread body',async mode=>{
 const cancel=vi.fn();const req=new Request(`https://example.test/api/webhooks/uptime-kuma${mode==='query'?'?token=TEST-ONLY-monitor':''}`,{method:'POST',headers:mode==='authorization'?{authorization:'Bearer TEST-ONLY-wrong'}:{},body:new ReadableStream({cancel}),duplex:'half'} as RequestInit);const reply=await POST(req);expect(reply.status).toBe(403);expect(cancel).toHaveBeenCalledOnce();expect(gate.rate).not.toHaveBeenCalled();expect(gate.admin).not.toHaveBeenCalled();
});
it('rate limits before body admission and returns private noncached responses',async()=>{
 gate.rate.mockResolvedValue({ok:false,retryAfter:12});const reply=await POST(request());expect(reply.status).toBe(429);expect(reply.headers.get('retry-after')).toBe('12');expect(reply.headers.get('cache-control')).toBe('private, no-store');expect(gate.admin).not.toHaveBeenCalled();
});
it('captures the original owner before a delayed rate-limit response',async()=>{
 let finish!:(value:unknown)=>void;gate.rate.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));gate.rpc.mockImplementation((_name,args)=>({retry:()=>({abortSignal:()=>Promise.resolve({data:{ownerId:args.p_owner,monitorId:args.p_monitor_id,observedAt:args.p_observed_at,status:args.p_status,outcome:'recorded'},error:null})})}));const pending=POST(request());vi.stubEnv('DASHBOARD_OWNER_ID','22222222-2222-4222-8222-222222222222');finish({ok:true});const reply=await pending;expect(reply.status).toBe(200);expect(gate.rpc.mock.calls[0][1].p_owner).toBe(owner);expect(gate.from).not.toHaveBeenCalled();expect(await reply.json()).toMatchObject({ok:true,state:'down',outcome:'recorded'});
});
it('releases an unread/stalled body after caller cancellation',async()=>{
 const cancel=vi.fn(),controller=new AbortController();const req=new Request('https://example.test/api/webhooks/uptime-kuma',{method:'POST',headers:{authorization:'Bearer TEST-ONLY-monitor'},body:new ReadableStream({cancel}),signal:controller.signal,duplex:'half'} as RequestInit);const pending=POST(req);await Promise.resolve();controller.abort();expect((await pending).status).toBe(503);expect(cancel).toHaveBeenCalledOnce();expect(gate.admin).not.toHaveBeenCalled();
});

it('bounds the rate-limit wait within the total route deadline before body admission',async()=>{
 vi.useFakeTimers();vi.spyOn(AbortSignal,'timeout').mockImplementation(milliseconds=>{const controller=new AbortController();setTimeout(()=>controller.abort(new DOMException('Synthetic deadline','TimeoutError')),milliseconds);return controller.signal;});gate.rate.mockImplementation(()=>new Promise(()=>{}));let settled=false;const pending=POST(request()).then(reply=>{settled=true;return reply;});await vi.advanceTimersByTimeAsync(19_999);expect(settled).toBe(false);await vi.advanceTimersByTimeAsync(1);expect((await pending).status).toBe(503);expect(gate.admin).not.toHaveBeenCalled();expect(gate.rate).toHaveBeenCalledOnce();
});
