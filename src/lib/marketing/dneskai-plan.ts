import 'server-only';
import { z } from 'zod';
import type { createAdminClient } from '@/lib/supabase/admin';
import { parseContentRevision, renderReportBlocks, type ContentRevision } from './contracts';
import { pragueScheduledAt } from './clock';
import { pragueMarketingDate } from './weekly-planning';
import { pragueDayAfter } from './dneskai-workspace';
import { DNESKAI_GENERATION_KIT, dneskaiKitOf } from './dneskai-slides';
import { DNESKAI_PLAN_DAYS, DNESKAI_PLAN_INSTAGRAM_TIMES, DNESKAI_PLAN_TIMES, type DneskaiPlanKind, type DneskaiPlanStatus } from './dneskai-plan-view';
import { dneskaiThreadsTwin, type DneskaiThreadsAccount } from './dneskai-threads';
import { prepareDneskaiRevisionEdit, renderAndAttachDneskaiRevision, reusableDneskaiRender } from './dneskai-revision-edit';
import { getBriefAssetHashLister, getBriefPoolLoader, getDneskaiMediaLoader, getRenderDneskaiDeck } from './dneskai-wiring';
import { refreshMarketingAssetUrls } from './asset-urls';
import { saveRevision } from './store';
import { synchronizeMarketingSources } from './orchestrator';

/**
 * The DNESKAi publishing plan step (owner decision, 7 November 2026). The owner approved every education topic and
 * the last week's news into a rolling 30-day plan: three Instagram posts a day, the same three on Threads and one
 * evening Threads post. On each minute tick, behind DNESKAI_PLAN_ENABLED, this step:
 *
 * 1. fills empty slots from tomorrow to the 30th day with approved education topics that are not planned yet, and
 *    writes each topic's slot into its evidence, so the topic bridge briefs it for exactly that day and time;
 * 2. works the slots of today and the next `DNESKAI_PLAN_HORIZON_DAYS` days, one decision per slot: render the post in
 *    Spotlight, move it to the slot's time, turn a Threads-only post into a Threads revision, approve the exact
 *    version, and derive and approve the Threads twin of an approved Instagram post.
 *
 * The owner keeps the last word. A revision the owner saved in the Design Lab after the plan's own (`written_revision_id`
 * differs) keeps its kit and time; returned or skipped posts leave the plan as skipped. At most one render runs per
 * tick, because a render takes most of one.
 */
type Database = ReturnType<typeof createAdminClient>;
type Environment = Record<string, string | undefined>;

/** Days after today whose slots the step prepares; the topic bridge generates them as soon as they enter it. */
export const DNESKAI_PLAN_HORIZON_DAYS = 2;
/** A post is approved only while its slot is at least this far away. */
const APPROVAL_LEAD_MS = 2 * 60_000;
/** A news brief stays current until this long after its planned slot. */
const NEWS_EXTENSION_MS = 24 * 60 * 60_000;
const FILL_LIMIT = 40;

export function dneskaiPlanEnabled(env: Environment = process.env): boolean {
  return env.DNESKAI_PLAN_ENABLED === 'true';
}

export type DneskaiPlanRow = {
  id: string; user_id: string; project_id: string; date: string; local_time: string; instagram: boolean; threads: boolean; kind: DneskaiPlanKind;
  revision_id: string | null; topic_id: string | null; head_revision_id: string | null; threads_revision_id: string | null;
  written_revision_id: string | null; threads_base_revision_id: string | null; status: DneskaiPlanStatus; code: string | null;
};
export type DneskaiPlanHead = { id: string; status: string; ready: boolean; content_hash: string; revision: ContentRevision; render_report: unknown };
export type DneskaiPlanTwin = { id: string; status: string; ready: boolean; content_hash: string };

export type DneskaiPlanAction =
  | { kind: 'wait'; status: DneskaiPlanStatus; code: string | null }
  | { kind: 'spotlight' | 'move' | 'to-threads' | 'approve' | 'twin' | 'approve-twin'; status: DneskaiPlanStatus };

/** The slot's instant in Prague time. */
export const dneskaiPlanSlotAt = (slot: Pick<DneskaiPlanRow, 'date' | 'local_time'>) => pragueScheduledAt(slot.date, slot.local_time);

/**
 * The one thing a slot needs next. Pure: the executor reads the head, its Threads twin and the Threads account, asks
 * this, does that one step and records the returned status and code on the slot.
 */
export function dneskaiPlanAction(slot: DneskaiPlanRow, head: DneskaiPlanHead | null, twin: DneskaiPlanTwin | null, threadsAccount: boolean, now: Date): DneskaiPlanAction {
  if (!head) return slot.topic_id ? { kind: 'wait', status: 'generating', code: null } : { kind: 'wait', status: 'failed', code: 'plan-post-missing' };
  const slotAt = Date.parse(dneskaiPlanSlotAt(slot));
  if (head.status === 'published') return { kind: 'wait', status: 'published', code: null };
  if (head.status === 'returned' || head.status === 'skipped') return { kind: 'wait', status: 'skipped', code: `owner-${head.status}` };
  if (head.status === 'superseded') return { kind: 'wait', status: 'failed', code: 'plan-post-superseded' };
  if (head.status === 'failed') return { kind: 'wait', status: 'failed', code: 'publish-failed' };
  if (head.status === 'publishing' || head.status === 'reconciliation') return { kind: 'wait', status: 'approved', code: null };
  const ownerEdit = !!slot.written_revision_id && head.id !== slot.written_revision_id;
  if (head.status === 'review') {
    if (!head.ready || renderReportBlocks(head.render_report)) return { kind: 'wait', status: 'failed', code: 'render-blocked' };
    if (!ownerEdit && head.revision.deck && dneskaiKitOf(head.revision.deck) !== DNESKAI_GENERATION_KIT) return { kind: 'spotlight', status: 'ready' };
    if (!ownerEdit && Date.parse(head.revision.scheduledAt) !== slotAt) return { kind: 'move', status: 'ready' };
    if (!slot.instagram && head.revision.account.platform === 'instagram') {
      return threadsAccount ? { kind: 'to-threads', status: 'ready' } : { kind: 'wait', status: 'ready', code: 'threads-account-missing' };
    }
    if (Date.parse(head.revision.scheduledAt) <= now.getTime() + APPROVAL_LEAD_MS) return { kind: 'wait', status: 'failed', code: 'slot-passed' };
    return { kind: 'approve', status: 'approved' };
  }
  if (head.status === 'approved' && slot.instagram && slot.threads && head.revision.account.platform === 'instagram') {
    if (!threadsAccount) return { kind: 'wait', status: 'approved', code: 'threads-account-missing' };
    if (Date.parse(head.revision.scheduledAt) <= now.getTime() + APPROVAL_LEAD_MS) return { kind: 'wait', status: 'approved', code: twin?.status === 'approved' ? null : 'threads-slot-passed' };
    if (!twin || slot.threads_base_revision_id !== head.id || ['skipped', 'superseded', 'returned', 'failed'].includes(twin.status)) return { kind: 'twin', status: 'approved' };
    if (twin.status === 'review') return twin.ready ? { kind: 'approve-twin', status: 'approved' } : { kind: 'wait', status: 'approved', code: 'threads-twin-not-ready' };
  }
  return { kind: 'wait', status: 'approved', code: null };
}

/** The empty slots from `from` through `until`: Instagram and Threads at the three day times, Threads alone at 20:00. */
export function dneskaiPlanEmptySlots(taken: ReadonlyArray<Pick<DneskaiPlanRow, 'date' | 'local_time'>>, from: string, until: string): Array<{ date: string; time: string; instagram: boolean }> {
  const used = new Set(taken.map((slot) => `${slot.date} ${slot.local_time}`));
  const result: Array<{ date: string; time: string; instagram: boolean }> = [];
  for (let date = from; date <= until; date = pragueDayAfter(date, 1)) {
    for (const time of DNESKAI_PLAN_TIMES) if (!used.has(`${date} ${time}`)) result.push({ date, time, instagram: (DNESKAI_PLAN_INSTAGRAM_TIMES as readonly string[]).includes(time) });
  }
  return result;
}

export type DneskaiPlanResult = { filled: number; worked: number; rendered: number; approved: number; twins: number; codes: Record<string, number> };

const read = <T>(result: { data: T | null; error: unknown }, code: string): T => { if (result.error) throw new Error(code); return result.data as T; };
const SLOT_COLUMNS = 'id,user_id,project_id,date,local_time,instagram,threads,kind,revision_id,topic_id,head_revision_id,threads_revision_id,written_revision_id,threads_base_revision_id,status,code';

/** Fills empty slots with approved, unplanned education topics, oldest approval first. */
async function fillPlan(db: Database, owner: string, project: string, today: string): Promise<number> {
  const from = pragueDayAfter(today, 1), until = pragueDayAfter(today, DNESKAI_PLAN_DAYS - 1);
  const taken = read(await db.from('marketing_dneskai_plan').select('date,local_time').eq('user_id', owner).eq('project_id', project).gte('date', from).lte('date', until).limit(400), 'plan-unavailable') as Array<{ date: string; local_time: string }>;
  const empty = dneskaiPlanEmptySlots(taken, from, until).slice(0, FILL_LIMIT);
  if (!empty.length) return 0;
  const topics = read(await db.from('marketing_dneskai_topics').select('id,evidence').eq('user_id', owner).eq('project_id', project).eq('kind', 'education').eq('status', 'approved')
    .is('evidence->>planDate', null).order('approved_at', { ascending: true }).order('created_at', { ascending: true }).limit(empty.length), 'plan-topics-unavailable') as Array<{ id: string; evidence: Record<string, unknown> | null }>;
  let filled = 0;
  for (const [index, topic] of topics.entries()) {
    const slot = empty[index]!;
    const inserted = await db.from('marketing_dneskai_plan').insert({ user_id: owner, project_id: project, date: slot.date, local_time: slot.time, instagram: slot.instagram, threads: true, kind: 'education', topic_id: topic.id }).select('id');
    if (inserted.error) continue; // A slot taken meanwhile or a topic planned by another tick: the next pass sees it.
    const { error } = await db.from('marketing_dneskai_topics').update({ evidence: { ...(topic.evidence ?? {}), planDate: slot.date, planTime: slot.time }, updated_at: new Date().toISOString() }).eq('user_id', owner).eq('id', topic.id);
    if (error) throw new Error('plan-topic-write-failed');
    filled++;
  }
  return filled;
}

const RevisionRowSchema = z.object({ id: z.uuid(), status: z.string(), ready: z.boolean(), content_hash: z.string(), revision: z.unknown(), render_report: z.unknown().optional(), slides: z.unknown().optional() });
async function revisionRow(db: Database, owner: string, id: string) {
  const row = read(await db.from('marketing_revisions').select('id,status,ready,content_hash,revision,render_report,slides').eq('user_id', owner).eq('id', id).maybeSingle(), 'plan-revision-unavailable');
  return row ? RevisionRowSchema.parse(row) : null;
}

/** The newest revision of the post: the slot's head (or first revision, or the topic's draft) and its successors. */
async function resolveHead(db: Database, owner: string, slot: DneskaiPlanRow): Promise<DneskaiPlanHead | null> {
  let id = slot.head_revision_id ?? slot.revision_id;
  if (!id && slot.topic_id) {
    const topic = read(await db.from('marketing_dneskai_topics').select('status,evidence').eq('user_id', owner).eq('id', slot.topic_id).maybeSingle(), 'plan-topic-unavailable') as { status: string; evidence: Record<string, unknown> | null } | null;
    id = topic?.status === 'generated' && typeof topic.evidence?.revisionId === 'string' ? topic.evidence.revisionId : null;
  }
  if (!id) return null;
  for (let step = 0; step < 30; step++) {
    const next = read(await db.from('marketing_revisions').select('id').eq('user_id', owner).eq('replaces_id', id).order('created_at', { ascending: false }).limit(1), 'plan-revision-unavailable') as Array<{ id: string }>;
    if (!next.length) break;
    id = next[0]!.id;
  }
  const row = await revisionRow(db, owner, id);
  if (!row) return null;
  try { return { id: row.id, status: row.status, ready: row.ready, content_hash: row.content_hash, revision: parseContentRevision(row.revision), render_report: row.render_report ?? null }; }
  catch { return null; }
}

type Wiring = { render: ReturnType<typeof getRenderDneskaiDeck>; loadMedia: ReturnType<typeof getDneskaiMediaLoader>; listBriefAssetHashes: ReturnType<typeof getBriefAssetHashLister>; loadBriefPool: ReturnType<typeof getBriefPoolLoader> };

/** A news post goes out after its 48 hours: its brief stays current until a day after the slot, and its source packet is re-read. */
async function keepNewsCurrent(db: Database, owner: string, slot: DneskaiPlanRow, revision: ContentRevision, signal: AbortSignal) {
  if (slot.kind !== 'news') return;
  const until = new Date(Date.parse(dneskaiPlanSlotAt(slot)) + NEWS_EXTENSION_MS).toISOString();
  for (const source of revision.sources) {
    const { error } = await db.rpc('marketing_dneskai_plan_extend_brief', { p_owner: owner, p_event: source.sourceId, p_until: until });
    if (error) throw new Error('plan-brief-extension-failed');
    // The brief is the local producer: re-reading it stores the packet with the new expiry (same content hash).
    await synchronizeMarketingSources(db, owner, 'dneskai', [source.sourceId], undefined, signal);
  }
}

/** Saves the plan's own edit of the head (Spotlight and/or the slot's time) and renders it, reusing the JPEGs when the deck is unchanged. */
async function saveEdit(db: Database, owner: string, head: DneskaiPlanHead, edit: { kit: boolean; scheduledAt: string }, wiring: Wiring, signal: AbortSignal) {
  const deck = head.revision.deck;
  const deckEdit = edit.kit && deck ? { kit: DNESKAI_GENERATION_KIT, slides: deck.slides.map((_, from) => ({ from })) } : undefined;
  const revision = await prepareDneskaiRevisionEdit(head.revision, { caption: head.revision.caption, scheduledAt: edit.scheduledAt, ...(deckEdit ? { deck: deckEdit } : {}) }, wiring.listBriefAssetHashes, wiring.loadBriefPool);
  let reuse = reusableDneskaiRender(head.revision, head.render_report, revision);
  if (reuse) { try { reuse = { ...reuse, assets: await refreshMarketingAssetUrls(db, owner, reuse.assets) }; } catch { reuse = null; } }
  const saved = await saveRevision(db, owner, revision, { replacesId: head.id, slides: [] });
  const rendered = await renderAndAttachDneskaiRevision(db, owner, { revisionId: saved.id, revision }, { render: wiring.render, loadMedia: wiring.loadMedia, signal, reuse });
  return { id: saved.id, rendered: !rendered.reused, ready: rendered.ready };
}

async function threadsAccountOf(db: Database, owner: string): Promise<DneskaiThreadsAccount | null> {
  return read(await db.from('marketing_accounts').select('remote_account_id,handle').eq('user_id', owner).eq('brand', 'dneskai').eq('platform', 'threads').not('verified_at', 'is', null).maybeSingle(), 'plan-account-unavailable') as DneskaiThreadsAccount | null;
}

async function approve(db: Database, owner: string, id: string, hash: string) {
  const { error } = await db.rpc('marketing_dneskai_plan_approve', { p_owner: owner, p_revision_id: id, p_expected_hash: hash });
  if (error) throw new Error(`plan-approval-${(error.message ?? 'failed').replace(/[^a-z]+/gi, '-').toLowerCase().replace(/^-|-$/g, '').slice(0, 60) || 'failed'}`);
}

export async function advanceDneskaiPlan(db: Database, owner: string, project: string, input: { now: Date; signal: AbortSignal; remainingMs: () => number }): Promise<DneskaiPlanResult> {
  z.uuid().parse(owner); z.uuid().parse(project);
  const result: DneskaiPlanResult = { filled: 0, worked: 0, rendered: 0, approved: 0, twins: 0, codes: {} };
  const today = pragueMarketingDate(input.now);
  result.filled = await fillPlan(db, owner, project, today);
  const slots = read(await db.from('marketing_dneskai_plan').select(SLOT_COLUMNS).eq('user_id', owner).eq('project_id', project).gte('date', today)
    .lte('date', pragueDayAfter(today, DNESKAI_PLAN_HORIZON_DAYS)).not('status', 'in', '(published,skipped)').order('date').order('local_time').limit(20), 'plan-unavailable') as DneskaiPlanRow[];
  const account = await threadsAccountOf(db, owner);
  let wiring: Wiring | null = null;
  const wired = () => (wiring ??= { render: getRenderDneskaiDeck(db), loadMedia: getDneskaiMediaLoader(db, owner), listBriefAssetHashes: getBriefAssetHashLister(db, owner), loadBriefPool: getBriefPoolLoader(db, owner) });
  const record = async (slot: DneskaiPlanRow, patch: Partial<DneskaiPlanRow>) => {
    const changed = Object.entries(patch).some(([key, value]) => slot[key as keyof DneskaiPlanRow] !== value);
    if (!changed) return;
    const { error } = await db.from('marketing_dneskai_plan').update(patch).eq('user_id', owner).eq('id', slot.id);
    if (error) throw new Error('plan-write-failed');
  };
  for (const slot of slots) {
    if (input.remainingMs() < 8_000 || input.signal.aborted) break;
    try {
      // Up to four steps per slot in one pass (move, approve, twin, approve twin); a render ends the slot's pass.
      for (let pass = 0; pass < 4; pass++) {
        if (input.remainingMs() < 8_000) break;
        const head = await resolveHead(db, owner, slot);
        const twin = slot.threads_revision_id ? await revisionRow(db, owner, slot.threads_revision_id) : null;
        const action = dneskaiPlanAction(slot, head, twin, !!account, input.now);
        const base: Partial<DneskaiPlanRow> = { head_revision_id: head?.id ?? slot.head_revision_id, status: action.status, code: action.kind === 'wait' ? action.code : null };
        if (action.kind === 'wait') { await record(slot, base); Object.assign(slot, base); break; }
        result.worked++;
        const current = head!;
        if (action.kind === 'spotlight' || action.kind === 'move') {
          if (action.kind === 'spotlight' && (result.rendered >= 1 || input.remainingMs() < 30_000)) { await record(slot, { ...base, code: 'plan-render-waiting' }); break; }
          await keepNewsCurrent(db, owner, slot, current.revision, input.signal);
          const saved = await saveEdit(db, owner, current, { kit: action.kind === 'spotlight', scheduledAt: dneskaiPlanSlotAt(slot) }, wired(), input.signal);
          if (saved.rendered) result.rendered++;
          const patch = { ...base, head_revision_id: saved.id, written_revision_id: saved.id, status: saved.ready ? 'ready' as const : 'failed' as const, code: saved.ready ? null : 'render-blocked' };
          await record(slot, patch); Object.assign(slot, patch);
          if (saved.rendered) break;
          continue;
        }
        if (action.kind === 'to-threads') {
          await keepNewsCurrent(db, owner, slot, current.revision, input.signal);
          const twinRevision = dneskaiThreadsTwin(current.revision, account!, dneskaiPlanSlotAt(slot));
          const saved = await saveRevision(db, owner, { ...twinRevision, assets: await refreshMarketingAssetUrls(db, owner, twinRevision.assets) }, { replacesId: current.id, slides: [] });
          const patch = { ...base, head_revision_id: saved.id, written_revision_id: saved.id, status: saved.ready ? 'ready' as const : 'failed' as const, code: saved.ready ? null : 'threads-twin-not-ready' };
          await record(slot, patch); Object.assign(slot, patch);
          continue;
        }
        if (action.kind === 'approve') {
          await keepNewsCurrent(db, owner, slot, current.revision, input.signal);
          await approve(db, owner, current.id, current.content_hash);
          result.approved++;
          const patch = { ...base, written_revision_id: slot.written_revision_id ?? current.id };
          await record(slot, patch); Object.assign(slot, patch);
          continue;
        }
        if (action.kind === 'twin') {
          if (slot.threads_revision_id) await db.rpc('marketing_dneskai_plan_retire', { p_owner: owner, p_revision_id: slot.threads_revision_id });
          const twinRevision = dneskaiThreadsTwin(current.revision, account!);
          const saved = await saveRevision(db, owner, { ...twinRevision, assets: await refreshMarketingAssetUrls(db, owner, twinRevision.assets) }, {});
          result.twins++;
          const patch = { ...base, threads_revision_id: saved.id, threads_base_revision_id: current.id };
          await record(slot, patch); Object.assign(slot, patch);
          continue;
        }
        // approve-twin
        await approve(db, owner, twin!.id, twin!.content_hash);
        result.approved++;
        await record(slot, base); Object.assign(slot, base);
      }
    } catch (error) {
      const code = error instanceof Error && /^[a-z][a-z0-9-]{1,99}$/.test(error.message) ? error.message : 'plan-step-failed';
      result.codes[code] = (result.codes[code] ?? 0) + 1;
      await record(slot, { code }).catch(() => undefined);
    }
  }
  return result;
}
