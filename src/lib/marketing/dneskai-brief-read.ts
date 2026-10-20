import 'server-only';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DneskaiBriefSchema } from './dneskai-brief';
import { DNESKAI_BRIEFS_READ_VERSION, DneskaiBriefsReadSchema, DneskaiCandidateSchema, type DneskaiBriefsRead, type DneskaiCandidate, type DneskaiEventView } from './dneskai-contracts';
import { groupDneskaiEvents, rankDneskaiEventMembers } from './dneskai-events';

/**
 * The owner's read of DNESKAi events and briefs (#115) for the Sources tab and the review UI (#119). Reads
 * through the caller's client, so a session client sees only the owner's rows (RLS). No brief document leaves
 * here, only its state, slot and counts; the members name their source, title and URL.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the generated database types do not cover marketing tables
type Database = Pick<SupabaseClient<any>, 'from'>;

const memberView = (candidate: DneskaiCandidate, role: 'primary' | 'supporting') => ({
  candidateId: candidate.id, sourceId: candidate.sourceId, title: candidate.title.slice(0, 500), url: candidate.url, status: candidate.status, reason: candidate.reason, role,
});
const BriefRowSchema = z.object({
  id: z.uuid(), event_id: z.string(), target_date: z.string(), rank: z.number().int(), member_ids: z.array(z.string()), status: z.enum(['pending', 'ready', 'queued', 'skipped']),
  code: z.string().nullable(), brief: z.unknown(), scheduled_at: z.string().nullable(), job_id: z.uuid().nullable(),
});

/** Selected events of the latest target days (or one day), each with its brief state and its reports, primary first. */
export async function readDneskaiBriefs(db: Database, owner: string, project: string, date?: string): Promise<DneskaiBriefsRead> {
  z.uuid().parse(owner); z.uuid().parse(project); if (date) z.iso.date().parse(date);
  const query = db.from('marketing_dneskai_briefs').select('id,event_id,target_date,rank,member_ids,status,code,brief,scheduled_at,job_id').eq('user_id', owner).eq('project_id', project);
  const { data, error } = await (date ? query.eq('target_date', date).order('rank') : query.order('target_date', { ascending: false }).order('rank').limit(28));
  if (error) throw new Error('dneskai-briefs-unavailable');
  const rows = (data ?? []).flatMap((row) => { const parsed = BriefRowSchema.safeParse(row); return parsed.success ? [parsed.data] : []; });
  const ids = [...new Set(rows.flatMap((row) => row.member_ids))];
  const candidates = new Map<string, DneskaiCandidate>();
  for (let index = 0; index < ids.length; index += 100) {
    const { data: members, error: memberError } = await db.from('marketing_dneskai_candidates').select('id,candidate').eq('user_id', owner).eq('project_id', project).in('id', ids.slice(index, index + 100));
    if (memberError) throw new Error('dneskai-briefs-unavailable');
    for (const row of members ?? []) { const parsed = DneskaiCandidateSchema.safeParse(row.candidate); if (parsed.success && parsed.data.id === row.id) candidates.set(row.id, parsed.data); }
  }
  const events = rows.flatMap((row): DneskaiEventView[] => {
    const members = row.member_ids.flatMap((id) => candidates.get(id) ?? []);
    if (!members.length) return [];
    const brief = DneskaiBriefSchema.safeParse(row.brief);
    // The brief's evidence order is the chosen primary first; before the brief exists, the same source ranking.
    const order = brief.success ? brief.data.evidence.map((item) => item.candidateId) : rankDneskaiEventMembers(members).map((member) => member.id);
    const ordered = [...members].sort((a, b) => (order.indexOf(a.id) + 1 || 99) - (order.indexOf(b.id) + 1 || 99));
    const repeat = row.status === 'skipped' && row.code === 'collection-already-covered';
    return [{
      eventId: row.event_id, targetDate: row.target_date, status: row.status !== 'skipped' ? 'selected' : repeat ? 'duplicate' : 'held', reason: row.status === 'skipped' ? row.code : null,
      brief: { id: row.id, rank: Math.min(4, Math.max(1, row.rank)), status: row.status, code: row.code, scheduledAt: row.scheduled_at ? new Date(row.scheduled_at).toISOString() : null,
        suggestedFormat: brief.success ? brief.data.suggestedFormat : null, evidenceCount: brief.success ? brief.data.evidence.length : 0, mediaCount: brief.success ? brief.data.media.length : 0, jobId: row.job_id },
      members: ordered.slice(0, 30).map((member, index) => memberView(member, index === 0 ? 'primary' : 'supporting')),
    }];
  });
  return DneskaiBriefsReadSchema.parse({ schemaVersion: DNESKAI_BRIEFS_READ_VERSION, events });
}

/**
 * Recent reports that were not selected, grouped into events the same way the selection groups them, so the
 * owner sees one held or duplicate event instead of several loose reports. Reports already in a brief are left
 * out. Newest events first, at most `limit`.
 */
export function dneskaiOtherEventViews(candidates: readonly DneskaiCandidate[], briefed: ReadonlySet<string>, limit = 12): DneskaiEventView[] {
  const open = candidates.filter((candidate) => !briefed.has(candidate.id) && candidate.status !== 'selected');
  const statusOf = (members: readonly DneskaiCandidate[]): { status: DneskaiEventView['status']; reason: string | null } => {
    for (const status of ['duplicate', 'held', 'rejected'] as const) {
      const member = members.find((item) => item.status === status);
      if (member) return { status, reason: member.reason };
    }
    return { status: 'new', reason: null };
  };
  return groupDneskaiEvents(open)
    .sort((a, b) => Math.max(...b.members.map((item) => Date.parse(item.fetchedAt))) - Math.max(...a.members.map((item) => Date.parse(item.fetchedAt))))
    .slice(0, limit)
    .map((event) => {
      const ordered = rankDneskaiEventMembers(event.members);
      return { eventId: event.eventId, targetDate: null, ...statusOf(event.members), brief: null, members: ordered.slice(0, 30).map((member, index) => memberView(member, index === 0 ? 'primary' : 'supporting')) };
    });
}
