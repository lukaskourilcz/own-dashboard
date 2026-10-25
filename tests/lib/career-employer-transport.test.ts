import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchEmployerBoard, normalizeEmployerJob } from '@/lib/jobs/employer-sources';
const board={id:'ashby-sanity',provider:'ashby' as const,slug:'sanity',name:'Synthetic'};
const row=(id='one')=>({id,title:'React frontend engineer',jobUrl:`https://jobs.ashbyhq.com/sanity/${id}`,location:'Oslo',descriptionPlain:'React TypeScript',workplaceType:'Remote'});
let network:ReturnType<typeof vi.fn>;
beforeEach(()=>{network=vi.fn().mockResolvedValue(Response.json({jobs:[row()]}));vi.stubGlobal('fetch',network);});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers();});
it('reads the existing public feed with no redirects and a captured cancellable transport',async()=>{
 const parent=new AbortController();expect(await fetchEmployerBoard(board,parent.signal)).toHaveLength(1);expect(network).toHaveBeenCalledOnce();const init=network.mock.calls[0][1] as RequestInit;expect(init.redirect).toBe('error');expect(init.signal).toBeInstanceOf(AbortSignal);expect(init.signal!.aborted).toBe(true);
});
it.each([null,[],{...row(),title:42}])('refuses a malformed raw row before silently returning a partial feed (%j)',async value=>{
 network.mockResolvedValue(Response.json({jobs:[row(),value]}));await expect(fetchEmployerBoard(board)).rejects.toThrow();
});
it('refuses a feed beyond its complete 1,000-row bound',async()=>{network.mockResolvedValue(Response.json({jobs:Array.from({length:1001},(_,i)=>row(String(i)))}));await expect(fetchEmployerBoard(board)).rejects.toThrow();});
it('does not start a public request after parent cancellation',async()=>{const parent=new AbortController();parent.abort();await expect(fetchEmployerBoard(board,parent.signal)).rejects.toThrow();expect(network).not.toHaveBeenCalled();});

it.each(['ashby','lever','greenhouse'] as const)('retains documented %s public response shapes',async provider=>{
 const raw=provider==='lever'?{id:'one',text:row().title,hostedUrl:'https://jobs.lever.co/outreach/one',categories:{location:'Oslo'},descriptionPlain:'React TypeScript'}:provider==='greenhouse'?{id:123,title:row().title,absolute_url:'https://boards.greenhouse.io/synthetic/jobs/123',location:{name:'Oslo'},content:'React TypeScript'}:row();
 network.mockResolvedValue(Response.json(provider==='lever'?[raw]:{jobs:[raw]}));const result=await fetchEmployerBoard({...board,provider});expect(result).toHaveLength(1);expect(result[0]).toMatchObject({source:board.id,title:row().title,location:'Oslo'});
});
it('refuses actual UTF-8 overflow even when the decoded text fits a character count',async()=>{
 let cancelled=0;const bytes=new TextEncoder().encode(JSON.stringify({jobs:[row()],ignored:'ž'.repeat(4_194_304)}));
 network.mockResolvedValue(new Response(new ReadableStream({start(controller){controller.enqueue(bytes);},cancel(){cancelled++;}})));
 await expect(fetchEmployerBoard(board)).rejects.toThrow('Employer feed unavailable');expect(cancelled).toBe(1);expect(network).toHaveBeenCalledOnce();
});
it('shares its byte budget across Lever pages instead of granting every page another eight MiB',async()=>{
 const page=Array.from({length:100},(_,i)=>i===0?{...row(String(i)),unusedProviderMetadata:'a'.repeat(4_500_000)}:row(String(i)));
 network.mockImplementation(async()=>Response.json(page));await expect(fetchEmployerBoard({...board,provider:'lever'})).rejects.toThrow('Employer feed unavailable');expect(network).toHaveBeenCalledTimes(2);
});
it.each(['utf8','declared','http'] as const)('releases refused %s bodies and keeps the diagnostic fixed',async kind=>{
 let cancelled=0;network.mockResolvedValue(new Response(new ReadableStream({start(controller){controller.enqueue(kind==='utf8'?new Uint8Array([255]):new TextEncoder().encode('PRIVATE TEST'));if(kind==='utf8')controller.close();},cancel(){cancelled++;}}),{status:kind==='http'?503:200,headers:kind==='declared'?{'content-length':'99999999'}:{}}));
 await expect(fetchEmployerBoard(board)).rejects.toThrow('Employer feed unavailable');expect(cancelled).toBe(kind==='utf8'?0:1);
});
it.each(['headers','body'] as const)('bounds stalled %s within the per-request deadline and releases late work',async phase=>{
 const deadlines=new Map<number,AbortController>();vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{const c=new AbortController();deadlines.set(ms,c);return c.signal;});
 let finish!:(value:Response)=>void,cancelled=0;
 network.mockImplementation(()=>phase==='headers'?new Promise<Response>(resolve=>{finish=resolve;}):Promise.resolve(new Response(new ReadableStream({cancel(){cancelled++;}}))));
 const pending=fetchEmployerBoard(board),check=expect(pending).rejects.toThrow('Employer feed unavailable');await vi.waitFor(()=>expect(network).toHaveBeenCalledOnce());deadlines.get(10000)!.abort();await check;
 if(phase==='headers'){finish(new Response(new ReadableStream({cancel(){cancelled++;}})));await Promise.resolve();}
 expect(cancelled).toBe(1);expect(network).toHaveBeenCalledOnce();
});
it('copies board identity before waiting and keeps all Lever pages in that original source',async()=>{
 const input={...board,id:'lever-outreach',provider:'lever' as const,slug:'outreach'};let finish!:(response:Response)=>void;
 network.mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve;})).mockResolvedValueOnce(Response.json([{...row('last'),jobUrl:'https://jobs.lever.co/outreach/last'}]));
 const pending=fetchEmployerBoard(input);await vi.waitFor(()=>expect(network).toHaveBeenCalledOnce());input.slug='changed';input.id='changed';
 finish(Response.json(Array.from({length:100},(_,i)=>({...row(String(i)),jobUrl:`https://jobs.lever.co/outreach/${i}`}))));const result=await pending;
 expect(result).toHaveLength(101);expect(result.every(job=>job.source==='lever-outreach')).toBe(true);expect(network.mock.calls.every(call=>String(call[0]).includes('/outreach?'))).toBe(true);
});
it('never requests a later Lever page after the parent retires',async()=>{
 const parent=new AbortController();network.mockImplementation(async()=>{parent.abort();return Response.json(Array.from({length:100},(_,i)=>row(String(i))));});
 await expect(fetchEmployerBoard({...board,provider:'lever'},parent.signal)).rejects.toMatchObject({name:'AbortError'});expect(network).toHaveBeenCalledOnce();
});
it('shares a total deadline across successful Lever pages',async()=>{
 vi.useFakeTimers();vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{const c=new AbortController();setTimeout(()=>c.abort(),ms);return c.signal;});
 network.mockImplementation(()=>new Promise(resolve=>setTimeout(()=>resolve(Response.json(Array.from({length:100},(_,i)=>row(String(i))))),9000)));
 const pending=fetchEmployerBoard({...board,provider:'lever'}),check=expect(pending).rejects.toThrow('Employer feed unavailable');await vi.advanceTimersByTimeAsync(25001);await check;expect(network).toHaveBeenCalledTimes(3);await vi.advanceTimersByTimeAsync(20000);expect(network).toHaveBeenCalledTimes(3);
});
it.each([101,500])('refuses an oversized or unproven Lever page window (%s)',async count=>{
 network.mockImplementation(async()=>Response.json(Array.from({length:count===101?101:100},(_,i)=>row(String(i)))));await expect(fetchEmployerBoard({...board,provider:'lever'})).rejects.toThrow();expect(network).toHaveBeenCalledTimes(count===101?1:5);
});
it.each([{title:'x'.repeat(301)},{descriptionPlain:'<'.repeat(100001)},{location:'x'.repeat(501)},{jobUrl:'https://private.example.test/job'}])('refuses oversized or unsupported normalized evidence before text cleanup (%j)',async patch=>{
 const value={...row(),...patch};expect(normalizeEmployerJob(value,board)).toBeNull();network.mockResolvedValue(Response.json({jobs:[value]}));await expect(fetchEmployerBoard(board)).rejects.toThrow();
});
it('preserves bounded malformed-tag output and normalizes an invalid publication time to unknown',()=>{
 const old=(value:string)=>value.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').slice(0,12000);
 for(const text of ['React <b>TypeScript</b>','React <broken','React '+ '<'.repeat(24000),'React <> Vue &amp; Node&nbsp;js','React <a<b> TypeScript','React 😀<bad\n tail']) expect(normalizeEmployerJob({...row(),descriptionPlain:text,publishedAt:'invalid'},board)).toMatchObject({description:old(text),postedAt:null});
});
