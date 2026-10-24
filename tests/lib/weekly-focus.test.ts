import { createClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadWeeklyFocusSnapshot, parseWeeklyFocusSnapshot } from '@/lib/weekly-focus';
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222', week = '2026-10-12';
const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const make = () => ({ ownerId: owner, weekStart: week, sets: [0,1].map(n => ({ id: id(n + 1), user_id: owner, focus_date: `2026-10-${12+n}`, generation: n+1,
  items: [1,2].map(position => ({ id: id(100+n*10+position), user_id: owner, set_id: id(n+1), todo_id: id(200+position), position, title_snapshot: 'Private fixture task', project_name_snapshot: null as string | null, completed_at: position === 1 ? null : '2026-10-13T09:00:00.123456Z' })) })) });
type Value = ReturnType<typeof make>;
afterEach(() => vi.restoreAllMocks());
const client = (fetcher: typeof fetch) => createClient('https://example.supabase.co', 'public-fixture-key', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fetcher } });

describe('complete weekly focus runtime contract', () => {
  it('retains the exact validated weekly identities and confirms empty results', () => {
    const value = make(); expect(parseWeeklyFocusSnapshot(value, owner, week)).toEqual(value.sets);
    expect(parseWeeklyFocusSnapshot({ ...value, sets: [] }, owner, week)).toEqual([]);
  });
  const corrupt: Array<[string, (value: Value) => unknown]> = [
    ['wrong actor', v => ({ ...v, ownerId: other })], ['wrong week', v => ({ ...v, weekStart: '2026-10-19' })],
    ['unknown field', v => ({ ...v, privateCalendarBody: 'Unexpected' })], ['too many days', v => ({ ...v, sets: Array(8).fill(v.sets[0]) })],
    ['foreign set', v => { v.sets[0]!.user_id = other; return v; }], ['duplicate set', v => { v.sets[1]!.id = v.sets[0]!.id; return v; }],
    ['duplicate day', v => { v.sets[1]!.focus_date = v.sets[0]!.focus_date; return v; }], ['reversed days', v => ({ ...v, sets: [...v.sets].reverse() })],
    ['outside week', v => { v.sets[1]!.focus_date = '2026-10-19'; return v; }], ['zero generation', v => { v.sets[0]!.generation = 0; return v; }],
    ['too many items', v => { v.sets[0]!.items = Array(8).fill(v.sets[0]!.items[0]); return v; }],
    ['foreign item', v => { v.sets[0]!.items[0]!.user_id = other; return v; }], ['wrong parent', v => { v.sets[0]!.items[0]!.set_id = id(9); return v; }],
    ['duplicate item', v => { v.sets[1]!.items[0]!.id = v.sets[0]!.items[0]!.id; return v; }],
    ['duplicate position', v => { v.sets[0]!.items[1]!.position = 1; return v; }], ['reversed positions', v => { v.sets[0]!.items.reverse(); return v; }],
    ['duplicate live task in a set', v => { v.sets[0]!.items[1]!.todo_id = v.sets[0]!.items[0]!.todo_id; return v; }],
    ['empty title', v => { v.sets[0]!.items[0]!.title_snapshot = ''; return v; }],
    ['invalid completion time', v => { v.sets[0]!.items[0]!.completed_at = '2026-02-30T09:00:00Z'; return v; }],
    ['unsupported time precision', v => { v.sets[0]!.items[0]!.completed_at = '2026-10-13T09:00:00.1234567Z'; return v; }],
  ];
  it.each(corrupt)('refuses %s instead of returning a partial recap', (_name, change) => expect(() => parseWeeklyFocusSnapshot(change(make()), owner, week)).toThrow());
  it('refuses malformed top-level values and an invalid caller identity/window', () => {
    for (const value of [null, [], {}, true, 'private body']) expect(() => parseWeeklyFocusSnapshot(value, owner, week)).toThrow();
    expect(() => parseWeeklyFocusSnapshot(make(), 'wrong-owner', week)).toThrow();
    expect(() => parseWeeklyFocusSnapshot(make(), owner, '2026-10-13')).toThrow();
  });
  it('bounds UTF-8 response bytes independently from row counts', () => {
    const value = make(); value.sets = Array.from({ length: 7 }, (_, n) => ({ ...value.sets[0]!, id: id(n+1), focus_date: `2026-10-${12+n}`,
      items: Array.from({ length: 7 }, (_, position) => ({ ...value.sets[0]!.items[0]!, id: id(100+n*10+position), set_id: id(n+1), todo_id: id(200+position), position: position+1,
        title_snapshot: '字'.repeat(4000), project_name_snapshot: '字'.repeat(4000) })) }));
    expect(() => parseWeeklyFocusSnapshot(value, owner, week)).toThrow('Weekly focus unavailable');
  });
});

describe('actual SDK weekly read boundary', () => {
  it('issues one narrow RPC and validates its exact owner/week response', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe('https://example.supabase.co/rest/v1/rpc/weekly_focus_snapshot');
      expect(JSON.parse(init!.body as string)).toEqual({ p_week_start: week }); return Response.json(make());
    });
    expect(await loadWeeklyFocusSnapshot(client(fetcher), owner, week)).toEqual(make().sets); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not retry a refused read or expose its private body', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ message: 'Private fixture provider body' }, { status: 503 }));
    await expect(loadWeeklyFocusSnapshot(client(fetcher), owner, week)).rejects.toThrow(/^Weekly focus unavailable$/); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('refuses malformed replies and never seeds a partial or foreign snapshot', async () => {
    for (const value of [null, [], { ...make(), ownerId: other }, { ...make(), sets: [make().sets[1], make().sets[0]] }]) {
      await expect(loadWeeklyFocusSnapshot(client(async () => Response.json(value)), owner, week)).rejects.toThrow(/^Weekly focus unavailable$/);
    }
  });
  it('performs no request after caller cancellation or invalid window input', async () => {
    const fetcher = vi.fn<typeof fetch>(), controller = new AbortController(); controller.abort(new Error('Private reason'));
    await expect(loadWeeklyFocusSnapshot(client(fetcher), owner, week, controller.signal)).rejects.toMatchObject({ name: 'AbortError', message: 'Request aborted' });
    await expect(loadWeeklyFocusSnapshot(client(fetcher), owner, '2026-10-13')).rejects.toThrow(/^Weekly focus unavailable$/); expect(fetcher).not.toHaveBeenCalled();
  });
  it('cancels a noncooperative transport promptly and forwards the signal without a private cause', async () => {
    let transportSignal: AbortSignal | undefined; const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => { transportSignal = init?.signal ?? undefined; return new Promise<Response>(() => {}); });
    const pending = loadWeeklyFocusSnapshot(client(fetcher), owner, week, controller.signal);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)); controller.abort(new Error('Private reason'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError', message: 'Request aborted' }); expect(transportSignal!.aborted).toBe(true);
  });
  it('treats an expired internal deadline as unavailable, with no hidden retry', async () => {
    const controller = new AbortController(); vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const fetcher = vi.fn<typeof fetch>(async () => new Promise<Response>(() => {}));
    const pending = loadWeeklyFocusSnapshot(client(fetcher), owner, week); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)); controller.abort();
    await expect(pending).rejects.toThrow(/^Weekly focus unavailable$/); expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
