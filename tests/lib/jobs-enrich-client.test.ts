import {afterEach,it,expect,vi} from 'vitest';
import {enrichCareerUrl} from '@/lib/jobs/enrich-client';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',url='https://thehub.io/jobs/synthetic-import';
const scope=()=>({ownerId:owner,signal:new AbortController().signal});
const receipt=()=>({ownerId:owner,inputUrl:url,url,title:'Synthetic role',company:'Synthetic company',description:'Synthetic description'});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('captures the owner and normalized URL before waiting and sends no draft fields',async()=>{
 let settle!:(value:Response)=>void;const fetcher=vi.fn(()=>new Promise<Response>(resolve=>{settle=resolve;}));vi.stubGlobal('fetch',fetcher);const captured=scope(),pending=enrichCareerUrl(captured,' thehub.io/jobs/synthetic-import ');captured.ownerId=other;settle(Response.json(receipt()));expect(await pending).toEqual(receipt());
 expect(fetcher).toHaveBeenCalledOnce();const [target,init]=fetcher.mock.calls[0] as unknown as [string,RequestInit];expect(target).toBe('/api/jobs/enrich');expect(init.headers).toEqual({'Content-Type':'application/json','x-own-dashboard-owner':owner});expect(JSON.parse(String(init.body))).toEqual({url});
});
it.each(['owner','input','extra','title','url','description','array','missing'] as const)('refuses a %s receipt',async kind=>{
 const value:Record<string,unknown>=receipt();let data:unknown=value;if(kind==='owner')value.ownerId=other;else if(kind==='input')value.inputUrl='https://thehub.io/jobs/other';else if(kind==='extra')value.private='TEST';else if(kind==='title')value.title='A'.repeat(301);else if(kind==='url')value.url='javascript:alert(1)';else if(kind==='description')value.description=42;else if(kind==='array')data=[value];else delete value.company;
 const fetcher=vi.fn(async()=>Response.json(data));vi.stubGlobal('fetch',fetcher);await expect(enrichCareerUrl(scope(),url)).rejects.toMatchObject({message:'Position import unavailable'});expect(fetcher).toHaveBeenCalledOnce();
});
it('refuses invalid input and already-retired owners before sending',async()=>{
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);await expect(enrichCareerUrl(scope(),'javascript:alert(1)')).rejects.toThrow('Position import unavailable');await expect(enrichCareerUrl({...scope(),ownerId:'invalid'},url)).rejects.toThrow('Position import unavailable');const stop=new AbortController();stop.abort();await expect(enrichCareerUrl({ownerId:owner,signal:stop.signal},url)).rejects.toMatchObject({name:'AbortError'});expect(fetcher).not.toHaveBeenCalled();
});
it('bounds streamed bytes and discards a failed response without exposing provider text',async()=>{
 let cancelled=0;const fetcher=vi.fn().mockResolvedValueOnce(new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(256*1024+1));},cancel(){cancelled++;}}))).mockResolvedValueOnce(new Response(new ReadableStream({cancel(){cancelled++;}}),{status:503}));vi.stubGlobal('fetch',fetcher);
 for(let i=0;i<2;i++)await expect(enrichCareerUrl(scope(),url)).rejects.toThrow('Position import unavailable');expect(cancelled).toBe(2);expect(fetcher).toHaveBeenCalledTimes(2);
});
it.each(['cancel','deadline','body'] as const)('retires uncooperative %s work and never accepts a late receipt',async mode=>{
 const stop=new AbortController(),deadline=new AbortController();vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{expect(ms).toBe(30_000);return deadline.signal;});let settle!:(value:Response)=>void,cancelled=false;
 const fetcher=vi.fn(()=>mode==='body'?Promise.resolve(new Response(new ReadableStream({cancel(){cancelled=true;}}))):new Promise<Response>(resolve=>{settle=resolve;}));vi.stubGlobal('fetch',fetcher);
 const pending=enrichCareerUrl({ownerId:owner,signal:stop.signal},url),failure=expect(pending).rejects.toMatchObject(mode==='deadline'?{message:'Position import unavailable'}:{name:'AbortError'});await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledOnce());(mode==='deadline'?deadline:stop).abort();await failure;
 if(mode!=='body')settle(new Response(new ReadableStream({cancel(){cancelled=true;}})));await vi.waitFor(()=>expect(cancelled).toBe(true));expect(fetcher).toHaveBeenCalledOnce();
});
