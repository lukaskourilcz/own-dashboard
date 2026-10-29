import {readFileSync,writeFileSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import type {PGlite} from '@electric-sql/pglite';
import {beforeAll,beforeEach,afterAll,afterEach,describe,expect,it,vi} from 'vitest';
import {createMigratedDatabase} from '../helpers/supabase-pglite';
import {SupabaseEmulator} from '../helpers/supabase-emulator';
import {deckRevision} from './marketing-dneskai-revision-fixture';
import {readDneskaiCalendar,readDneskaiWorkspace} from '@/lib/marketing/dneskai-workspace-read';
import type {DneskaiReadDatabase} from '@/lib/marketing/dneskai-read-database.generated';
vi.mock('server-only',()=>({}));
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',project='33333333-3333-4333-8333-333333333333',foreign='44444444-4444-4444-8444-444444444444';
const now=new Date('2026-10-28T10:00:00Z'),date='2026-10-28',future='2026-10-29T07:00:00Z';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db:PGlite;let transaction=true;
const receipt=async(sub=owner,target=project,role='authenticated',from=date)=>{
 await db.exec('savepoint calendar_read');
 try{await db.query("select set_config('request.jwt.claim.sub',$1,false)",[sub]);await db.exec('set role '+role);const result=await db.query<{value:unknown}>('select public.read_owned_dneskai_calendar($1,$2,$3::date,$4::timestamptz,false) as value',[sub,target,from,now.toISOString()]);await db.exec('reset role; release savepoint calendar_read');return result.rows[0]!.value;}
 catch(error){await db.exec('rollback to savepoint calendar_read; reset role; release savepoint calendar_read');throw error;}
};
beforeAll(async()=>{
 db=await createMigratedDatabase({owner,instant:now.toISOString()});await db.query('insert into auth.users(id,email) values($1,$2)',[other,'other@example.test']);
 await db.query("insert into projects(id,user_id,name,slug,portfolio_key) values($1,$2,'Calendar','calendar','aifirst'),($3,$4,'Foreign','foreign','aifirst')",[project,owner,foreign,other]);
 const revision={...deckRevision(),scheduledAt:future,title:'Old creation, future plan'};
 await db.query("insert into marketing_revisions(id,user_id,brand,content_hash,revision,status,ready,approved_at,approved_hash,created_at) values($1,$2,'dneskai',repeat('a',64),$3,'approved',true,'2026-10-28T10:00:00Z',repeat('a',64),'2026-01-01T00:00:00Z')",[id(1),owner,JSON.stringify(revision)]);
 await db.query(`insert into marketing_revisions(id,user_id,brand,content_hash,revision,status,ready,created_at)
 select ('00000000-0000-4000-8000-'||lpad((100+n)::text,12,'0'))::uuid,$1,'dneskai',repeat('b',64),$2::jsonb,'published',true,$3::timestamptz from generate_series(1,160) n`,[owner,JSON.stringify({...revision,scheduledAt:'2026-10-27T07:00:00Z',title:'Recent history'}),now.toISOString()]);
 await db.query("insert into marketing_jobs(id,user_id,idempotency_key,request_hash,request,status,created_at) values($1,$2,$1,repeat('c',64),$3,'queued','2026-01-01T00:00:00Z')",[id(6),owner,JSON.stringify({generation:{source:{brand:'dneskai',content:{title:'Old queued job'}},scheduledAt:future}})]);
 await db.query("insert into marketing_dneskai_runs(id,user_id,project_id,date,target_date,status) values($1,$2,$3,'2026-10-28','2026-10-29','complete')",[id(9),owner,project]);
 await db.query("insert into marketing_dneskai_briefs(id,user_id,project_id,run_id,event_id,target_date,rank,category,member_ids,lead_candidate_id,member_hash,status,brief,scheduled_at) values($1,$2,$3,$4,repeat('f',64),'2026-10-29',1,'ai-news',array['TEST_ONLY_CANDIDATE'],'TEST_ONLY_CANDIDATE',repeat('e',64),'pending',$5,$6)",[id(10),owner,project,id(9),JSON.stringify({title:'Future waiting topic'}),future]);
},120000);
afterEach(async()=>{if(transaction)await db.exec('rollback');vi.restoreAllMocks();});
// Each case has an independent synthetic transaction; no managed database is used.
beforeEach(async()=>{transaction=true;await db.exec('begin');});
afterAll(async()=>{await db?.close();});
describe('complete Calendar snapshot',()=>{
 it('includes older-created future plans beyond the newest 150 history rows',async()=>{const value=await receipt() as {revisionCount:number;revisions:Array<{id:string}>};expect(value.revisionCount).toBe(1);expect(value.revisions.map(row=>row.id)).toEqual([id(1)]);});
 it('adopts the complete envelope through the actual SDK and its original owner',async()=>{
  await db.exec('rollback');transaction=false;
  const emulator=new SupabaseEmulator(db,'https://offline.supabase.test',{service:'TEST-ONLY-SERVICE',users:{[owner]:'TEST-ONLY-CALENDAR'}},()=>now);
  let wireBytes=0;
  const client=createClient<DneskaiReadDatabase>('https://offline.supabase.test','TEST-ONLY-PUBLIC',{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:'Bearer TEST-ONLY-CALENDAR'},fetch:async(input,init)=>{const response=await emulator.fetch(new Request(input,init));wireBytes+=Buffer.byteLength(await response.clone().text());return response;}}});
  const old=await readDneskaiWorkspace(client,owner,now);const oldRequests=emulator.requests.length,oldWireBytes=wireBytes;
  const read=await readDneskaiCalendar(client,owner,project,now);expect(emulator.requests.length-oldRequests).toBe(1);expect(old.posts.map(post=>post.id)).not.toContain(id(1));expect(old.jobs.map(job=>job.id)).not.toContain(id(6));expect(read.jobs.map(job=>job.id)).toEqual([id(6)]);expect(read.waiting?.map(brief=>brief.briefId)).toEqual([id(10)]);expect(Buffer.byteLength(JSON.stringify(read))).toBeLessThan(Buffer.byteLength(JSON.stringify(old)));expect(read.calendarComplete).toBe(true);expect(read.posts.map(post=>post.id)).toEqual([id(1)]);expect(read.posts[0]!.title).toBe('Old creation, future plan');
  if(process.env.AUDIT_CALENDAR_CAPTURE)writeFileSync(process.env.AUDIT_CALENDAR_CAPTURE,JSON.stringify({fixture:'One old future plan, one old future queued job, 160 newer past posts; cold synthetic SDK/database reads. New window corrects omitted future records; this is not equal-output or production timing/billing evidence.',old:{requests:oldRequests,databaseResponseBytes:oldWireBytes,browserJsonBytes:Buffer.byteLength(JSON.stringify(old)),posts:old.posts.length,jobs:old.jobs.length},calendar:{requests:emulator.requests.length-oldRequests,databaseResponseBytes:wireBytes-oldWireBytes,browserJsonBytes:Buffer.byteLength(JSON.stringify(read)),posts:read.posts.length,jobs:read.jobs.length}},null,2)+'\n');
 });
 it('refuses a foreign project and anonymous/service execution',async()=>{await expect(receipt(owner,foreign)).rejects.toThrow();await expect(receipt(owner,project,'anon')).rejects.toThrow();await expect(receipt(owner,project,'service_role')).rejects.toThrow();});
});

it('includes a queued job created before the old three-day read window',async()=>{
 const value=await receipt() as {jobCount:number;jobs:Array<{id:string}>};expect(value.jobCount).toBe(1);expect(value.jobs.map(row=>row.id)).toEqual([id(6)]);
});
it('uses the matching active publication time and ignores a cancelled publication',async()=>{
 await db.query("insert into marketing_publications(id,user_id,revision_id,platform,status,scheduled_at) values($1,$2,$3,'instagram','queued','2026-11-20T07:00:00Z')",[id(7),owner,id(1)]);
 expect((await receipt() as {revisionCount:number}).revisionCount).toBe(0);
 await db.query("update marketing_publications set status='cancelled' where id=$1",[id(7)]);
 expect((await receipt() as {revisionCount:number}).revisionCount).toBe(1);
});
it('counts unknown dates without guessing a slot from PostgreSQL relative date syntax',async()=>{
 await db.query("update marketing_jobs set request=jsonb_set(request,'{generation,scheduledAt}','\"now\"'::jsonb) where id=$1",[id(6)]);
 const value=await receipt() as {unreadable:number;jobCount:number};expect(value.unreadable).toBe(1);expect(value.jobCount).toBe(0);
});
it('isolates a second owner even when their future plans share the window',async()=>{
 await db.query("insert into marketing_revisions(id,user_id,brand,content_hash,revision,status,ready) values($1,$2,'dneskai',repeat('d',64),$3,'review',true)",[id(8),other,JSON.stringify({...deckRevision(),scheduledAt:future})]);
 const value=await receipt() as {revisionCount:number;revisions:Array<{id:string}>};expect(value.revisionCount).toBe(1);expect(value.revisions.map(row=>row.id)).toEqual([id(1)]);
});
it('refuses a complete window beyond its finite record allowance',async()=>{
 await db.query(`insert into marketing_revisions(id,user_id,brand,content_hash,revision,status,ready)
 select ('00000000-0000-4000-8000-'||lpad((1000+n)::text,12,'0'))::uuid,$1,'dneskai',repeat('e',64),$2::jsonb,'review',true from generate_series(1,250) n`,[owner,JSON.stringify({...deckRevision(),scheduledAt:future})]);
 await expect(receipt()).rejects.toThrow('Calendar unavailable');
});
for(const kind of ['owner','project','date','clock','count','null','duplicate']as const)it(`refuses a contradictory ${kind} envelope through the actual SDK`,async()=>{
 const value=await receipt() as {ownerId:string;projectId:string;date:string;asOf:string;revisionCount:number;revisions:unknown[]|null};
 if(kind==='owner')value.ownerId=other;if(kind==='project')value.projectId=foreign;if(kind==='date')value.date='2026-10-29';if(kind==='clock')value.asOf='2026-10-28T10:00:01Z';if(kind==='count')value.revisionCount=0;if(kind==='null')value.revisions=null;if(kind==='duplicate'){value.revisions!.push(value.revisions![0]);value.revisionCount++;}
 const client=createClient<DneskaiReadDatabase>('https://offline.supabase.test','TEST-ONLY-PUBLIC',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async()=>Response.json(value)}});
 await expect(readDneskaiCalendar(client,owner,project,now)).rejects.toThrow('dneskai-workspace-unavailable');
});
it('keeps unreadable dated records from proving empty slots',async()=>{
 await db.query("update marketing_revisions set revision=$1 where id=$2",[JSON.stringify({brand:'dneskai',scheduledAt:future,schemaVersion:'TEST_ONLY_BROKEN'}),id(1)]);
 const value=await receipt();const client=createClient<DneskaiReadDatabase>('https://offline.supabase.test','TEST-ONLY-PUBLIC',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async()=>Response.json(value)}});
 const read=await readDneskaiCalendar(client,owner,project,now);expect(read.calendarComplete).toBe(false);expect(read.unreadable).toBe(1);expect(read.posts).toEqual([]);
});

it('uses seven local Prague dates across the autumn clock change with an exclusive end',async()=>{
 await db.query("update marketing_revisions set revision=jsonb_set(revision,'{scheduledAt}',to_jsonb($1::text)) where id=$2",['2026-10-24T22:00:00Z',id(1)]);
 expect((await receipt(owner,project,'authenticated','2026-10-25') as {revisions:Array<{id:string}>}).revisions.map(row=>row.id)).toContain(id(1));
 await db.query("update marketing_revisions set revision=jsonb_set(revision,'{scheduledAt}',to_jsonb($1::text)) where id=$2",['2026-10-31T23:00:00Z',id(1)]);
 expect((await receipt(owner,project,'authenticated','2026-10-25') as {revisions:Array<{id:string}>}).revisions.map(row=>row.id)).not.toContain(id(1));
});
it('refuses an excessive snapshot body before it reaches a client',async()=>{
 await db.query("update marketing_revisions set render_report=jsonb_build_object('TEST_ONLY',repeat('x',8388608)) where id=$1",[id(1)]);
 await expect(receipt()).rejects.toThrow('Calendar unavailable');
});
it('rolls back only the function and restores it without changing records or table permissions',async()=>{
 const before=await receipt();
 const privileges=await db.query("select has_table_privilege('authenticated','public.marketing_account_tokens','select') as token_read,has_table_privilege('authenticated','public.marketing_revisions','select') as revisions_read");
 await db.exec('drop function public.read_owned_dneskai_calendar(uuid,uuid,date,timestamptz,boolean)');await expect(receipt()).rejects.toThrow();
 await db.exec(readFileSync('supabase/migrations/20261028154447_complete_dneskai_calendar.sql','utf8'));
 expect(await receipt()).toEqual(before);expect((await db.query("select has_table_privilege('authenticated','public.marketing_account_tokens','select') as token_read,has_table_privilege('authenticated','public.marketing_revisions','select') as revisions_read")).rows).toEqual(privileges.rows);
});
it('refuses a cancelled or unavailable SDK read without automatic replay',async()=>{
 const fetcher=vi.fn<typeof fetch>(async()=>Response.json({message:'PRIVATE_TEST_ONLY_DETAIL'},{status:503,headers:{'Retry-After':'0'}}));
 const client=createClient<DneskaiReadDatabase>('https://offline.supabase.test','TEST-ONLY-PUBLIC',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:fetcher}});
 const controller=new AbortController();controller.abort();await expect(readDneskaiCalendar(client,owner,project,now,undefined,{signal:controller.signal})).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
 await expect(readDneskaiCalendar(client,owner,project,now)).rejects.toThrow('dneskai-workspace-unavailable');expect(fetcher).toHaveBeenCalledOnce();
});
