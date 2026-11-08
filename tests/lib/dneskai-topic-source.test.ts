import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createJinaTopicReader, dneskaiOwnerLinkCandidate, dneskaiOwnerLinkSource, dneskaiReaderText, dneskaiTopicUrl, dneskaiTopicUrls } from '@/lib/marketing/dneskai-topic-source';
import { advanceDneskaiTopicBriefs, type DneskaiBridgeTopic, type DneskaiTopicBridgeStore } from '@/lib/marketing/dneskai-topic-bridge';
import type { DneskaiBriefStore } from '@/lib/marketing/dneskai-briefs';

/** #210: link-library and manual topics. Every URL and page is synthetic. */
const owner = '11111111-1111-4111-8111-111111111111', project = '22222222-2222-4222-8222-222222222222', topicId = '33333333-3333-4333-8333-333333333333';
const url = 'https://tools.example.test/notes';
const signal = new AbortController().signal;

describe('owner-link sources (#210)', () => {
  it('sends only the URL to Jina Reader and returns the title and plain text', async () => {
    const fetcher = vi.fn(async () => Response.json({ data: { title: '  Synthetic   notes tool ', description: 'Short description.', content: 'Intro ![logo](https://x.test/a.png) with a [link](https://x.test/b).\n\n\n\nEnd.' } }));
    const page = await createJinaTopicReader({ JINA_API_KEY: 'test-only-key' }, fetcher as never)(url, signal);
    expect(page).toEqual({ title: 'Synthetic notes tool', text: 'Short description.\n\nIntro  with a link.\n\nEnd.' });
    const [target, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(target).toBe(`https://r.jina.ai/${url}`);
    expect(init.body).toBeUndefined();
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-only-key' });
  });

  it('returns null for a failed, empty or broken answer', async () => {
    expect(await createJinaTopicReader({}, (async () => new Response('', { status: 451 })) as never)(url, signal)).toBeNull();
    expect(await createJinaTopicReader({}, (async () => Response.json({ data: {} })) as never)(url, signal)).toBeNull();
    expect(await createJinaTopicReader({}, (async () => { throw new Error('offline'); }) as never)(url, signal)).toBeNull();
  });

  it('builds one candidate per topic with the identity hashes, and treats it as its own site for pictures', () => {
    const row = dneskaiOwnerLinkCandidate({ topicId, kind: 'education', url: `${url}?utm_source=x`, page: { title: '', text: '' }, fallbackTitle: 'Poznámky ze snímku', fallbackText: 'Popis z knihovny.', now: new Date('2026-10-23T08:00:00Z') });
    expect(row.candidate).toMatchObject({ id: `owner-link:${topicId}`, sourceId: 'owner-link', externalId: url, title: 'Poznámky ze snímku', text: 'Popis z knihovny.', category: 'tool', status: 'new', publishedAt: null });
    expect(row.canonicalUrlHash).toMatch(/^[a-f0-9]{64}$/);
    expect(dneskaiOwnerLinkCandidate({ topicId, kind: 'education', url, page: { title: '', text: '' }, fallbackTitle: 'Poznámky ze snímku', fallbackText: null, now: new Date() }).canonicalUrlHash).toBe(row.canonicalUrlHash);
    expect(dneskaiOwnerLinkSource(row.candidate)).toMatchObject({ id: 'owner-link', name: 'tools.example.test', url: 'https://tools.example.test/', kind: 'html' });
    expect(dneskaiOwnerLinkSource({ ...row.candidate, sourceId: 'show-hn' })).toBeUndefined();
  });

  it('takes the first https URL a topic stores', () => {
    expect(dneskaiTopicUrl({ urls: ['http://plain.example.test/', 'not a url', url] })).toBe(url);
    expect(dneskaiTopicUrl({})).toBeNull();
    expect(dneskaiTopicUrl(null)).toBeNull();
    expect(dneskaiReaderText('a  \n\n\n\nb')).toBe('a\n\nb');
  });

  it('takes up to three distinct https URLs in order, and numbers the candidates of further pages', () => {
    const urls = ['https://a.example.test/1', 'http://plain.example.test/', 'https://a.example.test/1', 'https://b.example.test/2', 'https://c.example.test/3', 'https://d.example.test/4'];
    expect(dneskaiTopicUrls({ urls })).toEqual(['https://a.example.test/1', 'https://b.example.test/2', 'https://c.example.test/3']);
    expect(dneskaiTopicUrls({ urls: 'https://a.example.test/1' })).toEqual([]);
    const input = { topicId, kind: 'education' as const, page: { title: 'Page', text: 'Text.' }, fallbackTitle: 'T', fallbackText: null, now: new Date('2026-11-08T08:00:00Z') };
    expect(dneskaiOwnerLinkCandidate({ ...input, url, part: 1 }).candidate.id).toBe(`owner-link:${topicId}`);
    expect(dneskaiOwnerLinkCandidate({ ...input, url: 'https://b.example.test/2', part: 2 }).candidate.id).toBe(`owner-link:${topicId}:2`);
  });
});

describe('the bridge with owner links (#210)', () => {
  const topic = (evidence: Record<string, unknown>): DneskaiBridgeTopic => ({ id: topicId, kind: 'education', status: 'approved', source_ref: 'library:link-1', title_cs: 'Poznámky', summary: null, brief_id: null, evidence });
  function stores(topics: DneskaiBridgeTopic[], options: { known?: { id: string } | null; run?: { id: string } | null } = {}) {
    const updates: Array<Record<string, unknown>> = [];
    const insertCandidate = vi.fn(async () => ({ id: `owner-link:${topicId}` }));
    const store = { topics: async () => topics, brief: async () => null, candidate: async () => null, selectCandidate: vi.fn(), insertTopicBrief: vi.fn(),
      updateTopic: async (_owner: string, _id: string, patch: Record<string, unknown>) => { updates.push(patch); }, job: async () => null,
      candidateByUrl: async () => options.known ?? null, latestRun: async () => options.run === undefined ? { id: '44444444-4444-4444-8444-444444444444' } : options.run, insertCandidate } as unknown as DneskaiTopicBridgeStore;
    return { store, updates, insertCandidate };
  }
  const advance = (store: DneskaiTopicBridgeStore, reader: (url: string) => Promise<{ title: string; text: string } | null>) =>
    advanceDneskaiTopicBriefs({ topics: store, briefs: { takenSlots: async () => [] } as unknown as DneskaiBriefStore },
      { owner, project, now: new Date('2026-10-23T05:00:00Z'), signal, remainingMs: () => 40_000, reader });

  it('counts a failed read, retries it, and stops after the third', async () => {
    const reader = vi.fn(async () => null);
    const first = stores([topic({ urls: [url] })]);
    expect(await advance(first.store, reader)).toMatchObject({ waiting: 1 });
    expect(first.updates[0]).toEqual({ evidence: { urls: [url], readerAttempts: 1, bridgeCode: 'topic-source-unreadable' } });
    const third = stores([topic({ urls: [url], readerAttempts: 2 })]);
    expect(await advance(third.store, reader)).toMatchObject({ unsupported: 1, waiting: 0 });
    const done = stores([topic({ urls: [url], readerAttempts: 3, bridgeCode: 'topic-source-unreadable' })]);
    expect(await advance(done.store, reader)).toMatchObject({ unsupported: 1 });
    expect(reader).toHaveBeenCalledTimes(2);
    expect(done.updates).toEqual([]);
  });

  it('reuses a report already stored for the page, and waits without a finished run', async () => {
    const reader = vi.fn(async () => ({ title: 'T', text: 'x' }));
    const known = stores([topic({ urls: [url] })], { known: { id: 'show-hn:4242' } });
    await advance(known.store, reader);
    expect(reader).not.toHaveBeenCalled();
    expect(known.insertCandidate).not.toHaveBeenCalled();
    expect(known.updates[0]).toMatchObject({ evidence: { reportId: 'show-hn:4242' } });
    const norun = stores([topic({ urls: [url] })], { run: null });
    expect(await advance(norun.store, reader)).toMatchObject({ waiting: 1 });
    expect(norun.updates[0]).toMatchObject({ evidence: { bridgeCode: 'topic-run-unavailable' } });
    expect(reader).not.toHaveBeenCalled();
  });

  it('makes every readable further page a member of the brief and leaves an unreadable one out', async () => {
    const second = 'https://b.example.test/2', third = 'https://c.example.test/3';
    const runId = '44444444-4444-4444-8444-444444444444';
    const row = (id: string) => ({ id, run_id: runId, status: 'new', target_date: null, content_hash: 'h', candidate: {} });
    const reader = vi.fn(async (page: string) => page === second ? null : { title: 'Page', text: 'Text.' });
    const insertCandidate = vi.fn(async (_o: string, _p: string, _r: string, inserted: { candidate: { id: string } }) => ({ id: inserted.candidate.id }));
    const insertTopicBrief = vi.fn(async () => ({ id: '55555555-5555-4555-8555-555555555555' }));
    const selectCandidate = vi.fn(async () => undefined);
    const updates: Array<Record<string, unknown>> = [];
    const store = { topics: async () => [topic({ urls: [url, second, third], reportId: `owner-link:${topicId}` })], brief: async () => null, candidate: async (_o: string, _p: string, id: string) => row(id),
      selectCandidate, insertTopicBrief, updateTopic: async (_o: string, _i: string, patch: Record<string, unknown>) => { updates.push(patch); }, job: async () => null,
      candidateByUrl: async () => null, latestRun: async () => ({ id: runId }), insertCandidate } as unknown as DneskaiTopicBridgeStore;
    await advance(store, reader);
    expect(reader.mock.calls.map(([page]) => page)).toEqual([second, third]);
    expect(updates[0]).toMatchObject({ evidence: { extraReports: { [third]: `owner-link:${topicId}:3` }, extraAttempts: 1 } });
    expect(selectCandidate).toHaveBeenCalledTimes(2);
    expect(insertTopicBrief).toHaveBeenCalledWith(owner, expect.objectContaining({ member_ids: [`owner-link:${topicId}`, `owner-link:${topicId}:3`], lead_candidate_id: `owner-link:${topicId}` }));
  });

  it('stops reading further pages after the third pass and keeps the ones it has', async () => {
    const reader = vi.fn(async () => ({ title: 'Page', text: 'Text.' }));
    const second = 'https://b.example.test/2';
    const base = stores([topic({ urls: [url, second], reportId: `owner-link:${topicId}`, extraAttempts: 3 })]);
    await advance(base.store, reader);
    expect(reader).not.toHaveBeenCalled();
  });
});
