import 'server-only';
import { z } from 'zod';
import type { createAdminClient } from '@/lib/supabase/admin';
import { ContentEngagementSchema } from './contracts';
import { resolveMetaPublisherConfig } from './meta-credentials';
import type { MetaPublisherConfig } from './publisher';
import {
  DNESKAI_ENGAGEMENT_WINDOW_MS, EngagementGraphError, engagementGraphError, type EngagementGraph, type EngagementStore, type EngagementTarget,
} from './dneskai-engagement-watch';

/**
 * Supabase and Graph behind the comment watcher (#160). Every read and write is owner-scoped and runs with the
 * service role from the scheduler; the tables come from `20261023120000_dneskai_comment_replies.sql`, so nothing here
 * runs unless `DNESKAI_ENGAGEMENT_ENABLED=true` (the switch waits for that migration).
 */
type Database = ReturnType<typeof createAdminClient>;
type Environment = Record<string, string | undefined>;
const numericId = z.string().regex(/^\d{1,40}$/);

const TargetRowSchema = z.object({
  id: z.uuid(), scheduled_at: z.string(), remote_media_id: numericId,
  marketing_revisions: z.object({ revision: z.object({ account: z.object({ id: numericId }), engagement: ContentEngagementSchema.optional() }) }),
});
const CheckRowSchema = z.object({ publication_id: z.uuid(), after_cursor: z.string().nullable(), pass_seen: z.number().int(), pass_matches: z.number().int(), pass_skipped_old: z.number().int(), last_checked_at: z.string().nullable() });
const AccountRowSchema = z.object({ id: z.uuid(), remote_account_id: numericId, engagement_enabled: z.boolean(), engagement_blocked_code: z.string().nullable() });

export function createDneskaiEngagementStore(db: Database, owner: string): EngagementStore {
  z.uuid().parse(owner);
  return {
    async targets(now) {
      const accounts = await db.from('marketing_accounts').select('id,remote_account_id,engagement_enabled,engagement_blocked_code').eq('user_id', owner).eq('brand', 'dneskai').eq('platform', 'instagram');
      if (accounts.error) throw new Error('engagement-state-unavailable');
      const live = z.array(AccountRowSchema).parse(accounts.data ?? []).filter((row) => row.engagement_enabled && !row.engagement_blocked_code);
      if (!live.length) return [];
      const since = new Date(now.getTime() - DNESKAI_ENGAGEMENT_WINDOW_MS).toISOString();
      const publications = await db.from('marketing_publications').select('id,scheduled_at,remote_media_id,marketing_revisions!inner(revision,brand)').eq('user_id', owner)
        .eq('status', 'published').eq('platform', 'instagram').eq('marketing_revisions.brand', 'dneskai').gte('scheduled_at', since).not('remote_media_id', 'is', null)
        .order('scheduled_at', { ascending: false }).limit(60);
      if (publications.error) throw new Error('engagement-state-unavailable');
      const rows = (publications.data ?? []).flatMap((row) => { const parsed = TargetRowSchema.safeParse(row); return parsed.success && parsed.data.marketing_revisions.revision.engagement ? [parsed.data] : []; });
      if (!rows.length) return [];
      const checks = await db.from('marketing_instagram_comment_checks').select('publication_id,after_cursor,pass_seen,pass_matches,pass_skipped_old,last_checked_at').eq('user_id', owner).in('publication_id', rows.map((row) => row.id));
      if (checks.error) throw new Error('engagement-state-unavailable');
      const byPublication = new Map(z.array(CheckRowSchema).parse(checks.data ?? []).map((row) => [row.publication_id, row]));
      return rows.flatMap((row): Array<EngagementTarget & { lastCheckedAt: string | null }> => {
        const account = live.find((item) => item.remote_account_id === row.marketing_revisions.revision.account.id);
        const engagement = row.marketing_revisions.revision.engagement!;
        if (!account) return [];
        const check = byPublication.get(row.id);
        return [{ publicationId: row.id, mediaId: row.remote_media_id, accountId: account.id, igUserId: account.remote_account_id, scheduledAt: row.scheduled_at,
          keyword: engagement.keyword, replyMessage: engagement.replyMessage, publicReply: engagement.publicReply ?? null, lastCheckedAt: check?.last_checked_at ?? null,
          check: { afterCursor: check?.after_cursor ?? null, passSeen: check?.pass_seen ?? 0, passMatches: check?.pass_matches ?? 0, passSkippedOld: check?.pass_skipped_old ?? 0 } }];
      }).sort((a, b) => (a.lastCheckedAt ? Date.parse(a.lastCheckedAt) : 0) - (b.lastCheckedAt ? Date.parse(b.lastCheckedAt) : 0));
    },
    async claim(input) {
      const { data, error } = await db.from('marketing_instagram_comment_replies').upsert({ user_id: owner, publication_id: input.publicationId, media_id: input.mediaId, comment_id: input.commentId,
        matched_keyword: input.keyword, status: 'claimed' }, { onConflict: 'comment_id', ignoreDuplicates: true }).select('id');
      if (error) throw new Error('engagement-state-unavailable');
      return (data ?? []).length === 1;
    },
    async finish(commentId, result) {
      const { error } = await db.from('marketing_instagram_comment_replies').update({ status: result.status, error_code: result.errorCode, private_sent_at: result.privateSentAt,
        public_status: result.publicStatus, public_comment_id: result.publicCommentId, updated_at: new Date().toISOString() }).eq('user_id', owner).eq('comment_id', commentId);
      if (error) throw new Error('engagement-state-unavailable');
    },
    async saveCheck(target, check) {
      const counts = check.finished ? { comments_seen: check.passSeen, keyword_matches: check.passMatches, skipped_old: check.passSkippedOld, pass_seen: 0, pass_matches: 0, pass_skipped_old: 0 }
        : { pass_seen: check.passSeen, pass_matches: check.passMatches, pass_skipped_old: check.passSkippedOld };
      const { error } = await db.from('marketing_instagram_comment_checks').upsert({ publication_id: target.publicationId, user_id: owner, media_id: target.mediaId,
        after_cursor: check.afterCursor, last_checked_at: check.at.toISOString(), last_error_code: check.errorCode, ...counts }, { onConflict: 'publication_id' });
      if (error) throw new Error('engagement-state-unavailable');
    },
    async blockAccount(accountId, code, at) {
      const { error } = await db.from('marketing_accounts').update({ engagement_blocked_code: code, engagement_blocked_at: at.toISOString() }).eq('user_id', owner).eq('id', accountId);
      if (error) throw new Error('engagement-state-unavailable');
    },
  };
}

/**
 * #161: whether Meta sends this account's comments to the app's webhook, and the owner's request to subscribe it
 * (`GET` / `POST /<IG_ID>/subscribed_apps`, field `comments`). Called only from the owner's account panel.
 */
export async function instagramCommentSubscription(db: Database, owner: string, account: { id: string; remoteAccountId: string }, action: 'status' | 'subscribe',
  env: Environment = process.env, fetcher: typeof fetch = fetch): Promise<{ subscribed: boolean }> {
  const settings = await resolveMetaPublisherConfig(db, owner, { id: account.id, user_id: owner, brand: 'dneskai', platform: 'instagram' }, env);
  if (settings.credentialHold) throw new EngagementGraphError(settings.credentialHold, 'definite', 'run');
  if (settings.loginMode !== 'instagram' || !/^v\d+\.\d+$/.test(settings.apiVersion)) throw new EngagementGraphError('api-version-unverified', 'definite', 'run');
  if (!numericId.safeParse(account.remoteAccountId).success) throw new EngagementGraphError('account-unavailable', 'definite', 'run');
  const url = new URL(`https://graph.instagram.com/${settings.apiVersion}/${account.remoteAccountId}/subscribed_apps`);
  if (action === 'subscribe') url.searchParams.set('subscribed_fields', 'comments');
  let response: Response;
  try { response = await fetcher(url.href, { method: action === 'subscribe' ? 'POST' : 'GET', headers: { Authorization: `Bearer ${settings.accessToken}` }, redirect: 'error', signal: AbortSignal.timeout(10_000) }); }
  catch { throw new EngagementGraphError('meta-request-uncertain', 'uncertain'); }
  let body: unknown = null;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok || (body && typeof body === 'object' && 'error' in body)) throw engagementGraphError(response.status, body);
  if (action === 'subscribe') {
    if (!z.object({ success: z.literal(true) }).safeParse(body).success) throw new EngagementGraphError('meta-invalid-response', 'uncertain');
    return { subscribed: true };
  }
  const listed = z.object({ data: z.array(z.object({ subscribed_fields: z.array(z.string()).default([]) }).passthrough()).max(20) }).safeParse(body);
  if (!listed.success) throw new EngagementGraphError('meta-invalid-response', 'definite');
  return { subscribed: listed.data.data.some((app) => app.subscribed_fields.includes('comments')) };
}

/** The scopes a private reply and a public reply need under Instagram Login. */
export const DNESKAI_ENGAGEMENT_SCOPES = ['instagram_business_basic', 'instagram_business_manage_comments'] as const;

/**
 * Graph calls through Instagram Login (`graph.instagram.com`) with the account's stored token, resolved once per
 * account per tick. The token travels only in the Authorization header. Comments: `GET /<media-id>/comments`;
 * private reply: `POST /<IG_ID>/messages` with `recipient.comment_id`; public reply: `POST /<comment-id>/replies`.
 */
export function createDneskaiEngagementGraph(db: Database, owner: string, env: Environment = process.env, fetcher: typeof fetch = fetch): EngagementGraph {
  const configs = new Map<string, Promise<MetaPublisherConfig>>();
  const config = (target: EngagementTarget) => {
    let found = configs.get(target.accountId);
    if (!found) { found = resolveMetaPublisherConfig(db, owner, { id: target.accountId, user_id: owner, brand: 'dneskai', platform: 'instagram' }, env); configs.set(target.accountId, found); }
    return found;
  };
  async function call(target: EngagementTarget, path: string, init: { method: 'GET' | 'POST'; query?: Record<string, string>; json?: unknown; form?: Record<string, string> }, signal: AbortSignal) {
    const settings = await config(target);
    if (settings.credentialHold) throw new EngagementGraphError(settings.credentialHold, 'definite', 'run');
    if (settings.loginMode !== 'instagram') throw new EngagementGraphError('login-mode-mismatch', 'definite', 'run');
    if (!/^v\d+\.\d+$/.test(settings.apiVersion)) throw new EngagementGraphError('api-version-unverified', 'definite', 'run');
    if (DNESKAI_ENGAGEMENT_SCOPES.some((scope) => !settings.scopes.includes(scope))) throw new EngagementGraphError('engagement-scopes-unverified', 'definite', 'run');
    const url = new URL(`https://graph.instagram.com/${settings.apiVersion}/${path}`);
    for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value);
    const headers: Record<string, string> = { Authorization: `Bearer ${settings.accessToken}` };
    let body: string | undefined;
    if (init.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(init.json); }
    else if (init.form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(init.form).toString(); }
    let response: Response;
    try { response = await fetcher(url.href, { method: init.method, headers, body, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) }); }
    catch { throw new EngagementGraphError('meta-request-uncertain', 'uncertain'); }
    let parsed: unknown = null;
    try { parsed = await response.json(); } catch { parsed = null; }
    if (!response.ok || (parsed && typeof parsed === 'object' && 'error' in parsed)) throw engagementGraphError(response.status, parsed);
    if (!parsed || typeof parsed !== 'object') throw new EngagementGraphError('meta-invalid-response', init.method === 'POST' ? 'uncertain' : 'definite');
    return parsed as Record<string, unknown>;
  }
  const CommentsSchema = z.object({ data: z.array(z.object({ id: numericId, text: z.string().max(5000).default(''), timestamp: z.string() })).max(100),
    paging: z.object({ cursors: z.object({ after: z.string().max(512).optional() }).optional(), next: z.string().optional() }).optional() });
  return {
    async comments(target, after, signal) {
      const raw = await call(target, `${target.mediaId}/comments`, { method: 'GET', query: { fields: 'id,text,timestamp', limit: '50', ...(after ? { after } : {}) } }, signal);
      const page = CommentsSchema.safeParse(raw);
      if (!page.success) throw new EngagementGraphError('meta-invalid-response', 'definite');
      // Graph gives a next link only when another page exists; the cursor alone may be present on the last page.
      return { comments: page.data.data, after: page.data.paging?.next ? page.data.paging.cursors?.after ?? null : null };
    },
    async privateReply(target, commentId, signal) {
      await call(target, `${target.igUserId}/messages`, { method: 'POST', json: { recipient: { comment_id: commentId }, message: { text: target.replyMessage } } }, signal);
    },
    async publicReply(target, commentId, signal) {
      const raw = await call(target, `${commentId}/replies`, { method: 'POST', form: { message: target.publicReply ?? '' } }, signal);
      const id = numericId.safeParse(raw.id);
      if (!id.success) throw new EngagementGraphError('meta-invalid-response', 'uncertain');
      return { id: id.data };
    },
  };
}
