import { afterEach, expect, it, vi } from "vitest";
import { boundedResponseText } from "@/lib/bounded-response";
afterEach(() => vi.useRealTimers());
const fresh = () => new AbortController().signal;
it("reads a complete multibyte response at its exact byte bound", async () => {
  const raw = 'á😀', response = new Response(raw); expect(await boundedResponseText(response, 6, fresh())).toBe(raw); expect(response.body?.locked).toBe(false);
});
it("refuses multibyte overflow rather than measuring characters", async () => {
  await expect(boundedResponseText(new Response('á😀'), 5, fresh())).rejects.toThrow("Response unavailable");
});
it("does not await a permanently pending producer cancellation", async () => {
  const cancel = vi.fn(() => new Promise<void>(() => {})), response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(11)); }, cancel }));
  await expect(boundedResponseText(response, 10, fresh())).rejects.toThrow("Response unavailable"); expect(cancel).toHaveBeenCalledOnce(); expect(response.body?.locked).toBe(false);
});
it("cancels and releases a pending body on the caller's deadline", async () => {
  const stop = new AbortController(), cancel = vi.fn(() => new Promise<void>(() => {})), response = new Response(new ReadableStream({ cancel }));
  const result = boundedResponseText(response, 10, stop.signal), failed = expect(result).rejects.toMatchObject({ name: "AbortError" });
  stop.abort('PRIVATE TEST reason'); await failed; expect(cancel).toHaveBeenCalledOnce(); expect(response.body?.locked).toBe(false);
});
it("discards a declared overflow before reading", async () => {
  const pull = vi.fn(), cancel = vi.fn(), response = new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), { headers: { 'content-length': '11' } });
  await expect(boundedResponseText(response, 10, fresh())).rejects.toThrow("Response unavailable"); expect(pull).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce();
});
it.each(['-1', 'wrong', '1e3'])("refuses malformed declared size %s", async declared => {
  await expect(boundedResponseText(new Response('{}', { headers: { 'content-length': declared } }), 10, fresh())).rejects.toThrow("Response unavailable");
});
it("does not trust an understated or compressed content length", async () => {
  await expect(boundedResponseText(new Response('x'.repeat(11), { headers: { 'content-length': '2' } }), 10, fresh())).rejects.toThrow("Response unavailable");
});
it("rejects invalid UTF-8 instead of authenticating replacement characters", async () => {
  const response = new Response(new Uint8Array([0xc3, 0x28])); await expect(boundedResponseText(response, 10, fresh())).rejects.toThrow(); expect(response.body?.locked).toBe(false);
});
it("discards pre-aborted input without exposing the reason", async () => {
  const stop = new AbortController(); stop.abort('PRIVATE TEST reason'); const cancel = vi.fn(), response = new Response(new ReadableStream({ cancel }));
  await expect(boundedResponseText(response, 10, stop.signal)).rejects.toThrow("Response unavailable"); expect(cancel).toHaveBeenCalledOnce(); expect(response.body?.locked).toBe(false);
});
it("refuses absent bodies and invalid bounds", async () => {
  await expect(boundedResponseText(new Response(null), 10, fresh())).rejects.toThrow("Response unavailable");
  for (const maximum of [0, -1, 1.5, Infinity]) await expect(boundedResponseText(new Response('{}'), maximum, fresh())).rejects.toThrow("Response unavailable");
});
it("does not accept a previously consumed suffix as a complete response", async () => {
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('ignored prefix')); controller.enqueue(new TextEncoder().encode('{}')); controller.close(); } }));
  const reader = response.body!.getReader(); await reader.read(); reader.releaseLock();
  await expect(boundedResponseText(response, 100, fresh())).rejects.toThrow("Response unavailable");
});
it("hides an untrusted producer's failure text", async () => {
  await expect(boundedResponseText(new Response(new ReadableStream({ pull(controller) { controller.error(new Error('PRIVATE TEST producer')); } })), 100, fresh())).rejects.toThrow(/^Response unavailable$/);
});

it('refuses a finite zero-byte chunk flood without retaining every allocation',async()=>{
 let pulls=0;const cancel=vi.fn(),response=new Response(new ReadableStream({pull(controller){if(++pulls<65538)controller.enqueue(new Uint8Array());else controller.close();},cancel},{highWaterMark:0}));await expect(boundedResponseText(response,1024,fresh())).rejects.toThrow('Response unavailable');expect(pulls).toBeLessThanOrEqual(65537);expect(cancel).toHaveBeenCalledOnce();expect(response.body?.locked).toBe(false);
});
it.each([()=>new Uint8Array([65]),()=>Buffer.from([65])])('captures each admitted chunk before a producer reuses its buffer: %#',async makeBytes=>{
 const bytes=makeBytes();let step=0;const response=new Response(new ReadableStream({pull(controller){if(step++===0)controller.enqueue(bytes);else{bytes[0]=66;controller.enqueue(bytes);controller.close();}}},{highWaterMark:0}));expect(await boundedResponseText(response,2,fresh())).toBe('AB');
});
