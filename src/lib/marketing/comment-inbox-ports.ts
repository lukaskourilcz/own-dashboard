import 'server-only';
import { z } from 'zod';
import type { createAdminClient } from '@/lib/supabase/admin';
import { COMMENT_INBOX_MEDIA_PER_TICK, type InboxStore, type InboxTarget } from './comment-inbox-watch';

/**
 * Supabase behind the comment-inbox capture (owner request, 8 November 2026). Every read and write is owner-scoped and
 * runs with the service role; the tables come from `20261108130000_marketing_comment_inbox.sql`, so nothing here runs
 * unless `MARKETING_COMMENT_INBOX_ENABLED=true` (the switch waits for that migration). Unlike the keyword watcher this
 * spans both brands and both platforms, and it keeps the comment's author and text so the owner can answer it.
 */
type Database = ReturnType<typeof createAdminClient>;
const numericId = z.string().regex(/^\d{1,40}$/);
/** Published posts newer than this are watched for comments. */
export const COMMENT_INBOX_WINDOW_MS = 30 * 24 * 60 * 60_000;

const AccountRowSchema = z.object({ id: z.uuid(), remote_account_id: numericId, brand: z.enum(['dneskai', 'devshark']), platform: z.enum(['instagram', 'threads']), comment_inbox_enabled: z.boolean() });
const PublicationRowSchema = z.object({
  id: z.uuid(), platform: z.enum(['instagram', 'threads']), remote_media_id: numericId,
  marketing_revisions: z.object({ brand: z.enum(['dneskai', 'devshark']), revision: z.object({ account: z.object({ id: numericId }) }) }),
});

export function createCommentInboxStore(db: Database, owner: string): InboxStore {
  z.uuid().parse(owner);
  return {
    async targets(now) {
      const accounts = await db.from('marketing_accounts').select('id,remote_account_id,brand,platform,comment_inbox_enabled').eq('user_id', owner).eq('comment_inbox_enabled', true);
      if (accounts.error) throw new Error('comment-inbox-state-unavailable');
      const live = z.array(AccountRowSchema).parse(accounts.data ?? []).filter((row) => row.comment_inbox_enabled);
      if (!live.length) return [];
      const since = new Date(now.getTime() - COMMENT_INBOX_WINDOW_MS).toISOString();
      const publications = await db.from('marketing_publications')
        .select('id,platform,remote_media_id,marketing_revisions!inner(revision,brand)')
        .eq('user_id', owner).eq('status', 'published').gte('scheduled_at', since).not('remote_media_id', 'is', null)
        .order('scheduled_at', { ascending: false }).limit(120);
      if (publications.error) throw new Error('comment-inbox-state-unavailable');
      const rows = (publications.data ?? []).flatMap((row) => { const parsed = PublicationRowSchema.safeParse(row); return parsed.success ? [parsed.data] : []; });
      return rows.flatMap((row): InboxTarget[] => {
        const account = live.find((item) => item.platform === row.platform && item.brand === row.marketing_revisions.brand && item.remote_account_id === row.marketing_revisions.revision.account.id);
        if (!account) return [];
        return [{ accountId: account.id, publicationId: row.id, brand: account.brand, platform: account.platform, mediaId: row.remote_media_id, remoteAccountId: account.remote_account_id }];
      }).slice(0, COMMENT_INBOX_MEDIA_PER_TICK);
    },

    async capture(row, now) {
      const { comment } = row;
      const { data, error } = await db.from('marketing_comments').upsert({
        user_id: owner, account_id: row.accountId, publication_id: row.publicationId, brand: row.brand, platform: row.platform,
        media_id: row.mediaId, comment_id: comment.commentId, parent_comment_id: comment.parentCommentId ?? null,
        author_username: comment.author, author_remote_id: comment.authorId ?? null, body: comment.text.slice(0, 3000),
        permalink: comment.permalink ?? null, commented_at: comment.timestamp, status: row.flaggedReason ? 'flagged' : 'new',
        flagged_reason: row.flaggedReason, updated_at: now.toISOString(),
      }, { onConflict: 'user_id,platform,comment_id', ignoreDuplicates: true }).select('id');
      if (error) throw new Error('comment-inbox-state-unavailable');
      return (data ?? []).length === 1 ? (data![0] as { id: string }).id : null;
    },

    async notify(row, commentRowId, now) {
      const existing = await db.from('notifications').select('id').eq('user_id', owner).eq('kind', 'marketing_comment').eq('source_id', commentRowId).is('dismissed_at', null).limit(1);
      if (existing.error) throw new Error('comment-inbox-state-unavailable');
      if ((existing.data ?? []).length) return;
      const place = row.platform === 'threads' ? 'Threads' : 'Instagramu';
      const who = row.comment.author ? `@${row.comment.author}` : 'někdo';
      const { error } = await db.from('notifications').insert({
        user_id: owner, kind: 'marketing_comment', source_type: 'marketing_comment', source_id: commentRowId,
        title: `Nový komentář na ${place}`, body: `${who}: ${row.comment.text.slice(0, 160)}`,
        action_url: '/marketing', created_at: now.toISOString(),
      });
      if (error) throw new Error('comment-inbox-state-unavailable');
    },
  };
}
