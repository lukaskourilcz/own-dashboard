import type { PGlite } from '@electric-sql/pglite';
import { afterAll,beforeAll,beforeEach,expect,it } from 'vitest';
import { createMigratedDatabase,setDatabaseTime } from '../helpers/supabase-pglite';
import { saveWeeklyReview,type WeeklyReviewSave,type WeeklyReviewReceipt } from '@/lib/weekly-review-save';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WeeklyReview } from '@/lib/types';
const owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222', id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', week='2026-10-19';
let db:PGlite;
const call=async (input: Partial<WeeklyReviewSave>={}) => {
 const args={ownerId:owner,id,weekStart:week,expected:null,mode:'auto',patch:{items:{step:'time'}},...input};
 return (await db.query<{result:WeeklyReviewReceipt}>('select save_weekly_review($1,$2,$3,$4,$5,$6) as result',[args.ownerId,args.id,args.weekStart,args.expected?.updated_at??null,args.mode,JSON.stringify(args.patch)])).rows[0]!.result;
};
const row=async()=> (await db.query<{row:WeeklyReview}>('select to_jsonb(r) as row from weekly_reviews r where user_id=$1 and week_start=$2',[owner,week])).rows[0]?.row;
const saved=async()=>{const result=await call();if(result.kind!=='saved')throw Error('Fixture not saved');return result.review;};
beforeAll(async()=>{db=await createMigratedDatabase({owner,instant:'2026-10-24T12:00:00.123456Z'});await db.query('insert into auth.users(id) values($1)',[other]);},120_000);
beforeEach(async()=>{await db.exec('reset role; drop trigger if exists test_weekly_change on public.weekly_reviews; delete from public.weekly_reviews');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated');await setDatabaseTime(db,'2026-10-24T12:00:00.123456Z');});
afterAll(async()=>db?.close());
it('persists one stable creation identity and acknowledges a repeated request without changing its timestamp',async()=>{
 const first=await saved();expect(first.id).toBe(id);expect(first.user_id).toBe(owner);expect(first.week_start).toBe(week);
 await setDatabaseTime(db,'2026-10-24T13:00:00Z');const retry=await call();expect(retry.kind).toBe('saved');expect(retry.review).toEqual(first);
 expect((await db.query<{count:number}>('select count(*)::int as count from weekly_reviews')).rows[0]!.count).toBe(1);
});
it('confirms captured patches while preserving untouched legacy fields and unknown future item keys',async()=>{
 let source=await saved();await db.query("update weekly_reviews set summary='Keep summary',items=items||'{\"facts\":[\"Keep fact\"],\"futureKey\":{\"a\":1}}'::jsonb,updated_at='2026-10-24T12:00:00.123457Z' where id=$1",[id]);source=(await row())!;
 const result=await call({expected:source,patch:{items:{step:'objectives',objectives:[{id:'objective-1',text:'Ship',done:false}]}}});
 expect(result.kind).toBe('saved');expect(result.review?.items).toMatchObject({facts:['Keep fact'],futureKey:{a:1},objectives:[{id:'objective-1',text:'Ship',done:false}]});expect(result.review?.summary).toBe('Keep summary');
 expect(Date.parse(result.review!.updated_at)).toBeGreaterThan(Date.parse(source.updated_at));
});
it('persists only validated calendar aggregates and focus counts, with fractional minutes intact',async()=>{
 const source=await saved();const timeByChannel={minutes:{client:90.125,project:30,admin:15},unmatchedEvents:2,source:'google' as const};
 const result=await call({expected:source,patch:{items:{step:'done',timeByChannel,focusRecap:{completed:3,total:7,days:1}}}});
 expect(result.kind).toBe('saved');expect(result.review!.items.timeByChannel).toEqual(timeByChannel);expect(result.review!.items.focusRecap).toEqual({completed:3,total:7,days:1});
});
it('refuses a stale differing draft and a stale creation/deleted-row expectation without writing',async()=>{
 const source=await saved();await db.query("update weekly_reviews set summary='Other tab',updated_at='2026-10-24T12:00:00.123457Z' where id=$1",[id]);
 expect((await call({expected:source,patch:{summary:'Stale draft',items:{step:'summary'}}})).kind).toBe('conflict');expect((await row())!.summary).toBe('Other tab');
 expect((await call({id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'})).kind).toBe('conflict');
 await db.query('delete from weekly_reviews where id=$1',[id]);expect((await call({expected:source})).kind).toBe('conflict');expect(await row())!.toBeUndefined();
});
it('accepts an ambiguous stored retry while preserving newer unrelated content',async()=>{
 const source=await saved();const input={expected:source,patch:{summary:'Confirmed text',items:{step:'summary' as const}}};const first=await call(input);expect(first.kind).toBe('saved');
 await db.query("update weekly_reviews set items=items||'{\"facts\":[\"Later untouched fact\"]}'::jsonb,updated_at=updated_at+interval '1 millisecond' where id=$1",[id]);
 const retry=await call(input);expect(retry.kind).toBe('saved');expect(retry.review!.items.facts).toEqual(['Later untouched fact']);expect(retry.review!.updated_at).toBe((await row())!.updated_at);
});
it('keeps completed weeks completed on automatic navigation and reopens only for explicit Save Draft',async()=>{
 const source=await saved();const complete=await call({expected:source,mode:'complete',patch:{items:{step:'summary'}}});expect(complete.review!.status).toBe('completed');expect(complete.review!.completed_at).not.toBeNull();
 await setDatabaseTime(db,'2026-10-25T12:00:00Z');expect((await call({expected:source,mode:'complete',patch:{items:{step:'summary'}}})).review).toEqual(complete.review);
 const auto=await call({expected:complete.review,patch:{items:{step:'objectives'}}});expect(auto.review!.status).toBe('completed');expect(auto.review!.completed_at).toBe(complete.review!.completed_at);
 const draft=await call({expected:auto.review,mode:'draft'});expect(draft.review!.status).toBe('draft');expect(draft.review!.completed_at).toBeNull();
});
it('binds actor/owner/id/week and preserves authenticated-only invoker RLS execution',async()=>{
 expect((await db.query("select prosecdef,proconfig,has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('service_role',oid,'execute') as service,has_function_privilege('authenticated',oid,'execute') as authenticated from pg_proc where oid='save_weekly_review(uuid,uuid,date,timestamptz,text,jsonb)'::regprocedure")).rows[0]).toEqual({prosecdef:false,proconfig:['search_path=""','lock_timeout=5s'],anon:false,service:false,authenticated:true});
 await expect(call({ownerId:other})).rejects.toThrow('Weekly review unavailable');await saved();await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
 await expect(call({ownerId:owner})).rejects.toThrow('Weekly review unavailable');expect((await db.query('select * from weekly_reviews')).rows).toEqual([]);
 await db.query("select set_config('request.jwt.claim.sub','',false)");await expect(call()).rejects.toThrow('Weekly review unavailable');
 for(const role of ['anon','service_role']){await db.exec(`reset role; set role ${role}`);await expect(call()).rejects.toThrow('permission denied');}
});
it('rejects malformed/unknown/overbound and nonaggregate inputs before any write',async()=>{
 const patches:unknown[]=[null,[],{items:{step:'unknown'}},{items:{step:'time',calendarEvents:[]}}, {summary:null,items:{step:'time'}},{summary:'x'.repeat(20001),items:{step:'time'}},
 {items:{step:'time',facts: Array(101).fill('x')}},{items:{step:'time',facts:[null]}},{items:{step:'time',objectives:[{id:'x',text:' ',done:false}]}},
 {items:{step:'time',objectives:[{id:'x',text:'One',done:false},{id:'x',text:'Two',done:true}]}},{items:{step:'time',focusRecap:{completed:50,total:49,days:7}}},
 {items:{step:'time',timeByChannel:{minutes:{client:-1,project:0,admin:0},unmatchedEvents:0,source:'google'}}}];
 for(const [index,patch] of patches.entries())await expect(call({patch:patch as WeeklyReviewSave['patch']}), `Invalid patch ${index}`).rejects.toThrow('Weekly review invalid');
 for(const weekStart of ['2026-10-20','infinity','-infinity'])await expect(call({weekStart})).rejects.toThrow('Weekly review invalid');
 expect(await row())!.toBeUndefined();
});
it.each(['return null','new.summary:=\'Altered by fixture\'; return new'])('rolls back suppressed or altered writes: %s',async body=>{
 const source=await saved();await db.exec(`reset role; create or replace function public.test_weekly_mutate() returns trigger language plpgsql as $$ begin ${body}; end $$; create trigger test_weekly_change before update on weekly_reviews for each row execute function public.test_weekly_mutate(); set role authenticated`);
 await expect(call({expected:source,patch:{summary:'Expected draft',items:{step:'summary'}}})).rejects.toThrow('Weekly review save unconfirmed');expect(await row())!.toEqual(source);
});
it('refuses an oversized retained response and rolls back its attempted edit without truncation',async()=>{
 const source=await saved();await db.query("update weekly_reviews set items=items||jsonb_build_object('futureKey',repeat('x',524288)) where id=$1",[id]);
 await expect(call({expected:source,patch:{summary:'Must not persist',items:{step:'summary'}}})).rejects.toThrow('Weekly review limit');expect((await row())!.summary).toBe('');expect(((await row())!.items.futureKey as string).length).toBe(524288);
});
it('validates a real persisted database receipt through the client contract with timestamp precision intact',async()=>{
 const source=await saved();const request:WeeklyReviewSave={ownerId:owner,id,weekStart:week,expected:source,mode:'complete',patch:{summary:'Final draft',items:{step:'summary',focusRecap:{completed:3,total:7,days:1}}}};
 const transport={rpc:(_name:string,args:Record<string,unknown>)=>{const pending=db.query<{result:WeeklyReviewReceipt}>('select save_weekly_review($1,$2,$3,$4,$5,$6) as result',[args.p_owner,args.p_id,args.p_week_start,args.p_expected_updated_at,args.p_mode,JSON.stringify(args.p_patch)]).then(result=>({data:result.rows[0]!.result,error:null}));return {retry:()=>({abortSignal:()=>pending})};}} as unknown as SupabaseClient;
 const result=await saveWeeklyReview(transport,request);expect(result.kind).toBe('saved');expect(result.review).toEqual(await row());
});
