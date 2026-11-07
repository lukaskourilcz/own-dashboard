import 'server-only';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseContentRevision, type ContentRevision } from './contracts';
import { pragueScheduledAt } from './clock';
import { pragueMarketingDate } from './weekly-planning';
import { pragueDayAfter } from './dneskai-workspace';
import { dneskaiKitOf } from './dneskai-slides';
import { DNESKAI_PLAN_VIEW_VERSION, DneskaiPlanReadSchema, type DneskaiPlanChannel, type DneskaiPlanRead, type DneskaiPlanSlot } from './dneskai-plan-view';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the generated database types do not cover marketing tables
type Database = SupabaseClient<any>;

type SlotRow = { id: string; project_id: string; date: string; local_time: string; instagram: boolean; threads: boolean; kind: 'news' | 'education'; status: DneskaiPlanSlot['status']; code: string | null;
  revision_id: string | null; topic_id: string | null; head_revision_id: string | null; threads_revision_id: string | null; story_revision_id: string | null };
type RevisionRow = { id: string; status: string; revision: unknown };
type PublicationRow = { revision_id: string; status: DneskaiPlanChannel['publicationStatus']; remote_url: string | null; error_code: string | null };
const rows = <T>(result: { data: T[] | null; error: unknown }): T[] => { if (result.error) throw new Error('dneskai-plan-unavailable'); return result.data ?? []; };
const httpsOrNull = (value: string | null) => { try { return value && new URL(value).protocol === 'https:' ? value : null; } catch { return null; } };
const codeOrNull = (value: string | null) => value && /^[a-z][a-z0-9_-]{0,99}$/.test(value) ? value : null;

/**
 * The plan read for the owner's session (own-only RLS decides what is visible): the slots of `days` Prague days from
 * `from`, each with the revision going out on Instagram and on Threads, its rendered slides, text and publication.
 */
export async function readDneskaiPlan(db: Database, owner: string, now: Date, input: { from?: string; days?: number; projectId?: string; enabled: boolean }): Promise<DneskaiPlanRead> {
  z.uuid().parse(owner);
  const today = pragueMarketingDate(now);
  const from = input.from ?? today, days = input.days ?? 2;
  const until = pragueDayAfter(from, days - 1);
  let query = db.from('marketing_dneskai_plan').select('id,project_id,date,local_time,instagram,threads,kind,status,code,revision_id,topic_id,head_revision_id,threads_revision_id,story_revision_id')
    .eq('user_id', owner).gte('date', from).lte('date', until).order('date').order('local_time').limit(200);
  if (input.projectId) query = query.eq('project_id', input.projectId);
  const slots = rows(await query as { data: SlotRow[] | null; error: unknown });
  const revisionIds = [...new Set(slots.flatMap((slot) => [slot.head_revision_id ?? slot.revision_id, slot.threads_revision_id, slot.story_revision_id]).filter((id): id is string => !!id))];
  const topicIds = [...new Set(slots.flatMap((slot) => slot.topic_id ? [slot.topic_id] : []))];
  const [revisionResult, publicationResult, topicResult, accountResult] = await Promise.all([
    revisionIds.length ? db.from('marketing_revisions').select('id,status,revision').eq('user_id', owner).in('id', revisionIds) : Promise.resolve({ data: [], error: null }),
    revisionIds.length ? db.from('marketing_publications').select('revision_id,status,remote_url,error_code').eq('user_id', owner).in('revision_id', revisionIds).neq('status', 'cancelled') : Promise.resolve({ data: [], error: null }),
    topicIds.length ? db.from('marketing_dneskai_topics').select('id,title_cs').eq('user_id', owner).in('id', topicIds) : Promise.resolve({ data: [], error: null }),
    db.from('marketing_accounts').select('platform,handle,enabled,verified_at').eq('user_id', owner).eq('brand', 'dneskai'),
  ]);
  const revisions = new Map<string, { status: string; revision: ContentRevision }>();
  for (const row of rows(revisionResult as { data: RevisionRow[] | null; error: unknown })) {
    try { revisions.set(row.id, { status: row.status, revision: parseContentRevision(row.revision) }); } catch { /* An unreadable revision shows as not ready. */ }
  }
  const publications = new Map(rows(publicationResult as { data: PublicationRow[] | null; error: unknown }).map((row) => [row.revision_id, row]));
  const topics = new Map(rows(topicResult as { data: Array<{ id: string; title_cs: string }> | null; error: unknown }).map((row) => [row.id, row.title_cs]));
  const accounts = rows(accountResult as { data: Array<{ platform: string; handle: string; enabled: boolean; verified_at: string | null }> | null; error: unknown }).filter((row) => row.verified_at);
  const account = (platform: string) => { const row = accounts.find((item) => item.platform === platform); return row ? { handle: row.handle, enabled: row.enabled } : null; };

  const channel = (id: string | null): DneskaiPlanChannel | null => {
    const stored = id ? revisions.get(id) : undefined;
    const publication = id ? publications.get(id) : undefined;
    return { revisionId: id, caption: stored?.revision.caption ?? null, format: stored?.revision.format ?? null, revisionStatus: stored?.status ?? null,
      publicationStatus: publication?.status ?? null, remoteUrl: httpsOrNull(publication?.remote_url ?? null), errorCode: codeOrNull(publication?.error_code ?? null) };
  };
  const view = slots.map((slot): DneskaiPlanSlot => {
    const headId = slot.head_revision_id ?? slot.revision_id;
    const head = headId ? revisions.get(headId) : undefined;
    const onThreads = head?.revision.account.platform === 'threads';
    const instagram = slot.instagram ? channel(onThreads ? null : headId) : null;
    // A Threads-only slot goes out as its head once the plan turned it into a Threads revision; before that, the text is still the Instagram one.
    const threads = slot.threads ? (slot.instagram ? channel(slot.threads_revision_id) : channel(headId)) : null;
    return {
      id: slot.id, date: slot.date, time: slot.local_time, scheduledAt: new Date(pragueScheduledAt(slot.date, slot.local_time)).toISOString(), kind: slot.kind, status: slot.status, code: codeOrNull(slot.code),
      title: (head?.revision.title ?? (slot.topic_id ? topics.get(slot.topic_id) : null) ?? 'DNESKAi').slice(0, 300),
      kit: head?.revision.deck ? dneskaiKitOf(head.revision.deck) : null,
      slides: (head?.revision.assets ?? []).filter((asset) => asset.mimeType === 'image/jpeg').slice(0, 10).map((asset) => ({ url: asset.url, alt: asset.alt, width: asset.width, height: asset.height })),
      labPostId: head ? headId : null,
      instagram, threads, story: slot.story_revision_id ? channel(slot.story_revision_id) : null,
    };
  });
  return DneskaiPlanReadSchema.parse({ schemaVersion: DNESKAI_PLAN_VIEW_VERSION, generatedAt: now.toISOString(), today, from, days, enabled: input.enabled,
    accounts: { instagram: account('instagram'), threads: account('threads') }, slots: view });
}
