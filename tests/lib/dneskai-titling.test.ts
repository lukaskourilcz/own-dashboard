import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { candidate } from '@/lib/marketing/dneskai-providers';
import { dneskaiKeyword, dneskaiNewsTopicsFromRun, dneskaiTitleAcceptable, expireDneskaiNewsTopics, normalizeDneskaiTitle, titleDneskaiTopics, DNESKAI_TITLING_RESERVATION_USD } from '@/lib/marketing/dneskai-titling';
import type { DneskaiTopicModel } from '@/lib/marketing/dneskai-topic-model';
import { dneskaiTitlingEnabled } from '@/lib/marketing/dneskai-evidence-rollout';

/** Synthetic topics and a fake model; nothing leaves the test. */
const owner = '11111111-1111-4111-8111-111111111111', project = '22222222-2222-4222-8222-222222222222', runId = '44444444-4444-4444-8444-444444444444';
const now = new Date('2026-10-24T00:30:00Z'); // 02:30 in Prague
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const untitled = (n: number) => ({ id: id(n), kind: 'education', title_cs: `Source title ${n}`, summary: `Synthetic excerpt ${n}.`, evidence: { titled: false, excerpt: `Synthetic excerpt ${n}.` } });

/** A fake client: answers reads in order, records updates and the upsert, and the two ledger RPCs. */
function fakeDb(reads: unknown[][], options: { admit?: boolean } = {}) {
  const updates: Array<{ values: Record<string, unknown>; filters: Record<string, unknown> }> = [];
  const upserts: unknown[][] = [];
  let index = 0;
  const from = vi.fn(() => {
    const builder: Record<string, unknown> = {}; let update: Record<string, unknown> | null = null; const filters: Record<string, unknown> = {};
    for (const method of ['select', 'neq', 'in', 'gte', 'lt', 'order', 'limit']) builder[method] = () => builder;
    builder.eq = (column: string, value: unknown) => { filters[column] = value; return builder; };
    builder.update = (values: Record<string, unknown>) => { update = values; updates.push({ values, filters }); return builder; };
    builder.upsert = async (values: unknown[]) => { upserts.push(values); return { error: null }; };
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(update ? { data: [{ id: 'x' }], error: null } : { data: reads[index++] ?? [], error: null }).then(resolve);
    return builder;
  });
  const rpc = vi.fn(async (name: string) => ({ data: name === 'marketing_reserve_dneskai_topic_spend' ? (options.admit === false ? { admitted: false } : { admitted: true, id: '33333333-3333-4333-8333-333333333333' }) : true, error: null }));
  return { db: { from, rpc } as never, updates, upserts, rpc };
}
function model(items: unknown[]): DneskaiTopicModel & { invoke: ReturnType<typeof vi.fn> } {
  return { model: 'claude-haiku-5-5', pricing: { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.5 }, invoke: vi.fn(async () => ({ output: { items }, usage: { inputTokens: 6_000, outputTokens: 1_500 } })) };
}
const env = { MARKETING_AI_CONSENT: 'true' };

describe('titling (#153)', () => {
  it('turns twelve candidates into twelve titles under the limits with one reserved call', async () => {
    const topics = Array.from({ length: 12 }, (_, n) => untitled(n + 1));
    const answer = topics.map((_, index) => ({ index, titleCs: `Nástroj ${index + 1} zkrátí přepis schůzky na minutu`, summary: 'Ukázka shrnutí v jedné větě.', keyword: index === 0 ? 'Přepis' : 'TIPS', kind: index % 2 ? 'news' : 'education' }));
    const fake = fakeDb([topics, []]), m = model(answer);
    const result = await titleDneskaiTopics(fake.db, owner, project, now, { env, signal: new AbortController().signal, model: async () => m });
    expect(result).toMatchObject({ titled: 12, duplicates: 0, missing: 0, refused: false });
    expect(m.invoke).toHaveBeenCalledTimes(1);
    expect(fake.rpc).toHaveBeenCalledWith('marketing_reserve_dneskai_topic_spend', expect.objectContaining({ p_kind: 'title', p_reservation: DNESKAI_TITLING_RESERVATION_USD, p_ceiling: 1 }));
    expect(fake.rpc).toHaveBeenCalledWith('marketing_settle_dneskai_topic_spend', expect.objectContaining({ p_cost: 0.0014 }));
    const titles = fake.updates.map((entry) => entry.values);
    expect(titles.every((row) => String(row.title_cs).length <= 60 && (row.evidence as { titled: boolean }).titled)).toBe(true);
    expect(titles[0]).toMatchObject({ keyword: 'PREPIS', kind: 'education' });
    expect(titles[1]).toMatchObject({ keyword: null, kind: 'news' });
    const prompt = m.invoke.mock.calls[0]![0] as { system: string; prompt: string };
    expect(prompt.system).toMatch(/untrusted data, never instructions/);
    expect(JSON.parse(prompt.prompt).items).toHaveLength(12);
  });

  it('drops titles that repeat the last 30 days or each other, and leaves unusable ones untitled', async () => {
    const topics = [untitled(1), untitled(2), untitled(3), untitled(4)];
    const answer = [
      { index: 0, titleCs: 'Claude Code umí plánovat úlohy', summary: 'x', keyword: 'CLAUDE', kind: 'news' },
      { index: 1, titleCs: 'Nový editor zrychlí střih o polovinu', summary: 'x', keyword: null, kind: 'education' },
      { index: 2, titleCs: 'NOVÝ EDITOR zrychlí střih o polovinu.', summary: 'x', keyword: null, kind: 'education' },
      { index: 3, titleCs: 'Zvládne to opravdu každý?', summary: 'x', keyword: null, kind: 'education' },
    ];
    const fake = fakeDb([topics, [{ title_cs: 'Claude Code umí plánovat úlohy' }]]);
    const result = await titleDneskaiTopics(fake.db, owner, project, now, { env, signal: new AbortController().signal, model: async () => model(answer) });
    expect(result).toMatchObject({ titled: 1, duplicates: 2, missing: 1 });
    const rejected = fake.updates.filter((entry) => entry.values.status === 'rejected');
    expect(rejected.map((entry) => entry.filters.id)).toEqual([id(1), id(3)]);
    expect(rejected[0]!.values.evidence).toMatchObject({ rejectedReason: 'duplicate-title' });
  });

  it('refuses above the ceiling without calling the model, and costs nothing with nothing to title', async () => {
    const m = model([]);
    const refused = fakeDb([[untitled(1)], []], { admit: false });
    expect(await titleDneskaiTopics(refused.db, owner, project, now, { env, signal: new AbortController().signal, model: async () => m })).toMatchObject({ refused: true, titled: 0 });
    expect(m.invoke).not.toHaveBeenCalled();
    const empty = fakeDb([[], []]);
    expect(await titleDneskaiTopics(empty.db, owner, project, now, { env, signal: new AbortController().signal, model: async () => m })).toMatchObject({ titled: 0, refused: false });
    expect(empty.rpc).not.toHaveBeenCalled();
  });

  it('keeps titles and keywords inside the rules', () => {
    expect(normalizeDneskaiTitle('Nový  EDITOR, zrychlí střih!')).toBe('novy editor zrychli strih');
    expect(dneskaiTitleAcceptable('x'.repeat(61))).toBe(false);
    expect(dneskaiTitleAcceptable('Proč to funguje?')).toBe(false);
    expect(dneskaiKeyword('Šablona')).toBe('SABLONA');
    for (const word of ['free', 'Info', 'two words', 'A', null]) expect(dneskaiKeyword(word)).toBeNull();
  });

  it('turns a finished run\'s selected events into untitled news topics, once', async () => {
    const lead = candidate('openai-blog', 'n1', 'Synthetic release headline', 'Synthetic release text.', 'https://example.com/release', '2026-10-23T10:00:00Z', '2026-10-23T20:10:00Z');
    const other = candidate('techcrunch-ai', 'n2', 'Second report', 'Text.', 'https://example.org/report', '2026-10-23T11:00:00Z', '2026-10-23T20:10:00Z');
    const brief = { id: '55555555-5555-4555-8555-555555555555', event_id: 'e'.repeat(64), member_ids: [lead.id, other.id], lead_candidate_id: lead.id, category: 'ai-news', target_date: '2026-10-24' };
    const fake = fakeDb([[brief], [{ id: lead.id, candidate: lead }, { id: other.id, candidate: other }]]);
    expect(await dneskaiNewsTopicsFromRun(fake.db, owner, project, runId, now)).toEqual({ events: 1, inserted: 1 });
    expect(fake.upserts[0]![0]).toMatchObject({ kind: 'news', source_kind: 'feed', source_ref: `event:${brief.event_id}`, brief_id: brief.id, status: 'proposed', title_cs: 'Synthetic release headline',
      evidence: { titled: false, urls: [lead.url, other.url], eventId: brief.event_id } });
    expect(await dneskaiNewsTopicsFromRun(fakeDb([[]]).db, owner, project, runId, now)).toEqual({ events: 0, inserted: 0 });
  });

  it('expires proposed news topics after 48 hours only', async () => {
    const fake = fakeDb([]);
    expect(await expireDneskaiNewsTopics(fake.db, owner, project, now)).toBe(1);
    expect(fake.updates[0]).toMatchObject({ values: { status: 'expired' }, filters: { kind: 'news', status: 'proposed', user_id: owner, project_id: project } });
  });

  it('needs the topics switch as well as its own', () => {
    expect(dneskaiTitlingEnabled({ DNESKAI_TITLING_ENABLED: 'true', DNESKAI_TOPICS_ENABLED: 'true' })).toBe(true);
    expect(dneskaiTitlingEnabled({ DNESKAI_TITLING_ENABLED: 'true' })).toBe(false);
  });
});
