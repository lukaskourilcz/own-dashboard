import 'server-only';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MARKETING_SOURCE_VERSION, parseSourcePacket, type SourcePacket } from './contracts';
import { contentHash } from './hashes';
import { DevsharkDeckSchema } from './devshark-deck';

/**
 * The local source of a devShark post (owner decision, 7 November 2026): the concept the owner approved in the studio.
 * Every devShark revision cites it as its source, and the publisher re-reads it before publishing, so a concept that
 * was edited, returned to review or rejected after its revisions were made stops them. Kind `coding-task`, English.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the generated database types do not cover marketing tables
type Database = SupabaseClient<any>;

export const DEVSHARK_DRAFT_SOURCE_PREFIX = 'devshark-draft:';
const DraftRowSchema = z.object({ id: z.uuid(), title: z.string().min(1), caption: z.string().min(1), deck: DevsharkDeckSchema, status: z.string() });
export type DevsharkSourceDraft = z.infer<typeof DraftRowSchema>;

/** The packet of one concept; `eligible` only while it is approved, planned or published. */
export function devsharkDraftPacket(draft: DevsharkSourceDraft, now: Date): SourcePacket {
  const value = DraftRowSchema.parse(draft);
  const text = value.deck.slides.map((slide) => [slide.headline, slide.body, slide.code].filter(Boolean).join('\n')).join('\n\n').replace(/\[\[|\]\]/g, '');
  const content = { title: value.title.slice(0, 300), body: `${value.caption}\n\n${text}`.slice(0, 30000), category: 'devshark-concept', difficulty: null, code: null,
    options: [], answer: null, explanation: null, evidence: [], image: null };
  const eligible = ['approved', 'planned', 'published'].includes(value.status);
  return parseSourcePacket({ schemaVersion: MARKETING_SOURCE_VERSION, brand: 'devshark', kind: 'coding-task', sourceId: `${DEVSHARK_DRAFT_SOURCE_PREFIX}${value.id}`,
    sourceRevision: contentHash({ title: value.title, caption: value.caption, deck: value.deck }), contentHash: contentHash(content), canonicalUrl: 'https://devshark.app/',
    locale: 'en', observedAt: now.toISOString(), expiresAt: null, eligible, eligibilityReason: eligible ? 'owner-approved-concept' : `concept-${value.status}`, content });
}

/** Re-reads a concept for its owner; a missing concept is held, never a fallback. */
export async function refreshDevsharkDraftPacket(db: Database, owner: string, sourceId: string, now: Date): Promise<{ packet: SourcePacket } | { held: string }> {
  z.uuid().parse(owner);
  const id = sourceId.slice(DEVSHARK_DRAFT_SOURCE_PREFIX.length);
  if (!sourceId.startsWith(DEVSHARK_DRAFT_SOURCE_PREFIX) || !z.uuid().safeParse(id).success) return { held: 'source-kind-invalid' };
  const { data, error } = await db.from('marketing_devshark_drafts').select('id,title,caption,deck,status').eq('user_id', owner).eq('id', id).maybeSingle();
  if (error) throw new Error('source-current-unavailable');
  const row = DraftRowSchema.safeParse(data);
  if (!data) return { held: 'source-unavailable' };
  if (!row.success) return { held: 'source-packet-invalid' };
  return { packet: devsharkDraftPacket(row.data, now) };
}

/** The concept states whose packet is eligible; discovery lists only these. */
export const DEVSHARK_ELIGIBLE_CONCEPT_STATUSES = ['approved', 'planned', 'published'] as const;

/**
 * Local devShark source discovery (13 November 2026): the owner's eligible concepts, newest first, at most `limit`.
 * This replaces the Quorum/n8n bridge (`?resource=marketing-source`), whose n8n instance no longer exists.
 */
export async function discoverDevsharkDraftPackets(db: Database, owner: string, now: Date, limit = 20): Promise<{ packets: SourcePacket[]; invalid: number }> {
  z.uuid().parse(owner);
  const { data, error } = await db.from('marketing_devshark_drafts').select('id,title,caption,deck,status').eq('user_id', owner)
    .in('status', [...DEVSHARK_ELIGIBLE_CONCEPT_STATUSES]).order('updated_at', { ascending: false }).order('id').limit(Math.max(1, Math.min(limit, 20)));
  if (error) throw new Error('source-current-unavailable');
  const packets: SourcePacket[] = []; let invalid = 0;
  for (const value of (data ?? []) as unknown[]) {
    const row = DraftRowSchema.safeParse(value);
    if (row.success) packets.push(devsharkDraftPacket(row.data, now)); else invalid++;
  }
  return { packets, invalid };
}
