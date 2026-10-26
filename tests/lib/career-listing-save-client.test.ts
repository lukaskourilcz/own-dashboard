import { afterEach,expect,it,vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { applyCareerSaveReceipt,captureCareerListing,CareerSaveError,type CareerSaveReceipt } from '@/lib/career-listing-save';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',requestId='33333333-3333-4333-8333-333333333333',listingId='44444444-4444-4444-8444-444444444444',stamp='2026-10-26T12:00:00Z';
const listing=()=>({id:listingId,url:'https://jobs.ashbyhq.com/sanity/synthetic-capture',last_seen_at:stamp,source:'ashby-sanity',title:'Synthetic React role',company:null,location:'Europe',description:'React TypeScript',remote:true});
const receipt=():CareerSaveReceipt=>({ownerId:owner,requestId,created:true,row:{id:requestId,user_id:owner,listing_id:listingId,title:'Synthetic React role',company:null,url:listing().url,source:'ashby-sanity',location:'Europe',remote:true,description:'React TypeScript',cover_letter:'',notes:null,saved_at:stamp,updated_at:stamp,cover_letter_url:null,readiness:'draft'}});
function backend(pending:Promise<{data:unknown,error:unknown}>){const builder={retry:vi.fn(()=>builder),abortSignal:vi.fn(()=>pending)},rpc=vi.fn(()=>builder);return {db:{rpc} as unknown as SupabaseClient,rpc,builder};}
const scope=()=>({ownerId:owner,signal:new AbortController().signal});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
it('captures original account, listing proof and stable id before waiting and makes one non-retried request',async()=>{
 let settle!:(value:{data:unknown,error:null})=>void;const fixture=backend(new Promise(resolve=>{settle=resolve;})),captured=scope(),source=listing();
 const pending=captureCareerListing(fixture.db,captured,requestId,source);captured.ownerId=other;source.id=other;source.title='Changed';source.url='https://thehub.io/jobs/changed';settle({data:receipt(),error:null});
 expect(await pending).toEqual(receipt());expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith('capture_career_listing',{p_expected_owner:owner,p_saved_id:requestId,p_listing_id:listingId,p_last_seen_at:stamp,p_url:listing().url});expect(fixture.builder.retry).toHaveBeenCalledWith(false);expect(fixture.builder.abortSignal).toHaveBeenCalledOnce();
});
it.each(['owner','request','row-owner','url','id','listing','title','source','remote','draft','extra','missing-remote','array','empty'] as const)('refuses a malformed %s receipt',async kind=>{
 const value=receipt() as unknown as {ownerId:string,requestId:string,row:Record<string,unknown>};let data:unknown=value;
 if(kind==='owner')value.ownerId=other;else if(kind==='request')value.requestId=other;else if(kind==='row-owner')value.row.user_id=other;else if(kind==='url')value.row.url='https://thehub.io/jobs/other';else if(kind==='id')value.row.id=other;else if(kind==='listing')value.row.listing_id=other;else if(kind==='title')value.row.title='Synthetic changed';else if(kind==='source')value.row.source='lever-other';else if(kind==='remote')value.row.remote=false;else if(kind==='draft')value.row.cover_letter='Unexpected private draft';else if(kind==='extra')value.row.unreviewed='PRIVATE TEST';else if(kind==='missing-remote')delete value.row.remote;else if(kind==='array')data=[value];else data=null;
 const fixture=backend(Promise.resolve({data,error:null}));await expect(captureCareerListing(fixture.db,scope(),requestId,listing())).rejects.toBeInstanceOf(CareerSaveError);expect(fixture.rpc).toHaveBeenCalledOnce();
});
it('returns an existing private draft without requiring discovery defaults or replacing its identity',async()=>{
 const value=receipt();value.created=false;Object.assign(value.row,{id:other,listing_id:null,title:'Synthetic private title',cover_letter:'Synthetic draft',notes:'Synthetic private note',readiness:'needs_review',remote:null});
 const fixture=backend(Promise.resolve({data:value,error:null}));expect(await captureCareerListing(fixture.db,scope(),requestId,listing())).toEqual(value);
});
it.each(['P0002','42501','XX000'])('keeps %s errors fixed and distinguishes a source conflict',async code=>{
 const fixture=backend(Promise.resolve({data:null,error:{code,message:'PRIVATE TEST'}}));await expect(captureCareerListing(fixture.db,scope(),requestId,listing())).rejects.toMatchObject({message:'Career save unconfirmed',reason:code==='P0002'?'changed':'unavailable'});
});
it('does not send invalid identities, invalid posting URLs or an already cancelled intent',async()=>{
 const fixture=backend(Promise.resolve({data:receipt(),error:null}));await expect(captureCareerListing(fixture.db,{...scope(),ownerId:'invalid'},requestId,listing())).rejects.toBeInstanceOf(CareerSaveError);
 await expect(captureCareerListing(fixture.db,scope(),requestId,{...listing(),url:'https://unregistered.example/job'})).rejects.toBeInstanceOf(CareerSaveError);
 const parent=new AbortController();parent.abort();await expect(captureCareerListing(fixture.db,{ownerId:owner,signal:parent.signal},requestId,listing())).rejects.toMatchObject({name:'AbortError'});expect(fixture.rpc).not.toHaveBeenCalled();
});
it('retires an uncooperative SDK call on cancellation and ignores its later response',async()=>{
 const fixture=backend(new Promise(()=>{})),parent=new AbortController(),pending=captureCareerListing(fixture.db,{ownerId:owner,signal:parent.signal},requestId,listing()),check=expect(pending).rejects.toMatchObject({name:'AbortError'});parent.abort();await check;expect(fixture.rpc).toHaveBeenCalledOnce();
});
it('bounds an uncooperative SDK call at fifteen seconds without retry',async()=>{
 vi.useFakeTimers();vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{const controller=new AbortController();setTimeout(()=>controller.abort(),ms);return controller.signal;});
 const fixture=backend(new Promise(()=>{})),pending=captureCareerListing(fixture.db,scope(),requestId,listing()),check=expect(pending).rejects.toBeInstanceOf(CareerSaveError);await vi.advanceTimersByTimeAsync(15_001);await check;expect(fixture.rpc).toHaveBeenCalledOnce();
});
it('adds a receipt only to its unchanged source cache and never replaces a confirmed private row',()=>{
 const base:CareerSaveReceipt['row'][]=[];const value=receipt();expect(applyCareerSaveReceipt(base,base,value)).toEqual([value.row]);
 const refreshed=[{...value.row,title:'Synthetic newer private title'}];expect(applyCareerSaveReceipt(refreshed,base,value)).toBe(refreshed);
 const changed:CareerSaveReceipt['row'][]=[];expect(applyCareerSaveReceipt(changed,base,value)).toBe(changed);
});
