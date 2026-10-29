import { afterEach, expect, it, vi } from 'vitest';
import { liveDneskaiWorkspaceApi, previewAt, fitAt } from '@/lib/marketing/dneskai-workspace-client';
const id = '22222222-2222-4222-8222-222222222222', hash = 'a'.repeat(64);
const preview = () => ({ schemaVersion: 'dneskai-preview/1', draft: true, slide: 0, status: 'refused', image: null, problems: [] });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('does not send a retired draft preview', async () => {
  const caller = new AbortController(); caller.abort('TEST_ONLY_PRIVATE_REASON');
  const fetcher = vi.fn(async () => Response.json(preview())); vi.stubGlobal('fetch', fetcher);
  await expect(previewAt('/TEST_ONLY_PREVIEW', {}, caller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetcher).not.toHaveBeenCalled();
});
it('captures one allowance before a write rather than waiting without a limit', async () => {
  const deadline = new AbortController(), clock = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
  let finish!: (value: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })); vi.stubGlobal('fetch', fetcher);
  const pending = liveDneskaiWorkspaceApi.approve(id, hash);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce()); finish(Response.json({ ok: true })); await pending;
  expect(clock).toHaveBeenCalledExactlyOnceWith(65_000);
});
it('retires a held draft-preview body without waiting for its producer', async () => {
  const caller = new AbortController(), cancelled = vi.fn(); let stream!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller; }, cancel: cancelled });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'Content-Type': 'application/json' } })));
  let settled = false;
  const pending = previewAt('/TEST_ONLY_PREVIEW', {}, caller.signal).then(value => ({ value }), error => ({ error })).finally(() => { settled = true; });
  await vi.waitFor(() => expect(body.locked).toBe(true)); caller.abort('TEST_ONLY_PRIVATE_REASON');
  await new Promise(resolve => setTimeout(resolve, 20)); const retiredBeforeRelease = settled;
  if (!cancelled.mock.calls.length) { stream.enqueue(new TextEncoder().encode(JSON.stringify(preview()))); stream.close(); }
  const result = await pending;
  expect(retiredBeforeRelease).toBe(true); expect(result).toMatchObject({ error: { name: 'AbortError' } }); expect(cancelled).toHaveBeenCalledOnce();
});
it('refuses actual oversized write acknowledgements before schema validation', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(' '.repeat(64 * 1024 + 1) + '{"ok":true}', { headers: { 'Content-Type': 'application/json' } })));
  await expect(liveDneskaiWorkspaceApi.approve(id, hash)).rejects.toMatchObject({ code: 'decision-failed' });
});
it('never acknowledges a malformed successful JSON write', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{', { headers: { 'Content-Type': 'application/json' } })));
  await expect(liveDneskaiWorkspaceApi.approve(id, hash)).rejects.toMatchObject({ code: 'decision-failed' });
});
it.each([200, 503])('bounds a held %i write body under the original allowance', async status => {
  const deadline = new AbortController(), clock = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal), cancelled = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel: cancelled });
  const fetcher = vi.fn(async () => new Response(body, { status, headers: { 'Content-Type': 'application/json' } })); vi.stubGlobal('fetch', fetcher);
  const pending = liveDneskaiWorkspaceApi.approve(id, hash).catch(error => error);
  await vi.waitFor(() => expect(body.locked).toBe(true)); deadline.abort();
  expect(await pending).toMatchObject({ code: 'decision-failed' }); expect(clock).toHaveBeenCalledExactlyOnceWith(65_000);
  expect(cancelled).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce();
});
it('observes an ambiguous uncooperative write without replay and discards a late acknowledgement', async () => {
  const deadline = new AbortController(); vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
  let finish!: (value: Response) => void; const cancelled = vi.fn();
  const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })); vi.stubGlobal('fetch', fetcher);
  const pending = liveDneskaiWorkspaceApi.approve(id, hash).catch(error => error); deadline.abort();
  expect(await pending).toMatchObject({ code: 'decision-failed' });
  finish(new Response(new ReadableStream({ cancel: cancelled }), { headers: { 'Content-Type': 'application/json' } }));
  await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce()); expect(fetcher).toHaveBeenCalledOnce();
});
it('allows a schema-valid two-million-character preview without using the small acknowledgement cap', async () => {
  const prefix = 'data:image/webp;base64,', image = prefix + 'a'.repeat(2_000_000 - prefix.length);
  const value = { ...preview(), status: 'rendered', image };
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => { expect(init?.redirect).toBe('error'); expect(init?.signal).toBeInstanceOf(AbortSignal); return Response.json(value); }); vi.stubGlobal('fetch', fetcher);
  expect((await previewAt('/TEST_ONLY_PREVIEW', {})).image).toBe(image); expect(fetcher).toHaveBeenCalledOnce();
});
it('uses the preview, fit and requeue allowances in their live and fixture ports', async () => {
  const deadline = new AbortController(), clock = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(preview()))); await previewAt('/TEST_ONLY_PREVIEW', {});
  expect(clock).toHaveBeenLastCalledWith(20_000);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ schemaVersion: 'dneskai-fit/1', kit: 'editorial', slides: [] })));
  await fitAt('/TEST_ONLY_FIT', { kit: 'editorial', slides: [{ type: 'statement', headline: 'TEST_ONLY_HEADLINE', images: [] }] }); expect(clock).toHaveBeenLastCalledWith(15_000);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ result: 'queued' }))); await liveDneskaiWorkspaceApi.requeuePublication(id); expect(clock).toHaveBeenLastCalledWith(20_000);
  expect(clock).toHaveBeenCalledTimes(3);
});
it('keeps an accepted queued job distinct from completed generation', async () => {
  const value = { jobId: id, status: 'queued' };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(value, { status: 202 })));
  expect(await liveDneskaiWorkspaceApi.generateNow(id)).toEqual(value);
});
it('refuses actual oversized error JSON, invalid UTF-8 and non-JSON success without exposing diagnostics', async () => {
  for (const response of [
    new Response(JSON.stringify({ error: 'TEST_ONLY_PRIVATE_ERROR', detail: 'x'.repeat(5000) }), { status: 503, headers: { 'Content-Type': 'application/json' } }),
    new Response(new Uint8Array([0xc3, 0x28]), { headers: { 'Content-Type': 'application/json' } }),
    new Response('{"ok":true}', { headers: { 'Content-Type': 'text/html' } }),
  ]) {
    vi.stubGlobal('fetch', vi.fn(async () => response));
    await expect(liveDneskaiWorkspaceApi.approve(id, hash)).rejects.toMatchObject({ code: 'decision-failed' });
  }
});
