import { afterEach, expect, it, vi } from 'vitest';
import { loadDneskaiSourceList, postDneskaiSourceAction } from '@/lib/marketing/dneskai-source-list-client';
import { dneskaiRegistrySourceList, type DneskaiSourceAction, type DneskaiSourceRow } from '@/lib/marketing/dneskai-source-list';
const owner='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222';
const source:DneskaiSourceRow={sourceId:'instagram:fixture',kind:'instagram',topic:'education',handleOrUrl:'fixture',name:'Fixture',tier:0,weekdays:[1,2],maxItems:10,enabled:true};
const action=():DneskaiSourceAction=>({action:'save',projectId:project,source:{...source,weekdays:[...source.weekdays]},expected:null});
const receipt=()=>({kind:'saved',ownerId:owner,projectId:project,sourceId:source.sourceId,source});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('keeps preview offline and refuses invalid captures or cancelled calls before fetch',async()=>{
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);expect(await loadDneskaiSourceList(project,true)).toEqual(dneskaiRegistrySourceList());
 await expect(postDneskaiSourceAction({...action(),expected:{...source,sourceId:'instagram:other'}})).rejects.toThrow();
 const controller=new AbortController();controller.abort();await expect(postDneskaiSourceAction(action(),controller.signal)).rejects.toMatchObject({name:'AbortError'});expect(fetcher).not.toHaveBeenCalled();
});
it('reads the validated list and accepts only a matching persisted save/removal',async()=>{
 const list=dneskaiRegistrySourceList(),removed={...receipt(),kind:'removed',source:null};
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json(list)).mockResolvedValueOnce(Response.json(receipt())).mockResolvedValueOnce(Response.json(removed));vi.stubGlobal('fetch',fetcher);
 expect(await loadDneskaiSourceList(project,false)).toEqual(list);expect(await postDneskaiSourceAction(action())).toEqual(receipt());
 expect(await postDneskaiSourceAction({action:'remove',projectId:project,sourceId:source.sourceId,expected:source})).toEqual(removed);
 expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual(action());expect(fetcher.mock.calls[1][1]).toMatchObject({method:'POST',cache:'no-store',signal:expect.any(AbortSignal)});
});
it('captures caller intent before a later mutation of its object',async()=>{
 let release!:(response:Response)=>void;const input=action(),fetcher=vi.fn().mockImplementation(()=>new Promise<Response>(resolve=>{release=resolve;}));vi.stubGlobal('fetch',fetcher);
 const pending=postDneskaiSourceAction(input);if(input.action==='save')input.source.name='Changed after submit';
 release(Response.json(receipt()));expect((await pending).source?.name).toBe('Fixture');expect(JSON.parse(fetcher.mock.calls[0][1].body).source.name).toBe('Fixture');
});
it.each([{ok:true}, {...receipt(),projectId:owner}, {...receipt(),source:{...source,name:'Altered'}}, {...receipt(),kind:'removed',source:null},
 {...receipt(),sourceId:'instagram:other',source:{...source,sourceId:'instagram:other'}}, {...receipt(),source:null}])('refuses a legacy, incomplete or altered save response (%#)',async(body)=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json(body)));await expect(postDneskaiSourceAction(action())).rejects.toMatchObject({code:'sources-unavailable'});
});
it('recognizes a real conflict but refuses a conflicting receipt that matches the captured state',async()=>{
 const conflict={...receipt(),kind:'conflict',source:{...source,name:'Changed elsewhere'}};
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json(conflict,{status:409})).mockResolvedValueOnce(Response.json({...receipt(),kind:'conflict'},{status:409})));
 await expect(postDneskaiSourceAction(action())).rejects.toMatchObject({code:'source-changed'});
 await expect(postDneskaiSourceAction({action:'save',projectId:project,expected:source,source:{...source,name:'My draft'}})).rejects.toMatchObject({code:'sources-unavailable'});
});
it.each(['constructor','private upstream detail','Bearer synthetic-only text'])('does not forward an unknown refusal into UI dictionaries (%s)',async(code)=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({error:code},{status:503})));await expect(postDneskaiSourceAction(action())).rejects.toMatchObject({code:'sources-unavailable',message:'sources-unavailable'});
});
it('keeps a known refusal code without arbitrary response fields',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({error:'source-limit'},{status:409})).mockResolvedValueOnce(Response.json({error:'source-limit',private:'untrusted'},{status:409})));
 await expect(postDneskaiSourceAction(action())).rejects.toMatchObject({code:'source-limit'});await expect(postDneskaiSourceAction(action())).rejects.toMatchObject({code:'sources-unavailable'});
});
it('cancels an oversized receipt without reading its remainder',async()=>{
 const cancel=vi.fn();vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('x'.repeat(70000)));},cancel}))));
 await expect(postDneskaiSourceAction(action())).rejects.toMatchObject({code:'sources-unavailable'});expect(cancel).toHaveBeenCalledOnce();
});
it.each(['fetch','body'])('expires a stalled %s with no retry and no raw abort reason',async(kind)=>{
 const controller=new AbortController();vi.spyOn(AbortSignal,'timeout').mockImplementation(()=>controller.signal);
 const cancel=vi.fn(),response=new Response(new ReadableStream({cancel})),fetcher=vi.fn().mockImplementation(()=>kind==='fetch'?new Promise(()=>{}):Promise.resolve(response));vi.stubGlobal('fetch',fetcher);
 const failed=expect(postDneskaiSourceAction(action())).rejects.toMatchObject({code:'sources-unavailable',message:'sources-unavailable'});
 await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledOnce());if(kind==='body')await vi.waitFor(()=>expect(response.body?.locked).toBe(true));controller.abort('synthetic private reason');await failed;
 expect(fetcher).toHaveBeenCalledOnce();if(kind==='body')expect(cancel).toHaveBeenCalledOnce();
});
