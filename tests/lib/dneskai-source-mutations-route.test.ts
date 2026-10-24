import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GET, POST } from '@/app/api/marketing/dneskai/source-list/route';
import type { DneskaiSourceAction, DneskaiSourceRow } from '@/lib/marketing/dneskai-source-list';
const m=vi.hoisted(()=>({user:vi.fn(),project:vi.fn(),rpc:vi.fn(),retry:vi.fn(),signal:vi.fn(),result:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/marketing/dneskai-store',()=>({requireDneskaiProject:m.project}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:m.user},rpc:(...args:unknown[])=>{
 m.rpc(...args);const builder={retry:(value:false)=>{m.retry(value);return builder;},abortSignal:(signal:AbortSignal)=>{m.signal(signal);return builder;},then:(resolve:(value:unknown)=>unknown)=>m.result().then(resolve)};return builder;
}})}));
const owner='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222';
const source:DneskaiSourceRow={sourceId:'instagram:fixture',kind:'instagram',topic:'education',handleOrUrl:'fixture',name:'Fixture',tier:0,weekdays:[1,2],maxItems:10,enabled:true};
const action:DneskaiSourceAction={action:'save',projectId:project,source,expected:null};
const receipt=()=>({kind:'saved',ownerId:owner,projectId:project,sourceId:source.sourceId,source});
const request=(value:unknown,origin='https://fixture.invalid')=>new Request('https://fixture.invalid/api/marketing/dneskai/source-list',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(value)});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('DNESKAI_SOURCES_TABLE_ENABLED','true');m.user.mockResolvedValue({data:{user:{id:owner}},error:null});m.project.mockResolvedValue({id:project});m.result.mockResolvedValue({data:receipt(),error:null});});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();vi.useRealTimers();});
it('confirms the owned requested source through the captured RPC without SDK retries',async()=>{
 const response=await POST(request(action));expect(response.status).toBe(200);expect(await response.json()).toEqual(receipt());
 expect(m.rpc).toHaveBeenCalledExactlyOnceWith('change_dneskai_source',{p_project:project,p_action:'save',p_expected:null,p_source:source});expect(m.retry).toHaveBeenCalledWith(false);expect(m.signal).toHaveBeenCalledWith(expect.any(AbortSignal));expect(response.headers.get('cache-control')).toContain('no-store');
});
it.each([null,{ok:true}, {...receipt(),ownerId:project},{...receipt(),projectId:owner},{...receipt(),sourceId:'instagram:another',source:{...source,sourceId:'instagram:another'}},
 {...receipt(),source:{...source,enabled:false}},{...receipt(),kind:'removed',source:null}])('refuses an empty, legacy or altered acknowledgement (%#)',async(data)=>{
 m.result.mockResolvedValue({data,error:null});const response=await POST(request(action));expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'sources-unavailable'});
});
it('returns a matching conflict as 409 and confirms only the requested removal',async()=>{
 const conflict={...receipt(),kind:'conflict',source:{...source,name:'Changed elsewhere'}};m.result.mockResolvedValueOnce({data:conflict,error:null});
 const response=await POST(request(action));expect(response.status).toBe(409);expect(await response.json()).toEqual(conflict);
 const removed={...receipt(),kind:'removed',source:null};m.result.mockResolvedValueOnce({data:removed,error:null});
 const result=await POST(request({action:'remove',projectId:project,sourceId:source.sourceId,expected:source}));expect(result.status).toBe(200);expect(await result.json()).toEqual(removed);
});
it('refuses incomplete captures, excessive bodies and identity mismatches before a write',async()=>{
 for(const value of [{action:'save',projectId:project,source},{...action,extra:'x'}, {...action,expected:{...source,sourceId:'instagram:another'}}, {extra:'x'.repeat(17000)}])expect((await POST(request(value))).status).toBe(400);
 expect(m.rpc).not.toHaveBeenCalled();
});
it('distinguishes unavailable project reads from confirmed missing or foreign projects',async()=>{
 m.project.mockRejectedValueOnce(new Error('collection-project-read-unavailable'));expect((await POST(request(action))).status).toBe(503);
 m.project.mockRejectedValueOnce(new Error('collection-project-unavailable'));expect((await POST(request(action))).status).toBe(404);
 m.project.mockRejectedValueOnce(new Error('collection-project-read-unavailable'));expect((await GET(new Request(`https://fixture.invalid/api/marketing/dneskai/source-list?projectId=${project}`))).status).toBe(503);
 expect(m.rpc).not.toHaveBeenCalled();
});
it('refuses an unknown project-check failure as unavailable rather than a missing project',async()=>{
 m.project.mockRejectedValueOnce(new Error('synthetic private unexpected failure'));const response=await POST(request(action));
 expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'sources-unavailable'});expect(m.rpc).not.toHaveBeenCalled();
});
it('cancels a stalled upload with a retryable response before any source mutation',async()=>{
 vi.useFakeTimers();const cancel=vi.fn(),body=new ReadableStream<Uint8Array>({cancel});
 const pending=POST(new Request('https://fixture.invalid/api/marketing/dneskai/source-list',{method:'POST',headers:{Origin:'https://fixture.invalid'},body,duplex:'half'} as RequestInit));
 await vi.waitFor(()=>expect(body.locked).toBe(true));await vi.advanceTimersByTimeAsync(5000);const response=await pending;
 expect(response.status).toBe(408);expect(await response.json()).toEqual({error:'sources-unavailable'});expect(m.rpc).not.toHaveBeenCalled();expect(cancel).toHaveBeenCalledOnce();
});
it('refuses unavailable auth, absent sessions, cross-origin requests and switched-off writes',async()=>{
 m.user.mockResolvedValueOnce({data:{user:null},error:{status:503}});expect((await POST(request(action))).status).toBe(503);
 m.user.mockResolvedValueOnce({data:{user:null},error:null});expect((await POST(request(action))).status).toBe(401);
 expect((await POST(request(action,'https://foreign.invalid'))).status).toBe(403);
 vi.stubEnv('DNESKAI_SOURCES_TABLE_ENABLED','false');expect((await POST(request(action))).status).toBe(404);expect(m.rpc).not.toHaveBeenCalled();
});
it('expires a stalled mutation once without leaking its body or retrying it',async()=>{
 const controller=new AbortController();vi.spyOn(AbortSignal,'timeout').mockImplementation(()=>controller.signal);m.result.mockImplementation(()=>new Promise(()=>{}));
 const pending=POST(request(action));await vi.waitFor(()=>expect(m.rpc).toHaveBeenCalledOnce());controller.abort('synthetic private upstream detail');
 const response=await pending;expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'sources-unavailable'});expect(m.rpc).toHaveBeenCalledOnce();expect((m.signal.mock.calls[0]![0] as AbortSignal).aborted).toBe(true);
});
it('the actual project helper separates read failures from successful absence and propagates cancellation',async()=>{
 const {requireDneskaiProject}=await vi.importActual<typeof import('@/lib/marketing/dneskai-store')>('@/lib/marketing/dneskai-store');
 const read=vi.fn().mockResolvedValue({data:null,error:{message:'synthetic private error'}}),retry=vi.fn(),abort=vi.fn(),filters:unknown[][]=[];
 const query={select:()=>query,eq:(...args:unknown[])=>{filters.push(args);return query;},retry:(value:false)=>{retry(value);return query;},abortSignal:(signal:AbortSignal)=>{abort(signal);return query;},maybeSingle:read};
 const db={from:()=>query},controller=new AbortController();
 await expect(requireDneskaiProject(db as never,owner,project,controller.signal)).rejects.toThrow('collection-project-read-unavailable');
 read.mockResolvedValue({data:null,error:null});await expect(requireDneskaiProject(db as never,owner,project,controller.signal)).rejects.toThrow('collection-project-unavailable');
 expect(filters).toContainEqual(['user_id',owner]);expect(filters).toContainEqual(['id',project]);expect(retry).toHaveBeenCalledWith(false);expect(abort).toHaveBeenCalledWith(controller.signal);
 read.mockClear();controller.abort();await expect(requireDneskaiProject(db as never,owner,project,controller.signal)).rejects.toMatchObject({name:'AbortError'});expect(read).not.toHaveBeenCalled();
});
