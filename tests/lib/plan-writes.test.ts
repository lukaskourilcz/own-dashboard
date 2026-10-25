import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import { createPlanRecord, updatePlanRecord, removePlanRecord, applyPlanReceipt, type PlanFields } from '@/lib/plan-records';
import { databaseVersion } from '@/lib/database-version';
import type { Plan } from '@/lib/types';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',stamp='2026-10-25T17:00:00Z';
let db:PGlite;
const scope=()=>({ownerId:owner,signal:new AbortController().signal});
const fields=():PlanFields=>({title:'Synthetic plan',target_date:'2026-11-01',status:'idea',recurrence:'none',notes:'Retained private note'});
const record=():Plan=>({...fields(),id,user_id:owner,last_completed_at:null,linked_calendar_event_id:null,created_at:stamp,updated_at:stamp});
function client(actor=owner,intercept?:(request:Request,next:()=>Promise<Response>)=>Promise<Response>) {
 const emulator=new SupabaseEmulator(db,'https://offline.supabase.test',{service:'TEST-ONLY-service',users:{[owner]:'TEST-ONLY-owner',[other]:'TEST-ONLY-other'}},()=>new Date(stamp));
 const api=createClient('https://offline.supabase.test','TEST-ONLY-public',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:`Bearer ${actor===owner?'TEST-ONLY-owner':'TEST-ONLY-other'}`},fetch:(input,init)=>{const request=new Request(input,init);return intercept?intercept(request,()=>emulator.fetch(request)):emulator.fetch(request);}}});return{api,emulator};
}
function wire(value:unknown,status=200,fetcher?:typeof fetch){const transport=fetcher??vi.fn(async()=>Response.json(value,{status}));return{api:createClient('https://example.supabase.co','TEST-ONLY-public',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:transport}}),transport};}
beforeAll(async()=>{db=await createMigratedDatabase({owner,instant:stamp});await db.query('insert into auth.users(id) values($1)',[other]);},120000);
beforeEach(async()=>{await db.exec('reset role; delete from plans');});
afterEach(()=>vi.restoreAllMocks());afterAll(async()=>db?.close());
it('creates and explicitly recovers the same id through actual SDK/RLS without an upsert',async()=>{
 const {api,emulator}=client(),first=await createPlanRecord(api,scope(),id,fields());expect(await createPlanRecord(api,scope(),id,fields())).toEqual(first);
 expect(emulator.requests.map(r=>r.method)).toEqual(['POST','POST','GET']);expect((await db.query('select id from plans')).rows).toEqual([{id}]);
});
it('recovers a committed insert with a lost response but never overwrites a changed recovered plan',async()=>{
 let lose=true;const {api}=client(owner,async(_request,next)=>{const response=await next();if(lose){lose=false;throw Error('PRIVATE TEST lost receipt');}return response;});
 await expect(createPlanRecord(api,scope(),id,fields())).rejects.toThrow(/^Plans unavailable$/);expect(await createPlanRecord(api,scope(),id,fields())).toMatchObject({id,...fields()});
 await db.query("update plans set notes='Newer private note' where id=$1",[id]);await expect(createPlanRecord(api,scope(),id,fields())).rejects.toMatchObject({reason:'changed'});expect((await db.query('select notes from plans')).rows).toEqual([{notes:'Newer private note'}]);
});
it('confirms status, completion and Calendar patches while preserving every unrelated field',async()=>{
 const {api}=client();let source=await createPlanRecord(api,scope(),id,fields());
 for(const patch of [{status:'active' as const},{last_completed_at:stamp},{linked_calendar_event_id:'synthetic-event'},{last_completed_at:null}]){
  const updated=await updatePlanRecord(api,scope(),source,patch);expect(databaseVersion(updated.updated_at)!>databaseVersion(source.updated_at)!).toBe(true);
  const expected={...source,...patch,updated_at:updated.updated_at};
  if(expected.last_completed_at){expect(updated.last_completed_at).not.toBeNull();expect(databaseVersion(updated.last_completed_at!)).toBe(databaseVersion(expected.last_completed_at));}
  expect(updated).toEqual({...expected,last_completed_at:expected.last_completed_at?updated.last_completed_at:null});source=updated;
 }
 expect(await removePlanRecord(api,scope(),source)).toEqual(source);await expect(removePlanRecord(api,scope(),source)).rejects.toMatchObject({reason:'changed'});
});
it('refuses stale updates and removal without changing an edited plan',async()=>{
 const {api}=client(),source=await createPlanRecord(api,scope(),id,fields());await updatePlanRecord(api,scope(),source,{status:'active'});
 await expect(updatePlanRecord(api,scope(),source,{status:'done'})).rejects.toMatchObject({reason:'changed'});await expect(removePlanRecord(api,scope(),source)).rejects.toMatchObject({reason:'changed'});expect((await db.query('select status,notes from plans')).rows).toEqual([{status:'active',notes:fields().notes}]);
});
it('refuses a switched authenticated actor for creation, recovery, updates and deletion',async()=>{
 const source=await createPlanRecord(client().api,scope(),id,fields()),{api}=client(other);
 await expect(createPlanRecord(api,scope(),id,fields())).rejects.toThrow(/^Plans unavailable$/);await expect(createPlanRecord(api,scope(),other,fields())).rejects.toThrow(/^Plans unavailable$/);
 await expect(updatePlanRecord(api,scope(),source,{status:'done'})).rejects.toMatchObject({reason:'changed'});await expect(removePlanRecord(api,scope(),source)).rejects.toMatchObject({reason:'changed'});expect((await db.query('select id from plans')).rows).toEqual([{id}]);
});
it('sends exact captured owner/id/version filters and positive columns on actual SDK mutations',async()=>{
 const seen:Request[]=[];const {api}=client(owner,async(request,next)=>{seen.push(request);return next();});const source=await createPlanRecord(api,scope(),id,fields()),updated=await updatePlanRecord(api,scope(),source,{status:'active'});await removePlanRecord(api,scope(),updated);
 for(const [index,version] of [[1,source.updated_at],[2,updated.updated_at]] as const){const query=new URL(seen[index].url).searchParams;expect(query.get('id')).toBe(`eq.${id}`);expect(query.get('user_id')).toBe(`eq.${owner}`);expect(query.get('updated_at')).toBe(`eq.${version}`);expect(query.get('select')).not.toContain('*');}
});
it.each([null,[],[record(),record()],[{...record(),user_id:other}],[{...record(),title:'Unrequested'}],[{...record(),last_completed_at:stamp}],[{...record(),linked_calendar_event_id:'Unexpected'}],[{...record(),updated_at:'infinity'}],[{...record(),extra:'PRIVATE TEST'}]])('rejects unconfirmed creation receipts',async value=>{await expect(createPlanRecord(wire(value).api,scope(),id,fields())).rejects.toThrow(/^Plans unavailable$/);});
it.each([record(),{...record(),status:'active',updated_at:'2026-10-25T16:00:00Z'},{...record(),status:'active',notes:'Unexpected',updated_at:'2026-10-25T17:00:01Z'}])('refuses unadvanced or unrequested updates',async value=>{await expect(updatePlanRecord(wire([value]).api,scope(),record(),{status:'active'})).rejects.toThrow(/^Plans unavailable$/);});
it('accepts equivalent timestamp formatting and preserves microseconds for completion and versions',async()=>{
 const source={...record(),updated_at:'2026-10-25T17:00:00.000001Z'},receipt={...source,last_completed_at:'2026-10-25T19:00:00+02:00',created_at:'2026-10-25T19:00:00+02:00',updated_at:'2026-10-25T17:00:00.000002Z'};
 expect(await updatePlanRecord(wire([receipt]).api,scope(),source,{last_completed_at:stamp})).toEqual(receipt);
});
it('refuses an altered deletion receipt',async()=>{await expect(removePlanRecord(wire([{...record(),notes:'Different'}]).api,scope(),record())).rejects.toThrow(/^Plans unavailable$/);});
it('validates identities, fields and payload bounds before any transport',async()=>{
 const {api,transport}=wire([]);
 for(const patch of [{},{status:undefined},{status:'unknown'},{user_id:other},{notes:'Unrequested'},{last_completed_at:'infinity'},{linked_calendar_event_id:'bad\nvalue'}])await expect(updatePlanRecord(api,scope(),record(),patch as never)).rejects.toThrow(/^Plans unavailable$/);
 await expect(createPlanRecord(api,scope(),'invalid',fields())).rejects.toThrow();await expect(createPlanRecord(api,scope(),id,{...fields(),notes:'x'.repeat(65537)})).rejects.toThrow();await expect(updatePlanRecord(api,scope(),{...record(),user_id:other},{status:'active'})).rejects.toThrow();expect(transport).not.toHaveBeenCalled();
});
it('captures the original source, patch and scope before a delayed response',async()=>{
 let release!:(response:Response)=>void;const {api}=wire(null,200,()=>new Promise(resolve=>{release=resolve;}));const source=record(),patch={status:'active' as const},captured=scope();const pending=updatePlanRecord(api,captured,source,patch);
 source.notes='Later source';captured.ownerId=other;Object.assign(patch,{status:'done'});await vi.waitFor(()=>expect(release).toBeTypeOf('function'));release(Response.json([{...record(),status:'active',updated_at:'2026-10-25T17:00:01Z'}]));expect((await pending).status).toBe('active');
});
it.each(['create','update','remove'] as const)('bounds uncooperative %s without a hidden retry',async kind=>{
 const stop=new AbortController();vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>ms===15000?stop.signal:new AbortController().signal);const transport=vi.fn<typeof fetch>(()=>new Promise(()=>{})),{api}=wire(null,200,transport);
 const pending=kind==='create'?createPlanRecord(api,scope(),id,fields()):kind==='update'?updatePlanRecord(api,scope(),record(),{status:'active'}):removePlanRecord(api,scope(),record());const failed=expect(pending).rejects.toThrow(/^Plans unavailable$/);await vi.waitFor(()=>expect(transport).toHaveBeenCalledOnce());stop.abort('PRIVATE TEST');await failed;expect(transport).toHaveBeenCalledOnce();
});
it('refuses disposed work and ignores a late successful creation',async()=>{
 const stop=new AbortController();let release!:(response:Response)=>void;const transport=vi.fn<typeof fetch>(()=>new Promise(resolve=>{release=resolve;})),{api}=wire(null,200,transport),captured={ownerId:owner,signal:stop.signal};
 const pending=createPlanRecord(api,captured,id,fields()),failed=expect(pending).rejects.toMatchObject({name:'AbortError'});await vi.waitFor(()=>expect(release).toBeTypeOf('function'));stop.abort();await failed;release(Response.json([record()]));await expect(removePlanRecord(api,captured,record())).rejects.toMatchObject({name:'AbortError'});expect(transport).toHaveBeenCalledOnce();
});
it('applies confirmed receipts only to the exact cached source, retaining newer and unrelated rows',()=>{
 const source=record(),receipt={...source,status:'active' as const,updated_at:'2026-10-25T17:00:01Z'},unrelated={...source,id:other},newer={...source,notes:'Newer note'};
 expect(applyPlanReceipt([source,unrelated],source,receipt)).toEqual([receipt,unrelated]);expect(applyPlanReceipt([newer,unrelated],source,receipt)).toEqual([newer,unrelated]);expect(applyPlanReceipt([source,unrelated],source,null)).toEqual([unrelated]);expect(applyPlanReceipt([newer],source,null)).toEqual([newer]);expect(applyPlanReceipt([],source,receipt)).toEqual([]);
});
