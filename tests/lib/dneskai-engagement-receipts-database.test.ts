import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const until = '2026-10-23T10:00:00Z', since = '2026-10-16T10:00:00Z';
let db: PGlite;
type Receipt = { publicationId: string; keywordMatches: number; privateSent: number; failedCount: number; failures: Array<{ code: string; count: number }> };
type Result = { receipts: Receipt[]; summary: { posts: number; commentsSeen: number; keywordMatches: number; privateSent: number; publicSent: number; failed: number } };
async function read(asOwner: string, ids: string[] = [id(101),id(103),id(104)], from=since) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[asOwner]); await db.exec('set role authenticated');
  try { return (await db.query<{ result: Result }>('select public.marketing_dneskai_engagement_receipts($1::uuid[],$2::timestamptz,$3::timestamptz) as result',[ids,from,until])).rows[0]!.result; }
  finally { await db.exec('reset role'); }
}
beforeAll(async () => {
  db = await createMigratedDatabase({ owner, instant: until });
  await db.query('insert into auth.users(id,email) values($1,$2)',[other,'other@example.test']);
  for(let n=1;n<=6;n++) {
    const user=n===4?other:owner, brand=n===5?'devshark':'dneskai';
    const revision={ brand, ...(n===6?{}:{ engagement: { keyword:'SKILL',replyMessage:'Synthetic reply.' } }) };
    await db.query("insert into public.marketing_revisions(id,user_id,brand,revision,content_hash,ready,status) values($1,$2,$3,$4,$5,true,'published')",[id(n),user,brand,JSON.stringify(revision),'a'.repeat(64)]);
    await db.query("insert into public.marketing_publications(id,user_id,revision_id,platform,status,scheduled_at) values($1,$2,$3,'instagram','published',$4)",[id(100+n),user,id(n),n===2||n===3?'2026-10-01T10:00:00Z':'2026-10-21T10:00:00Z']);
  }
  // Actual publication time, not the original planned slot, puts this off-page post in the seven-day summary.
  await db.query("insert into public.marketing_events(user_id,revision_id,kind,created_at) values($1,$2,'published','2026-10-22T10:00:00Z')",[owner,id(2)]);
  await db.query(`insert into public.marketing_instagram_comment_replies(user_id,publication_id,media_id,comment_id,matched_keyword,status,private_sent_at,public_status,error_code)
    select $1,$2,'1',(100000+n)::text,'SKILL',case when n<=5001 then 'sent' else 'failed' end,
    case when n<=5001 then $3::timestamptz end,case when n<=5001 then 'sent' else 'failed' end,
    case when n>5001 then 'failure-'||(n-5001)::text end from generate_series(1,5013) n`,[owner,id(101),until]);
  for(const n of [2,3,4,5,6]) await db.query("insert into public.marketing_instagram_comment_replies(user_id,publication_id,media_id,comment_id,matched_keyword,status,private_sent_at) values($1,$2,'1',$3,'SKILL','sent',$4)",[n===4?other:owner,id(100+n),String(200000+n),until]);
  await db.query("insert into public.marketing_instagram_comment_checks(publication_id,user_id,media_id,comments_seen,pass_seen) values($1,$2,'1',10000,10001)",[id(101),owner]);
},120000);
afterAll(async () => { await db?.close(); });
describe('complete owner-scoped engagement receipts on all migrations', () => {
  it('counts beyond 5000, keeps the full failed count and includes recent posts outside the selected page', async () => {
    const result=await read(owner);
    expect(result.summary).toEqual({ posts:2,commentsSeen:10001,keywordMatches:5014,privateSent:5002,publicSent:5001,failed:12 });
    expect(result.receipts.map(r=>r.publicationId)).toEqual([id(101),id(103)]);
    expect(result.receipts[0]).toMatchObject({ keywordMatches:5013,privateSent:5001,failedCount:12 });
    expect(result.receipts[0]!.failures).toHaveLength(10);
    expect(result.receipts[0]!.failures.reduce((sum,r)=>sum+r.count,0)).toBe(10);
    expect(result.receipts[1]!.keywordMatches).toBe(1);
  });
  it('returns the complete seven-day summary even when no selected post needs a receipt', async () => {
    const result=await read(owner,[]); expect(result.receipts).toEqual([]); expect(result.summary.keywordMatches).toBe(5014);
  });
  it('enforces owner RLS and excludes other brands and posts without a keyword', async () => {
    const result=await read(other); expect(result.receipts.map(r=>r.publicationId)).toEqual([id(104)]); expect(result.summary.posts).toBe(1); expect(result.summary.keywordMatches).toBe(1);
    expect((await read(owner,[id(105),id(106)])).receipts).toEqual([]);
  });
  it('uses invoker security and grants no anonymous/service-role execution', async () => {
    const result=await db.query<{ prosecdef:boolean; anon:boolean; service:boolean; owner:boolean }>(`select p.prosecdef,
      has_function_privilege('anon',p.oid,'execute') as anon,has_function_privilege('service_role',p.oid,'execute') as service,
      has_function_privilege('authenticated',p.oid,'execute') as owner from pg_proc p where p.proname='marketing_dneskai_engagement_receipts'`);
    expect(result.rows).toEqual([{ prosecdef:false,anon:false,service:false,owner:true }]);
  });
  it('rejects oversized selections and windows longer than seven days', async () => {
    await expect(read(owner,Array.from({length:61},()=>id(101)))).rejects.toThrow('invalid receipt window');
    await expect(read(owner,[],'2026-10-01T00:00:00Z')).rejects.toThrow('invalid receipt window');
  });
});
