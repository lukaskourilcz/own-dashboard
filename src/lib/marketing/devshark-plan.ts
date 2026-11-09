import 'server-only';
import { z } from 'zod';
import type { createAdminClient } from '@/lib/supabase/admin';
import { pragueMarketingDate } from './weekly-planning';
import { pragueDayAfter } from './dneskai-workspace';

/**
 * The devShark publishing plan (owner request, 7 November 2026). The cadence is one Instagram post a day at 16:00
 * Prague (15:00 UTC in winter; 12:00 until 8 November 2026, moved after the Apify research), which also goes to
 * Threads, and a second Threads post at 19:00: one Instagram and two Threads posts a day.
 * Only concepts the owner approved (`marketing_devshark_drafts.status = 'approved'`) enter the plan, oldest decision
 * first. The Wednesday and Friday Instagram slots prefer marked concepts. A marked concept waits for one of those
 * slots. The step runs only with DEVSHARK_PLAN_ENABLED=true and never publishes anything itself.
 */
type Database = ReturnType<typeof createAdminClient>;

export const DEVSHARK_PLAN_SLOTS = [
  { time: '16:00', instagram: true, threads: true },
  { time: '19:00', instagram: false, threads: true },
] as const;
export const DEVSHARK_PLAN_DAYS = 30;

export function devsharkPlanEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DEVSHARK_PLAN_ENABLED === 'true';
}

export type DevsharkPlanSlot = { date: string; time: (typeof DEVSHARK_PLAN_SLOTS)[number]['time']; instagram: boolean; threads: boolean };

/** The empty slots from `from` through `until`, in order, minus the taken ones. */
export function devsharkPlanEmptySlots(taken: ReadonlyArray<{ date: string; local_time: string }>, from: string, until: string): DevsharkPlanSlot[] {
  const used = new Set(taken.map((slot) => `${slot.date} ${slot.local_time}`));
  const result: DevsharkPlanSlot[] = [];
  for (let date = from; date <= until; date = pragueDayAfter(date, 1)) {
    for (const slot of DEVSHARK_PLAN_SLOTS) if (!used.has(`${date} ${slot.time}`)) result.push({ date, time: slot.time, instagram: slot.instagram, threads: slot.threads });
  }
  return result;
}

/** Posts a day the plan holds on each network, for the cadence check and the owner's overview. */
export function devsharkPlanDailyCounts(slots: ReadonlyArray<Pick<DevsharkPlanSlot, 'date' | 'instagram' | 'threads'>>): Map<string, { instagram: number; threads: number }> {
  const counts = new Map<string, { instagram: number; threads: number }>();
  for (const slot of slots) {
    const day = counts.get(slot.date) ?? { instagram: 0, threads: 0 };
    counts.set(slot.date, { instagram: day.instagram + Number(slot.instagram), threads: day.threads + Number(slot.threads) });
  }
  return counts;
}

const read = <T>(result: { data: T | null; error: unknown }, code: string): T => { if (result.error) throw new Error(code); return result.data as T; };

type ApprovedDraft = { id: string };

export function devsharkPlanAssignments(slots: readonly DevsharkPlanSlot[], regular: readonly ApprovedDraft[], strong: readonly ApprovedDraft[]) {
  const normalQueue = [...regular], strongQueue = [...strong];
  return slots.flatMap((slot) => {
    const weekday = new Date(`${slot.date}T00:00:00Z`).getUTCDay();
    const preferred = slot.instagram && (weekday === 3 || weekday === 5);
    const draft = (preferred ? strongQueue.shift() : undefined) ?? normalQueue.shift();
    return draft ? [{ slot, draft }] : [];
  });
}

/** Places approved, unplanned concepts into the empty slots from tomorrow on; returns how many it placed. */
export async function fillDevsharkPlan(db: Database, owner: string, project: string, now: Date): Promise<{ placed: number; waiting: number }> {
  z.uuid().parse(owner); z.uuid().parse(project);
  const from = pragueDayAfter(pragueMarketingDate(now), 1), until = pragueDayAfter(from, DEVSHARK_PLAN_DAYS - 1);
  const taken = read(await db.from('marketing_devshark_plan').select('date,local_time').eq('user_id', owner).eq('project_id', project).gte('date', from).lte('date', until).limit(200), 'devshark-plan-unavailable') as Array<{ date: string; local_time: string }>;
  const empty = devsharkPlanEmptySlots(taken, from, until);
  const approved = () => db.from('marketing_devshark_drafts').select('id').eq('user_id', owner).eq('project_id', project).eq('status', 'approved')
    .order('decided_at', { ascending: true }).order('id').limit(Math.max(1, empty.length));
  const [regularResult, strongResult] = await Promise.all([
    approved().not('deck', 'cs', '{"strong":true}'),
    approved().contains('deck', { strong: true }),
  ]);
  const regular = read(regularResult, 'devshark-drafts-unavailable');
  const strong = read(strongResult, 'devshark-drafts-unavailable');
  let placed = 0;
  for (const { slot, draft } of devsharkPlanAssignments(empty, regular, strong)) {
    const inserted = await db.from('marketing_devshark_plan').insert({ user_id: owner, project_id: project, date: slot.date, local_time: slot.time, instagram: slot.instagram, threads: slot.threads, draft_id: draft.id }).select('id');
    if (inserted.error) continue;
    const { error } = await db.from('marketing_devshark_drafts').update({ status: 'planned', updated_at: new Date().toISOString() }).eq('user_id', owner).eq('id', draft.id).eq('status', 'approved');
    if (error) throw new Error('devshark-draft-write-failed');
    placed++;
  }
  return { placed, waiting: regular.length + strong.length - placed };
}
