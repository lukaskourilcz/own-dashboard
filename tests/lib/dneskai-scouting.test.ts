import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { candidate } from '@/lib/marketing/dneskai-providers';
import { dneskaiLibraryTopic, dneskaiReportTopic, dneskaiScoutingPicks, scoutDneskaiTopics, DNESKAI_SCOUTING_LIBRARY_LIMIT, DNESKAI_SCOUTING_REPORT_LIMIT } from '@/lib/marketing/dneskai-scouting';
import { DNESKAI_EDUCATION_SOURCES, DNESKAI_SOURCES, dueDneskaiSources, isDneskaiEducationSource } from '@/lib/marketing/dneskai-registry';
import { pendingDneskaiCandidates } from '@/lib/marketing/dneskai-collection';
import { projectHnSearch } from '@/lib/marketing/free-feeds/sources/adapters/hnsearch';
import { dneskaiNativeSourceConfig } from '@/lib/marketing/dneskai-native-feed';

/** Synthetic reports, links and topics only; no request leaves the test. */
const owner = '11111111-1111-4111-8111-111111111111', project = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-10-23T21:00:00Z');
const reel = candidate('instagram:itstundeanthony', 'reel-1', 'FACT or HYPE: a coding agent that reviews its own pull requests', 'FACT or HYPE: a coding agent that reviews its own pull requests\nFull test in the video.', 'https://www.instagram.com/p/EXAMPLE1/', '2026-10-23T10:00:00Z', '2026-10-23T20:10:00Z', [], false, { ownerUsername: 'itstundeanthony', mediaType: 'video' });
const show = candidate('show-hn', '4242', 'Show HN: A local tool that turns screenshots into notes', 'Synthetic summary.', 'https://example.com/tool?utm_source=hn', '2026-10-23T08:00:00Z', '2026-10-23T20:10:00Z');
const link = { id: '33333333-3333-4333-8333-333333333333', title: 'A prompt library worth keeping', url: 'https://example.org/prompts', description: 'Synthetic note.', usefulness_rating: 5 };

/** A stand-in for the service-role client: answers the three reads in order and records the upsert. */
function fakeDb(reads: unknown[][], fail?: 'read' | 'write') {
  const writes: Array<{ values: Array<Record<string, unknown>>; options: unknown }> = [];
  let index = 0;
  const from = vi.fn(() => {
    const result = { data: reads[index++] ?? [], error: fail === 'read' ? { message: 'x' } : null };
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'gte', 'order', 'limit']) builder[method] = () => builder;
    builder.upsert = async (values: Array<Record<string, unknown>>, options: unknown) => { writes.push({ values, options }); return { error: fail === 'write' ? { message: 'x' } : null }; };
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return builder;
  });
  return { db: { from } as never, from, writes };
}

describe('scouting topics (#151)', () => {
  it('makes one topic per report and library link, with the source title until titling and evidence', () => {
    expect(dneskaiReportTopic(reel)).toMatchObject({ kind: 'education', sourceKind: 'instagram', sourceRef: `report:${reel.id}`, title: reel.title,
      evidence: { titled: false, urls: [reel.url], handle: 'itstundeanthony', sourceId: 'instagram:itstundeanthony' } });
    expect(dneskaiReportTopic(show)).toMatchObject({ sourceKind: 'feed', evidence: { canonicalUrl: 'https://example.com/tool' } });
    expect(dneskaiLibraryTopic(link)).toMatchObject({ sourceKind: 'library', sourceRef: `library:${link.id}`, evidence: { rating: 5 } });
    expect(dneskaiLibraryTopic({ ...link, url: 'http://example.org/plain' })).toBeNull();
    expect(dneskaiReportTopic({ ...show, title: 'x'.repeat(400) })!.title.length).toBeLessThanOrEqual(160);
  });

  it('skips known references and URLs, a URL twice in one night, and keeps the nightly limits', () => {
    const reports = Array.from({ length: 40 }, (_, n) => dneskaiReportTopic(candidate('product-hunt', `p${n}`, `Synthetic product ${n}`, '', `https://example.com/p/${n}`, '2026-10-23T08:00:00Z', '2026-10-23T20:10:00Z'))!);
    const library = Array.from({ length: 6 }, (_, n) => dneskaiLibraryTopic({ ...link, id: `33333333-3333-4333-8333-00000000000${n}`, url: `https://example.org/l/${n}` })!);
    const picks = dneskaiScoutingPicks([reports[0]!, ...reports], library, { refs: new Set([reports[1]!.sourceRef]), urls: new Set(['https://example.com/p/2']) });
    expect(picks.reports).toHaveLength(DNESKAI_SCOUTING_REPORT_LIMIT);
    expect(picks.reports.map((item) => item.sourceRef)).not.toContain(reports[1]!.sourceRef);
    expect(picks.reports.map((item) => item.evidence.canonicalUrl)).not.toContain('https://example.com/p/2');
    expect(new Set(picks.reports.map((item) => item.sourceRef)).size).toBe(picks.reports.length);
    expect(picks.library).toHaveLength(DNESKAI_SCOUTING_LIBRARY_LIMIT);
  });

  it('a dry pass over fixtures proposes topics from all three source kinds and writes them idempotently', async () => {
    const { db, writes } = fakeDb([[{ candidate: reel }, { candidate: show }, { candidate: { broken: true } }], [link], [{ source_ref: 'library:other', url: null }]]);
    const result = await scoutDneskaiTopics(db, owner, project, now);
    expect(result).toEqual({ reports: 2, library: 1, inserted: 3, skipped: 0 });
    expect(writes).toHaveLength(1);
    expect(writes[0]!.options).toEqual({ onConflict: 'user_id,source_ref', ignoreDuplicates: true });
    expect(writes[0]!.values.map((row) => row.source_kind)).toEqual(['instagram', 'feed', 'library']);
    expect(writes[0]!.values.every((row) => row.user_id === owner && row.project_id === project && row.status === 'proposed' && row.kind === 'education' && row.proposed_for === '2026-10-23')).toBe(true);
  });

  it('writes nothing when everything is known and refuses on a failed read or write', async () => {
    const known = [{ source_ref: `report:${reel.id}`, url: null }, { source_ref: 'x', url: 'https://example.com/tool' }, { source_ref: `library:${link.id}`, url: null }];
    const { db, writes } = fakeDb([[{ candidate: reel }, { candidate: show }], [link], known]);
    expect(await scoutDneskaiTopics(db, owner, project, now)).toEqual({ reports: 0, library: 0, inserted: 0, skipped: 3 });
    expect(writes).toEqual([]);
    await expect(scoutDneskaiTopics(fakeDb([[], [], []], 'read').db, owner, project, now)).rejects.toThrow('scouting-reports-unavailable');
    await expect(scoutDneskaiTopics(fakeDb([[{ candidate: reel }], [], []], 'write').db, owner, project, now)).rejects.toThrow('scouting-write-failed');
  });
});

describe('education sources (#151)', () => {
  it('stay out of the news list, are due only with scouting and keep every day within the 42 sources admission takes', () => {
    expect(DNESKAI_EDUCATION_SOURCES.length).toBe(17);
    expect(DNESKAI_SOURCES.some((source) => isDneskaiEducationSource(source.id))).toBe(false);
    for (let day = 18; day <= 24; day++) {
      const date = `2026-10-${day}`;
      expect(dueDneskaiSources(date).some((source) => isDneskaiEducationSource(source.id))).toBe(false);
      const all = dueDneskaiSources(date, { education: true });
      expect(all.length).toBeLessThanOrEqual(42);
      // Each day reads at most three education profiles; the SQL caps hold any read beyond the $0.25 day.
      expect(all.filter((source) => source.kind === 'instagram' && isDneskaiEducationSource(source.id)).length).toBeLessThanOrEqual(3);
    }
    expect(dneskaiNativeSourceConfig('show-hn')).toMatchObject({ kind: 'hnsearch', url: expect.stringContaining('tags=show_hn') });
  });

  it('never hands an education report to Jev', () => {
    const news = candidate('openai-blog', 'n1', 'Synthetic news', 'Text.', 'https://example.com/news', '2026-10-23T08:00:00Z', '2026-10-23T20:10:00Z');
    expect(pendingDneskaiCandidates([news, reel, show], now).map((item) => item.id)).toEqual([news.id]);
  });

  it('reads Show HN hits from the Algolia answer', () => {
    const config = dneskaiNativeSourceConfig('show-hn')!;
    const items = projectHnSearch({ hits: [
      { objectID: '4242', title: 'Show HN: Synthetic tool', url: 'https://example.com/tool', created_at: '2026-10-23T08:00:00Z', author: 'someone', points: 320 },
      { objectID: '4243', title: 'Show HN: Without a link', url: null, story_text: 'Synthetic text', created_at: '2026-10-23T09:00:00Z' },
      { objectID: 'bad', title: 'Ignored' },
    ] }, config, now);
    expect(items.map((item) => [item.externalId, item.url])).toEqual([['4242', 'https://example.com/tool'], ['4243', 'https://news.ycombinator.com/item?id=4243']]);
  });
});
