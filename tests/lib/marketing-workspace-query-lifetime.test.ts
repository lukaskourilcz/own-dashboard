import {createClient} from '@supabase/supabase-js';
import {afterEach,expect,it,vi} from 'vitest';
import {readDneskaiCosts,readDneskaiWorkspace} from '@/lib/marketing/dneskai-workspace-read';
import type {DneskaiReadDatabase} from '@/lib/marketing/dneskai-read-database.generated';
vi.mock('server-only',()=>({}));
const owner='11111111-1111-4111-8111-111111111111',now=new Date('2026-10-28T10:00:00Z');
const client=(fetcher:typeof fetch)=>createClient<DneskaiReadDatabase>('https://offline.supabase.test','TEST-ONLY-PUBLIC',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:fetcher}});
const url=(input:Parameters<typeof fetch>[0])=>new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
it('refuses retired reads before any actual SDK query',async()=>{
 const fetcher=vi.fn<typeof fetch>(async()=>Response.json([])),controller=new AbortController();controller.abort();
 await expect(readDneskaiWorkspace(client(fetcher),owner,now,undefined,{signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});expect(fetcher).not.toHaveBeenCalled();
});
it('does not automatically replay an actual SDK account-read outage',async()=>{
 const requests:string[]=[];const fetcher:typeof fetch=async(input)=>{const path=url(input).pathname;requests.push(path);return path.endsWith('/marketing_accounts')?Response.json({message:'TEST_ONLY_UNAVAILABLE'},{status:503,headers:{'Retry-After':'0'}}):Response.json([]);};
 await expect(readDneskaiWorkspace(client(fetcher),owner,now)).rejects.toThrow('dneskai-workspace-unavailable');expect(requests.filter(path=>path.endsWith('/marketing_accounts'))).toHaveLength(1);
});
for(const phase of ['initial','related','engagement']as const)it(`retires the actual SDK ${phase} read without admitting later queries`,async()=>{
 const requests:string[]=[],signals:AbortSignal[]=[];let release!:(response:Response)=>void;const controller=new AbortController();
 const blocked=phase==='initial'?'marketing_accounts':phase==='related'?'marketing_dneskai_topics':'marketing_dneskai_engagement_receipts';
 const fetcher:typeof fetch=async(input,init)=>{const path=url(input).pathname;requests.push(path);if(init?.signal)signals.push(init.signal);return path.endsWith('/'+blocked)?new Promise(resolve=>{release=resolve;}):Response.json([]);};
 const pending=readDneskaiWorkspace(client(fetcher),owner,now,undefined,{topicTitles:phase!=='engagement',engagement:phase==='engagement',signal:controller.signal}).then(value=>value,error=>error);
 await vi.waitFor(()=>expect(requests.some(path=>path.endsWith('/'+blocked))).toBe(true));controller.abort();
 try{const result=await Promise.race([pending,new Promise<'pending'>(resolve=>setTimeout(()=>resolve('pending'),80))]);expect(result).not.toBe('pending');expect(result).toMatchObject({name:'AbortError'});}
 finally{release(Response.json([]));await pending;}
 expect(signals.length).toBeGreaterThan(0);expect(signals.every(signal=>signal.aborted)).toBe(true);
 if(phase==='initial')expect(requests.some(path=>path.endsWith('/marketing_dneskai_topics'))).toBe(false);
});
it('keeps missing optional waiting context unknown instead of confirming an empty list',async()=>{
 const fetcher:typeof fetch=async(input)=>Response.json(url(input).pathname.endsWith('/marketing_dneskai_briefs')?null:[]);
 const read=await readDneskaiWorkspace(client(fetcher),owner,now);expect(read.waiting).toBeUndefined();
});
it('bounds a cancelled actual SDK costs aggregate even when its transport ignores cancellation',async()=>{
 const controller=new AbortController();let release!:(response:Response)=>void;
 const fetcher:typeof fetch=async(input)=>url(input).pathname.includes('/rpc/')?new Promise(resolve=>{release=resolve;}):Response.json([]);
 const pending=readDneskaiCosts(client(fetcher),owner,'22222222-2222-4222-8222-222222222222',now,{spentUsd:0,ceilingUsd:1,code:null},'7d',{signal:controller.signal}).then(value=>value,error=>error);
 await vi.waitFor(()=>expect(release).toBeTypeOf('function'));controller.abort();
 try{const result=await Promise.race([pending,new Promise<'pending'>(resolve=>setTimeout(()=>resolve('pending'),80))]);expect(result).not.toBe('pending');expect(result).toMatchObject({name:'AbortError'});}
 finally{release(Response.json(null));await pending;}
});
it('bounds a direct consumer even when its SDK transport ignores cancellation',async()=>{
 vi.useFakeTimers();vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{const controller=new AbortController();setTimeout(()=>controller.abort(),ms);return controller.signal;});
 const release:Array<(response:Response)=>void>=[];const fetcher:typeof fetch=async()=>new Promise(resolve=>release.push(resolve));let settled=false;
 const pending=readDneskaiWorkspace(client(fetcher),owner,now).then(value=>{settled=true;return value;},error=>{settled=true;return error;});
 try{await vi.advanceTimersByTimeAsync(14_999);expect(release).toHaveLength(5);expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);expect(settled).toBe(true);expect(await pending).toMatchObject({name:'AbortError'});
 }finally{for(const finish of release)finish(Response.json([]));await pending;}
});
