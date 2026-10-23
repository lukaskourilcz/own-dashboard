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
