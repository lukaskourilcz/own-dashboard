import { afterEach, expect, it, vi } from 'vitest';
import { createOwnedCalendarEvent, deleteOwnedCalendarEvent } from '@/lib/calendar-event-client';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const scope=()=>({ownerId:owner,signal:new AbortController().signal});
const input={title:'Synthetic project review',date:'2026-11-01',allDay:true};
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('carries the captured owner and accepts only its confirmed create/delete receipts',async()=>{
 const network=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({id:'synthetic-event',ownerId:owner,htmlLink:'https://calendar.google.com/'})).mockResolvedValueOnce(Response.json({ok:true,ownerId:owner}));vi.stubGlobal('fetch',network);
 expect(await createOwnedCalendarEvent(scope(),input)).toMatchObject({id:'synthetic-event',ownerId:owner});await deleteOwnedCalendarEvent(scope(),'synthetic-event');
 expect(network).toHaveBeenCalledTimes(2);for(const call of network.mock.calls)expect(call[1]).toMatchObject({cache:'no-store',redirect:'error',credentials:'same-origin',headers:{'x-calendar-owner':owner}});
 expect(network.mock.calls.map(call=>call[1]?.method)).toEqual(['POST','DELETE']);
});
it.each([null,{}, {id:'event'}, {id:'event',ownerId:other},{id:'bad\nid',ownerId:owner},{id:'event',ownerId:owner,extra:'PRIVATE TEST'}])('rejects unconfirmed create receipts and never resends (%j)',async value=>{
 const network=vi.fn().mockResolvedValue(Response.json(value));vi.stubGlobal('fetch',network);await expect(createOwnedCalendarEvent(scope(),input)).rejects.toThrow(/^Calendar result unconfirmed$/);expect(network).toHaveBeenCalledOnce();
});
it.each([{ok:false,ownerId:owner},{ok:true},{ok:true,ownerId:other}])('requires an owned explicit deletion receipt (%j)',async value=>{
 const network=vi.fn().mockResolvedValue(Response.json(value));vi.stubGlobal('fetch',network);await expect(deleteOwnedCalendarEvent(scope(),'event')).rejects.toThrow(/^Calendar result unconfirmed$/);expect(network).toHaveBeenCalledOnce();
});
it('omits an unsafe receipt URL without exposing it as a link',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({id:'event',ownerId:owner,htmlLink:'javascript:alert(1)'})));expect((await createOwnedCalendarEvent(scope(),input)).htmlLink).toBeUndefined();
});
it.each([401,409,503])('returns fixed error classification without upstream details or retry (%s)',async status=>{
 const network=vi.fn().mockResolvedValue(Response.json({reason:'expired',error:'PRIVATE TEST'},{status}));vi.stubGlobal('fetch',network);await expect(createOwnedCalendarEvent(scope(),input)).rejects.toMatchObject({message:'Calendar result unconfirmed',reason:status===401?'expired':'unconfirmed'});expect(network).toHaveBeenCalledOnce();
});
it('rejects malformed input or disposed ownership before a provider request',async()=>{
 const network=vi.fn();vi.stubGlobal('fetch',network);const stop=new AbortController();stop.abort();await expect(createOwnedCalendarEvent({ownerId:owner,signal:stop.signal},input)).rejects.toMatchObject({name:'AbortError'});
 await expect(createOwnedCalendarEvent(scope(),{...input,date:'2026-02-31'})).rejects.toThrow();await expect(deleteOwnedCalendarEvent(scope(),'bad\nid')).rejects.toThrow();await expect(createOwnedCalendarEvent(scope(),{...input,description:'x'.repeat(10001)})).rejects.toThrow();expect(network).not.toHaveBeenCalled();
});
it('captures the owner before delayed work and ignores mutation of the caller scope',async()=>{
 let release!:(response:Response)=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise(resolve=>{release=resolve;})));const captured=scope(),pending=createOwnedCalendarEvent(captured,input);captured.ownerId=other;release(Response.json({id:'event',ownerId:owner}));expect((await pending).ownerId).toBe(owner);
});
it('bounds an uncooperative request without resending or accepting its late result',async()=>{
 const stop=new AbortController();vi.spyOn(AbortSignal,'timeout').mockReturnValue(stop.signal);let release!:(response:Response)=>void;const network=vi.fn(()=>new Promise(resolve=>{release=resolve;}));vi.stubGlobal('fetch',network);
 const pending=createOwnedCalendarEvent(scope(),input),failed=expect(pending).rejects.toThrow(/^Calendar result unconfirmed$/);stop.abort('PRIVATE TEST');await failed;release(Response.json({id:'event',ownerId:owner}));expect(network).toHaveBeenCalledOnce();
});
it('cancels a stalled or oversized response body and refuses a late owner result',async()=>{
 const stop=new AbortController(),cancel=vi.fn();vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(new ReadableStream({cancel}))));
 const pending=createOwnedCalendarEvent({ownerId:owner,signal:stop.signal},input),failed=expect(pending).rejects.toMatchObject({name:'AbortError'});await vi.waitFor(()=>expect(fetch).toHaveBeenCalledOnce());stop.abort();await failed;expect(cancel).toHaveBeenCalledOnce();
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('PRIVATE TEST'.repeat(7000))));await expect(createOwnedCalendarEvent(scope(),input)).rejects.toThrow(/^Calendar result unconfirmed$/);
});
