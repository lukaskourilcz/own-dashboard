import 'server-only';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { awaitWithSignal } from '@/lib/abortable';
import { databaseVersion } from '@/lib/database-version';
import { DEFAULT_DNESKAI_DAILY_MIX, DneskaiDailyMixReadSchema, DneskaiDailyMixSaveSchema, DneskaiDailyMixReceiptSchema, sameDneskaiDailyMix, type DneskaiDailyMix, type DneskaiDailyMixRead, type DneskaiDailyMixReceipt } from './dneskai-daily-mix';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the generated database types do not cover marketing tables
type Database = Pick<SupabaseClient<any>, 'from' | 'rpc'>;

/**
 * Only a successfully read absent row uses the default. An unavailable or
 * malformed configuration must never restore posts the owner switched off.
 */
export async function readDneskaiDailyMix(db: Database, owner: string, project: string, options: { enabled: boolean }): Promise<DneskaiDailyMixRead> {
  if (!options.enabled) return { mix: DEFAULT_DNESKAI_DAILY_MIX, stored: false, version: null };
  z.uuid().parse(owner); z.uuid().parse(project);
  const signal = AbortSignal.timeout(15_000);
  const { data, error } = await awaitWithSignal(db.from('marketing_dneskai_daily_mix').select('news_per_day,education_per_day,slots,updated_at').eq('user_id', owner).eq('project_id', project).retry(false).abortSignal(signal).maybeSingle(), signal);
  if (error) throw new Error('daily-mix-unavailable');
  if (!data) return { mix: DEFAULT_DNESKAI_DAILY_MIX, stored: false, version: null };
  const row = data as { news_per_day: unknown; education_per_day: unknown; slots: unknown; updated_at: unknown };
  const parsed = DneskaiDailyMixReadSchema.safeParse({ mix: { newsPerDay: row.news_per_day, educationPerDay: row.education_per_day, slots: row.slots }, stored: true, version: row.updated_at });
  if (!parsed.success) throw new Error('daily-mix-unavailable');
  return parsed.data;
}

/** Captured-version save through invoker RLS; never echo the input as evidence of persistence. */
export async function saveDneskaiDailyMix(db: Database, owner: string, project: string, mix: DneskaiDailyMix, expectedVersion: string | null): Promise<DneskaiDailyMixReceipt> {
  z.uuid().parse(owner); z.uuid().parse(project);
  const input = DneskaiDailyMixSaveSchema.parse({ mix, expectedVersion }), signal = AbortSignal.timeout(15_000);
  const { data, error } = await awaitWithSignal(db.rpc('save_dneskai_daily_mix', { p_project: project, p_expected_updated_at: input.expectedVersion, p_mix: input.mix }).retry(false).abortSignal(signal), signal);
  if (error) throw new Error('daily-mix-save-unconfirmed');
  const receipt = DneskaiDailyMixReceiptSchema.parse(data);
  const from = receipt.sourceVersion === null ? null : databaseVersion(receipt.sourceVersion), to = databaseVersion(receipt.read.version!)!;
  const expected = expectedVersion === null ? null : databaseVersion(expectedVersion);
  if (receipt.ownerId !== owner || receipt.projectId !== project || (from !== null && to < from)
    || (receipt.kind === 'saved' ? !sameDneskaiDailyMix(receipt.read.mix, mix) || (from !== to && from !== expected)
      : from === expected || from !== to || sameDneskaiDailyMix(receipt.read.mix, mix))) throw new Error('daily-mix-save-unconfirmed');
  return receipt;
}
