import { expect, it, vi } from "vitest";
import { readTextPrefix } from "@/lib/bounded-text";
it("decodes split UTF-8 chunks without truncating a complete body",async()=>{
 const bytes=new TextEncoder().encode("Český text"),response=new Response(new ReadableStream({start(c){for(const b of bytes)c.enqueue(new Uint8Array([b]));c.close();}}));
 expect(await readTextPrefix(response,10)).toEqual({text:"Český text",truncated:false});
});
it("cancels an oversized stream without reading or buffering its remainder",async()=>{
 const cancel=vi.fn();let reads=0;const response=new Response(new ReadableStream({pull(c){reads++;c.enqueue(new TextEncoder().encode("abcdefgh"));},cancel},{highWaterMark:0}));
 expect(await readTextPrefix(response,5)).toEqual({text:"abcde",truncated:true});expect(reads).toBe(1);expect(cancel).toHaveBeenCalledOnce();
});
it("keeps exact bounds and empty bodies complete",async()=>{
 expect(await readTextPrefix(new Response("abc"),3)).toEqual({text:"abc",truncated:false});
 expect(await readTextPrefix(new Response(null),3)).toEqual({text:"",truncated:false});
});
it("cancels a stalled body on abort without leaking the abort reason", async () => {
 const cancel=vi.fn(),controller=new AbortController();
 const pending=readTextPrefix(new Response(new ReadableStream({cancel})),100,controller.signal);
 const failed=expect(pending).rejects.toMatchObject({name:"AbortError",message:"Request aborted"});
 controller.abort("private");await failed;expect(cancel).toHaveBeenCalledOnce();
});
it("does not begin reading an already cancelled request", async () => {
 const controller=new AbortController();controller.abort("private");
 const response=new Response("unused");
 await expect(readTextPrefix(response,10,controller.signal)).rejects.toMatchObject({name:"AbortError"});expect(response.bodyUsed).toBe(false);
});

it("returns an oversized prefix without waiting for the producer's cancellation hook", async () => {
 let release!: () => void;
 const cancel = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
 const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('abcdefgh')); }, cancel }));
 const pending = readTextPrefix(response, 5);
 try {
  const result = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve('still waiting for producer'), 20))]);
  expect(result).toEqual({ text: 'abcde', truncated: true });
  expect(cancel).toHaveBeenCalledOnce();
  expect(response.body!.locked).toBe(false);
 } finally { release?.(); await pending; }
});
it("keeps an oversized prefix truthful when the producer rejects cancellation", async () => {
 const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('abcdefgh')); }, cancel() { return Promise.reject(new Error('TEST_ONLY_PRIVATE')); } }));
 await expect(readTextPrefix(response, 5)).resolves.toEqual({ text: 'abcde', truncated: true });
 expect(response.body!.locked).toBe(false);
});
