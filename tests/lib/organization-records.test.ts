import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import { readOrganizationRecords } from '@/lib/organization-records';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',stamp='2026-10-25T09:00:00Z';
let db:PGlite;
const scope=()=>({ownerId:owner,signal:new AbortController().signal});
const record=()=>({id,user_id:owner,name:'Synthetic organization',type:'client',website:null,logo_url:null,email:null,phone:null,address:null,city:null,zip:null,country:null,company_id:null,vat_id:null,notes:'Synthetic note',status:'active',ares_verified_at:null,vat_verification_status:'unchecked',vat_verified_at:null,vat_verified_id:null,vat_verified_name:null,vat_verified_address:null,created_at:stamp,updated_at:stamp});
function client(actor=owner) {
 const emulator=new SupabaseEmulator(db,'https://offline.supabase.test',{service:'TEST-ONLY-service',users:{[owner]:'TEST-ONLY-owner',[other]:'TEST-ONLY-other'}},()=>new Date(stamp));
 const api=createClient('https://offline.supabase.test','TEST-ONLY-public',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:`Bearer ${actor===owner?'TEST-ONLY-owner':'TEST-ONLY-other'}`},fetch:(input,init)=>emulator.fetch(new Request(input,init))}});return{api,emulator};
}
function wire(value:unknown,status=200,fetcher?:typeof fetch){const transport=fetcher??vi.fn(async()=>Response.json(value,{status}));return{api:createClient('https://example.supabase.co','TEST-ONLY-public',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:transport}}),transport};}
beforeAll(async()=>{db=await createMigratedDatabase({owner,instant:stamp});await db.query('insert into auth.users(id) values($1)',[other]);},120000);
beforeEach(async()=>{await db.exec('reset role; delete from organizations');});
afterEach(()=>vi.restoreAllMocks());afterAll(async()=>db?.close());
it('reads a complete owned list beyond the REST cap in one real SDK/RLS request',async()=>{
 await db.query("insert into organizations(user_id,name) select $1,'Fixture '||n from generate_series(1,1201)n",[owner]);await db.query("insert into organizations(user_id,name) values($1,'Foreign')",[other]);
 const{api,emulator}=client(),result=await readOrganizationRecords(api,scope());expect(result.data).toHaveLength(1201);expect(result.data.every(row=>row.user_id===owner)).toBe(true);expect(new Set(result.data.map(row=>row.id)).size).toBe(1201);expect(emulator.requests).toHaveLength(1);expect(emulator.requests[0].path).toContain('/rpc/read_owned_collection');
});
it('does not commit another authenticated role response under the captured owner',async()=>{
 await db.query("insert into organizations(user_id,name) values($1,'Foreign')",[other]);const{api}=client(other);await expect(readOrganizationRecords(api,scope())).rejects.toThrow(/^Organization unavailable$/);
});
it('preserves a confirmed empty owned collection',async()=>{expect(await readOrganizationRecords(client().api,scope())).toEqual({data:[],error:null});});
it.each([null,{},[null],[{...record(),name:123}],[{...record(),vat_verification_status:'unknown'}],[{...record(),updated_at:'infinity'}],[{...record(),extra:'PRIVATE TEST metadata'}],[record(),record()]])('refuses malformed, duplicate or expanded responses without private diagnostic text',async data=>{
 await expect(readOrganizationRecords(wire(data).api,scope())).rejects.toThrow(/^Organization unavailable$/);
});
it('enforces the organization row contract even if a provider violates the SQL bound',async()=>{
 const rows=Array.from({length:10001},(_,n)=>({...record(),id:`${n.toString(16).padStart(8,'0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`}));await expect(readOrganizationRecords(wire(rows).api,scope())).rejects.toThrow(/^Organization unavailable$/);
});
it('does not retry database failures or expose their raw text',async()=>{
 const{api,transport}=wire({message:'PRIVATE TEST database detail'},503);await expect(readOrganizationRecords(api,scope())).rejects.toThrow(/^Organization unavailable$/);expect(transport).toHaveBeenCalledOnce();
});
it('ends an uncooperative read at its one complete-read deadline',async()=>{
 const stop=new AbortController();vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>ms===15000?stop.signal:new AbortController().signal);const transport=vi.fn<typeof fetch>(()=>new Promise(()=>{})),{api}=wire(null,200,transport);
 const pending=readOrganizationRecords(api,scope()),failed=expect(pending).rejects.toThrow(/^Organization unavailable$/);await vi.waitFor(()=>expect(transport).toHaveBeenCalledOnce());stop.abort('PRIVATE TEST reason');await failed;
});
it('does not request rows after owner disposal or malformed captured identity',async()=>{
 const{api,transport}=wire([]),stop=new AbortController();stop.abort();await expect(readOrganizationRecords(api,{ownerId:owner,signal:stop.signal})).rejects.toMatchObject({name:'AbortError'});await expect(readOrganizationRecords(api,{...scope(),ownerId:'invalid'})).rejects.toThrow(/^Organization unavailable$/);expect(transport).not.toHaveBeenCalled();
});
it('refuses an empty collection from a different authenticated owner',async()=>{await expect(readOrganizationRecords(client(other).api,scope())).rejects.toThrow(/^Organization unavailable$/);});
it('requires the captured actor before every scoped result while preserving legacy calls',async()=>{
 const{api}=client();for(const identity of [null,other]){const result=await api.rpc('read_owned_collection',{p_entity:'organizations',p_expected_owner:identity}).retry(false);expect(result.data).toBeNull();expect(result.error?.code).toBe('42501');}
 expect((await api.rpc('read_owned_collection',{p_entity:'organizations'}).retry(false)).data).toEqual([]);
 const row=(await db.query("select prosecdef,proconfig,has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('service_role',oid,'execute') as service,has_function_privilege('authenticated',oid,'execute') as authenticated from pg_proc where oid='public.read_owned_collection(text,uuid)'::regprocedure")).rows[0];
 expect(row).toEqual({prosecdef:false,proconfig:['search_path=""'],anon:false,service:false,authenticated:true});
});
