import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { EngagementCommentEvent } from './dneskai-engagement-watch';

/**
 * The Instagram comment webhook (#161): signature check and payload reading for `/api/webhooks/instagram`. Meta signs
 * the raw body with the app secret (`X-Hub-Signature-256: sha256=<hex>`). Under Instagram Login a comment arrives as
 * `entry[].field = "comments"` with `value.{id, text, media.id}`; the Facebook Login shape wraps the same value in
 * `entry[].changes[]`. Both are read; anything else is ignored. Only the comment id, the media id and the text in
 * memory are used; the commenter's identity is never read.
 */
export const INSTAGRAM_WEBHOOK_MAX_BYTES = 256 * 1024;

export function instagramWebhookSignatureValid(raw: string, header: string | null, secret: string): boolean {
  if (!header || !/^sha256=[a-f0-9]{64}$/.test(header) || secret.length < 16) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(raw, 'utf8').digest('hex'), 'utf8');
  const given = Buffer.from(header.slice('sha256='.length), 'utf8');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const numericId = z.string().regex(/^\d{1,40}$/);
const CommentValueSchema = z.object({ id: numericId, text: z.string().max(5000).default(''), media: z.object({ id: numericId }) });
const ChangeSchema = z.object({ field: z.string(), value: z.unknown() });
const EntrySchema = z.object({ id: z.string().optional(), field: z.string().optional(), value: z.unknown().optional(), changes: z.array(ChangeSchema).max(100).optional() });
const PayloadSchema = z.object({ object: z.string(), entry: z.array(EntrySchema).max(100) });

/** The comment events in a webhook body, deduplicated by comment id; an unreadable body gives none. */
export function instagramCommentEvents(body: unknown): EngagementCommentEvent[] {
  const payload = PayloadSchema.safeParse(body);
  if (!payload.success || payload.data.object !== 'instagram') return [];
  const values = payload.data.entry.flatMap((entry) => [
    ...(entry.field === 'comments' ? [entry.value] : []),
    ...(entry.changes ?? []).filter((change) => change.field === 'comments').map((change) => change.value),
  ]);
  const events = new Map<string, EngagementCommentEvent>();
  for (const value of values) {
    const comment = CommentValueSchema.safeParse(value);
    if (comment.success && !events.has(comment.data.id)) events.set(comment.data.id, { commentId: comment.data.id, mediaId: comment.data.media.id, text: comment.data.text });
  }
  return [...events.values()];
}
