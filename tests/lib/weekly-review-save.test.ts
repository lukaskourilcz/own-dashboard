import { createClient } from '@supabase/supabase-js';
import { afterEach,expect,it,vi } from 'vitest';
import { applyWeeklyReviewReceipt,saveWeeklyReview,type WeeklyReviewSave,type WeeklyReviewReceipt } from '@/lib/weekly-review-save';
import type { WeeklyReview } from '@/lib/types';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', week='2026-10-19';
const source=():WeeklyReview=>({id,user_id:owner,week_start:week,status:'draft',summary:'Existing summary',items:{step:'time',futureKey:{retained:true},facts:['Keep fact']},completed_at:null,created_at:'2026-10-19T09:00:00.123456Z',updated_at:'2026-10-24T09:00:00.123456Z'});
const input=():WeeklyReviewSave=>({ownerId:owner,id,weekStart:week,expected:source(),mode:'auto',patch:{summary:'Captured draft',items:{step:'summary'}}});
const receipt=():Extract<WeeklyReviewReceipt,{kind:'saved'}>=>({kind:'saved',ownerId:owner,weekStart:week,sourceUpdatedAt:source().updated_at,review:{...source(),summary:'Captured draft',items:{...source().items,step:'summary'},updated_at:'2026-10-24T09:00:00.124456Z'}});
const client=(fetcher:typeof fetch)=>createClient('https://example.supabase.co','public-fixture-key',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:fetcher}});
afterEach(()=>vi.restoreAllMocks());
it('uses one RPC with a captured owner/week/version/patch, preserving the receipt microseconds',async()=>{
 const request=input();const fetcher=vi.fn<typeof fetch>(async(url,init)=>{expect(String(url)).toBe('https://example.supabase.co/rest/v1/rpc/save_weekly_review');expect(JSON.parse(init!.body as string)).toEqual({p_owner:owner,p_id:id,p_week_start:week,p_expected_updated_at:source().updated_at,p_mode:'auto',p_patch:request.patch});return Response.json(receipt());});
 expect(await saveWeeklyReview(client(fetcher),request)).toEqual(receipt());expect(fetcher).toHaveBeenCalledTimes(1);
});
it('does not read mutable drafts after awaiting the transport',async()=>{
 let finish!:(response:Response)=>void;const request=input(),fetcher=vi.fn<typeof fetch>(async()=>new Promise<Response>(resolve=>{finish=resolve;}));
 const pending=saveWeeklyReview(client(fetcher),request);await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));request.patch.summary='New later text';request.expected!.items.facts=['Later edit'];finish(Response.json(receipt()));expect(await pending).toEqual(receipt());
});
const corrupt:Array<[string,(value:ReturnType<typeof receipt>)=>unknown]>=[
 ['wrong actor',r=>({...r,ownerId:other})],['wrong week',r=>({...r,weekStart:'2026-10-12'})],['wrong row owner',r=>{r.review.user_id=other;return r;}],['wrong row id',r=>{r.review.id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';return r;}],
 ['missing row',r=>({...r,review:null})],['changed summary',r=>{r.review.summary='Another text';return r;}],['changed step',r=>{r.review.items.step='time';return r;}],
 ['lost retained facts',r=>{delete r.review.items.facts;return r;}],['changed unknown legacy key',r=>{r.review.items.futureKey={retained:false};return r;}],
 ['changed created time',r=>{r.review.created_at='2026-10-20T09:00:00Z';return r;}],['auto reopened completed state',r=>{r.review.status='completed';return r;}],
 ['nonadvancing changed source',r=>{r.review.updated_at=r.sourceUpdatedAt!;return r;}],['regressed timestamp',r=>{r.review.updated_at='2026-10-24T09:00:00.123455Z';return r;}],
 ['unsupported precision',r=>{r.review.updated_at='2026-10-24T09:00:00.1234567Z';return r;}],['advanced unrelated source',r=>{r.sourceUpdatedAt='2026-10-24T09:00:00.123457Z';return r;}],
 ['false absent source',r=>({...r,sourceUpdatedAt:null})],['oversized response',r=>{r.review.items.futureKey='x'.repeat(524288);return r;}],['unexpected envelope',r=>({...r,privateBody:'Never use'})],
];
it.each(corrupt)('refuses %s without acknowledging a save',async(_name,change)=>{await expect(saveWeeklyReview(client(async()=>Response.json(change(receipt()))),input())).rejects.toThrow(/^Weekly review save unconfirmed$/);});
it('accepts semantic object order and timezone formatting without losing timestamp precision',async()=>{
 const result=receipt();result.sourceUpdatedAt='2026-10-24T11:00:00.123456+02:00';result.review.created_at='2026-10-19T11:00:00.123456+02:00';result.review.items={facts:['Keep fact'],futureKey:{retained:true},step:'summary'};
 expect((await saveWeeklyReview(client(async()=>Response.json(result)),input())).kind).toBe('saved');
});
it('accepts unchanged stored retries and explicit nonwriting conflicts',async()=>{
 const result=receipt();result.sourceUpdatedAt=result.review.updated_at;result.review.items.futureKey={newer:true};
 expect(await saveWeeklyReview(client(async()=>Response.json(result)),input())).toEqual(result);
 const conflict={kind:'conflict',ownerId:owner,weekStart:week,sourceUpdatedAt:null,review:null};expect(await saveWeeklyReview(client(async()=>Response.json(conflict)),input())).toEqual(conflict);
});
it('requires completed/draft state in explicit mode receipts',async()=>{
 for(const mode of ['complete','draft'] as const){const request={...input(),mode};const wrong=receipt();if(mode==='draft'){wrong.review.status='completed';wrong.review.completed_at='2026-10-24T09:00:00Z';}await expect(saveWeeklyReview(client(async()=>Response.json(wrong)),request)).rejects.toThrow(/^Weekly review save unconfirmed$/);}
});
it('accepts a stable new creation and refuses an existing-source receipt disguised as a new write',async()=>{
 const request={...input(),expected:null};const result=receipt();result.sourceUpdatedAt=null;result.review.created_at=result.review.updated_at;result.review.items={step:'summary'};
 expect(await saveWeeklyReview(client(async()=>Response.json(result)),request)).toEqual(result);
 result.sourceUpdatedAt=source().updated_at;await expect(saveWeeklyReview(client(async()=>Response.json(result)),request)).rejects.toThrow(/^Weekly review save unconfirmed$/);
});
it('refuses invalid captured input and pre-aborts without making any request',async()=>{
 const fetcher=vi.fn<typeof fetch>();for(const change of [{ownerId:'invalid'},{weekStart:'2026-10-20'},{expected:{...source(),user_id:other}},{patch:{items:{step:'summary',calendarEvents:['Private event body']}}}])await expect(saveWeeklyReview(client(fetcher),{...input(),...change} as WeeklyReviewSave)).rejects.toThrow(/^Weekly review save unconfirmed$/);
 const controller=new AbortController();controller.abort(Error('Private reason'));await expect(saveWeeklyReview(client(fetcher),input(),controller.signal)).rejects.toMatchObject({name:'AbortError',message:'Request aborted'});expect(fetcher).not.toHaveBeenCalled();
});
it('refuses a private 503 without automatic SDK retries',async()=>{const fetcher=vi.fn<typeof fetch>(async()=>Response.json({message:'Private SQL body'},{status:503}));await expect(saveWeeklyReview(client(fetcher),input())).rejects.toThrow(/^Weekly review save unconfirmed$/);expect(fetcher).toHaveBeenCalledTimes(1);});
it.each(['parent','deadline'])('interrupts a noncooperative transport at the %s boundary',async kind=>{
 const controller=new AbortController();if(kind==='deadline')vi.spyOn(AbortSignal,'timeout').mockReturnValue(controller.signal);let observed:AbortSignal|undefined;const fetcher=vi.fn<typeof fetch>(async(_url,init)=>{observed=init!.signal as AbortSignal;return new Promise<Response>(()=>{});});
 const pending=saveWeeklyReview(client(fetcher),input(),kind==='parent'?controller.signal:undefined);await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));controller.abort(Error('Private reason'));
 await expect(pending).rejects.toThrow(kind==='parent'?'Request aborted':'Weekly review save unconfirmed');expect(observed!.aborted).toBe(true);expect(fetcher).toHaveBeenCalledTimes(1);
});
it('applies only to the captured source and never resurrects or rolls back newer or foreign rows',()=>{
 const saved=receipt(), original=source(),foreign={...source(),id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',user_id:other};
 expect(applyWeeklyReviewReceipt([original,foreign],original,saved)).toEqual({rows:[saved.review,foreign],reconcile:false});
 const newer={...original,summary:'New local draft'};for(const rows of [[newer,foreign],[foreign]])expect(applyWeeklyReviewReceipt(rows,original,saved)).toEqual({rows,reconcile:true});
 expect(applyWeeklyReviewReceipt([saved.review,foreign],original,saved)).toEqual({rows:[saved.review,foreign],reconcile:false});
 expect(applyWeeklyReviewReceipt([foreign],null,saved)).toEqual({rows:[saved.review,foreign],reconcile:false});
 expect(applyWeeklyReviewReceipt([newer],null,saved)).toEqual({rows:[newer],reconcile:true});
});
