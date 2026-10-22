import 'server-only';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MARKETING_SOURCE_VERSION, parseSourcePacket, type SourcePacket } from './contracts';
import { DneskaiBriefSchema, type DneskaiBrief, type DneskaiBriefCategory } from './dneskai-brief';
import { contentHash } from './hashes';

/**
 * The local producer of DNESKAi brief sources (#115). A brief packet is built in OwnDashboard from selected
 * research candidates and re-read from `marketing_dneskai_briefs`, never from the Quorum bridge: by the worker
 * before and after generation, by enqueue, by the publish gate and by its read-only preflight.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the generated database types do not cover marketing tables
export type DneskaiBriefDatabase = Pick<SupabaseClient<any>, 'rpc'>;

/** A research selection is not fact verification; the packet says so, and the owner approves the exact revision. */
export const DNESKAI_BRIEF_ELIGIBILITY = 'research-selection-not-fact-checked';
const HOUR = 3600000;
/** News is current for 48 hours, a tool, project or marketing practice for 14 days. */
export function dneskaiBriefLifetimeMs(category: DneskaiBriefCategory): number {
  return category === 'ai-news' || category === 'tech-news' ? 48 * HOUR : 14 * 24 * HOUR;
}

/**
 * The SourcePacket of a brief: kind `brief`, sourceId = eventId, sourceRevision = memberHash, the primary
 * evidence as canonical URL, the primary report's text as body and every report as evidence (checked when the
 * brief was observed). It carries no image: media travel by sha256 in `brief.media`.
 */
export function dneskaiBriefSourcePacket(brief: DneskaiBrief, options: { observedAt?: string; eligible?: boolean; eligibilityReason?: string } = {}): SourcePacket {
  const value = DneskaiBriefSchema.parse(brief);
  const primary = value.evidence[0]!;
  const text=(item:typeof primary)=>[item.excerpt,...("articleText" in item&&!item.captionOnly?[item.articleText]:[])].filter(Boolean).join("\n\n");
  const content = {
    title: value.title.slice(0, 300),
    body: (text(primary).trim() || primary.title).slice(0, 12000),
    category: value.category,
    difficulty: null, code: null, options: [], answer: null, explanation: null,
    evidence: value.evidence.map((item) => ({ url: item.url, title: item.title.slice(0, 300), excerpt: text(item).slice(0, 2000), checkedAt: value.observedAt })),
    image: null,
  };
  return parseSourcePacket({
    schemaVersion: MARKETING_SOURCE_VERSION, brand: 'dneskai', kind: 'brief', sourceId: value.eventId, sourceRevision: value.memberHash,
    contentHash: contentHash(content), canonicalUrl: primary.url, locale: 'cs', observedAt: options.observedAt ?? value.observedAt, expiresAt: value.expiresAt,
    eligible: options.eligible ?? true, eligibilityReason: (options.eligibilityReason ?? DNESKAI_BRIEF_ELIGIBILITY).slice(0, 300), content, brief: value,
  });
}

const BriefSourceRowSchema = z.object({
  briefId: z.uuid(), projectId: z.uuid(), status: z.enum(['pending', 'ready', 'queued', 'skipped']), code: z.string().nullable(),
  brief: z.unknown(), memberHash: z.string(), currentMemberHash: z.string(), memberCount: z.number().int(), currentMemberCount: z.number().int(),
});
export class DneskaiBriefSourceError extends Error { constructor(readonly code: string) { super(code); this.name = 'DneskaiBriefSourceError'; } }

/**
 * Re-reads one brief source for its owner. The stored brief is the producer head: a brief whose members are no
 * longer the selected reports it was built from, or that was skipped, comes back ineligible; an expired brief
 * comes back with its past `expiresAt`. A missing or unreadable brief is `held`, never a fallback.
 */
export async function refreshDneskaiBriefPacket(db: DneskaiBriefDatabase, owner: string, previous: SourcePacket, now: Date): Promise<{ packet: SourcePacket } | { held: string }> {
  z.uuid().parse(owner);
  if (previous.brand !== 'dneskai' || previous.kind !== 'brief' || !previous.brief) return { held: 'source-kind-invalid' };
  const { data, error } = await db.rpc('marketing_dneskai_brief_source', { p_owner: owner, p_event: previous.brief.eventId, p_target: previous.brief.targetDate });
  if (error) throw new DneskaiBriefSourceError('source-current-unavailable');
  if (data === null || data === undefined) return { held: 'source-unavailable' };
  const row = BriefSourceRowSchema.safeParse(data);
  if (!row.success) return { held: 'source-packet-invalid' };
  const brief = DneskaiBriefSchema.safeParse(row.data.brief);
  if (!brief.success || brief.data.eventId !== previous.sourceId || brief.data.memberHash !== row.data.memberHash) return { held: row.data.status === 'pending' ? 'brief-not-ready' : 'source-packet-invalid' };
  const changed = row.data.currentMemberHash !== row.data.memberHash || row.data.currentMemberCount !== row.data.memberCount;
  const reason = changed ? 'brief-members-changed' : row.data.status === 'skipped' ? (row.data.code ?? 'brief-skipped') : null;
  return { packet: dneskaiBriefSourcePacket(brief.data, { observedAt: now.toISOString(), ...(reason ? { eligible: false, eligibilityReason: reason } : {}) }) };
}
