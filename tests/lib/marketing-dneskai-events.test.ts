import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { DNESKAI_FINISH_EVENT_LIMIT, dneskaiEventId, dneskaiEventMemberHash, dneskaiFinishEvents, dneskaiHeadlinesMatch, dneskaiPrimaryUrlKey, dneskaiSourceTier, dneskaiTitleTokens, groupDneskaiEvents, rankDneskaiEventMembers } from '@/lib/marketing/dneskai-events';
import { syntheticCandidate } from './marketing-dneskai-briefs-db';
vi.mock('server-only', () => ({}));

// Synthetic, test-only reports; no source text is real.
const at = (hours: number) => new Date(Date.parse('2026-10-20T08:00:00Z') + hours * 3600000).toISOString();
const report = (sourceId: string, id: string, title: string, hours = 0, patch: Parameters<typeof syntheticCandidate>[3] = {}, text?: string, url?: string) =>
  syntheticCandidate(sourceId, id, title, { fetchedAt: at(hours), publishedAt: at(hours), ...patch }, text, url, at(hours));

describe('DNESKAi event grouping without paid calls (#115)', () => {
  it('joins three reports of one event from two Instagram accounts into one event', () => {
    const items = [
      report('instagram:technology', 'tech-1', 'OpenAI launches Sora 2 app for iPhone', 0),
      report('instagram:insidertech', 'insider-1', 'OpenAI launches Sora 2 iPhone app', 1),
      report('instagram:insidertech', 'insider-2', 'Sora 2 app from OpenAI now on iPhone', 2),
    ];
    const events = groupDneskaiEvents(items);
    expect(events).toHaveLength(1);
    expect(events[0]!.members.map((member) => member.externalId)).toEqual(['tech-1', 'insider-1', 'insider-2']);
    expect(events[0]!.links).toEqual(['similar-title']);
    expect(events[0]!.eventId).toBe(dneskaiEventId(items[0]!.id));
  });

  it('keeps two Ollama versions apart even when the rest of the headline is the same', () => {
    const events = groupDneskaiEvents([
      report('github-ai-releases', 'ollama-0.12.6', 'Ollama 0.12.6: faster Gemma 3 support on Apple silicon', 0),
      report('github-ai-releases', 'ollama-0.12.7', 'Ollama 0.12.7: faster Gemma 3 support on Apple silicon', 5),
    ]);
    expect(events).toHaveLength(2);
    expect(dneskaiHeadlinesMatch('Ollama v0.12.6 released', 'Ollama v0.12.7 released')).toBe(false);
    expect(dneskaiHeadlinesMatch('GPT-5 is here', 'GPT-6 is here')).toBe(false);
  });

  it('joins on a Jev duplicate link regardless of time, and on the same canonical URL', () => {
    const first = report('openai-blog', 'first', 'Introducing a synthetic model', 0, {}, undefined, 'https://www.example.test/news/model?utm_source=x');
    const sameUrl = report('hn-frontpage', 'hn', 'Completely different words', 3, {}, undefined, 'https://example.test/news/model/');
    const jev = report('techcrunch-ai', 'jev', 'Unrelated title text', 200, { duplicateOf: first.id, status: 'duplicate' });
    const linked = report('instagram:techcrunch', 'post', 'Big day', 4, {}, 'Read more https://example.test/news/model.');
    const events = groupDneskaiEvents([first, sameUrl, jev, linked]);
    expect(events).toHaveLength(1);
    expect(events[0]!.links).toEqual(['jev-duplicate', 'same-url']);
    expect(dneskaiPrimaryUrlKey('https://m.example.test/a/amp?ref=x&b=2&a=1#top')).toBe('example.test/a?a=1&b=2');
  });

  it('never joins the same headline across more than 72 hours without a Jev link', () => {
    expect(groupDneskaiEvents([report('the-verge', 'a', 'Apple announces M5 MacBook Pro', 0), report('wired-ai', 'b', 'Apple announces M5 MacBook Pro', 80)])).toHaveLength(2);
    expect(groupDneskaiEvents([report('the-verge', 'a', 'Apple announces M5 MacBook Pro', 0), report('wired-ai', 'b', 'Apple announces M5 MacBook Pro', 70)])).toHaveLength(1);
  });

  it('removes Czech and English stop words and folds diacritics', () => {
    expect([...dneskaiTitleTokens('OpenAI představila nový model GPT-6 pro vývojáře')]).toEqual(['openai', 'predstavila', 'model', 'gpt-6', 'vyvojare']);
    expect(dneskaiHeadlinesMatch('OpenAI představila nový model GPT-6 pro vývojáře', 'OpenAI představila GPT-6 model pro vývojáře')).toBe(true);
    expect(dneskaiHeadlinesMatch('Gemini', 'Gemini')).toBe(false);
  });

  it('names an event after its earliest member, so a later report changes the member hash and not the id', () => {
    const a = report('openai-blog', 'a', 'Synthetic launch of Model Nine for developers', 0);
    const b = report('the-verge', 'b', 'Synthetic launch of Model Nine for developers', 1);
    const before = groupDneskaiEvents([a]), after = groupDneskaiEvents([b, a]);
    expect(after[0]!.eventId).toBe(before[0]!.eventId);
    expect(after[0]!.memberHash).not.toBe(before[0]!.memberHash);
    const lines = [a, b].map((item) => `${item.id}:${item.contentHash}`).sort();
    expect(after[0]!.memberHash).toBe(createHash('sha256').update(`dneskai-event-members/1\n${lines.join('\n')}`).digest('hex'));
    expect(dneskaiEventMemberHash([b, a])).toBe(dneskaiEventMemberHash([a, b]));
  });

  it('chooses the original publisher before a newsroom before an aggregator, then more pictures, then the newer report', () => {
    const verge = report('the-verge', 'verge', 'x', 3), hn = report('hn-frontpage', 'hn', 'x', 5), blog = report('openai-blog', 'blog', 'x', 0);
    const crunch = report('techcrunch-ai', 'crunch', 'x', 4), insider = report('instagram:insidertech', 'insider', 'x', 2);
    expect([dneskaiSourceTier('openai-blog'), dneskaiSourceTier('the-verge'), dneskaiSourceTier('hn-frontpage'), dneskaiSourceTier('unknown')]).toEqual([0, 1, 2, 1]);
    expect(rankDneskaiEventMembers([hn, verge, crunch, blog, insider]).map((item) => item.externalId)).toEqual(['blog', 'verge', 'hn', 'crunch', 'insider']);
    const media = new Map([[insider.id, 4], [hn.id, 1]]);
    expect(rankDneskaiEventMembers([hn, crunch, insider], (id) => media.get(id) ?? 0).map((item) => item.externalId)).toEqual(['insider', 'hn', 'crunch']);
  });
});

describe('the events sent to marketing_dneskai_finish', () => {
  it('keeps only the events a keep rule allows and, over the limit, the most recently collected ones', () => {
    const pairs = Array.from({ length: DNESKAI_FINISH_EVENT_LIMIT + 2 }, (_, index) => [
      report('openai-blog', `pair-${index}-a`, `Synthetic launch number ${index} of Model Nine`, index / 10),
      report('the-verge', `pair-${index}-b`, `Synthetic launch number ${index} of Model Nine`, index / 10 + 0.01),
    ]).flat();
    const events = groupDneskaiEvents(pairs);
    expect(events).toHaveLength(DNESKAI_FINISH_EVENT_LIMIT + 2);
    const sent = dneskaiFinishEvents(events);
    expect(sent).toHaveLength(DNESKAI_FINISH_EVENT_LIMIT);
    // The two earliest events give way; the newest ones are the ones that can still be selected.
    expect(sent.map((event) => event.anchorId)).not.toContain(pairs[0]!.id);
    expect(sent.map((event) => event.anchorId)).not.toContain(pairs[2]!.id);
    expect(sent.map((event) => event.anchorId)).toContain(pairs[4]!.id);
    expect(dneskaiFinishEvents(events.slice(0, 3), (event) => event.anchorId !== pairs[0]!.id).map((event) => event.anchorId)).toEqual([pairs[2]!.id, pairs[4]!.id]);
  });
});

type Rows = Array<{ candidate: unknown }>;
/** A Supabase stand-in for the store: the candidate reads are answered by status, with `range` paging. */
function storeDatabase(byStatus: Record<string, Rows>) {
  const reads: Array<{ status: string; from: number; to: number }> = [];
  const from = (table: string) => {
    let status = ''; let range: [number, number] | null = null;
    const value: Record<string, unknown> = {};
    for (const key of ['select', 'in', 'gte', 'order', 'limit', 'maybeSingle']) value[key] = () => value;
    value.eq = (column: string, filter: string) => { if (column === 'status') status = filter; return value; };
    value.range = (start: number, end: number) => { range = [start, end]; reads.push({ status, from: start, to: end }); return value; };
    value.then = (resolve: (result: unknown) => unknown) => Promise.resolve({ data: table === 'marketing_dneskai_runs' ? { project_id: 'project' } : (byStatus[status] ?? []).slice(range![0], range![1] + 1), error: null }).then(resolve);
    return value;
  };
  return { reads, db: { from, rpc: vi.fn(async () => ({ data: { id: 'run' }, error: null })) } };
}

describe('the collection store passes the grouping to marketing_dneskai_finish', () => {
  it('sends p_events for a finishing run and nothing while the run continues', async () => {
    const { createDneskaiCollectionStore } = await import('@/lib/marketing/dneskai-store');
    const a = report('openai-blog', 'store-a', 'Synthetic launch of Model Nine for developers', 0, { status: 'new' });
    const b = report('the-verge', 'store-b', 'Synthetic launch of Model Nine for developers', 1, { status: 'new' });
    const c = report('hf-blog', 'store-c', 'Unrelated synthetic notebook tool', 2, { status: 'new' });
    // An event of a selected report and its duplicate has no open report: it cannot be selected and is not sent.
    const s = report('wired-ai', 'store-s', 'Synthetic chip export rules tightened', 0, { status: 'selected', targetDate: '2026-10-20' });
    const d = report('the-register', 'store-d', 'Synthetic chip export rules tightened', 1, { status: 'duplicate', duplicateOf: s.id });
    const { db, reads } = storeDatabase({ new: [a, b, c].map((candidate) => ({ candidate })), selected: [{ candidate: s }], duplicate: [{ candidate: d }] });
    const store = createDneskaiCollectionStore(db as never);
    await store.finish('owner', 'run', 'fence', 'complete', null);
    expect(db.rpc).toHaveBeenLastCalledWith('marketing_dneskai_finish', { p_owner: 'owner', p_run: 'run', p_fence: 'fence', p_status: 'complete', p_error: null, p_events: [{ eventId: dneskaiEventId(a.id), anchorId: a.id, memberIds: [a.id, b.id] }] });
    expect(reads).toEqual([{ status: 'new', from: 0, to: 999 }, { status: 'selected', from: 0, to: 999 }, { status: 'duplicate', from: 0, to: 999 }]);
    await store.finish('owner', 'run', 'fence', 'running', null);
    expect(db.rpc).toHaveBeenLastCalledWith('marketing_dneskai_finish', { p_owner: 'owner', p_run: 'run', p_fence: 'fence', p_status: 'running', p_error: null });
  });

  it('pages through the open reports and records a grouping that reached its read limit on the run', async () => {
    const { createDneskaiCollectionStore, DNESKAI_EVENT_READS } = await import('@/lib/marketing/dneskai-store');
    const limit = DNESKAI_EVENT_READS[0].limit;
    const open = Array.from({ length: limit + 1 }, (_, index) => ({ candidate: report('hf-blog', `open-${index}`, `Synthetic tool ${index}`, -index / 100, { status: 'new' }) }));
    const { db, reads } = storeDatabase({ new: open });
    const store = createDneskaiCollectionStore(db as never);
    await store.finish('owner', 'run', 'fence', 'complete', null);
    expect(reads.filter((read) => read.status === 'new')).toEqual([{ status: 'new', from: 0, to: 999 }, { status: 'new', from: 1000, to: 1999 }, { status: 'new', from: 2000, to: 2000 }]);
    expect(db.rpc).toHaveBeenLastCalledWith('marketing_dneskai_finish', expect.objectContaining({ p_error: 'collection-event-window-partial' }));
    // A run that already carries a code keeps it.
    await store.finish('owner', 'run', 'fence', 'partial', 'collection-review-incomplete');
    expect(db.rpc).toHaveBeenLastCalledWith('marketing_dneskai_finish', expect.objectContaining({ p_error: 'collection-review-incomplete' }));
    // Exactly the limit is complete: nothing was left out.
    const exact = storeDatabase({ new: open.slice(0, limit) });
    await createDneskaiCollectionStore(exact.db as never).finish('owner', 'run', 'fence', 'complete', null);
    expect(exact.db.rpc).toHaveBeenLastCalledWith('marketing_dneskai_finish', expect.objectContaining({ p_error: null }));
  });
});
