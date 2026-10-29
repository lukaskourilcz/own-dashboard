import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { dneskaiTopicTitles, readDneskaiWorkspace } from '@/lib/marketing/dneskai-workspace-read';
import { parseContentRevision } from '@/lib/marketing/contracts';
import type { DneskaiBrief } from '@/lib/marketing/dneskai-brief';
import { briefFixture, briefPictures } from './marketing-dneskai-generation-fixture';
import { deckRevision } from './marketing-dneskai-revision-fixture';

/** #211: a post, job or waiting brief made from an approved topic shows the topic's Czech working title. */
const owner = '11111111-1111-4111-8111-111111111111';
const now = new Date('2026-10-23T08:00:00Z');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const eventId = '9'.repeat(64), memberHash = 'c'.repeat(64);
const briefRowId = id(1), waitingBriefId = id(2), otherBriefId = id(3), jobId = id(4), revisionId = id(5);
let brief: DneskaiBrief;
beforeAll(async () => { brief = briefFixture(await briefPictures(), { eventId, memberHash }); });

type Result = { data: unknown[] | null; error: unknown };
/** A stand-in for the Supabase query builder: answers each table's reads in call order and records every chain. */
function fakeDb(tables: Record<string, Result[]>) {
  const calls: Array<Array<[string, unknown[]]>> = [];
  const used: Record<string, number> = {};
  const from = (table: string) => {
    const chain: Array<[string, unknown[]]> = [['from', [table]]]; calls.push(chain);
    const index = used[table] = (used[table] ?? -1) + 1;
    const result = tables[table]?.[index] ?? { data: [], error: null };
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'neq', 'in', 'not', 'gte', 'order', 'limit', 'retry', 'abortSignal']) builder[method] = (...args: unknown[]) => { chain.push([method, args]); return builder; };
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
    return builder;
  };
  return { db: { from } as never, calls };
}

function tables(topics: Result): Record<string, Result[]> {
  const base = deckRevision();
  const revision = parseContentRevision({ ...base, title: 'Source report title', sources: [{ ...base.sources[0]!, sourceId: eventId, sourceRevision: memberHash }] });
  return {
    marketing_revisions: [{ data: [{ id: revisionId, replaces_id: null, status: 'review', ready: true, content_hash: 'a'.repeat(64), created_at: '2026-10-23T07:00:00Z',
      approved_at: null, feedback: null, revision, render_report: null }], error: null }],
    marketing_jobs: [{ data: [{ id: jobId, status: 'queued', error_code: null, created_at: '2026-10-23T07:30:00Z', title: 'Queued source title', scheduled_at: '2026-10-23T16:00:00Z',
      revision_id: id(9), brand: 'dneskai' }], error: null }],
    marketing_dneskai_briefs: [
      { data: [{ id: waitingBriefId, status: 'ready', code: null, job_id: null, scheduled_at: '2026-10-23T18:00:00Z', title: 'Waiting source title' }], error: null },
      { data: [{ id: briefRowId, event_id: eventId, member_hash: memberHash, brief }], error: null },
    ],
    marketing_dneskai_topics: [topics],
  };
}
const topicRows = { data: [
  { brief_id: briefRowId, title_cs: 'Jak si nastavit vlastní příkazy', job_id: null },
  { brief_id: waitingBriefId, title_cs: 'Tři způsoby, jak zkrátit prompt', job_id: null },
  { brief_id: otherBriefId, title_cs: 'Aplikace, která z fotky tabule udělá poznámky', job_id: jobId },
], error: null };

describe('DNESKAi workspace topic working titles (#211)', () => {
  it('shows the approved working title on the post, the queued job and the waiting brief', async () => {
    const { db, calls } = fakeDb(tables(topicRows));
    const read = await readDneskaiWorkspace(db, owner, now, undefined, { topicTitles: true });
    expect(read.unreadable).toBe(0);
    expect(read.posts.map((post) => post.title)).toEqual(['Jak si nastavit vlastní příkazy']);
    expect(read.jobs.map((job) => job.title)).toEqual(['Aplikace, která z fotky tabule udělá poznámky']);
    expect(read.waiting?.map((item) => item.title)).toEqual(['Tři způsoby, jak zkrátit prompt']);
    // The source title stays in the brief the editor's sources read.
    expect(read.posts[0]!.brief?.title).toBe(brief.title);
    const topicChain = calls.find((chain) => chain[0]![1][0] === 'marketing_dneskai_topics')!;
    expect(topicChain).toContainEqual(['eq', ['user_id', owner]]);
    expect(topicChain.some(([method]) => method === 'limit')).toBe(true);
  });

  it('keeps the source titles and skips the topics table while the switch is off', async () => {
    const { db, calls } = fakeDb(tables(topicRows));
    const read = await readDneskaiWorkspace(db, owner, now);
    expect(read.posts.map((post) => post.title)).toEqual(['Source report title']);
    expect(read.jobs.map((job) => job.title)).toEqual(['Queued source title']);
    expect(read.waiting?.map((item) => item.title)).toEqual(['Waiting source title']);
    expect(calls.some((chain) => chain[0]![1][0] === 'marketing_dneskai_topics')).toBe(false);
  });

  it('keeps the source titles when the topics read fails', async () => {
    const { db } = fakeDb(tables({ data: null, error: { message: 'relation does not exist' } }));
    const read = await readDneskaiWorkspace(db, owner, now, undefined, { topicTitles: true });
    expect(read.posts.map((post) => post.title)).toEqual(['Source report title']);
    expect(read.jobs.map((job) => job.title)).toEqual(['Queued source title']);
  });

  it('maps each title by brief row and by job, skipping blank titles and keeping the newest', () => {
    const titles = dneskaiTopicTitles([
      { brief_id: id(1), title_cs: '  Nový titulek  ', job_id: id(4) },
      { brief_id: id(1), title_cs: 'Starší titulek', job_id: null },
      { brief_id: id(2), title_cs: '   ', job_id: id(5) },
    ]);
    expect([...titles.byBrief]).toEqual([[id(1), 'Nový titulek']]);
    expect([...titles.byJob]).toEqual([[id(4), 'Nový titulek']]);
  });
});
