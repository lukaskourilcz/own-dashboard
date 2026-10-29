import {afterEach,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {applyCareerTriage,applyCareerTriageReceipt,CareerTriageError,type CareerTriageIntent,type CareerTriageReceipt} from '@/lib/career-triage';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333',listingId='44444444-4444-4444-8444-444444444444',stamp='2026-10-26T12:00:00Z';
const scope=()=>({ownerId:owner,signal:new AbortController().signal});
const row=()=>({id,user_id:owner,listing_id:listingId,state:'shortlisted' as const,created_at:stamp,updated_at:stamp});
const intent=():CareerTriageIntent=>({id,listing:{id:listingId,url:'https://remotive.com/remote-jobs/synthetic-triage',last_seen_at:stamp},next:'shortlisted',existing:null});
const receipt=():CareerTriageReceipt=>({ownerId:owner,changes:[{listingId,next:'shortlisted',row:row()}]});
function backend(pending:Promise<{data:unknown,error:unknown}>){const builder={retry:vi.fn(()=>builder),abortSignal:vi.fn(()=>pending)},rpc=vi.fn(()=>builder);return{db:{rpc} as unknown as SupabaseClient,rpc,builder};}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
it('captures original owner, source and expected state before waiting in one non-retried SDK call',async()=>{
 let settle!:(value:{data:unknown,error:null})=>void;const fixture=backend(new Promise(resolve=>{settle=resolve;})),captured=scope(),change=intent();change.existing=row();
 const pending=applyCareerTriage(fixture.db,captured,[change]);captured.ownerId=other;change.listing.url='https://thehub.io/jobs/changed';change.existing.state='deleted';settle({data:receipt(),error:null});expect(await pending).toEqual(receipt());
 expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith('apply_career_triage',{p_expected_owner:owner,p_changes:[{id,listingId,url:intent().listing.url,lastSeenAt:stamp,next:'shortlisted',expected:{id,state:'shortlisted',createdAt:stamp,updatedAt:stamp}}]});expect(fixture.builder.retry).toHaveBeenCalledWith(false);
});
it.each(['owner','missing','duplicate','foreign-listing','next','row-owner','row-listing','state','null','extra','version'] as const)('refuses a malformed %s receipt',async kind=>{
 const data=receipt();if(kind==='owner')data.ownerId=other;else if(kind==='missing')data.changes=[];else if(kind==='duplicate')data.changes.push(data.changes[0]);else if(kind==='foreign-listing')data.changes[0].listingId=other;else if(kind==='next')data.changes[0].next='deleted';else if(kind==='row-owner')data.changes[0].row!.user_id=other;else if(kind==='row-listing')data.changes[0].row!.listing_id=other;else if(kind==='state')data.changes[0].row!.state='deleted';else if(kind==='null')data.changes[0].row=null;else if(kind==='extra')Object.assign(data.changes[0].row!,{future:'PRIVATE TEST'});else data.changes[0].row!.updated_at='infinity';
 const fixture=backend(Promise.resolve({data,error:null}));await expect(applyCareerTriage(fixture.db,scope(),[intent()])).rejects.toBeInstanceOf(CareerTriageError);expect(fixture.rpc).toHaveBeenCalledOnce();
});
it('accepts only a confirmed absent row for a captured clear',async()=>{
 const change={...intent(),next:null,existing:row()},data:CareerTriageReceipt={ownerId:owner,changes:[{listingId,next:null,row:null}]};expect(await applyCareerTriage(backend(Promise.resolve({data,error:null})).db,scope(),[change])).toEqual(data);
 data.changes[0].row=row();await expect(applyCareerTriage(backend(Promise.resolve({data,error:null})).db,scope(),[change])).rejects.toBeInstanceOf(CareerTriageError);
});
it.each(['P0002','42501','XX000'])('keeps %s diagnostics fixed and classifies conflicts',async code=>{const fixture=backend(Promise.resolve({data:null,error:{code,message:'PRIVATE TEST'}}));await expect(applyCareerTriage(fixture.db,scope(),[intent()])).rejects.toMatchObject({message:'Career triage unconfirmed',reason:code==='P0002'?'changed':'unavailable'});});
it('refuses oversized, empty, duplicate and foreign intents before a request',async()=>{
 const fixture=backend(Promise.resolve({data:receipt(),error:null}));await expect(applyCareerTriage(fixture.db,scope(),Array.from({length:1001},intent))).rejects.toMatchObject({reason:'limit'});
 await expect(applyCareerTriage(fixture.db,scope(),[])).rejects.toBeInstanceOf(CareerTriageError);await expect(applyCareerTriage(fixture.db,scope(),[intent(),intent()])).rejects.toBeInstanceOf(CareerTriageError);
 await expect(applyCareerTriage(fixture.db,scope(),[{...intent(),existing:{...row(),user_id:other}}])).rejects.toBeInstanceOf(CareerTriageError);
 await expect(applyCareerTriage(fixture.db,scope(),[{...intent(),existing:{...row(),state:'deleted'},next:null}])).rejects.toMatchObject({reason:'changed'});expect(fixture.rpc).not.toHaveBeenCalled();
});
it('refuses invalid source URLs and invalid or retired owners before any request',async()=>{
 const fixture=backend(Promise.resolve({data:receipt(),error:null}));await expect(applyCareerTriage(fixture.db,scope(),[{...intent(),listing:{...intent().listing,url:'https://unregistered.example/jobs'}}])).rejects.toBeInstanceOf(CareerTriageError);
 await expect(applyCareerTriage(fixture.db,{...scope(),ownerId:'invalid'},[intent()])).rejects.toBeInstanceOf(CareerTriageError);const parent=new AbortController();parent.abort();await expect(applyCareerTriage(fixture.db,{ownerId:owner,signal:parent.signal},[intent()])).rejects.toMatchObject({name:'AbortError'});expect(fixture.rpc).not.toHaveBeenCalled();
});
it('retires an uncooperative SDK call on cancellation',async()=>{const fixture=backend(new Promise(()=>{})),parent=new AbortController(),pending=applyCareerTriage(fixture.db,{ownerId:owner,signal:parent.signal},[intent()]),check=expect(pending).rejects.toMatchObject({name:'AbortError'});parent.abort();await check;expect(fixture.rpc).toHaveBeenCalledOnce();});
it('bounds an uncooperative SDK call to fifteen seconds without retry',async()=>{vi.useFakeTimers();vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{const parent=new AbortController();setTimeout(()=>parent.abort(),ms);return parent.signal;});const fixture=backend(new Promise(()=>{})),pending=applyCareerTriage(fixture.db,scope(),[intent()]),check=expect(pending).rejects.toBeInstanceOf(CareerTriageError);await vi.advanceTimersByTimeAsync(15_001);await check;expect(fixture.rpc).toHaveBeenCalledOnce();});
it('never replaces a newer marker with a delayed shortlist or clear, while merging an unchanged source row',()=>{
 const base=[row()],deleted={...row(),state:'deleted' as const,updated_at:'2026-10-26T12:00:00.000001Z'},current=[deleted];expect(applyCareerTriageReceipt(current,base,receipt())).toBe(current);
 const cleared:CareerTriageReceipt={ownerId:owner,changes:[{listingId,next:null,row:null}]};expect(applyCareerTriageReceipt(current,base,cleared)).toBe(current);expect(applyCareerTriageReceipt(base,base,cleared)).toEqual([]);
 const empty:ReturnType<typeof row>[]=[];expect(applyCareerTriageReceipt(empty,empty,receipt())).toEqual([row()]);const refreshed:ReturnType<typeof row>[]=[];expect(applyCareerTriageReceipt(refreshed,empty,receipt())).toBe(refreshed);
});

it('requires an advanced database version for a changed captured state and preserves timestamp precision',async()=>{
 const change={...intent(),next:'deleted' as const,existing:row()},data=receipt();data.changes[0].next='deleted';data.changes[0].row!.state='deleted';
 await expect(applyCareerTriage(backend(Promise.resolve({data,error:null})).db,scope(),[change])).rejects.toBeInstanceOf(CareerTriageError);
 data.changes[0].row!.updated_at='2026-10-26T12:00:00.000001+00:00';expect(await applyCareerTriage(backend(Promise.resolve({data,error:null})).db,scope(),[change])).toEqual(data);
});
