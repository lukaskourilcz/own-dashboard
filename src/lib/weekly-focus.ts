import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { awaitWithSignal } from '@/lib/abortable';
import { databaseTimestamp } from '@/lib/database-version';

const MAX_BYTES = 524_288;
const day = z.iso.date().refine(value => value.slice(0, 4) !== '0000');
const week = day.refine(value => new Date(`${value}T12:00:00Z`).getUTCDay() === 1);
const itemSchema = z.strictObject({
  id: z.uuid(), user_id: z.uuid(), set_id: z.uuid(), todo_id: z.uuid().nullable(), position: z.number().int().min(1).max(7),
  title_snapshot: z.string().min(1).max(4000), project_name_snapshot: z.string().max(4000).nullable(), completed_at: databaseTimestamp.nullable(),
});
const setSchema = z.strictObject({ id: z.uuid(), user_id: z.uuid(), focus_date: day, generation: z.number().int().positive().max(2_147_483_647), items: z.array(itemSchema).max(7) });
const snapshotSchema = z.strictObject({ ownerId: z.uuid(), weekStart: week, sets: z.array(setSchema).max(7) });
export type WeeklyFocusSet = z.infer<typeof setSchema>;

/** Complete owner/week identity, source order and unique item positions are
 * checked before any cached recap or carry list can use the snapshot. */
export function parseWeeklyFocusSnapshot(value: unknown, ownerId: string, weekStart: string): WeeklyFocusSet[] {
  z.uuid().parse(ownerId); week.parse(weekStart);
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_BYTES) throw Error('Weekly focus unavailable');
  const result = snapshotSchema.parse(value);
  if (result.ownerId !== ownerId || result.weekStart !== weekStart) throw Error('Weekly focus unavailable');
  const from = Date.parse(`${weekStart}T00:00:00Z`), until = from + 7 * 86_400_000;
  const ids = new Set<string>(), itemIds = new Set<string>(); let previousDay = '';
  for (const set of result.sets) {
    const instant = Date.parse(`${set.focus_date}T00:00:00Z`);
    if (set.user_id !== ownerId || ids.has(set.id) || set.focus_date <= previousDay || instant < from || instant >= until) throw Error('Weekly focus unavailable');
    ids.add(set.id); previousDay = set.focus_date;
    let position = 0; const todos = new Set<string>();
    for (const item of set.items) {
      if (item.user_id !== ownerId || item.set_id !== set.id || itemIds.has(item.id) || item.position <= position || (item.todo_id !== null && todos.has(item.todo_id))) throw Error('Weekly focus unavailable');
      itemIds.add(item.id); position = item.position;
      if (item.todo_id !== null) todos.add(item.todo_id);
    }
  }
  return result.sets;
}

/** One RPC under the caller's RLS, with no SDK retry and one fifteen-second
 * read budget. Nothing here persists task titles or calendar content. */
export async function loadWeeklyFocusSnapshot(client: SupabaseClient, ownerId: string, weekStart: string, parent?: AbortSignal): Promise<WeeklyFocusSet[]> {
  const timeout = AbortSignal.timeout(15_000), signal = parent ? AbortSignal.any([parent, timeout]) : timeout;
  try {
    z.uuid().parse(ownerId); week.parse(weekStart); signal.throwIfAborted();
    const { data, error } = await awaitWithSignal(client.rpc('weekly_focus_snapshot', { p_week_start: weekStart }).retry(false).abortSignal(signal), signal);
    if (error) throw Error('Weekly focus unavailable');
    return parseWeeklyFocusSnapshot(data, ownerId, weekStart);
  } catch {
    if (parent?.aborted) throw new DOMException('Request aborted', 'AbortError');
    throw Error('Weekly focus unavailable');
  }
}
