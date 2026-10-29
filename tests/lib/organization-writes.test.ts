import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import { createOrganizationRecord, updateOrganizationRecord, removeOrganizationRecord, applyOrganizationReceipt, type OrganizationFields } from '@/lib/organization-records';
import { databaseVersion } from '@/lib/database-version';
import type { Organization } from '@/lib/types';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',stamp='2026-10-25T09:00:00Z';
let db:PGlite;
const scope=()=>({ownerId:owner,signal:new AbortController().signal});
const fields=():OrganizationFields=>({name:'Synthetic organization',type:'client',website:null,logo_url:null,email:null,phone:'Synthetic phone',address:null,city:null,zip:null,country:null,company_id:null,vat_id:null,notes:'Synthetic note',status:'active',ares_verified_at:null,vat_verification_status:'unchecked',vat_verified_at:null,vat_verified_id:null,vat_verified_name:null,vat_verified_address:null});
const record=():Organization=>({...fields(),id,user_id:owner,created_at:stamp,updated_at:stamp});
function client(actor=owner,intercept?:(request:Request,next:()=>Promise<Response>)=>Promise<Response>) {
 const emulator=new SupabaseEmulator(db,'https://offline.supabase.test',{service:'TEST-ONLY-service',users:{[owner]:'TEST-ONLY-owner',[other]:'TEST-ONLY-other'}},()=>new Date(stamp));
 const api=createClient('https://offline.supabase.test','TEST-ONLY-public',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:`Bearer ${actor===owner?'TEST-ONLY-owner':'TEST-ONLY-other'}`},fetch:(input,init)=>{const request=new Request(input,init);return intercept?intercept(request,()=>emulator.fetch(request)):emulator.fetch(request);}}});return{api,emulator};
}
function wire(value:unknown,status=200,fetcher?:typeof fetch){const transport=fetcher??vi.fn(async()=>Response.json(value,{status}));return{api:createClient('https://example.supabase.co','TEST-ONLY-public',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:transport}}),transport};}
beforeAll(async()=>{db=await createMigratedDatabase({owner,instant:stamp});await db.query('insert into auth.users(id) values($1)',[other]);},120000);
beforeEach(async()=>{await db.exec('reset role; delete from organizations');});
afterEach(()=>vi.restoreAllMocks());afterAll(async()=>db?.close());
it('creates and explicitly recovers the same id with real SDK/RLS without an upsert',async()=>{
 const {api,emulator}=client();const first=await createOrganizationRecord(api,scope(),id,fields());const recovered=await createOrganizationRecord(api,scope(),id,fields());
 expect(recovered).toEqual(first);expect(emulator.requests.map(r=>r.method)).toEqual(['POST','POST','GET']);expect((await db.query('select id from organizations')).rows).toEqual([{id}]);
});
it('recovers a committed creation whose first transport response was lost',async()=>{
 let lose=true;const {api}=client(owner,async(_request,next)=>{const response=await next();if(lose){lose=false;throw new TypeError('PRIVATE TEST lost response');}return response;});
 await expect(createOrganizationRecord(api,scope(),id,fields())).rejects.toThrow(/^Organization unavailable$/);expect(await createOrganizationRecord(api,scope(),id,fields())).toMatchObject({id,...fields()});expect((await db.query('select id from organizations')).rows).toHaveLength(1);
});
it('refuses a changed row when recovering an id and never overwrites it',async()=>{
 const {api}=client();await createOrganizationRecord(api,scope(),id,fields());await db.query("update organizations set notes='Newer note' where id=$1",[id]);
 await expect(createOrganizationRecord(api,scope(),id,fields())).rejects.toMatchObject({reason:'changed'});expect((await db.query('select notes from organizations')).rows).toEqual([{notes:'Newer note'}]);
});
it('updates one captured version, preserves unrelated fields, and rejects its stale replay',async()=>{
 const {api,emulator}=client();const source=await createOrganizationRecord(api,scope(),id,fields());const updated=await updateOrganizationRecord(api,scope(),source,{name:'Confirmed new name'});
 expect(updated).toMatchObject({...fields(),id,name:'Confirmed new name'});expect(databaseVersion(updated.updated_at)!>databaseVersion(source.updated_at)!).toBe(true);
 await expect(updateOrganizationRecord(api,scope(),source,{notes:'Stale edit'})).rejects.toMatchObject({reason:'changed'});expect((await db.query('select name,notes from organizations')).rows).toEqual([{name:'Confirmed new name',notes:'Synthetic note'}]);expect(emulator.requests).toHaveLength(3);
});
it('confirms only the deleted captured version and does not pretend a second removal succeeded',async()=>{
 const {api}=client(),source=await createOrganizationRecord(api,scope(),id,fields());expect(await removeOrganizationRecord(api,scope(),source)).toEqual(source);
 await expect(removeOrganizationRecord(api,scope(),source)).rejects.toMatchObject({reason:'changed'});expect((await db.query('select id from organizations')).rows).toEqual([]);
});
it('does not delete a newer edited row',async()=>{
 const {api}=client(),source=await createOrganizationRecord(api,scope(),id,fields());await updateOrganizationRecord(api,scope(),source,{notes:'Keep this newer row'});
 await expect(removeOrganizationRecord(api,scope(),source)).rejects.toMatchObject({reason:'changed'});expect((await db.query('select notes from organizations')).rows).toEqual([{notes:'Keep this newer row'}]);
});
it('refuses a switched authenticated actor for create, update, delete and duplicate recovery',async()=>{
 const source=await createOrganizationRecord(client().api,scope(),id,fields()),{api}=client(other);
 await expect(createOrganizationRecord(api,scope(),id,fields())).rejects.toThrow(/^Organization unavailable$/);
 await expect(updateOrganizationRecord(api,scope(),source,{name:'Other actor'})).rejects.toMatchObject({reason:'changed'});
 await expect(removeOrganizationRecord(api,scope(),source)).rejects.toMatchObject({reason:'changed'});expect((await db.query('select id from organizations')).rows).toEqual([{id}]);
});
it('validates all identity and version filters on the actual SDK request',async()=>{
 const seen:Request[]=[];const {api}=client(owner,async(request,next)=>{seen.push(request);return next();});const source=await createOrganizationRecord(api,scope(),id,fields());const updated=await updateOrganizationRecord(api,scope(),source,{notes:'Updated'});await removeOrganizationRecord(api,scope(),updated);
 for(const [index,version] of [[1,source.updated_at],[2,updated.updated_at]] as const){const query=new URL(seen[index]!.url).searchParams;expect(query.get('id')).toBe(`eq.${id}`);expect(query.get('user_id')).toBe(`eq.${owner}`);expect(query.get('updated_at')).toBe(`eq.${version}`);expect(query.get('select')).not.toContain('*');}
});
it.each([null,[],[record(),record()],[{...record(),user_id:other}],[{...record(),name:'Unrequested name'}],[{...record(),phone:'Unrequested phone'}],[{...record(),updated_at:'infinity'}],[{...record(),extra:'PRIVATE TEST'}]])('refuses unconfirmed creation receipts',async response=>{await expect(createOrganizationRecord(wire(response).api,scope(),id,fields())).rejects.toThrow(/^Organization unavailable$/);});
it.each([record(),{...record(),updated_at:'2026-10-25T08:59:59Z'},{...record(),name:'Expected',phone:'Unexpected',updated_at:'2026-10-25T09:00:01Z'}])('refuses unadvanced or unrequested update receipts',async response=>{await expect(updateOrganizationRecord(wire([response]).api,scope(),record(),{name:'Expected'})).rejects.toThrow(/^Organization unavailable$/);});
it('accepts equivalent database timestamp formatting without losing microsecond versions',async()=>{
 const source={...record(),updated_at:'2026-10-25T09:00:00.000001Z'},receipt={...source,name:'New',created_at:'2026-10-25T11:00:00+02:00',updated_at:'2026-10-25T09:00:00.000002Z'};
 expect(await updateOrganizationRecord(wire([receipt]).api,scope(),source,{name:'New'})).toEqual(receipt);
});
it('refuses a mismatched delete receipt',async()=>{await expect(removeOrganizationRecord(wire([{...record(),notes:'Changed'}]).api,scope(),record())).rejects.toThrow(/^Organization unavailable$/);});
it('validates before transport and does not silently drop unsupported patch fields',async()=>{
 const {api,transport}=wire([]);await expect(updateOrganizationRecord(api,scope(),record(),{})).rejects.toThrow();await expect(updateOrganizationRecord(api,scope(),record(),{name:undefined})).rejects.toThrow();await expect(updateOrganizationRecord(api,scope(),record(),{user_id:other} as never)).rejects.toThrow();await expect(updateOrganizationRecord(api,scope(),record(),{notes:'x'.repeat(65537)})).rejects.toThrow();await expect(updateOrganizationRecord(api,scope(),{...record(),user_id:other},{name:'New'})).rejects.toThrow();await expect(createOrganizationRecord(api,scope(),'invalid',fields())).rejects.toThrow();expect(transport).not.toHaveBeenCalled();
});
it('snapshots a caller-owned patch before a delayed response',async()=>{
 let release!:(r:Response)=>void;const {api}=wire(null,200,()=>new Promise(resolve=>{release=resolve;}));const patch={name:'Captured'},pending=updateOrganizationRecord(api,scope(),record(),patch);patch.name='Later';await vi.waitFor(()=>expect(release).toBeTypeOf('function'));release(Response.json([{...record(),name:'Captured',updated_at:'2026-10-25T09:00:01Z'}]));expect((await pending).name).toBe('Captured');
});
it.each(['create','update','remove'] as const)('ends an uncooperative %s at the write deadline without retry',async kind=>{
 const stop=new AbortController();vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>ms===15000?stop.signal:new AbortController().signal);const transport=vi.fn<typeof fetch>(()=>new Promise(()=>{})),{api}=wire(null,200,transport);
 const pending=kind==='create'?createOrganizationRecord(api,scope(),id,fields()):kind==='update'?updateOrganizationRecord(api,scope(),record(),{name:'New'}):removeOrganizationRecord(api,scope(),record());const failed=expect(pending).rejects.toThrow(/^Organization unavailable$/);await vi.waitFor(()=>expect(transport).toHaveBeenCalledOnce());stop.abort('PRIVATE TEST reason');await failed;expect(transport).toHaveBeenCalledOnce();
});
it('does not send disposed writes and ignores a late successful response after disposal',async()=>{
 const stop=new AbortController();let release!:(r:Response)=>void;const transport=vi.fn<typeof fetch>(()=>new Promise(resolve=>{release=resolve;})),{api}=wire(null,200,transport);const captured={ownerId:owner,signal:stop.signal};const pending=createOrganizationRecord(api,captured,id,fields()),failed=expect(pending).rejects.toMatchObject({name:'AbortError'});await vi.waitFor(()=>expect(release).toBeTypeOf('function'));stop.abort();await failed;release(Response.json([record()]));await expect(removeOrganizationRecord(api,captured,record())).rejects.toMatchObject({name:'AbortError'});expect(transport).toHaveBeenCalledOnce();
});
it('applies a receipt only to the unchanged source, retaining newer refreshes and unrelated rows',()=>{
 const source=record(),receipt={...source,name:'Confirmed',updated_at:'2026-10-25T09:00:01Z'},unrelated={...source,id:other},newer={...source,notes:'Local newer value'};
 expect(applyOrganizationReceipt([source,unrelated],source,receipt)).toEqual([receipt,unrelated]);expect(applyOrganizationReceipt([newer,unrelated],source,receipt)).toEqual([newer,unrelated]);expect(applyOrganizationReceipt([source,unrelated],source,null)).toEqual([unrelated]);expect(applyOrganizationReceipt([newer],source,null)).toEqual([newer]);expect(applyOrganizationReceipt([],source,receipt)).toEqual([]);
});
