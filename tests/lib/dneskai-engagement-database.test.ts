import type { PGlite } from '@electric-sql/pglite';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
vi.mock('server-only', () => ({}));
import { createDneskaiEngagementStore } from '@/lib/marketing/dneskai-engagement-ports';

/**
 * 20261023120000 (#160) on every migration in isolated WASM Postgres, through the real watcher store and the
 * Supabase client: targets, the one-reply rule, receipts, the account block, ownership and RLS. Synthetic values only.
 */
const OWNER = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b', OTHER = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const SUPABASE = 'https://engagement-fixture.supabase.co', SERVICE_KEY = 'service-role-TEST-ONLY';
const instant = new Date('2026-10-25T10:00:00.000Z');
const ACCOUNT = '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a', REVISION = '7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b', PUBLICATION = '8c8c8c8c-8c8c-4c8c-8c8c-8c8c8c8c8c8c';
let db: PGlite; let emulator: SupabaseEmulator;
const sql = <T = Record<string, unknown>>(text: string, params: unknown[] = []) => emulator.sql<T>(text, params);
const admin = () => createClient(SUPABASE, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => emulator.fetch(input, init) } });
const engagement = { keyword: 'SKILL', replyMessage: 'Návod: otevřete aplikaci a začněte.', publicReply: 'Poslali jsme vám to do zpráv.' };

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(instant);
  db = await createMigratedDatabase({ owner: OWNER, instant });
  emulator = new SupabaseEmulator(db, SUPABASE, { service: SERVICE_KEY, users: {} }, () => new Date());
  await sql('insert into auth.users(id,email) values($1,$2)', [OTHER, 'other@example.test']);
  await sql("insert into public.marketing_accounts(id,user_id,brand,platform,remote_account_id,handle,verified_at,enabled,engagement_enabled) values($1,$2,'dneskai','instagram','17841400000000001','dneskai',now(),true,true)", [ACCOUNT, OWNER]);
  const revision = { brand: 'dneskai', account: { id: '17841400000000001', platform: 'instagram', handle: 'dneskai' }, engagement };
  await sql("insert into public.marketing_revisions(id,user_id,brand,revision,content_hash,ready,status) values($1,$2,'dneskai',$3,$4,true,'published')", [REVISION, OWNER, JSON.stringify(revision), 'a'.repeat(64)]);
  await sql("insert into public.marketing_publications(id,user_id,revision_id,platform,status,scheduled_at,remote_media_id) values($1,$2,$3,'instagram','published',$4,'1790000000000001')", [PUBLICATION, OWNER, REVISION, new Date(instant.getTime() - 30 * 3_600_000).toISOString()]);
}, 120_000);
afterAll(async () => { vi.useRealTimers(); await db?.close(); });

describe('comment replies on the migrated schema (#160)', () => {
  it('finds the published post with its keyword and the account whose switch is on', async () => {
    const store = createDneskaiEngagementStore(admin() as never, OWNER);
    const targets = await store.targets(instant);
    expect(targets).toEqual([expect.objectContaining({ publicationId: PUBLICATION, mediaId: '1790000000000001', accountId: ACCOUNT, igUserId: '17841400000000001', keyword: 'SKILL',
      replyMessage: engagement.replyMessage, publicReply: engagement.publicReply, check: { afterCursor: null, passSeen: 0, passMatches: 0, passSkippedOld: 0 } })]);
    // Older than seven days, or the account switch off: nothing to watch.
    expect(await store.targets(new Date(instant.getTime() + 7 * 86_400_000))).toEqual([]);
  });
  it('claims a comment once, records the reply and the finished pass', async () => {
    const store = createDneskaiEngagementStore(admin() as never, OWNER);
    const [target] = await store.targets(instant);
    expect(await store.claim({ publicationId: PUBLICATION, mediaId: target!.mediaId, commentId: '1801', keyword: 'SKILL' })).toBe(true);
    expect(await store.claim({ publicationId: PUBLICATION, mediaId: target!.mediaId, commentId: '1801', keyword: 'SKILL' })).toBe(false);
    await store.finish('1801', { status: 'sent', errorCode: null, privateSentAt: instant.toISOString(), publicStatus: 'sent', publicCommentId: '1790000000009999' });
    await store.saveCheck(target!, { afterCursor: null, passSeen: 4, passMatches: 2, passSkippedOld: 1, finished: true, errorCode: null, at: instant });
    const [row] = await sql<{ status: string; public_status: string; matched_keyword: string }>('select status,public_status,matched_keyword from public.marketing_instagram_comment_replies where comment_id=$1', ['1801']);
    expect(row).toEqual({ status: 'sent', public_status: 'sent', matched_keyword: 'SKILL' });
    const [check] = await sql('select comments_seen,keyword_matches,skipped_old,pass_seen,after_cursor from public.marketing_instagram_comment_checks where publication_id=$1', [PUBLICATION]);
    expect(check).toEqual({ comments_seen: 4, keyword_matches: 2, skipped_old: 1, pass_seen: 0, after_cursor: null });
    expect((await store.targets(instant))[0]!.check).toEqual({ afterCursor: null, passSeen: 0, passMatches: 0, passSkippedOld: 0 });
  });
  it('refuses a sent row without its time, another owner\'s publication and owner writes; the owner reads only own rows', async () => {
    await expect(sql("insert into public.marketing_instagram_comment_replies(user_id,publication_id,media_id,comment_id,matched_keyword,status) values($1,$2,'1','1802','SKILL','sent')", [OWNER, PUBLICATION])).rejects.toThrow();
    await expect(sql("insert into public.marketing_instagram_comment_replies(user_id,publication_id,media_id,comment_id,matched_keyword) values($1,$2,'1','1803','SKILL')", [OTHER, PUBLICATION])).rejects.toThrow(/foreign publication/);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [OWNER]);
    await db.exec('set role authenticated');
    try {
      expect((await db.query('select comment_id from public.marketing_instagram_comment_replies')).rows).toEqual([{ comment_id: '1801' }]);
      await expect(db.query("update public.marketing_instagram_comment_replies set status='failed'")).rejects.toThrow();
    } finally { await db.exec('reset role'); }
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [OTHER]);
    await db.exec('set role authenticated');
    try { expect((await db.query('select * from public.marketing_instagram_comment_replies')).rows).toEqual([]); } finally { await db.exec('reset role'); }
  });
  it('blocks the account, after which nothing is watched', async () => {
    const store = createDneskaiEngagementStore(admin() as never, OWNER);
    await store.blockAccount(ACCOUNT, 'engagement-messaging-disabled', instant);
    const [account] = await sql('select engagement_blocked_code from public.marketing_accounts where id=$1', [ACCOUNT]);
    expect(account).toEqual({ engagement_blocked_code: 'engagement-messaging-disabled' });
    expect(await store.targets(instant)).toEqual([]);
  });
});
