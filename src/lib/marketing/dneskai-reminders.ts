import 'server-only';
import { z } from 'zod';
import type { createAdminClient } from '@/lib/supabase/admin';
import { dneskaiLab } from '@/lib/i18n/sections/dneskai-lab';
import { pragueDate, pragueDayAfter } from './dneskai-workspace';
import { pragueMarketingDate } from './weekly-planning';

/**
 * Review reminders (owner decision 7, 22 October 2026): an in-app notification in OwnDashboard's own `notifications`
 * table, never an e-mail or another channel. Two kinds, each at most once:
 *
 * - `first-ready`: the first post of a Prague day (today or tomorrow) is rendered and waits for review. One per day.
 * - `slot-soon`: the earliest unapproved post of today is due within 60 minutes. One per slot instant, so an edit,
 *   which saves a new revision, never sends it again.
 *
 * The pg_cron tick calls this every five minutes; the `source_id` key makes every call after the first a no-op.
 */
type Admin = Pick<ReturnType<typeof createAdminClient>, 'from'>;
export const DNESKAI_REMINDER_KIND = 'dneskai-review-reminder';
export const DNESKAI_REMINDER_SOURCE = 'dneskai-reminder';
/** How long before the first unapproved slot the second reminder goes out. */
export const DNESKAI_REMINDER_LEAD_MS = 60 * 60_000;

export type DneskaiReminderPost = { id: string; status: string; ready: boolean; scheduledAt: string; title: string };
export type DneskaiReminder = { key: string; kind: 'first-ready' | 'slot-soon'; revisionId: string; date: string; scheduledAt: string; count: number };

const prague = (iso: string) => new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** The reminders due now. Pure: the store decides which of them were already sent. */
export function dneskaiDueReminders(posts: readonly DneskaiReminderPost[], now: Date): DneskaiReminder[] {
  const today = pragueMarketingDate(now);
  const waiting = posts.filter((post) => post.status === 'review' && post.ready && Date.parse(post.scheduledAt) > now.getTime())
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
  const due: DneskaiReminder[] = [];
  for (const date of [today, pragueDayAfter(today, 1)]) {
    const day = waiting.filter((post) => pragueDate(post.scheduledAt) === date);
    if (day.length) due.push({ key: `first-ready:${date}`, kind: 'first-ready', revisionId: day[0]!.id, date, scheduledAt: day[0]!.scheduledAt, count: day.length });
  }
  const first = waiting.find((post) => pragueDate(post.scheduledAt) === today);
  if (first && Date.parse(first.scheduledAt) - now.getTime() <= DNESKAI_REMINDER_LEAD_MS) {
    due.push({ key: `slot-soon:${new Date(first.scheduledAt).toISOString()}`, kind: 'slot-soon', revisionId: first.id, date: today, scheduledAt: first.scheduledAt, count: 1 });
  }
  return due;
}

/** The notification text in the owner's language (user_preferences.language, Czech by default). */
export function dneskaiReminderText(reminder: DneskaiReminder, lang: 'en' | 'cs', today: string) {
  const t = dneskaiLab[lang].reminder;
  return reminder.kind === 'first-ready'
    ? { title: reminder.date === today ? t.readyTodayTitle : t.readyTomorrowTitle, body: t.readyBody(reminder.count, prague(reminder.scheduledAt)) }
    : { title: t.soonTitle(prague(reminder.scheduledAt)), body: t.soonBody };
}

const RevisionRowSchema = z.object({ id: z.uuid(), status: z.string(), ready: z.boolean(), scheduled_at: z.string().nullable(), title: z.string().nullable() });

/**
 * Reads the owner's DNESKAi revisions waiting for review and writes the reminders not sent before. Returns how many it
 * wrote. A notification the owner read, snoozed or dismissed still counts as sent.
 */
export async function sendDneskaiReviewReminders(db: Admin, owner: string, project: string, now: Date): Promise<{ due: number; sent: number }> {
  z.uuid().parse(owner); z.uuid().parse(project);
  const { data, error } = await db.from('marketing_revisions').select('id,status,ready,scheduled_at:revision->>scheduledAt,title:revision->>title')
    .eq('user_id', owner).eq('brand', 'dneskai').eq('status', 'review').eq('ready', true).gte('created_at', new Date(now.getTime() - 7 * 86_400_000).toISOString()).limit(60);
  if (error) throw new Error('reminder-state-unavailable');
  const posts = z.array(RevisionRowSchema).parse(data ?? []).flatMap((row) => row.scheduled_at && Number.isFinite(Date.parse(row.scheduled_at))
    ? [{ id: row.id, status: row.status, ready: row.ready, scheduledAt: row.scheduled_at, title: row.title ?? '' }] : []);
  const due = dneskaiDueReminders(posts, now);
  if (!due.length) return { due: 0, sent: 0 };
  const { data: sentRows, error: sentError } = await db.from('notifications').select('source_id').eq('user_id', owner).eq('source_type', DNESKAI_REMINDER_SOURCE).in('source_id', due.map((item) => item.key)).limit(10);
  if (sentError) throw new Error('reminder-state-unavailable');
  const sent = new Set(((sentRows ?? []) as Array<{ source_id: string | null }>).map((row) => row.source_id));
  const fresh = due.filter((item) => !sent.has(item.key));
  if (!fresh.length) return { due: due.length, sent: 0 };
  const { data: preference } = await db.from('user_preferences').select('language').eq('user_id', owner).maybeSingle();
  const lang = (preference as { language?: unknown } | null)?.language === 'en' ? 'en' : 'cs';
  const today = pragueMarketingDate(now);
  const rows = fresh.map((item) => ({
    user_id: owner, kind: DNESKAI_REMINDER_KIND, source_type: DNESKAI_REMINDER_SOURCE, source_id: item.key,
    ...dneskaiReminderText(item, lang, today),
    action_url: `/projects/${project}?projectTab=dneskai-review&labPost=${item.revisionId}&labSlide=0`,
  }));
  const { error: insertError } = await db.from('notifications').insert(rows);
  if (insertError) throw new Error('reminder-write-failed');
  return { due: due.length, sent: rows.length };
}
