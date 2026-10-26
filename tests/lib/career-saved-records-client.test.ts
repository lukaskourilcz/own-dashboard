import { afterEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { applyCareerSavedReceipt, createCareerSavedRecord, removeCareerSavedRecord, updateCareerSavedRecord } from '@/lib/career-saved-records';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333',stamp='2026-10-26T12:00:00.000001Z';
const row=()=>({id,user_id:owner,listing_id:null,title:'Synthetic role',company:null,url:'https://thehub.io/jobs/synthetic-client',source:null,location:null,remote:null,description:null,cover_letter:'',notes:null as string|null,saved_at:stamp,updated_at:stamp,cover_letter_url:null,readiness:'draft' as const});
const scope=()=>({ownerId:owner,signal:new AbortController().signal});
function wire(fetcher:typeof fetch){return createClient('https://example.supabase.co','TEST-ONLY-public',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:fetcher}});}
function response(data:unknown){const transport=vi.fn<typeof fetch>(async()=>Response.json(data));return {db:wire(transport),transport};}
afterEach(()=>vi.restoreAllMocks());
it('captures original owner, source and patch before waiting, with no retry or extra read',async()=>{
 let settle!:(value:Response)=>void;const transport=vi.fn<typeof fetch>(()=>new Promise(resolve=>{settle=resolve;})),db=wire(transport),captured=scope(),source=row(),patch={notes:'Synthetic revised note'};
 const pending=updateCareerSavedRecord(db,captured,source,patch);await vi.waitFor(()=>expect(transport).toHaveBeenCalledOnce());
 captured.ownerId=other;source.notes='Mutation after submission';source.updated_at='2026-10-26T13:00:00Z';patch.notes='Changed intent';
 const receipt={...row(),notes:'Synthetic revised note',updated_at:'2026-10-26T12:00:00.000002Z'};settle(Response.json([receipt]));expect(await pending).toEqual(receipt);
 const [input,init]=transport.mock.calls[0],url=new URL(String(input));expect(url.searchParams.get('user_id')).toBe(`eq.${owner}`);expect(url.searchParams.get('updated_at')).toBe(`eq.${stamp}`);expect(JSON.parse(String(init?.body))).toEqual({notes:'Synthetic revised note'});
});
it.each(['owner','id','version','saved-at','unchanged-letter','missing','extra','duplicate','not-array'] as const)('refuses a %s update receipt',async kind=>{
 const value:Record<string,unknown>={...row(),notes:'Revised',updated_at:'2026-10-26T12:00:00.000002Z'};let data:unknown=[value];
 if(kind==='owner')value.user_id=other;else if(kind==='id')value.id=other;else if(kind==='version')value.updated_at=stamp;else if(kind==='saved-at')value.saved_at='2026-10-25T12:00:00Z';else if(kind==='unchanged-letter')value.cover_letter='Unexpected overwrite';else if(kind==='missing')delete value.remote;else if(kind==='extra')value.future_private='PRIVATE TEST';else if(kind==='duplicate')data=[value,value];else data=value;
 const {db,transport}=response(data);await expect(updateCareerSavedRecord(db,scope(),row(),{notes:'Revised'})).rejects.toMatchObject({message:'Saved position unconfirmed',reason:'unavailable'});expect(transport).toHaveBeenCalledOnce();
});
it.each(['title','url','credentials','google','empty','undefined','ownership','overlong'] as const)('refuses an invalid %s intent before sending',async kind=>{
 const patch:Record<string,unknown>=kind==='title'?{title:' '}:kind==='url'?{url:'javascript:alert(1)'}:kind==='credentials'?{url:'https://user:password@example.test/job'}:kind==='google'?{cover_letter_url:'https://example.test/document/d/test'}:kind==='empty'?{}:kind==='undefined'?{notes:undefined}:kind==='ownership'?{user_id:other}:{cover_letter:'X'.repeat(64_001)};
 const {db,transport}=response([row()]);await expect(updateCareerSavedRecord(db,scope(),row(),patch)).rejects.toMatchObject({reason:'invalid'});expect(transport).not.toHaveBeenCalled();
});
it('normalizes only submitted URLs and does not silently fill patch defaults',async()=>{
 const {db,transport}=response([{...row(),url:'https://thehub.io/jobs/revised',updated_at:'2026-10-26T12:00:00.000002Z'}]);
 await updateCareerSavedRecord(db,scope(),row(),{url:' thehub.io/jobs/revised '});expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toEqual({url:'https://thehub.io/jobs/revised'});
});
it('distinguishes an empty update/delete receipt from confirmed deletion',async()=>{
 const {db}=response([]);await expect(updateCareerSavedRecord(db,scope(),row(),{notes:'Revision'})).rejects.toMatchObject({reason:'changed'});await expect(removeCareerSavedRecord(db,scope(),row())).rejects.toMatchObject({reason:'changed'});
});
it('requires a deletion receipt to match every captured private field',async()=>{
 const {db}=response([{...row(),cover_letter:'Different private draft'}]);await expect(removeCareerSavedRecord(db,scope(),row())).rejects.toMatchObject({reason:'unavailable'});
});
it('does not retry a provider error or include its private message',async()=>{
 const transport=vi.fn<typeof fetch>(async()=>Response.json({message:'PRIVATE TEST detail',code:'XX000'},{status:503}));await expect(updateCareerSavedRecord(wire(transport),scope(),row(),{notes:'Revision'})).rejects.toMatchObject({reason:'unavailable',message:'Saved position unconfirmed'});expect(transport).toHaveBeenCalledOnce();
});
it('makes no request with a disposed or invalid owner or foreign source',async()=>{
 const {db,transport}=response([row()]),parent=new AbortController();parent.abort();await expect(removeCareerSavedRecord(db,{ownerId:owner,signal:parent.signal},row())).rejects.toMatchObject({name:'AbortError'});
 await expect(removeCareerSavedRecord(db,{...scope(),ownerId:'invalid'},row())).rejects.toMatchObject({reason:'unavailable'});await expect(removeCareerSavedRecord(db,scope(),{...row(),user_id:other})).rejects.toMatchObject({reason:'unavailable'});expect(transport).not.toHaveBeenCalled();
});
it.each(['cancel','deadline'] as const)('retires an uncooperative write on %s and ignores a late receipt',async mode=>{
 const parent=new AbortController(),deadline=new AbortController();vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{expect(ms).toBe(15_000);return deadline.signal;});
 let settle!:(value:Response)=>void;const transport=vi.fn<typeof fetch>(()=>new Promise(resolve=>{settle=resolve;}));
 const pending=createCareerSavedRecord(wire(transport),{ownerId:owner,signal:parent.signal},id,{title:row().title,url:row().url}),failure=expect(pending).rejects.toMatchObject(mode==='cancel'?{name:'AbortError'}:{reason:'unavailable'});
 await vi.waitFor(()=>expect(transport).toHaveBeenCalledOnce());(mode==='cancel'?parent:deadline).abort();await failure;settle(Response.json([row()]));expect(transport).toHaveBeenCalledOnce();
});
it('applies only to its captured cache source and never restores missing or newer private data',()=>{
 const source=row(),receipt={...source,notes:'Confirmed',updated_at:'2026-10-26T12:00:00.000002Z'};
 expect(applyCareerSavedReceipt([source],source,receipt)).toEqual([receipt]);expect(applyCareerSavedReceipt([source],source,null)).toEqual([]);
 const newer={...source,notes:'Other window',updated_at:'2026-10-26T12:00:00.000003Z'};expect(applyCareerSavedReceipt([newer],source,receipt)).toEqual([newer]);expect(applyCareerSavedReceipt([],source,receipt)).toEqual([]);
 expect(applyCareerSavedReceipt([source],source,{...receipt,user_id:other})).toEqual([source]);expect(applyCareerSavedReceipt([{...source,user_id:other}],source,null)).toEqual([{...source,user_id:other}]);
});

it('bounds encoded submission bytes as well as individual field lengths',async()=>{
 const {db,transport}=response([row()]);await expect(updateCareerSavedRecord(db,scope(),row(),{cover_letter:'界'.repeat(64_000),notes:'界'.repeat(30_000)})).rejects.toMatchObject({reason:'invalid'});expect(transport).not.toHaveBeenCalled();
});
