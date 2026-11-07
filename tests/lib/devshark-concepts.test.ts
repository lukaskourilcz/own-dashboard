import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { DEVSHARK_CONCEPT_QUEUE, devsharkConceptDeck, devsharkConceptLimits, devsharkConceptPrompt, generateDevsharkConcept, type DevsharkConceptOutput } from '@/lib/marketing/devshark-concepts';

const owner = '11111111-1111-4111-8111-111111111111', project = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-11-08T10:00:00Z');
const good: DevsharkConceptOutput = { title: 'Array.at()', caption: 'Read the last item without length - 1.\n\nMore on devshark.app\n\n#javascript #webdev #devshark', cover: 'light', slides: [
  { kind: 'cover', kicker: 'JavaScript', headline: 'Array.at()', body: 'Read [[the last item]] in one call.' },
  { kind: 'code', headline: 'Negative index', code: "const a = [1, 2, 3];\na.at(-1); // 3" },
  { kind: 'answer', headline: 'Same as a[a.length - 1]', body: 'Shorter and [[clearer]].' },
  { kind: 'closing', headline: 'Quizzes and [[coding tasks]] for web developers.' },
] };

/** A stand-in for the Supabase query builder: each table answers with what the test set, and inserts are recorded. */
function fakeDb(state: { waiting: number; recent: Array<{ cost_usd: number }>; generated: number }) {
  const inserts: unknown[] = [];
  const from = (table: string) => {
    let head = false, status: string | null = null, origin: string | null = null, select = '';
    const builder: Record<string, unknown> = {
      select: (columns: string, options?: { head?: boolean }) => { select = columns; head = !!options?.head; return builder; },
      eq: (column: string, value: string) => { if (column === 'status') status = value; if (column === 'origin') origin = value; return builder; },
      gte: () => builder, order: () => builder, limit: () => builder,
      insert: async (row: unknown) => { inserts.push(row); return { error: null }; },
      then: (resolve: (value: unknown) => unknown) => {
        if (table !== 'marketing_devshark_drafts') return resolve({ data: [], error: null });
        if (head && status === 'draft') return resolve({ count: state.waiting, error: null });
        if (head && origin === 'generated') return resolve({ count: state.generated, error: null });
        if (select === 'cost_usd') return resolve({ data: state.recent, error: null });
        return resolve({ data: [{ title: 'typeof null' }], error: null });
      },
    };
    return builder;
  };
  return { db: { from } as never, inserts };
}
const model = (output: unknown) => vi.fn(async () => ({ model: 'claude-sonnet-5-5', pricing: { inputPerMillionUsd: 2, outputPerMillionUsd: 10 }, invoke: vi.fn(async () => ({ output, usage: { inputTokens: 1200, outputTokens: 900 } })) }));

describe('devShark concept generation (7 November 2026)', () => {
  it('turns a fitting model output into a deck and refuses one that does not fit', () => {
    expect(devsharkConceptDeck(good)).toHaveProperty('deck');
    expect(devsharkConceptDeck({ ...good, slides: good.slides.slice(0, 3) })).toEqual({ code: 'concept-closing-missing' });
    const long = { ...good, slides: [{ ...good.slides[0]!, body: 'word '.repeat(60).trim().slice(0, 220) }, ...good.slides.slice(1)] };
    expect(devsharkConceptDeck({ ...long, slides: long.slides.map((slide) => ({ ...slide, headline: slide.headline })) })).toBeTruthy();
  });

  it('reads its daily limits with safe caps and names recent titles in the prompt', () => {
    expect(devsharkConceptLimits({})).toEqual({ perDay: 3, dailyUsd: 0.3 });
    expect(devsharkConceptLimits({ DEVSHARK_CONCEPTS_PER_DAY: '50', DEVSHARK_CONCEPT_DAILY_USD: '9' })).toEqual({ perDay: 10, dailyUsd: 2 });
    expect(devsharkConceptPrompt('a CSS layout technique', ['Center a div'])).toContain('- Center a div');
  });

  it('writes one concept for review with its cost, and stops at a full queue, the daily count or the ceiling', async () => {
    const ok = fakeDb({ waiting: 0, recent: [], generated: 4 });
    expect(await generateDevsharkConcept(ok.db, owner, project, { now, signal: new AbortController().signal, model: model(good) })).toMatchObject({ status: 'generated' });
    expect(ok.inserts[0]).toMatchObject({ origin: 'generated', status: 'draft', title: 'Array.at()', cost_usd: 0.0114 });
    const full = fakeDb({ waiting: DEVSHARK_CONCEPT_QUEUE, recent: [], generated: 0 });
    expect(await generateDevsharkConcept(full.db, owner, project, { now, signal: new AbortController().signal, model: model(good) })).toEqual({ status: 'skipped', code: 'concept-queue-full' });
    const many = fakeDb({ waiting: 0, recent: [{ cost_usd: 0.01 }, { cost_usd: 0.01 }, { cost_usd: 0.01 }], generated: 3 });
    expect(await generateDevsharkConcept(many.db, owner, project, { now, signal: new AbortController().signal, model: model(good) })).toEqual({ status: 'skipped', code: 'concept-daily-count-reached' });
    const costly = fakeDb({ waiting: 0, recent: [{ cost_usd: 0.29 }], generated: 1 });
    expect(await generateDevsharkConcept(costly.db, owner, project, { now, signal: new AbortController().signal, model: model(good) })).toEqual({ status: 'skipped', code: 'concept-daily-ceiling' });
  });

  it('keeps the cost of an output it cannot use as a rejected concept', async () => {
    const bad = fakeDb({ waiting: 0, recent: [], generated: 0 });
    expect(await generateDevsharkConcept(bad.db, owner, project, { now, signal: new AbortController().signal, model: model({ title: 'x' }) })).toMatchObject({ status: 'refused', code: 'concept-output-invalid' });
    expect(bad.inserts[0]).toMatchObject({ status: 'rejected', origin: 'generated' });
  });
});
