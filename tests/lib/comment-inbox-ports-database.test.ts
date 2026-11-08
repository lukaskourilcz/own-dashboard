import type { PGlite } from '@electric-sql/pglite';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
vi.mock('server-only', () => ({}));
import { createCommentInboxStore } from '@/lib/marketing/comment-inbox-ports';
import type { CapturedComment, InboxTarget } from '@/lib/marketing/comment-inbox-watch';

// The comment-inbox Supabase store on a migrated database, through the real Supabase client: targets across both
// brands and platforms, capture idempotency with the author and text kept, and one deduped notification. Synthetic.
const OWNER = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
const SUPABASE = 'https://inbox-fixture.supabase.co', SERVICE_KEY = 'service-role-TEST-ONLY';
const instant = new Date('2026-11-08T10:00:00.000Z');
const IG_ACCOUNT = '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a', TH_ACCOUNT = '6b6b6b6b-6b6b-4b6b-8b6b-6b6b6b6b6b6b';
let db: PGlite; let emulator: SupabaseEmulator;
const sql = <T = Record<string, unknown>>(text: string, params: unknown[] = []) => emulator.sql<T>(text, params);
const admin = () => createClient(SUPABASE, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => emulator.fetch(input, init) } });

async function seedPost(opts: { account: string; brand: 'dneskai' | 'devshark'; platform: 'instagram' | 'threads'; remoteAccount: string; mediaId: string }) {
  const revision = crypto.randomUUID(), publication = crypto.randomUUID();
  await sql(`insert into public.marketing_accounts(id,user_id,brand,platform,remote_account_id,handle,verified_at,enabled,comment_inbox_enabled)
    values($1,$2,$3,$4,$5,$6,now(),true,true) on conflict do nothing`, [opts.account, OWNER, opts.brand, opts.platform, opts.remoteAccount, opts.brand]);
  const rev = { brand: opts.brand, account: { id: opts.remoteAccount, platform: opts.platform, handle: opts.brand } };
  await sql("insert into public.marketing_revisions(id,user_id,brand,revision,content_hash,ready,status) values($1,$2,$3,$4,$5,true,'published')", [revision, OWNER, opts.brand, JSON.stringify(rev), 'a'.repeat(64)]);
  await sql("insert into public.marketing_publications(id,user_id,revision_id,platform,status,scheduled_at,remote_media_id) values($1,$2,$3,$4,'published',$5,$6)",
    [publication, OWNER, revision, opts.platform, new Date(instant.getTime() - 24 * 3_600_000).toISOString(), opts.mediaId]);
  return publication;
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(instant);
  db = await createMigratedDatabase({ owner: OWNER, instant });
  emulator = new SupabaseEmulator(db, SUPABASE, { service: SERVICE_KEY, users: {} }, () => new Date());
  await seedPost({ account: IG_ACCOUNT, brand: 'dneskai', platform: 'instagram', remoteAccount: '17841400000000001', mediaId: '1790000000000001' });
  await seedPost({ account: TH_ACCOUNT, brand: 'devshark', platform: 'threads', remoteAccount: '17841400000000002', mediaId: '1790000000000002' });
}, 120_000);
afterAll(async () => { vi.useRealTimers(); await db?.close(); });

const target = (over: Partial<InboxTarget> = {}): InboxTarget => ({ accountId: IG_ACCOUNT, publicationId: null, brand: 'dneskai', platform: 'instagram', mediaId: '1790000000000001', remoteAccountId: '17841400000000001', ...over });
const captured = (over: Partial<CapturedComment> = {}): CapturedComment => ({ ...target(), comment: { commentId: '5001', author: 'diazepam4dinner', text: 'Zdroj?', timestamp: instant.toISOString() }, flaggedReason: null, ...over });

describe('comment-inbox store on the migrated schema', () => {
  it('finds inbox-enabled posts across both brands and platforms', async () => {
    const targets = await createCommentInboxStore(admin() as never, OWNER).targets(instant);
    expect(targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: IG_ACCOUNT, brand: 'dneskai', platform: 'instagram', mediaId: '1790000000000001' }),
      expect.objectContaining({ accountId: TH_ACCOUNT, brand: 'devshark', platform: 'threads', mediaId: '1790000000000002' }),
    ]));
  });

  it('stores a new comment with its author and text, and ignores a repeat', async () => {
    const store = createCommentInboxStore(admin() as never, OWNER);
    const rowId = await store.capture(captured(), instant);
    expect(rowId).toBeTruthy();
    const again = await store.capture(captured(), instant);
    expect(again).toBeNull();
    const [row] = await sql<{ author_username: string; body: string; status: string }>('select author_username,body,status from public.marketing_comments where comment_id=$1', ['5001']);
    expect(row).toEqual({ author_username: 'diazepam4dinner', body: 'Zdroj?', status: 'new' });
  });

  it('flags a spammy comment and keeps its text', async () => {
    const store = createCommentInboxStore(admin() as never, OWNER);
    await store.capture(captured({ comment: { commentId: '5002', author: 'bot', text: 'free followers https://spam.example', timestamp: instant.toISOString() }, flaggedReason: 'link' }), instant);
    const [row] = await sql<{ status: string; flagged_reason: string }>('select status,flagged_reason from public.marketing_comments where comment_id=$1', ['5002']);
    expect(row).toEqual({ status: 'flagged', flagged_reason: 'link' });
  });

  it('raises one notification per captured comment and dedupes', async () => {
    const store = createCommentInboxStore(admin() as never, OWNER);
    const rowId = (await sql<{ id: string }>('select id from public.marketing_comments where comment_id=$1', ['5001']))[0]!.id;
    await store.notify(captured(), rowId, instant);
    await store.notify(captured(), rowId, instant);
    const notes = await sql<{ title: string; body: string; kind: string }>('select title,body,kind from public.notifications where source_id=$1', [rowId]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: 'marketing_comment', title: 'Nový komentář na Instagramu' });
    expect(notes[0]!.body).toContain('@diazepam4dinner');
  });
});
