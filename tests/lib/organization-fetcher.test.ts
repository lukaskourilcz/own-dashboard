import { afterEach, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
const m=vi.hoisted(()=>({api:null as unknown as SupabaseClient}));
vi.mock('@/lib/supabase/client',()=>({createClient:()=>m.api}));
import { fetchOrganizations } from '@/lib/queries/fetchers';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',stamp='2026-10-25T09:00:00Z';
const scope=()=>({ownerId:owner,signal:new AbortController().signal});
function row(n:number,identity=owner){return{id:`${n.toString(16).padStart(8,'0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,user_id:identity,name:'Synthetic organization',type:'client',website:null,logo_url:null,email:null,phone:null,address:null,city:null,zip:null,country:null,company_id:null,vat_id:null,notes:'',status:'active',ares_verified_at:null,vat_verification_status:'unchecked',vat_verified_at:null,vat_verified_id:null,vat_verified_name:null,vat_verified_address:null,created_at:stamp,updated_at:stamp};}
function backend(data:unknown,status=200){const fetcher=vi.fn<typeof fetch>(async input=>{const isRpc=String(input).includes('/rpc/');return Response.json(Array.isArray(data)&&!isRpc?data.slice(0,1000):data,{status});});m.api=createClient('https://example.supabase.co','TEST-ONLY-public',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:fetcher}});return fetcher;}
afterEach(()=>vi.restoreAllMocks());
it('keeps every owned organization beyond a REST-capped page',async()=>{const transport=backend(Array.from({length:1201},(_,n)=>row(n)));expect(await fetchOrganizations(scope())).toHaveLength(1201);expect(transport).toHaveBeenCalledOnce();});
it('refuses a changed authenticated owner instead of filling the previous owner cache',async()=>{backend([row(1,other)]);await expect(fetchOrganizations(scope())).rejects.toThrow(/^Organization unavailable$/);});
it('does not present malformed successful data as a confirmed empty collection',async()=>{backend(null);await expect(fetchOrganizations(scope())).rejects.toThrow(/^Organization unavailable$/);});
it('does not expose database diagnostics through the destination fetcher',async()=>{backend({message:'PRIVATE TEST transport detail'},503);await expect(fetchOrganizations(scope())).rejects.toThrow(/^Organization unavailable$/);});
