import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { DNESKAI_REMINDER_KIND, DNESKAI_REMINDER_SOURCE, dneskaiDueReminders, dneskaiReminderText, sendDneskaiReviewReminders, type DneskaiReminderPost } from '@/lib/marketing/dneskai-reminders';
import { pragueScheduledAt } from '@/lib/marketing/clock';

// 22 October 2026, 11:00 in Prague (UTC+2). Today's slots 12:30, 17:00 and 20:00 are still ahead.
const now = new Date('2026-10-22T09:00:00Z');
const owner = '11111111-1111-4111-8111-111111111111', project = '22222222-2222-4222-8222-222222222222';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const post = (n: number, date: string, time: string, patch: Partial<DneskaiReminderPost> = {}): DneskaiReminderPost =>
  ({ id: id(n), status: 'review', ready: true, scheduledAt: pragueScheduledAt(date, time), title: `Post ${n}`, ...patch });

describe('dneskaiDueReminders', () => {
  it('announces the first ready post of today and of tomorrow once per day', () => {
    const due = dneskaiDueReminders([post(2, '2026-10-22', '17:00'), post(1, '2026-10-22', '12:30'), post(3, '2026-10-23', '08:00')], new Date('2026-10-22T08:00:00Z'));
    expect(due.filter((item) => item.kind === 'first-ready')).toEqual([
      { key: 'first-ready:2026-10-22', kind: 'first-ready', revisionId: id(1), date: '2026-10-22', scheduledAt: pragueScheduledAt('2026-10-22', '12:30'), count: 2 },
      { key: 'first-ready:2026-10-23', kind: 'first-ready', revisionId: id(3), date: '2026-10-23', scheduledAt: pragueScheduledAt('2026-10-23', '08:00'), count: 1 },
    ]);
  });

  it('adds the 60-minute reminder for the first unapproved slot of today only inside the hour, keyed by the slot', () => {
    const posts = [post(1, '2026-10-22', '12:30'), post(2, '2026-10-22', '17:00')];
    // 11:00 Prague: 12:30 is 90 minutes away.
    expect(dneskaiDueReminders(posts, now).some((item) => item.kind === 'slot-soon')).toBe(false);
    const soon = dneskaiDueReminders(posts, new Date('2026-10-22T09:35:00Z'));
    expect(soon.find((item) => item.kind === 'slot-soon')).toMatchObject({ key: `slot-soon:${pragueScheduledAt('2026-10-22', '12:30')}`, revisionId: id(1) });
  });

  it('ignores approved, unready and past posts', () => {
    expect(dneskaiDueReminders([post(1, '2026-10-22', '12:30', { status: 'approved' }), post(2, '2026-10-22', '12:30', { ready: false }), post(3, '2026-10-22', '08:00')], now)).toEqual([]);
  });

  it('words both kinds in Czech and English without the post text', () => {
    const [ready] = dneskaiDueReminders([post(1, '2026-10-22', '12:30')], now);
    expect(dneskaiReminderText(ready!, 'cs', '2026-10-22')).toEqual({ title: 'DNESKAi: první dnešní příspěvek je připravený ke kontrole', body: 'Na schválení čeká 1 příspěvek. První čas je v 12:30.' });
    expect(dneskaiReminderText({ ...ready!, kind: 'slot-soon' }, 'en', '2026-10-22').title).toBe('DNESKAi: the 12:30 post is not approved yet');
  });
});

/** The four reads and one insert sendDneskaiReviewReminders makes, in memory. */
function fakeDb(input: { revisions: unknown[]; sent?: string[]; language?: string; failInsert?: boolean }) {
  const inserted: Array<Record<string, unknown>> = [];
  const filters: Array<[string, string, unknown]> = [];
  const from = (table: string) => {
    const query = {
      select: () => query, gte: () => query, limit: () => query,
      eq: (field: string, value: unknown) => { filters.push([table, field, value]); return query; },
      in: (field: string, value: unknown) => { filters.push([table, field, value]); return query; },
      maybeSingle: async () => ({ data: input.language ? { language: input.language } : null, error: null }),
      insert: async (rows: Array<Record<string, unknown>>) => { if (input.failInsert) return { error: { message: 'x' } }; inserted.push(...rows); return { error: null }; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(table === 'notifications' ? { data: (input.sent ?? []).map((source_id) => ({ source_id })), error: null } : { data: input.revisions, error: null }).then(resolve),
    };
    return query;
  };
  return { db: { from } as never, inserted, filters };
}
const row = (n: number, time: string) => ({ id: id(n), status: 'review', ready: true, scheduled_at: pragueScheduledAt('2026-10-22', time), title: `Post ${n}` });

describe('sendDneskaiReviewReminders', () => {
  it('writes each due reminder once into notifications, in the owner’s language, linking to the Lab post', async () => {
    const fake = fakeDb({ revisions: [row(1, '12:30')], language: 'en' });
    expect(await sendDneskaiReviewReminders(fake.db, owner, project, now)).toEqual({ due: 1, sent: 1 });
    expect(fake.inserted).toEqual([{ user_id: owner, kind: DNESKAI_REMINDER_KIND, source_type: DNESKAI_REMINDER_SOURCE, source_id: 'first-ready:2026-10-22',
      title: 'DNESKAi: today’s first post is ready for review', body: '1 post waits for approval. The first slot is at 12:30.',
      action_url: `/projects/${project}?projectTab=dneskai-review&labPost=${id(1)}&labSlide=0` }]);
    expect(fake.filters).toContainEqual(['marketing_revisions', 'user_id', owner]);
    expect(fake.filters).toContainEqual(['notifications', 'user_id', owner]);
  });

  it('sends nothing again once a reminder exists, read or dismissed, and reports a failed write', async () => {
    const again = fakeDb({ revisions: [row(1, '12:30')], sent: ['first-ready:2026-10-22'] });
    expect(await sendDneskaiReviewReminders(again.db, owner, project, now)).toEqual({ due: 1, sent: 0 });
    expect(again.inserted).toEqual([]);
    const quiet = fakeDb({ revisions: [] });
    expect(await sendDneskaiReviewReminders(quiet.db, owner, project, now)).toEqual({ due: 0, sent: 0 });
    await expect(sendDneskaiReviewReminders(fakeDb({ revisions: [row(1, '12:30')], failInsert: true }).db, owner, project, now)).rejects.toThrow('reminder-write-failed');
  });
});
