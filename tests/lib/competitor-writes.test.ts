import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import { createCompetitorRecord, updateCompetitorRecord, removeCompetitorRecord, applyCompetitorReceipt, type CompetitorFields } from '@/lib/competitor-records';
import { databaseVersion } from '@/lib/database-version';
import type { Competitor } from '@/lib/types';
const project='cccccccc-cccc-4ccc-8ccc-cccccccccccc',foreignProject='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',stamp='2026-10-25T09:00:00Z';
let db:PGlite;
const scope=()=>({ownerId:owner,signal:new AbortController().signal});
const fields=():CompetitorFields=>({project_id:project,name:'Synthetic competitor',url:'https://example.test/',summary:'Synthetic summary',category:'direct',useful_features:['Feature one','Feature two'],social_content:'',pricing_model:'',lessons:'',relevance_score:3,score_rationale:'',social_links:['https://example.test/social'],source_urls:['https://example.test/source'],reviewed_at:'2099-01-01',sort_order:0});
const record=():Competitor=>({...fields(),id,user_id:owner,created_at:stamp,updated_at:stamp});
function client(actor=owner,intercept?:(request:Request,next:()=>Promise<Response>)=>Promise<Response>) {
 const emulator=new SupabaseEmulator(db,'https://offline.supabase.test',{service:'TEST-ONLY-service',users:{[owner]:'TEST-ONLY-owner',[other]:'TEST-ONLY-other'}},()=>new Date(stamp));
 const api=createClient('https://offline.supabase.test','TEST-ONLY-public',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:`Bearer ${actor===owner?'TEST-ONLY-owner':'TEST-ONLY-other'}`},fetch:(input,init)=>{const request=new Request(input,init);return intercept?intercept(request,()=>emulator.fetch(request)):emulator.fetch(request);}}});return{api,emulator};
}
function wire(value:unknown,status=200,fetcher?:typeof fetch){const transport=fetcher??vi.fn(async()=>Response.json(value,{status}));return{api:createClient('https://example.supabase.co','TEST-ONLY-public',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:transport}}),transport};}
beforeAll(async()=>{db=await createMigratedDatabase({owner,instant:stamp});await db.query('insert into auth.users(id) values($1)',[other]);await db.query("insert into projects(id,user_id,name,slug) values($1,$2,'Owned','competitor-write-owned'),($3,$4,'Foreign','competitor-write-foreign')",[project,owner,foreignProject,other]);},120000);
beforeEach(async()=>{await db.exec('reset role; delete from competitors');});
afterEach(()=>vi.restoreAllMocks());afterAll(async()=>db?.close());
it('creates and explicitly recovers the same id with real SDK/RLS without an upsert',async()=>{
 const {api,emulator}=client();const first=await createCompetitorRecord(api,scope(),id,fields());const recovered=await createCompetitorRecord(api,scope(),id,fields());
 expect(recovered).toEqual(first);expect(emulator.requests.map(r=>r.method)).toEqual(['POST','POST','GET']);expect((await db.query('select id from competitors')).rows).toEqual([{id}]);
});
it('recovers a committed creation whose first transport response was lost',async()=>{
 let lose=true;const {api}=client(owner,async(_request,next)=>{const response=await next();if(lose){lose=false;throw new TypeError('PRIVATE TEST lost response');}return response;});
 await expect(createCompetitorRecord(api,scope(),id,fields())).rejects.toThrow(/^Competition unavailable$/);expect(await createCompetitorRecord(api,scope(),id,fields())).toMatchObject({id,...fields()});expect((await db.query('select id from competitors')).rows).toHaveLength(1);
});
it('refuses a changed row when recovering an id and never overwrites it',async()=>{
 const {api}=client();await createCompetitorRecord(api,scope(),id,fields());await db.query("update competitors set summary='Newer note' where id=$1",[id]);
 await expect(createCompetitorRecord(api,scope(),id,fields())).rejects.toMatchObject({reason:'changed'});expect((await db.query('select summary from competitors')).rows).toEqual([{summary:'Newer note'}]);
});
it('updates one captured version, preserves unrelated fields, and rejects its stale replay',async()=>{
 const {api,emulator}=client();const source=await createCompetitorRecord(api,scope(),id,fields());const updated=await updateCompetitorRecord(api,scope(),source,{name:'Confirmed new name'});
 expect(updated).toMatchObject({...fields(),id,name:'Confirmed new name'});expect(databaseVersion(updated.updated_at)!>databaseVersion(source.updated_at)!).toBe(true);
 await expect(updateCompetitorRecord(api,scope(),source,{summary:'Stale edit'})).rejects.toMatchObject({reason:'changed'});expect((await db.query('select name,summary from competitors')).rows).toEqual([{name:'Confirmed new name',summary:'Synthetic summary'}]);expect(emulator.requests).toHaveLength(3);
});
it('confirms only the deleted captured version and does not pretend a second removal succeeded',async()=>{
 const {api}=client(),source=await createCompetitorRecord(api,scope(),id,fields());expect(await removeCompetitorRecord(api,scope(),source)).toEqual(source);
 await expect(removeCompetitorRecord(api,scope(),source)).rejects.toMatchObject({reason:'changed'});expect((await db.query('select id from competitors')).rows).toEqual([]);
});
it('does not delete a newer edited row',async()=>{
 const {api}=client(),source=await createCompetitorRecord(api,scope(),id,fields());await updateCompetitorRecord(api,scope(),source,{summary:'Keep this newer row'});
 await expect(removeCompetitorRecord(api,scope(),source)).rejects.toMatchObject({reason:'changed'});expect((await db.query('select summary from competitors')).rows).toEqual([{summary:'Keep this newer row'}]);
});
it('refuses a switched authenticated actor for create, update, delete and duplicate recovery',async()=>{
 const source=await createCompetitorRecord(client().api,scope(),id,fields()),{api}=client(other);
 await expect(createCompetitorRecord(api,scope(),id,fields())).rejects.toThrow(/^Competition unavailable$/);
 await expect(updateCompetitorRecord(api,scope(),source,{name:'Other actor'})).rejects.toMatchObject({reason:'changed'});
 await expect(removeCompetitorRecord(api,scope(),source)).rejects.toMatchObject({reason:'changed'});expect((await db.query('select id from competitors')).rows).toEqual([{id}]);
});
it('validates all identity and version filters on the actual SDK request',async()=>{
 const seen:Request[]=[];const {api}=client(owner,async(request,next)=>{seen.push(request);return next();});const source=await createCompetitorRecord(api,scope(),id,fields());const updated=await updateCompetitorRecord(api,scope(),source,{summary:'Updated'});await removeCompetitorRecord(api,scope(),updated);
 for(const [index,version] of [[1,source.updated_at],[2,updated.updated_at]] as const){const query=new URL(seen[index]!.url).searchParams;expect(query.get('id')).toBe(`eq.${id}`);expect(query.get('user_id')).toBe(`eq.${owner}`);expect(query.get('updated_at')).toBe(`eq.${version}`);expect(query.get('select')).not.toContain('*');}
});
it.each([null,[],[record(),record()],[{...record(),user_id:other}],[{...record(),name:'Unrequested name'}],[{...record(),lessons:'Unrequested lessons'}],[{...record(),updated_at:'infinity'}],[{...record(),extra:'PRIVATE TEST'}]])('refuses unconfirmed creation receipts',async response=>{await expect(createCompetitorRecord(wire(response).api,scope(),id,fields())).rejects.toThrow(/^Competition unavailable$/);});
it.each([record(),{...record(),updated_at:'2026-10-25T08:59:59Z'},{...record(),name:'Expected',lessons:'Unexpected',updated_at:'2026-10-25T09:00:01Z'}])('refuses unadvanced or unrequested update receipts',async response=>{await expect(updateCompetitorRecord(wire([response]).api,scope(),record(),{name:'Expected'})).rejects.toThrow(/^Competition unavailable$/);});
it('accepts equivalent database timestamp formatting without losing microsecond versions',async()=>{
 const source={...record(),updated_at:'2026-10-25T09:00:00.000001Z'},receipt={...source,name:'New',created_at:'2026-10-25T11:00:00+02:00',updated_at:'2026-10-25T09:00:00.000002Z'};
 expect(await updateCompetitorRecord(wire([receipt]).api,scope(),source,{name:'New'})).toEqual(receipt);
});
it('refuses a mismatched delete receipt',async()=>{await expect(removeCompetitorRecord(wire([{...record(),summary:'Changed'}]).api,scope(),record())).rejects.toThrow(/^Competition unavailable$/);});
it('validates before transport and does not silently drop unsupported patch fields',async()=>{
 const {api,transport}=wire([]);await expect(updateCompetitorRecord(api,scope(),record(),{})).rejects.toThrow();await expect(updateCompetitorRecord(api,scope(),record(),{name:undefined})).rejects.toThrow();await expect(updateCompetitorRecord(api,scope(),record(),{user_id:other} as never)).rejects.toThrow();await expect(updateCompetitorRecord(api,scope(),record(),{summary:'x'.repeat(65537)})).rejects.toThrow();await expect(updateCompetitorRecord(api,scope(),{...record(),user_id:other},{name:'New'})).rejects.toThrow();await expect(createCompetitorRecord(api,scope(),'invalid',fields())).rejects.toThrow();expect(transport).not.toHaveBeenCalled();
});
it('snapshots a caller-owned patch before a delayed response',async()=>{
 let release!:(r:Response)=>void;const {api}=wire(null,200,()=>new Promise(resolve=>{release=resolve;}));const patch={name:'Captured'},pending=updateCompetitorRecord(api,scope(),record(),patch);patch.name='Later';await vi.waitFor(()=>expect(release).toBeTypeOf('function'));release(Response.json([{...record(),name:'Captured',updated_at:'2026-10-25T09:00:01Z'}]));expect((await pending).name).toBe('Captured');
});
it.each(['create','update','remove'] as const)('ends an uncooperative %s at the write deadline without retry',async kind=>{
 const stop=new AbortController();vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>ms===15000?stop.signal:new AbortController().signal);const transport=vi.fn<typeof fetch>(()=>new Promise(()=>{})),{api}=wire(null,200,transport);
 const pending=kind==='create'?createCompetitorRecord(api,scope(),id,fields()):kind==='update'?updateCompetitorRecord(api,scope(),record(),{name:'New'}):removeCompetitorRecord(api,scope(),record());const failed=expect(pending).rejects.toThrow(/^Competition unavailable$/);await vi.waitFor(()=>expect(transport).toHaveBeenCalledOnce());stop.abort('PRIVATE TEST reason');await failed;expect(transport).toHaveBeenCalledOnce();
});
it('does not send disposed writes and ignores a late successful response after disposal',async()=>{
 const stop=new AbortController();let release!:(r:Response)=>void;const transport=vi.fn<typeof fetch>(()=>new Promise(resolve=>{release=resolve;})),{api}=wire(null,200,transport);const captured={ownerId:owner,signal:stop.signal};const pending=createCompetitorRecord(api,captured,id,fields()),failed=expect(pending).rejects.toMatchObject({name:'AbortError'});await vi.waitFor(()=>expect(release).toBeTypeOf('function'));stop.abort();await failed;release(Response.json([record()]));await expect(removeCompetitorRecord(api,captured,record())).rejects.toMatchObject({name:'AbortError'});expect(transport).toHaveBeenCalledOnce();
});
it('applies a receipt only to the unchanged source, retaining newer refreshes and unrelated rows',()=>{
 const source=record(),receipt={...source,name:'Confirmed',updated_at:'2026-10-25T09:00:01Z'},unrelated={...source,id:other},newer={...source,summary:'Local newer value'};
 expect(applyCompetitorReceipt([source,unrelated],source,receipt)).toEqual([receipt,unrelated]);expect(applyCompetitorReceipt([newer,unrelated],source,receipt)).toEqual([newer,unrelated]);expect(applyCompetitorReceipt([source,unrelated],source,null)).toEqual([unrelated]);expect(applyCompetitorReceipt([newer],source,null)).toEqual([newer]);expect(applyCompetitorReceipt([],source,receipt)).toEqual([]);
});

it('preserves a legacy URL while updating another field but refuses unsafe new URLs before transport',async()=>{
 const source={...record(),url:'Legacy address'},receipt={...source,summary:'New summary',updated_at:'2026-10-25T09:00:01Z'};
 expect(await updateCompetitorRecord(wire([receipt]).api,scope(),source,{summary:'New summary'})).toEqual(receipt);
 const {api,transport}=wire([]);
 for(const patch of [{url:'javascript:alert(1)'},{social_links:['https://good.test','not a URL']},{source_urls:['https://user:pass@example.test']},{name:'   '}]) await expect(updateCompetitorRecord(api,scope(),record(),patch)).rejects.toThrow(/^Competition unavailable$/);
 expect(transport).not.toHaveBeenCalled();
});
it('compares arrays by their exact entries and dates by their full date value',async()=>{
 const source=record(),receipt={...source,useful_features:['Changed'],updated_at:'2026-10-25T09:00:01Z'};
 expect(await updateCompetitorRecord(wire([receipt]).api,scope(),source,{useful_features:['Changed']})).toEqual(receipt);
 for(const altered of [{...receipt,reviewed_at:'2099-01-02'},{...receipt,source_urls:['https://example.test/other']},{...receipt,useful_features:['Changed','Unexpected']}]) await expect(updateCompetitorRecord(wire([altered]).api,scope(),source,{useful_features:['Changed']})).rejects.toThrow(/^Competition unavailable$/);
 expect(applyCompetitorReceipt([{...source,reviewed_at:'2099-01-02'}],source,receipt)).toEqual([{...source,reviewed_at:'2099-01-02'}]);
});
it('retains related-project ownership for creates and changes',async()=>{
 const {api}=client(),source=await createCompetitorRecord(api,scope(),id,fields());
 await expect(updateCompetitorRecord(api,scope(),source,{project_id:foreignProject})).rejects.toThrow(/^Competition unavailable$/);
 await expect(createCompetitorRecord(api,scope(),other,{...fields(),project_id:foreignProject})).rejects.toThrow(/^Competition unavailable$/);
 expect((await db.query('select project_id from competitors')).rows).toEqual([{project_id:project}]);
});
it('deeply captures caller arrays and scope identity before a delayed response',async()=>{
 let release!:(r:Response)=>void;const {api}=wire(null,200,()=>new Promise(resolve=>{release=resolve;}));const patch={useful_features:['Captured']},captured=scope(),source=record(),pending=updateCompetitorRecord(api,captured,source,patch);
 patch.useful_features[0]='Later';source.source_urls[0]='Later source';captured.ownerId=other;
 await vi.waitFor(()=>expect(release).toBeTypeOf('function'));release(Response.json([{...record(),useful_features:['Captured'],updated_at:'2026-10-25T09:00:01Z'}]));expect((await pending).useful_features).toEqual(['Captured']);
});
