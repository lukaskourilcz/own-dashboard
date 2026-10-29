import { afterEach, describe, expect, it, vi } from 'vitest';
import { readKnowledgeBody } from '@/lib/marketing/knowledge-body';
const request = (body: BodyInit, headers: HeadersInit = {}, signal?: AbortSignal) => new Request('https://own.example', { method: 'POST', body, headers, signal, duplex: 'half' } as RequestInit);
afterEach(() => vi.useRealTimers());

describe('bounded marketing input streams', () => {
  it('preserves signed UTF-8 text exactly and releases a completed stream', async () => {
    const body = ' {"text":"Žluťoučký 😀"}\n';
    const input = request(body);
    expect(await readKnowledgeBody(input)).toBe(body);
    expect(input.body?.locked).toBe(false);
  });
  it('enforces actual bytes even when the claimed length is absent or smaller', async () => {
    for (const headers of [new Headers(), new Headers({ 'content-length': '1' })]) {
      const cancel = vi.fn();
      const input = request(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('😀')); }, cancel }), headers);
      await expect(readKnowledgeBody(input, 3)).rejects.toThrow('capture-too-large');
      expect(cancel).toHaveBeenCalledOnce();
      expect(input.body?.locked).toBe(false);
    }
  });
  it.each(['no', '-1', '1.2', '1e3', 'Infinity', '999999999999999999999999999999999'])('rejects malformed or excessive claimed length %s before reading', async length => {
    const input = request('x', { 'content-length': length });
    await expect(readKnowledgeBody(input, 10)).rejects.toThrow('capture-too-large');
    expect(input.bodyUsed).toBe(false);
  });
  it('refuses invalid UTF-8 rather than changing signed input', async () => {
    const input = request(new Uint8Array([0xc3, 0x28]));
    await expect(readKnowledgeBody(input)).rejects.toThrow();
    expect(input.body?.locked).toBe(false);
  });
  it('cancels a stalled read promptly without waiting for an uncooperative cancel hook', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const input = request(new ReadableStream({ cancel }));
    const controller = new AbortController();
    const pending = readKnowledgeBody(input, 100, controller.signal);
    controller.abort('TEST_ONLY_PRIVATE_REASON');
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(input.body?.locked).toBe(false);
  });
  it('does no body read after the request is already cancelled', async () => {
    const controller = new AbortController(); controller.abort();
    const input = request('x', {}, controller.signal);
    await expect(readKnowledgeBody(input)).rejects.toMatchObject({ name: 'AbortError' });
    expect(input.bodyUsed).toBe(false);
  });
  it('releases and cancels the reader on a transport failure without reflecting its text', async () => {
    const input = request(new ReadableStream({ start(controller) { controller.error(new Error('TEST_ONLY_PRIVATE_REASON')); } }));
    await expect(readKnowledgeBody(input)).rejects.toThrow('capture-read-failed');
    expect(input.body?.locked).toBe(false);
  });
  it('bounds a stalled request with its default deadline', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(); const input = request(new ReadableStream({ cancel }));
    const pending = readKnowledgeBody(input); const check = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(10_000);
    await check;
    expect(cancel).toHaveBeenCalledOnce();
    expect(input.body?.locked).toBe(false);
  });
});
