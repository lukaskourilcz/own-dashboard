import { afterEach, expect, it, vi } from 'vitest';
import { liveDneskaiWorkspaceApi } from '@/lib/marketing/dneskai-workspace-client';
import { createDneskaiWorkspaceFixture } from '@/lib/demo/dneskai-workspace-fixtures';
const project = '22222222-2222-4222-8222-222222222222';
const fixture = () => createDneskaiWorkspaceFixture(new Date('2026-10-28T09:00:00Z'));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('starts no browser read after original retirement', async () => {
  const caller = new AbortController(); caller.abort('TEST_ONLY_PRIVATE_REASON');
  const fetcher = vi.fn(async () => Response.json(fixture())); vi.stubGlobal('fetch', fetcher);
  await expect(liveDneskaiWorkspaceApi.loadReview(project, caller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetcher).not.toHaveBeenCalled();
});
it('captures one thirty-second read allowance before fetch', async () => {
  const deadline = new AbortController(), clock = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
  let finish!: (value: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })); vi.stubGlobal('fetch', fetcher);
  const pending = liveDneskaiWorkspaceApi.loadReview(project);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  finish(Response.json(fixture())); await pending;
  expect(clock).toHaveBeenCalledExactlyOnceWith(30_000);
  expect(fetcher.mock.calls[0]).toBeDefined();
});
it('retires a successful held body before its producer is released', async () => {
  const caller = new AbortController(); let stream!: ReadableStreamDefaultController<Uint8Array>;
  const cancelled = vi.fn();
  const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller; }, cancel: cancelled });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'Content-Type': 'application/json' } })));
  let settled = false;
  const pending = liveDneskaiWorkspaceApi.loadReview(project, caller.signal).then(value => ({ value }), error => ({ error })).finally(() => { settled = true; });
  await new Promise(resolve => setTimeout(resolve, 5)); caller.abort('TEST_ONLY_PRIVATE_REASON');
  await new Promise(resolve => setTimeout(resolve, 20)); const retiredBeforeRelease = settled;
  if (!cancelled.mock.calls.length) { stream.enqueue(new TextEncoder().encode(JSON.stringify(fixture()))); stream.close(); }
  const result = await pending;
  expect(retiredBeforeRelease).toBe(true); expect(result).toMatchObject({ error: { name: 'AbortError' } }); expect(cancelled).toHaveBeenCalledOnce();
});
it('refuses an actual oversized successful body even without Content-Length', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(' '.repeat(8 * 1024 * 1024 + 1) + JSON.stringify(fixture()), { headers: { 'Content-Type': 'application/json' } })));
  await expect(liveDneskaiWorkspaceApi.loadReview(project)).rejects.toMatchObject({ code: 'dneskai-workspace-unavailable' });
});
it('bounds an uncooperative header wait and discards its late body', async () => {
  const deadline = new AbortController(); vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
  let finish!: (value: Response) => void; const cancelled = vi.fn();
  const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })); vi.stubGlobal('fetch', fetcher);
  const pending = liveDneskaiWorkspaceApi.loadReview(project).catch(error => error);
  deadline.abort();
  expect(await pending).toMatchObject({ code: 'dneskai-workspace-unavailable' });
  finish(new Response(new ReadableStream({ cancel: cancelled }), { headers: { 'Content-Type': 'application/json' } }));
  await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce()); expect(fetcher).toHaveBeenCalledOnce();
});
it.each([200, 503])('shares the original allowance with a held %i body and cancels it', async status => {
  const deadline = new AbortController(), clock = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal), cancelled = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel: cancelled });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status, headers: { 'Content-Type': 'application/json' } })));
  const pending = liveDneskaiWorkspaceApi.loadReview(project).catch(error => error);
  await vi.waitFor(() => expect(body.locked).toBe(true)); deadline.abort();
  expect(await pending).toMatchObject({ code: 'dneskai-workspace-unavailable' });
  expect(clock).toHaveBeenCalledExactlyOnceWith(30_000); expect(cancelled).toHaveBeenCalledOnce();
});
const refusedMetadata: ResponseInit[] = [
  { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Length': String(8 * 1024 * 1024 + 1) } },
  { status: 200, headers: { 'Content-Type': 'text/html' } },
  { status: 503, headers: { 'Content-Type': 'application/json', 'Content-Length': '4097' } },
];
it.each(refusedMetadata)('discards refused response metadata without waiting for its body: %#', async init => {
  const cancelled = vi.fn(); vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ cancel: cancelled }), init)));
  await expect(liveDneskaiWorkspaceApi.loadReview(project)).rejects.toMatchObject({ code: 'dneskai-workspace-unavailable' });
  expect(cancelled).toHaveBeenCalledOnce();
});
it('rejects invalid UTF-8 and an actually oversized error envelope without exposing it', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([0xc3, 0x28]), { headers: { 'Content-Type': 'application/json' } })));
  await expect(liveDneskaiWorkspaceApi.loadReview(project)).rejects.toMatchObject({ code: 'dneskai-workspace-unavailable' });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'TEST_ONLY_PRIVATE_ERROR', detail: 'x'.repeat(5000) }), { status: 503, headers: { 'Content-Type': 'application/json' } })));
  await expect(liveDneskaiWorkspaceApi.loadReview(project)).rejects.toMatchObject({ code: 'dneskai-workspace-unavailable', status: 503 });
});
it('retains sanitized refusal reasons and Retry-After while skipping a stalled rate-limit body', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'approval-unavailable', reason: 'render-blocked' }, { status: 409 })));
  await expect(liveDneskaiWorkspaceApi.loadReview(project)).rejects.toMatchObject({ code: 'render-blocked', status: 409 });
  const cancelled = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ cancel: cancelled }), { status: 429, headers: { 'Retry-After': '12' } })));
  await expect(liveDneskaiWorkspaceApi.loadReview(project)).rejects.toMatchObject({ code: 'rate-limited', status: 429, retryAfterMs: 12_000 }); expect(cancelled).toHaveBeenCalledOnce();
});
it.each(['calendar', 'costs', 'media'] as const)('shares bounded transport with the %s reader', async kind => {
  const { createDneskaiCostsFixture } = await import('@/lib/demo/dneskai-workspace-fixtures');
  const value = kind === 'calendar' ? { ...fixture(), calendarComplete: true } : kind === 'costs' ? createDneskaiCostsFixture(new Date('2026-10-28T09:00:00Z')) : { schemaVersion: 'dneskai-media/1', candidates: [] };
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => { expect(init?.signal).toBeInstanceOf(AbortSignal); expect(init?.redirect).toBe('error'); expect(init?.cache).toBe('no-store'); return Response.json(value); }); vi.stubGlobal('fetch', fetcher);
  const result = kind === 'calendar' ? await liveDneskaiWorkspaceApi.loadReview(project, undefined, undefined, 'calendar') : kind === 'costs' ? await liveDneskaiWorkspaceApi.loadCosts(project) : await liveDneskaiWorkspaceApi.loadMedia(project, 'TEST_ONLY_CANDIDATE');
  expect(result).toMatchObject(value); expect(fetcher).toHaveBeenCalledOnce();
});
