import { afterEach, expect, it, vi } from 'vitest';
import { loadDneskaiDailyMix, saveDneskaiDailyMix } from '@/lib/marketing/dneskai-daily-mix-client';
const project='22222222-2222-4222-8222-222222222222', owner='11111111-1111-4111-8111-111111111111';
const version='2026-10-24T17:10:00.123456Z', next='2026-10-24T17:10:00.123457Z';
const mix={newsPerDay:0,educationPerDay:0,slots:['08:00'] as ['08:00']};
const receipt=()=>({kind:'saved',projectId:project,ownerId:owner,sourceVersion:version,read:{mix,stored:true,version:next}});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('keeps preview offline, validates inputs before network and refuses a cancelled call',async()=>{
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 expect(await loadDneskaiDailyMix(project,true)).toMatchObject({stored:false,version:null});
 await expect(loadDneskaiDailyMix('invalid',false)).rejects.toThrow();
 await expect(saveDneskaiDailyMix(project,{...mix,newsPerDay:5},version)).rejects.toThrow();
 const abort=new AbortController();abort.abort();await expect(saveDneskaiDailyMix(project,mix,version,abort.signal)).rejects.toMatchObject({name:'AbortError'});
 expect(fetcher).not.toHaveBeenCalled();
});
it('reads valid versioned data and requires a matching persisted save receipt',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json(receipt().read)).mockResolvedValueOnce(Response.json(receipt()));vi.stubGlobal('fetch',fetcher);
 expect(await loadDneskaiDailyMix(project,false)).toEqual(receipt().read);
 expect(await saveDneskaiDailyMix(project,mix,version)).toEqual(receipt().read);
 expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({mix,expectedVersion:version});
 expect(fetcher.mock.calls[1][1]).toMatchObject({method:'PUT',cache:'no-store',signal:expect.any(AbortSignal)});
});
it.each([
 ()=>({...receipt(),projectId:owner}),()=>({...receipt(),kind:'conflict'}),()=>({...receipt(),sourceVersion:next,read:{...receipt().read,version:'2026-10-24T17:10:00.123458Z'}}),
 ()=>({...receipt(),read:{...receipt().read,version:'2026-10-24T17:10:00.123455Z'}}),()=>({...receipt(),read:{...receipt().read,mix:{...mix,newsPerDay:1}}}),
 ()=>({...receipt(),read:{...receipt().read,stored:false}}),()=>({mix,stored:true,version:next}),
])('refuses altered or legacy echo acknowledgements (%#)',async(make)=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json(make())));await expect(saveDneskaiDailyMix(project,mix,version)).rejects.toThrow();
});
it('recognizes conflicts and feature-off responses without reading untrusted error bodies',async()=>{
 const cancel=vi.fn(),body=()=>new ReadableStream({cancel});
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(body(),{status:409})).mockResolvedValueOnce(new Response(body(),{status:404})));
 await expect(saveDneskaiDailyMix(project,mix,version)).rejects.toMatchObject({code:'daily-mix-conflict'});
 expect(await loadDneskaiDailyMix(project,false)).toBeNull();expect(cancel).toHaveBeenCalledTimes(2);
});
it('bounds the JSON response and cancels excess data',async()=>{
 const cancel=vi.fn();vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('x'.repeat(20000)));},cancel}))));
 await expect(loadDneskaiDailyMix(project,false)).rejects.toThrow();expect(cancel).toHaveBeenCalledOnce();
});
it.each(['fetch','body'])('expires a stalled %s without waiting for the implementation to cooperate',async(kind)=>{
 const controller=new AbortController();vi.spyOn(AbortSignal,'timeout').mockImplementation(()=>controller.signal);
 const cancel=vi.fn();vi.stubGlobal('fetch',vi.fn().mockImplementation(()=>kind==='fetch'?new Promise(()=>{}):Promise.resolve(new Response(new ReadableStream({cancel})))));
 const failed=expect(loadDneskaiDailyMix(project,false)).rejects.toMatchObject({name:'AbortError'});
 await vi.waitFor(()=>expect(fetch).toHaveBeenCalledOnce());await Promise.resolve();await Promise.resolve();controller.abort('synthetic private reason');await failed;
 if(kind==='body')expect(cancel).toHaveBeenCalledOnce();
});
