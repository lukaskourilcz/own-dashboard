import 'server-only';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_DNESKAI_DAILY_MIX, DneskaiDailyMixSchema, type DneskaiDailyMix, type DneskaiDailyMixRead } from './dneskai-daily-mix';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the generated database types do not cover marketing tables
type Database = Pick<SupabaseClient<any>, 'from'>;

/**
 * The owner's daily mix (20261023100300). Off, missing or unreadable, it is the default (1 news, 1 education, 08:00
 * and 17:00); a malformed stored row never stops the pipeline.
 */
export async function readDneskaiDailyMix(db: Database, owner: string, project: string, options: { enabled: boolean }): Promise<DneskaiDailyMixRead> {
  if (!options.enabled) return { mix: DEFAULT_DNESKAI_DAILY_MIX, stored: false };
  z.uuid().parse(owner); z.uuid().parse(project);
  const { data, error } = await db.from('marketing_dneskai_daily_mix').select('news_per_day,education_per_day,slots').eq('user_id', owner).eq('project_id', project).maybeSingle();
  if (error || !data) return { mix: DEFAULT_DNESKAI_DAILY_MIX, stored: false };
  const row = data as { news_per_day: unknown; education_per_day: unknown; slots: unknown };
  const parsed = DneskaiDailyMixSchema.safeParse({ newsPerDay: row.news_per_day, educationPerDay: row.education_per_day, slots: row.slots });
  return parsed.success ? { mix: parsed.data, stored: true } : { mix: DEFAULT_DNESKAI_DAILY_MIX, stored: false };
}

/** Upserts the owner's mix through the owner's session, so RLS and the table's checks decide. */
export async function saveDneskaiDailyMix(db: Database, owner: string, project: string, mix: DneskaiDailyMix): Promise<void> {
  const { error } = await db.from('marketing_dneskai_daily_mix').upsert({ user_id: owner, project_id: project, news_per_day: mix.newsPerDay, education_per_day: mix.educationPerDay, slots: mix.slots,
    updated_at: new Date().toISOString() }, { onConflict: 'user_id,project_id' });
  if (error) throw new Error('daily-mix-save-failed');
}
