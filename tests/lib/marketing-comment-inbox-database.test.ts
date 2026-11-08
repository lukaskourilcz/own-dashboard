import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';

// The comment-inbox tables on a real migrated database: own-only reads, and the ownership triggers that reject a
// comment or a draft wired to another owner's row, even for service-role writes. Author handles and comment text
// here are synthetic fixtures.
let db: PGlite;
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const scopes = '{instagram_business_basic,instagram_business_manage_comments}';
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
let ownerAccount: string;
let otherAccount: string;
let commentRow: string;

async function as<T>(role: 'authenticated' | 'anon' | 'service_role', sub: string | null, run: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [sub ?? '']);
  await db.exec(`set role ${role}`);
  try { return await run(); } finally { await db.exec('reset role'); }
}
async function makeAccount(user: string, handle: string): Promise<string> {
  await db.query('insert into auth.users(id,email) values($1,$2) on conflict do nothing', [user, `${handle}@example.test`]);
  return as('service_role', null, async () => {
    await db.query(
      "select marketing_verify_account($1,'dneskai','instagram',$2,$3,'TEST-ONLY-TOKEN-0001',$4,$5,'instagram')",
      [user, '1784140000000000' + (user === owner ? '1' : '2'), handle, inDays(55), scopes]);
    return (await db.query<{ id: string }>('select id from public.marketing_accounts where user_id=$1', [user])).rows[0]!.id;
  });
}

beforeAll(async () => {
  db = await createMigratedDatabase({ owner, instant: new Date() });
  ownerAccount = await makeAccount(owner, 'dneskai');
  otherAccount = await makeAccount(other, 'other');
});
afterAll(async () => { await db?.close(); });

async function insertComment(user: string, account: string, commentId: string) {
  return as('service_role', null, () => db.query<{ id: string }>(
    `insert into public.marketing_comments(user_id,account_id,brand,platform,media_id,comment_id,author_username,body)
     values($1,$2,'dneskai','instagram','900100','${commentId}','diazepam4dinner','Zdroj?') returning id`,
    [user, account]));
}

describe('comment inbox tables', () => {
  it('stores a captured comment with its author and text, readable only by its owner', async () => {
    commentRow = (await insertComment(owner, ownerAccount, '5001')).rows[0]!.id;
    const mine = await as('authenticated', owner, () => db.query('select body, author_username from public.marketing_comments where id=$1', [commentRow]));
    expect(mine.rows[0]).toEqual({ body: 'Zdroj?', author_username: 'diazepam4dinner' });
    const theirs = await as('authenticated', other, () => db.query('select 1 from public.marketing_comments where id=$1', [commentRow]));
    expect(theirs.rows).toHaveLength(0);
    // anon has no grant at all (not merely filtered by RLS).
    await expect(as('anon', null, () => db.query('select 1 from public.marketing_comments where id=$1', [commentRow]))).rejects.toThrow(/permission denied/);
  });

  it('rejects a comment wired to another owner\'s account', async () => {
    await expect(insertComment(owner, otherAccount, '5002')).rejects.toThrow(/foreign account/);
  });

  it('keeps one draft per comment, readable only by its owner, and ties sent to sent_at', async () => {
    await as('service_role', null, () => db.query(
      "insert into public.marketing_comment_reply_drafts(user_id,comment_row_id,draft_text,model) values($1,$2,'Díky za dotaz, zdroj je v popisku.','claude-opus-4-8')",
      [owner, commentRow]));
    const mine = await as('authenticated', owner, () => db.query('select draft_text, status from public.marketing_comment_reply_drafts where comment_row_id=$1', [commentRow]));
    expect(mine.rows[0]).toMatchObject({ status: 'draft' });
    const theirs = await as('authenticated', other, () => db.query('select 1 from public.marketing_comment_reply_drafts where comment_row_id=$1', [commentRow]));
    expect(theirs.rows).toHaveLength(0);
    // sent requires sent_at.
    await expect(as('service_role', null, () => db.query(
      "update public.marketing_comment_reply_drafts set status='sent' where comment_row_id=$1", [commentRow]))).rejects.toThrow();
  });

  it('rejects a draft wired to another owner\'s comment', async () => {
    await expect(as('service_role', null, () => db.query(
      "insert into public.marketing_comment_reply_drafts(user_id,comment_row_id,draft_text) values($1,$2,'x')",
      [other, commentRow]))).rejects.toThrow(/foreign comment/);
  });

  it('keeps one style sample per brand and requires a json array', async () => {
    await as('service_role', null, () => db.query(
      "insert into public.marketing_comment_style_samples(user_id,brand,samples,source) values($1,'dneskai','[\"krátká věta\"]','captions')", [owner]));
    await expect(as('service_role', null, () => db.query(
      "insert into public.marketing_comment_style_samples(user_id,brand,samples) values($1,'dneskai','[]')", [owner]))).rejects.toThrow();
    await expect(as('service_role', null, () => db.query(
      "insert into public.marketing_comment_style_samples(user_id,brand,samples) values($1,'devshark','{}')", [owner]))).rejects.toThrow();
  });

  it('defaults the per-account inbox switch to off', async () => {
    const row = await as('authenticated', owner, () => db.query<{ comment_inbox_enabled: boolean }>('select comment_inbox_enabled from public.marketing_accounts where id=$1', [ownerAccount]));
    expect(row.rows[0]!.comment_inbox_enabled).toBe(false);
  });
});
