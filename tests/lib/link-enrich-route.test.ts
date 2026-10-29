import { beforeEach, afterEach, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({user:true,limited:false,fetch:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:state.user?{id:"owner"}:null}})}})}));
vi.mock("@/lib/rate-limit",()=>({rateLimit:async()=>({ok:!state.limited,retryAfter:60})}));
import { POST } from "@/app/api/ai-links/enrich/route";
const request=(body:unknown,origin="https://app.example")=>new Request("https://app.example/api/ai-links/enrich",{method:"POST",headers:{origin,"Content-Type":"application/json"},body:JSON.stringify(body)});
beforeEach(()=>{state.user=true;state.limited=false;state.fetch.mockReset().mockResolvedValue(Response.json({data:{title:"Synthetic title",description:"Description"}}));vi.stubGlobal("fetch",state.fetch);});
afterEach(()=>vi.unstubAllGlobals());
it.each([null,[],{url:12},{url:{}},{url:"https://user:password@example.test"},{url:"x".repeat(4097)},{url:"javascript:alert(1)"}])("rejects invalid URLs before contacting a provider (%j)",async body=>{
 expect((await POST(request(body))).status).toBe(400);expect(state.fetch).not.toHaveBeenCalled();
});
it("requires the signed-in same-origin rate-limited action",async()=>{
 expect((await POST(request({url:"https://example.test"},"https://foreign.test"))).status).toBe(403);
 state.user=false;expect((await POST(request({url:"https://example.test"}))).status).toBe(401);
 state.user=true;state.limited=true;expect((await POST(request({url:"https://example.test"}))).status).toBe(429);expect(state.fetch).not.toHaveBeenCalled();
});
it("sends only the submitted URL and returns bounded page metadata",async()=>{
 const result=await POST(request({url:"example.test",categories:[{name:"Private category"}],owner:"Private owner"}));
 expect(await result.json()).toEqual({title:"Synthetic title",description:"Description",category_id:null,pricing:null});
 expect(state.fetch.mock.calls[0][0]).toBe("https://r.jina.ai/https://example.test/");expect(JSON.stringify(state.fetch.mock.calls)).not.toContain("Private");
});
it("refuses oversized or malformed upstream metadata without exposing the body",async()=>{
 state.fetch.mockResolvedValueOnce(new Response("x".repeat(512*1024+1))).mockResolvedValueOnce(Response.json({data:{title:{private:"detail"}}}));
 for(let n=0;n<2;n++){const response=await POST(request({url:"https://example.test"}));expect(response.status).toBe(502);expect(await response.text()).not.toContain("private");}
});
