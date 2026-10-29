import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
const state=vi.hoisted(()=>({api:null as unknown as SupabaseClient,probes:[] as string[]}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>state.api}));
vi.mock('@/lib/rate-limit',()=>({rateLimit:async()=>({ok:true})}));
vi.mock('@/lib/jobs/employer-sources',()=>({EMPLOYER_BOARDS:[],fetchEmployerBoard:async()=>{throw Error('No native source admitted');}}));
vi.mock('@/lib/jobs/availability',async original=>({...await original<typeof import('@/lib/jobs/availability')>(),verifyListings:async(rows:{id:string}[])=>{const admitted=rows.slice(0,100);state.probes.push(...admitted.map(row=>row.id));return Object.fromEntries(admitted.map(row=>[row.id,'open']));}}));
import { POST } from '@/app/api/jobs/available/route';
const owner='11111111-1111-4111-8111-111111111111';
let db:PGlite,paths:string[]=[];
beforeAll(async()=>{
 db=await createMigratedDatabase({owner,instant:'2026-10-25T12:00:00Z'});
 await db.exec("insert into job_listings(source,external_id,title,url,location,role,remote,tags,description,first_seen_at) select 'remotive',n::text,'React frontend engineer '||n,'https://remotive.com/remote-jobs/synthetic/'||n,'Europe','frontend',true,array['React'],'React TypeScript',now()-n*interval '1 second' from generate_series(1,1201)n");
 await db.query("insert into job_user_state(user_id,listing_id,state) select $1,id,'deleted' from job_listings where external_id::int<=501",[owner]);
 const emulator=new SupabaseEmulator(db,'https://example.supabase.co',{service:'TEST-ONLY-service',users:{[owner]:'TEST-ONLY-owner'}},()=>new Date('2026-10-25T12:00:00Z'));
 state.api=createClient('https://example.supabase.co','TEST-ONLY-owner',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>{const request=new Request(input,init);paths.push(new URL(request.url).pathname);return emulator.fetch(request);}}});
},60000);
afterEach(()=>vi.restoreAllMocks());afterAll(async()=>{await db?.close();});
it('counts all 700 visible candidates beyond 501 newer own markers and advances only explicit hundred-page windows',async()=>{
 paths=[];state.probes=[];const auth=vi.spyOn(state.api.auth,'getUser').mockResolvedValue({data:{user:{id:owner} as User},error:null});
 const request=(checkedIds:string[]=[])=>new Request('https://own.example/api/jobs/available',{method:'POST',headers:{origin:'https://own.example','content-type':'application/json','x-own-dashboard-owner':owner},body:JSON.stringify({checkedIds})});
 const first=await POST(request());expect(first.status).toBe(200);const value=await first.json();expect(value).toMatchObject({ownerId:owner,candidates:700,remaining:600});expect(Object.keys(value.states)).toHaveLength(100);
 const second=await POST(request(Object.keys(value.states)));expect(second.status).toBe(200);expect(await second.json()).toMatchObject({ownerId:owner,candidates:700,remaining:500});expect(new Set(state.probes).size).toBe(200);expect(auth).toHaveBeenCalledTimes(2);
 expect(paths.filter(path=>path.endsWith('/rpc/read_career_records'))).toHaveLength(2);expect(paths.filter(path=>path.endsWith('/user_preferences'))).toHaveLength(2);expect(paths.some(path=>path.endsWith('/job_listings')||path.startsWith('/auth/'))).toBe(false);
});
