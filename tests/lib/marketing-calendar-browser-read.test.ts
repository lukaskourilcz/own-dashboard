import { afterEach, expect, it, vi } from 'vitest';
import { loadMarketingCalendars, MARKETING_CALENDAR_SOURCES } from '@/lib/marketing-calendars';
const calendar = () => ({ name: 'Calendar', launch: null, periodStart: null, periodEnd: null, entries: [], prelaunch: [], skipped: 0 });
const payload = () => ({ checkedAt: '2026-10-28T09:00:00.000Z', sources: MARKETING_CALENDAR_SOURCES.map(({ id, label, repo, path, calendarUrl }) => ({ id, label, repo, path, calendarUrl, status: 'ok', detail: null, calendar: calendar() })) });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const stub = (response: Response) => vi.stubGlobal('fetch', vi.fn(async () => response));
it('returns the complete registered projection and forwards its original cancellation scope', async () => {
  const body = payload(), parent = new AbortController(); stub(Response.json(body));
  await expect(loadMarketingCalendars(parent.signal)).resolves.toEqual({ kind: 'ok', data: body });
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/marketing/calendars', expect.objectContaining({ cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal) }));
});
for (const state of ['empty', 'duplicate', 'unknown', 'wrong-link', 'wrong-label', 'bad-date', 'bad-time', 'duplicate-entry', 'too-many', 'bad-skipped', 'ok-without-calendar', 'failed-with-calendar', 'bad-checked-at'] as const) it(`refuses ${state} response evidence`, async () => {
  const body: Record<string, unknown> = payload(), sources = body.sources as Array<Record<string, unknown>>, first = sources[0]!, entries = [{ id: 'entry', date: '2026-10-28', time: '12:30', platform: 'instagram', kind: 'carousel', title: 'Calendar entry', status: 'planned', tipRefs: [] }];
  if (state === 'empty') body.sources = [];
  else if (state === 'duplicate') body.sources = [first, first];
  else if (state === 'unknown') first.id = 'another';
  else if (state === 'wrong-link') first.calendarUrl = 'https://example.com/foreign-calendar';
  else if (state === 'wrong-label') first.label = 'Another project';
  else if (state === 'bad-date') first.calendar = { ...calendar(), entries: [{ ...entries[0], date: '2026-02-30' }] };
  else if (state === 'bad-time') first.calendar = { ...calendar(), entries: [{ ...entries[0], time: '99:99' }] };
  else if (state === 'duplicate-entry') first.calendar = { ...calendar(), entries: [entries[0], entries[0]] };
  else if (state === 'too-many') first.calendar = { ...calendar(), entries: Array.from({ length: 1001 }, (_, i) => ({ ...entries[0], id: `e${i}` })) };
  else if (state === 'bad-skipped') first.calendar = { ...calendar(), skipped: -1 };
  else if (state === 'ok-without-calendar') first.calendar = null;
  else if (state === 'failed-with-calendar') first.status = 'unreadable';
  else body.checkedAt = 'yesterday';
  stub(Response.json(body)); await expect(loadMarketingCalendars()).resolves.toEqual({ kind: 'error' });
});
it('does not start an already retired read', async () => {
  const parent = new AbortController(); parent.abort(); stub(Response.json(payload()));
  await expect(loadMarketingCalendars(parent.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(fetch).not.toHaveBeenCalled();
});
it('stops waiting for an uncooperative fetch and discards its late body', async () => {
  const parent = new AbortController(); let finish!: (reply: Response) => void, settled = false, cancelled = false;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  const pending = loadMarketingCalendars(parent.signal); const outcome = pending.then(() => { settled = true; }, () => { settled = true; }); for (let i = 0; i < 12; i++) await Promise.resolve(); expect(fetch).toHaveBeenCalledOnce(); parent.abort();
  for (let i = 0; i < 12; i++) await Promise.resolve();
  try { expect(settled).toBe(true); }
  finally { finish(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify(payload()))); }, pull(controller) { controller.close(); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } })); await outcome; }
  for (let i = 0; i < 12; i++) await Promise.resolve(); expect(cancelled).toBe(true);
});
it('bounds actual streamed bytes without trusting an absent length header', async () => {
  let cancelled = false;
  stub(new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } }));
  const parent = new AbortController(), pending = loadMarketingCalendars(parent.signal); let settled = false; const outcome = pending.then(value => { settled = true; return value; }, () => { settled = true; return { kind: 'error' }; });
  for (let i = 0; i < 30; i++) await Promise.resolve();
  try { expect(settled).toBe(true); expect(await outcome).toEqual({ kind: 'error' }); expect(cancelled).toBe(true); }
  finally { parent.abort(); }
});
for (const status of [401, 429] as const) it(`discards an unread ${status} body without parsing it`, async () => {
  let cancelled = false; stub(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('TEST_ONLY_UNUSED_ERROR')); }, cancel() { cancelled = true; } }), { status }));
  await expect(loadMarketingCalendars()).resolves.toEqual({ kind: status === 401 ? 'signed-out' : 'rate-limited' }); expect(cancelled).toBe(true);
});
it('keeps one original thirty-five-second allowance around an uncooperative fetch', async () => {
  const budget = new AbortController(), clock = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(budget.signal);
  let finish!: (reply: Response) => void; vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  const pending = loadMarketingCalendars(); expect(clock).toHaveBeenCalledExactlyOnceWith(35_000); for (let i = 0; i < 12; i++) await Promise.resolve(); expect(fetch).toHaveBeenCalledOnce(); budget.abort();
  await expect(pending).resolves.toEqual({ kind: 'error' }); finish(Response.json(payload()));
});
it('retires a stalled body without waiting for its cancellation hook', async () => {
  const budget = new AbortController(); vi.spyOn(AbortSignal, 'timeout').mockReturnValue(budget.signal); let cancelled = false;
  stub(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel() { cancelled = true; return new Promise(() => {}); } }), { headers: { 'content-type': 'application/json' } }));
  const pending = loadMarketingCalendars(); for (let i = 0; i < 12; i++) await Promise.resolve(); budget.abort(); await expect(pending).resolves.toEqual({ kind: 'error' }); expect(cancelled).toBe(true);
});
for (const [status, contentType] of [[200, 'text/html'], [206, 'application/json']] as const) it(`refuses a ${status}/${contentType} success-shaped document`, async () => {
  stub(new Response(JSON.stringify(payload()), { status, headers: { 'content-type': contentType } })); await expect(loadMarketingCalendars()).resolves.toEqual({ kind: 'error' });
});
it('retires a same-turn query before starting its HTTP transport', async () => {
  const parent = new AbortController(); stub(Response.json(payload())); const pending = loadMarketingCalendars(parent.signal); parent.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(fetch).not.toHaveBeenCalled();
});
