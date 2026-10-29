import {readFileSync} from 'node:fs';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,expect,it} from 'vitest';
import {applyCareerTriage,type CareerTriageIntent} from '@/lib/career-triage';
import {databaseVersion} from '@/lib/database-version';
import {readCareerRecords} from '@/lib/career-records';
import {createMigratedDatabase} from '../helpers/supabase-pglite';
import {SupabaseEmulator} from '../helpers/supabase-emulator';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',instant='2026-10-26T12:00:00Z',migration='20261026001926_captured_career_triage.sql';
let db:PGlite,client:SupabaseClient,calls:number;
const scope=()=>({ownerId:owner,signal:new AbortController().signal});
beforeAll(async()=>{db=await createMigratedDatabase({owner,instant});await db.query('insert into auth.users(id) values($1)',[other]);const emulator=new SupabaseEmulator(db,'https://example.supabase.co',{service:'TEST-ONLY-service',users:{[owner]:'TEST-ONLY-owner'}},()=>new Date(instant));client=createClient('https://example.supabase.co','TEST-ONLY-owner',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>{calls++;return emulator.fetch(input,init);}}});},60_000);
beforeEach(async()=>{calls=0;await db.exec('truncate job_user_state,job_listings cascade');});
afterAll(async()=>{await db?.close();});
async function intent(next:CareerTriageIntent['next']='shortlisted'):Promise<CareerTriageIntent>{const source=(await db.query<{id:string,url:string,last_seen_at:string}>("insert into job_listings(source,external_id,title,url,role,last_seen_at) values('remotive',$1,'Synthetic React role',$2,'frontend',$3) returning id,url,to_jsonb(last_seen_at)#>>'{}' last_seen_at",[crypto.randomUUID(),`https://remotive.com/remote-jobs/${crypto.randomUUID()}`,instant])).rows[0];return{id:crypto.randomUUID(),listing:source,next,existing:null};}
it('creates once, retains matching desired state/version on retry and clears only the captured shortlist',async()=>{
 const change=await intent(),created=await applyCareerTriage(client,scope(),[change]);expect(created.changes[0].row).toMatchObject({id:change.id,user_id:owner,listing_id:change.listing.id,state:'shortlisted'});expect(databaseVersion(created.changes[0].row!.updated_at!)).toBe(databaseVersion(instant));
 const repeat=await applyCareerTriage(client,scope(),[change]);expect(repeat).toEqual(created);
 const clear={...change,id:crypto.randomUUID(),next:null,existing:created.changes[0].row};expect((await applyCareerTriage(client,scope(),[clear])).changes[0].row).toBeNull();expect((await applyCareerTriage(client,scope(),[clear])).changes[0].row).toBeNull();expect(calls).toBe(4);
});
it('retains a newer same-state version and a recreated shortlist against an old clear',async()=>{
 const change=await intent(),old=(await applyCareerTriage(client,scope(),[change])).changes[0].row!;
 await db.query("update job_user_state set state='shortlisted' where id=$1",[old.id]);
 await expect(applyCareerTriage(client,scope(),[{...change,next:null,existing:old}])).rejects.toMatchObject({reason:'changed'});
 await db.query('delete from job_user_state where id=$1',[old.id]);
 const newer=(await applyCareerTriage(client,scope(),[{...change,id:crypto.randomUUID()}])).changes[0].row!;expect(newer.id).not.toBe(old.id);
 await expect(applyCareerTriage(client,scope(),[{...change,next:null,existing:old}])).rejects.toMatchObject({reason:'changed'});expect((await db.query('select id from job_user_state')).rows).toEqual([{id:newer.id}]);
});
it('makes a captured delete permanent and retries it without altering its version',async()=>{
 const change=await intent(),old=(await applyCareerTriage(client,scope(),[change])).changes[0].row!;
 const deletion={...change,next:'deleted' as const,existing:old};const first=await applyCareerTriage(client,scope(),[deletion]);expect(first.changes[0].row?.updated_at).not.toBe(old.updated_at);
 expect(await applyCareerTriage(client,scope(),[deletion])).toEqual(first);
 await expect(applyCareerTriage(client,scope(),[{...change,next:null,existing:old}])).rejects.toMatchObject({reason:'changed'});
 const current=(await readCareerRecords(client,'job_user_state',scope())).data;expect(current).toHaveLength(1);expect(current[0].state).toBe('deleted');
 expect((await readCareerRecords(client,'job_listings',scope())).data).toHaveLength(0);
});
it('rolls an entire mixed batch back when a later source version has changed',async()=>{
 const one=await intent('deleted'),two=await intent('deleted');const ordered=[one,two].sort((a,b)=>a.listing.id.localeCompare(b.listing.id));
 await db.query("update job_listings set last_seen_at=last_seen_at+interval '1 microsecond' where id=$1",[ordered[1].listing.id]);
 await expect(applyCareerTriage(client,scope(),ordered)).rejects.toMatchObject({reason:'changed'});expect((await db.query('select id from job_user_state')).rows).toHaveLength(0);
});
it('never overwrites a newer shortlist when a stale empty-cache delete expected no row',async()=>{
 const change=await intent();await applyCareerTriage(client,scope(),[change]);await expect(applyCareerTriage(client,scope(),[{...change,next:'deleted',existing:null}])).rejects.toMatchObject({reason:'changed'});
 expect((await db.query('select state from job_user_state')).rows).toEqual([{state:'shortlisted'}]);
});
it('admits original ownership before an empty read and isolates foreign markers',async()=>{
 const change=await intent();await db.query("insert into job_user_state(user_id,listing_id,state) values($1,$2,'deleted')",[other,change.listing.id]);
 await expect(applyCareerTriage(client,{...scope(),ownerId:other},[change])).rejects.toThrow('Career triage unconfirmed');
 expect((await applyCareerTriage(client,scope(),[change])).changes[0].row?.user_id).toBe(owner);
});
it('keeps exact invoker grants and hides future columns',async()=>{
 await db.exec("alter table job_user_state add column future_private_field text default 'TEST-ONLY future field'");try{const result=await applyCareerTriage(client,scope(),[await intent()]);expect(result.changes[0].row).not.toHaveProperty('future_private_field');}finally{await db.exec('alter table job_user_state drop column future_private_field');}
 expect((await db.query("select prosecdef,proconfig,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') authenticated,has_function_privilege('service_role',oid,'execute') service from pg_proc where oid='public.apply_career_triage(uuid,jsonb)'::regprocedure")).rows).toEqual([{prosecdef:false,proconfig:['search_path=""','lock_timeout=5s'],anon:false,authenticated:true,service:false}]);
 for(const name of ['career_private_version_touch','career_triage_permanent_intent'])expect((await db.query("select has_function_privilege('authenticated',oid,'execute') allowed from pg_proc where oid=($1||'()')::regprocedure",[`public.${name}`])).rows).toEqual([{allowed:false}]);
});
it.each(['upgrade','rollback','invalid-existing'] as const)('keeps existing private intent untouched during %s',async mode=>{
 const before=await createMigratedDatabase({owner,instant,beforeMigration:migration});try{
  const source=(await before.query<{id:string}>("insert into job_listings(source,external_id,title,url,role) values('remotive','legacy-triage','Synthetic legacy role','https://remotive.com/remote-jobs/legacy-triage','frontend') returning id")).rows[0];
  await before.query("insert into job_user_state(user_id,listing_id,state,created_at) values($1,$2,'deleted',$3)",[owner,source.id,mode==='invalid-existing'?'infinity':instant]);
  const snapshot=async()=>(await before.query("select to_jsonb(s)-'updated_at' row from job_user_state s order by id")).rows,original=await snapshot(),sql=readFileSync(`supabase/migrations/${migration}`,'utf8');
  if(mode==='upgrade')await before.exec(sql);else await expect(before.transaction(async tx=>{await tx.exec(sql);if(mode==='rollback')throw Error('synthetic rollback');})).rejects.toThrow();
  expect(await snapshot()).toEqual(original);expect((await before.query<{found:boolean}>("select to_regprocedure('public.apply_career_triage(uuid,jsonb)') is not null found")).rows[0].found).toBe(mode==='upgrade');
  if(mode==='upgrade'){expect((await before.query('select updated_at from job_user_state')).rows).toEqual([{updated_at:null}]);await before.query("update job_user_state set state='deleted' where user_id=$1",[owner]);expect(databaseVersion((await before.query<{stamp:string}>('select to_jsonb(updated_at) stamp from job_user_state')).rows[0].stamp)).toBe(databaseVersion(instant));}
 }finally{await before.close();}
},60_000);

it('handles the full 1,000-change bound atomically in one captured SDK request',async()=>{
 const sources=(await db.query<{id:string,url:string,last_seen_at:string}>("insert into job_listings(source,external_id,title,url,role,last_seen_at) select 'remotive',n::text,'Synthetic bulk React role','https://remotive.com/remote-jobs/bulk-'||n,'frontend',$1 from generate_series(1,1000)n returning id,url,to_jsonb(last_seen_at)#>>'{}' last_seen_at",[instant])).rows;
 const changes:CareerTriageIntent[]=sources.map(listing=>({id:crypto.randomUUID(),listing,next:'deleted',existing:null}));const result=await applyCareerTriage(client,scope(),changes);
 expect(result.changes).toHaveLength(1000);expect(new Set(result.changes.map(change=>change.listingId)).size).toBe(1000);expect(result.changes.every(change=>change.row?.state==='deleted'&&change.row.user_id===owner)).toBe(true);expect(calls).toBe(1);
 expect((await db.query<{count:number}>("select count(*)::int count from job_user_state where user_id=$1 and state='deleted'",[owner])).rows[0].count).toBe(1000);
},30_000);
