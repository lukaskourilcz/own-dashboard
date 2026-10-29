import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readCareerAvailability, availabilityVersionMatches, type AvailabilityRequest } from '@/lib/jobs/availability-client';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const listing={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',source:'remotive',title:'Synthetic React role',url:'https://remotive.com/remote-jobs/synthetic/one',last_seen_at:'2026-10-25T12:00:00.000001Z'};
const version='a'.repeat(64);
const proof=()=>({source:listing.source,title:listing.title,url:listing.url,lastSeenAt:listing.last_seen_at});
const receipt=()=>({ownerId:owner,candidateVersion:version,states:{[listing.id]:'open'},versions:{[listing.id]:proof()},checkedAt:new Date().toISOString(),candidates:1,previouslyChecked:0,remaining:0});
let parent:AbortController,network:ReturnType<typeof vi.fn>;
beforeEach(()=>{parent=new AbortController();network=vi.fn().mockResolvedValue(Response.json(receipt()));vi.stubGlobal('fetch',network);});
afterEach(()=>{parent.abort();vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers();});
const scope=():AvailabilityRequest=>({ownerId:owner,signal:parent.signal,listings:[{...listing}]});
it('confirms one captured owner/version read and retires its transport without an auth lookup',async()=>{
 expect(await readCareerAvailability(scope())).toMatchObject({ownerId:owner,states:{[listing.id]:'open'}});expect(network).toHaveBeenCalledOnce();const [url,init]=network.mock.calls[0];expect(url).toBe('/api/jobs/available');expect(new Headers(init.headers).get('x-own-dashboard-owner')).toBe(owner);expect(init).toMatchObject({method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store'});expect(JSON.parse(init.body)).toEqual({checkedIds:[]});expect(init.signal.aborted).toBe(true);
});
it.each(['owner','shape','extra','state','foreign-id','missing-proof','extra-proof','url','title','source','microseconds','counts','prior-count','old','future','cohort'] as const)('refuses unconfirmed %s evidence in one attempt',async kind=>{
 const base=receipt();let value:unknown=base;
 if(kind==='owner')value={...base,ownerId:other};if(kind==='shape')value={};if(kind==='extra')value={...base,extra:'PRIVATE TEST'};
 if(kind==='state')value={...base,states:{[listing.id]:'invalid'}};if(kind==='foreign-id')value={...base,states:{[other]:'open'},versions:{[other]:proof()}};
 if(kind==='missing-proof')value={...base,versions:{}};if(kind==='extra-proof')value={...base,versions:{...base.versions,[other]:proof()}};
 if(['url','title','source','microseconds'].includes(kind)) {
  const patch = kind==='microseconds' ? {lastSeenAt:'2026-10-25T12:00:00.000002Z'} : {[kind]:'changed'};
  value={...base,versions:{[listing.id]:{...proof(),...patch}}};
 }
 if(kind==='counts')value={...base,remaining:1};if(kind==='prior-count')value={...base,previouslyChecked:1};
 if(kind==='old'||kind==='future')value={...base,checkedAt:new Date(Date.now()+(kind==='old'?-130000:130000)).toISOString()};
 if(kind==='cohort')value={...base,candidateVersion:'invalid'};
 network.mockResolvedValue(Response.json(value));await expect(readCareerAvailability(scope())).rejects.toThrow('Career availability unconfirmed');expect(network).toHaveBeenCalledOnce();
});
it('normalizes equivalent timestamp offsets without discarding PostgreSQL microseconds',()=>{
 expect(availabilityVersionMatches(listing,{...proof(),lastSeenAt:'2026-10-25T13:00:00.000001+01:00'})).toBe(true);expect(availabilityVersionMatches(listing,{...proof(),lastSeenAt:'2026-10-25T13:00:00.000002+01:00'})).toBe(false);
});
it('confirms a later window only for the same cohort and completed original identities',async()=>{
 network.mockResolvedValue(Response.json({...receipt(),states:{},versions:{},previouslyChecked:1}));const input={...scope(),checkedIds:[listing.id],expectedVersion:version,previousCheckedAt:new Date(Date.now()-1000).toISOString()};expect(await readCareerAvailability(input)).toMatchObject({previouslyChecked:1});expect(JSON.parse(network.mock.calls[0][1].body)).toEqual({checkedIds:[listing.id],expectedVersion:version});
 network.mockResolvedValue(Response.json({...receipt(),candidateVersion:'b'.repeat(64),states:{},versions:{},previouslyChecked:1}));await expect(readCareerAvailability(input)).rejects.toThrow();
});
it('captures listing primitives before transport rather than adopting later caller mutations',async()=>{
 const input=scope();let finish!:(value:Response)=>void;network.mockImplementation(()=>new Promise<Response>(resolve=>{finish=resolve;}));const pending=readCareerAvailability(input);input.ownerId=other;(input.listings as typeof listing[])[0].url='https://remotive.com/changed';finish(Response.json(receipt()));expect(await pending).toMatchObject({ownerId:owner});
});
it.each(['owner','duplicate-listings','duplicate-checked','foreign-checked','size','cohort'] as const)('refuses invalid captured %s input before transport',async kind=>{
 const input=scope();if(kind==='owner')input.ownerId='invalid';if(kind==='duplicate-listings')input.listings=[listing,listing];if(kind==='duplicate-checked')input.checkedIds=[listing.id,listing.id];if(kind==='foreign-checked')input.checkedIds=[other];if(kind==='size')input.listings=Array.from({length:10001},()=>listing);if(kind==='cohort')input.expectedVersion='bad';await expect(readCareerAvailability(input)).rejects.toThrow();expect(network).not.toHaveBeenCalled();
});
it.each([401,409,429,500,503])('discards HTTP %s detail without a hidden retry',async status=>{const cancel=vi.fn();network.mockResolvedValue(new Response(new ReadableStream({cancel}),{status}));await expect(readCareerAvailability(scope())).rejects.toThrow('Career availability unconfirmed');expect(cancel).toHaveBeenCalledOnce();expect(network).toHaveBeenCalledOnce();});
it('releases a late response after cancellation without accepting or retrying it',async()=>{
 let finish!:(value:Response)=>void;network.mockImplementation(()=>new Promise<Response>(resolve=>{finish=resolve;}));const pending=readCareerAvailability(scope()),check=expect(pending).rejects.toMatchObject({name:'AbortError'});parent.abort();await check;const cancel=vi.fn();finish(new Response(new ReadableStream({cancel})));await Promise.resolve();expect(cancel).toHaveBeenCalledOnce();expect(network).toHaveBeenCalledOnce();
});
it.each(['transport','body'] as const)('bounds an uncooperative %s at sixty seconds',async phase=>{
 vi.useFakeTimers();vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{const c=new AbortController();setTimeout(()=>c.abort(),ms);return c.signal;});const cancel=vi.fn();network.mockImplementation(()=>phase==='transport'?new Promise(()=>{}):Promise.resolve(new Response(new ReadableStream({cancel}))));const pending=readCareerAvailability(scope()),check=expect(pending).rejects.toThrow('Career availability unconfirmed');await vi.advanceTimersByTimeAsync(60001);await check;expect(network).toHaveBeenCalledOnce();if(phase==='body')expect(cancel).toHaveBeenCalledOnce();
});
it('bounds actual UTF-8 response bytes and discards an oversized producer',async()=>{
 const cancel=vi.fn();network.mockResolvedValue(new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('ž'.repeat(5_242_881)));},cancel})));await expect(readCareerAvailability(scope())).rejects.toThrow();expect(cancel).toHaveBeenCalledOnce();
});
