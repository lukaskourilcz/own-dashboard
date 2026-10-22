import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

const owner = '11111111-1111-4111-8111-111111111111';
const other = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let db: PGlite; let next = 0;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const migration = readFileSync('supabase/migrations/20261013193132_marketing_story_receipts.sql', 'utf8');
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema auth; create role anon; create role authenticated; create role service_role bypassrls;
    create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table projects(id uuid primary key,user_id uuid); create table ai_links(id uuid primary key,user_id uuid);
    alter default privileges in schema public grant execute on functions to anon,authenticated;`);
  await db.query('insert into auth.users values($1),($2)', [owner, other]);
  for (const file of ['20261013193104_marketing_control_surface.sql', '20261013193105_marketing_durable_jobs.sql']) await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  await db.exec(migration); await db.exec(migration);
}, 30000);
afterAll(async () => { await db?.close(); });
async function prepared(format = 'story', platform = 'instagram', assetPatch = {}) {
  const id = uuid(++next); const publication = uuid(1000 + next);
  // Synthetic privileged SQL fixture, not live approval or actual Meta evidence.
  const revision = { format, account: { id: '101', handle: 'offline_qa', platform }, assets: [{ mimeType: 'image/jpeg', width: 1080, height: format === 'story' ? 1920 : 1350, ...assetPatch }] };
  await db.query(`insert into marketing_revisions(id,user_id,brand,revision,content_hash,approved_hash,status,ready,approved_at) values($1,$2,'devshark',$3,repeat('a',64),repeat('a',64),'approved',true,now())`, [id, owner, JSON.stringify(revision)]);
  await db.query(`insert into marketing_publications(id,user_id,revision_id,platform,scheduled_at,status,remote_container_id,error_code) values($1,$2,$3,$4,now(),'claimed','201','publish-intent')`, [publication, owner, id, platform]);
  return { id, publication };
}
const finish = (publication: string, media = '301', url: string | null = null, caller = owner, expected = 'publish-intent') => db.query(`select marketing_finish_publication($1,$2,'201',$3,'published','201',$4,$5,null) as status`, [caller, publication, expected, media, url]);

describe('actual SQL Story-only nullable receipt URL', () => {
  it('commits a numeric Story acknowledgement, revision and one event atomically, idempotently', async () => {
    const { id, publication } = await prepared();
    expect((await finish(publication)).rows[0]).toEqual({ status: 'published' });
    expect((await db.query('select status,remote_media_id,remote_url,error_code from marketing_publications where id=$1', [publication])).rows[0]).toEqual({ status: 'published', remote_media_id: '301', remote_url: null, error_code: null });
    expect((await db.query('select status from marketing_revisions where id=$1', [id])).rows[0]).toEqual({ status: 'published' });
    await db.query(`select marketing_finish_publication($1,$2,'201',null,'published','201','301',null,null)`, [owner, publication]);
    expect((await db.query("select count(*)::int n from marketing_events where revision_id=$1 and kind='published'", [id])).rows[0]).toEqual({ n: 1 });
    await expect(db.query(`select marketing_finish_publication($1,$2,'201',null,'published','201','302',null,null)`, [owner, publication])).rejects.toThrow('receipt conflict');
  });
  it.each([['post', 'instagram'], ['carousel', 'instagram'], ['reel', 'instagram'], ['thread', 'threads'], ['story', 'threads']])('does not allow a null URL for %s on %s', async (format, platform) => {
    const { publication } = await prepared(format, platform);
    await expect(finish(publication)).rejects.toThrow('missing receipt');
    expect((await db.query('select status from marketing_publications where id=$1', [publication])).rows[0]).toEqual({ status: 'claimed' });
  });
  it.each(['0', '001', 'not-numeric'])('rejects ambiguous Story media ID %s', async media => {
    const { publication } = await prepared(); await expect(finish(publication, media)).rejects.toThrow('missing Story receipt');
  });
  it('rejects foreign ownership, stale fences and malformed Story image evidence', async () => {
    const foreign = await prepared(); await expect(finish(foreign.publication, '301', null, other)).rejects.toThrow('publication fence lost');
    await expect(finish(foreign.publication, '301', null, owner, 'different-intent')).rejects.toThrow('publication fence lost');
    for (const patch of [{ height: 1350 }, { mimeType: 'video/mp4' }]) {
      const { publication } = await prepared('story', 'instagram', patch); await expect(finish(publication)).rejects.toThrow('missing Story receipt');
    }
    const insecure = await prepared(); await expect(finish(insecure.publication, '301', 'http://example.invalid')).rejects.toThrow('missing receipt');
  });
  it('preserves ordinary HTTPS receipts and service-only permissions despite default Supabase function grants', async () => {
    const feed = await prepared('post'); expect((await finish(feed.publication, '301', 'https://www.instagram.com/p/offline-qa/')).rows[0]).toEqual({ status: 'published' });
    const signature = 'public.marketing_record_receipt(uuid,uuid,text,text,text,text,text)';
    for (const role of ['anon', 'authenticated']) expect((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') allowed', [role, signature])).rows[0]).toEqual({ allowed: false });
    expect((await db.query('select has_function_privilege(\'service_role\',$1,\'EXECUTE\') allowed', [signature])).rows[0]).toEqual({ allowed: true });
  });
});
