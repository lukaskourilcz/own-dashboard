import {createClient} from '@supabase/supabase-js';
import {afterEach,expect,it,vi} from 'vitest';
import {readDneskaiMedia,type DneskaiMediaObjectStore} from '@/lib/marketing/dneskai-media';
import {candidate} from '@/lib/marketing/dneskai-providers';
vi.mock('server-only',()=>({}));
const owner='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222',sha='a'.repeat(64),at='2026-10-28T10:00:00Z';
const item=candidate('hf-blog','TEST_ONLY_ARTICLE','Test article','Test text','https://huggingface.co/blog/test-only',at,at);
const link={candidate_id:item.id,position:0,origin_url:'https://example.com/image.jpg',origin_kind:'og-image',credit:'Test credit',asset:{id:'33333333-3333-4333-8333-333333333333',sha256:sha,width:1080,height:1350,mime:'image/jpeg',bytes:1000,storage_path:`marketing-media/${owner}/${sha}.jpg`,fetched_at:at,duplicate_of_asset_id:null,purged_at:null}};
const client=(fetcher:typeof fetch)=>createClient('https://offline.supabase.test','TEST-ONLY-PUBLIC',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:fetcher}});
const path=(input:Parameters<typeof fetch>[0])=>new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url).pathname;
const result=(name:string)=>name.endsWith('/marketing_dneskai_candidates')?[{id:item.id,status:'selected',candidate:item}]:name.endsWith('/marketing_media_asset_links')?[link]:[];
const store=():DneskaiMediaObjectStore=>({put:vi.fn(async()=> 'stored' as const),get:vi.fn(async()=>null),remove:vi.fn(async()=>undefined),sign:vi.fn(async(names)=>names.map(()=>null))});
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
it('does not query or sign after prior retirement',async()=>{
 const fetcher=vi.fn<typeof fetch>(async(input)=>Response.json(result(path(input)))),files=store(),controller=new AbortController();controller.abort();
 await expect(readDneskaiMedia(client(fetcher),owner,project,{signal:controller.signal,sign:true,store:files})).rejects.toMatchObject({name:'AbortError'});expect(fetcher).not.toHaveBeenCalled();expect(files.sign).not.toHaveBeenCalled();
});
it('uses one actual SDK request for an unavailable candidate read',async()=>{
 const fetcher=vi.fn<typeof fetch>(async()=>Response.json({message:'TEST_ONLY_UNAVAILABLE'},{status:503,headers:{'Retry-After':'0'}}));
 await expect(readDneskaiMedia(client(fetcher),owner,project)).rejects.toThrow('media-read-unavailable');expect(fetcher).toHaveBeenCalledTimes(1);
});
for(const phase of ['candidate','related','canonical']as const)it(`stops the actual SDK ${phase} phase before later signing after cancellation`,async()=>{
 const controller=new AbortController(),files=store(),requests:string[]=[],signals:AbortSignal[]=[];let release!:(response:Response)=>void;
 const blocked=phase==='candidate'?'marketing_dneskai_candidates':phase==='related'?'marketing_media_collections':'marketing_media_assets';
 const fetcher:typeof fetch=async(input,init)=>{const name=path(input);requests.push(name);if(init?.signal)signals.push(init.signal);const data=phase==='canonical'&&name.endsWith('/marketing_media_asset_links')?[{...link,asset:{...link.asset,duplicate_of_asset_id:'44444444-4444-4444-8444-444444444444'}}]:result(name);return name.endsWith('/'+blocked)?new Promise(resolve=>{release=resolve;}):Response.json(data);};
 const pending=readDneskaiMedia(client(fetcher),owner,project,{signal:controller.signal,sign:true,store:files}).then(value=>value,error=>error);
 await vi.waitFor(()=>expect(release).toBeTypeOf('function'));controller.abort();
 try{const value=await Promise.race([pending,new Promise<'pending'>(resolve=>setTimeout(()=>resolve('pending'),80))]);expect(value).not.toBe('pending');expect(value).toMatchObject({name:'AbortError'});}
 finally{release(Response.json(result('/'+blocked)));await pending;}
 expect(files.sign).not.toHaveBeenCalled();expect(signals.length).toBeGreaterThan(0);expect(signals.every(signal=>signal.aborted)).toBe(true);
 if(phase==='candidate')expect(requests).toHaveLength(1);
});
it('retains confirmed pictures with unknown previews after an ordinary signing outage',async()=>{
 const files=store();vi.mocked(files.sign).mockRejectedValueOnce(Error('PRIVATE_TEST_ONLY_SIGNING_DETAIL'));
 const read=await readDneskaiMedia(client(async(input)=>Response.json(result(path(input)))),owner,project,{sign:true,store:files});
 expect(read.candidates[0]!.assets).toHaveLength(1);expect(read.candidates[0]!.assets[0]).toMatchObject({sha256:sha,credit:'Test credit',previewUrl:null});
});
it('bounds a direct consumer without a route deadline',async()=>{
 vi.useFakeTimers();vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{const controller=new AbortController();setTimeout(()=>controller.abort(),ms);return controller.signal;});
 let release!:(response:Response)=>void;let settled=false;const files=store(),fetcher=vi.fn<typeof fetch>(async()=>new Promise(resolve=>{release=resolve;}));
 const pending=readDneskaiMedia(client(fetcher),owner,project,{sign:true,store:files}).then(value=>{settled=true;return value;},error=>{settled=true;return error;});
 try{await vi.advanceTimersByTimeAsync(14_999);expect(fetcher).toHaveBeenCalledOnce();expect(settled).toBe(false);await vi.advanceTimersByTimeAsync(1);expect(settled).toBe(true);expect(await pending).toMatchObject({name:'AbortError'});}
 finally{release(Response.json(result('/marketing_dneskai_candidates')));await pending;}
 expect(files.sign).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledOnce();
});
it('does not turn retirement during signing into a successful late preview',async()=>{
 const controller=new AbortController(),files=store();let release!:(urls:Array<string|null>)=>void;
 vi.mocked(files.sign).mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 const pending=readDneskaiMedia(client(async(input)=>Response.json(result(path(input)))),owner,project,{signal:controller.signal,sign:true,store:files}).then(value=>value,error=>error);
 await vi.waitFor(()=>expect(files.sign).toHaveBeenCalledOnce());controller.abort();
 try{const value=await Promise.race([pending,new Promise<'pending'>(resolve=>setTimeout(()=>resolve('pending'),80))]);expect(value).not.toBe('pending');expect(value).toMatchObject({name:'AbortError'});}
 finally{release([null]);await pending;}
});
