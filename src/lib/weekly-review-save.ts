import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { awaitWithSignal } from '@/lib/abortable';
import { databaseTimestamp, databaseVersion } from '@/lib/database-version';
import type { WeeklyReview } from '@/lib/types';

const week = z.iso.date().refine(value => value.slice(0,4) !== '0000' && new Date(`${value}T12:00:00Z`).getUTCDay() === 1);
const objective = z.strictObject({ id: z.string().min(1).max(200), text: z.string().min(1).max(2000).refine(value => value.trim().length > 0), done: z.boolean(), carriedFrom: z.string().min(1).max(200).optional() });
const lines = z.array(z.string().max(2000)).max(100);
const count = z.number().int().min(0).max(49);
export const weeklyReviewPatchSchema = z.strictObject({ summary: z.string().max(20_000).optional(), items: z.strictObject({
  step: z.enum(['time','done','carry','objectives','summary']),
  objectives: z.array(objective).max(100).refine(rows => new Set(rows.map(row => row.id)).size === rows.length).optional(),
  facts: lines.optional(), risks: lines.optional(), decisions: lines.optional(), priorities: lines.optional(), followUps: lines.optional(), sources: lines.optional(),
  timeByChannel: z.strictObject({ minutes: z.strictObject({ client: z.number().min(0).max(1e9), project: z.number().min(0).max(1e9), admin: z.number().min(0).max(1e9) }), unmatchedEvents: z.number().int().min(0).max(1e6), source: z.enum(['google','unavailable']) }).optional(),
  focusRecap: z.strictObject({ completed: count, total: count, days: z.number().int().min(0).max(7) }).refine(value => value.completed <= value.total).optional(),
}) });
const rowSchema = z.strictObject({ id: z.uuid(), user_id: z.uuid(), week_start: week, status: z.enum(['draft','completed']), summary: z.string(), items: z.record(z.string(),z.unknown()), completed_at: databaseTimestamp.nullable(), created_at: databaseTimestamp, updated_at: databaseTimestamp });
const envelope = { ownerId: z.uuid(), weekStart: week, sourceUpdatedAt: databaseTimestamp.nullable() };
const receiptSchema = z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('saved'), ...envelope, review: rowSchema }), z.strictObject({ kind: z.literal('conflict'), ...envelope, review: z.null() })]);
export type WeeklyReviewPatch = z.infer<typeof weeklyReviewPatchSchema>;
export type WeeklyReviewSave = { ownerId: string; id: string; weekStart: string; expected: WeeklyReview | null; mode: 'auto'|'draft'|'complete'; patch: WeeklyReviewPatch };
export type WeeklyReviewReceipt = z.infer<typeof receiptSchema>;
const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
function equal(a: unknown,b: unknown): boolean {
  if (Object.is(a,b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Object.keys(a), right = Object.keys(b);
  return left.length === right.length && left.every(key => Object.hasOwn(b,key) && equal((a as Record<string,unknown>)[key],(b as Record<string,unknown>)[key]));
}

/** One captured owner/week/version write. Fixed errors reveal no private SQL or draft. */
export async function saveWeeklyReview(client: SupabaseClient, input: WeeklyReviewSave, parent?: AbortSignal): Promise<WeeklyReviewReceipt> {
  const signal = parent ? AbortSignal.any([parent,AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
  try {
    signal.throwIfAborted();
    const captured = structuredClone(input), patch = weeklyReviewPatchSchema.parse(captured.patch), source = captured.expected;
    z.uuid().parse(captured.ownerId); z.uuid().parse(captured.id); week.parse(captured.weekStart); z.enum(['auto','draft','complete']).parse(captured.mode);
    if (source) {
      rowSchema.parse(source);
      if (source.id !== captured.id || source.user_id !== captured.ownerId || source.week_start !== captured.weekStart) throw Error();
    }
    if (byteLength(patch)>262144) throw Error();
    const { data,error } = await awaitWithSignal(client.rpc('save_weekly_review', { p_owner: captured.ownerId,p_id: captured.id,p_week_start: captured.weekStart,p_expected_updated_at: source?.updated_at ?? null,p_mode: captured.mode,p_patch: patch }).retry(false).abortSignal(signal), signal);
    if (error || byteLength(data)>524288) throw Error();
    const receipt = receiptSchema.parse(data);
    if (receipt.ownerId !== captured.ownerId || receipt.weekStart !== captured.weekStart) throw Error();
    if (receipt.kind === 'conflict') return receipt;
    const row = receipt.review, from = receipt.sourceUpdatedAt === null ? null : databaseVersion(receipt.sourceUpdatedAt), to = databaseVersion(row.updated_at)!;
    if (row.id !== captured.id || row.user_id !== captured.ownerId || row.week_start !== captured.weekStart || (from !== null && to < from)
      || (from === null && source !== null) || (from === null && databaseVersion(row.created_at) !== to)
      || (patch.summary !== undefined && row.summary !== patch.summary)
      || Object.entries(patch.items).some(([key,value]) => !Object.hasOwn(row.items,key) || !equal(row.items[key],value))
      || (captured.mode === 'draft' && (row.status !== 'draft' || row.completed_at !== null))
      || (captured.mode === 'complete' && (row.status !== 'completed' || row.completed_at === null))) throw Error();
    // A changed source is accepted only as an unchanged, already-stored retry.
    const sameSource = source !== null && from === databaseVersion(source.updated_at);
    if (from !== null && !sameSource && to !== from) throw Error();
    if (sameSource) {
      const expectedItems = { ...source.items,...patch.items };
      const changed = row.summary !== source.summary || !equal(row.items,source.items) || row.status !== source.status
        || (row.completed_at === null ? null : databaseVersion(row.completed_at)) !== (source.completed_at === null ? null : databaseVersion(source.completed_at));
      if (changed ? to <= from! : to !== from) throw Error();
      if (!equal(row.items,expectedItems) || (patch.summary === undefined && row.summary !== source.summary)
        || databaseVersion(row.created_at) !== databaseVersion(source.created_at)
        || (captured.mode === 'auto' && (row.status !== source.status || (row.completed_at === null ? null : databaseVersion(row.completed_at)) !== (source.completed_at === null ? null : databaseVersion(source.completed_at))))) throw Error();
    }
    return receipt;
  } catch { if (parent?.aborted) throw new DOMException('Request aborted','AbortError'); throw Error('Weekly review save unconfirmed'); }
}

/** Apply only to the captured row. A late save never replaces newer edits or a missing source. */
export function applyWeeklyReviewReceipt(rows: WeeklyReview[], source: WeeklyReview | null, receipt: WeeklyReviewReceipt): { rows: WeeklyReview[]; reconcile: boolean } {
  if (receipt.kind !== 'saved') return { rows,reconcile: true };
  const saved = receipt.review;
  const current = rows.find(row => row.user_id === saved.user_id && row.week_start === saved.week_start);
  if (current && equal(current,saved)) return { rows,reconcile: false };
  if (source ? !current || !equal(current,source) : current !== undefined) return { rows,reconcile: true };
  return { rows: [saved,...rows.filter(row => row !== current)],reconcile: false };
}
