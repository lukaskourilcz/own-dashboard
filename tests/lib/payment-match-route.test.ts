import { beforeEach, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({user:true,limited:false,read:vi.fn(),link:vi.fn(),run:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:state.user?{id:"owner"}:null}})}})}));
vi.mock("@/lib/rate-limit",()=>({rateLimit:async()=>({ok:!state.limited,retryAfter:60})}));
vi.mock("@/lib/payment-matching-server",()=>({readPaymentMatchingSnapshot:state.read,linkPayment:state.link,runPaymentMatching:state.run}));
import { POST } from "@/app/api/money/payment-match/route";
const transactionId="11111111-1111-4111-8111-111111111111",invoiceId="22222222-2222-4222-8222-222222222222";
const request=(body:unknown,origin="https://app.example")=>new Request("https://app.example/api/money/payment-match",{method:"POST",headers:{origin,"Content-Type":"application/json"},body:JSON.stringify(body)});
beforeEach(()=>{state.user=true;state.limited=false;state.read.mockReset().mockResolvedValue({transactions:[{id:transactionId,kind:"income",occurred_on:"2026-10-19"}],invoices:[{id:invoiceId,payment_method:"bank"}]});state.link.mockReset().mockResolvedValue({paid_on:"2026-10-20"});state.run.mockReset().mockResolvedValue({scanned:5,linked:1,unmatched:[]});});
it.each([null,[],{}, {mode:"bad"},{mode:"link",transactionId:"not-an-id",invoiceId}])("rejects malformed input before any ledger read/write (%j)",async body=>{
 expect((await POST(request(body))).status).toBe(400);expect(state.read).not.toHaveBeenCalled();expect(state.run).not.toHaveBeenCalled();
});
it("retains authentication, same-origin and rate boundaries",async()=>{
 expect((await POST(request({mode:"auto"},"https://other.test"))).status).toBe(403);state.user=false;expect((await POST(request({mode:"auto"}))).status).toBe(401);state.user=true;state.limited=true;expect((await POST(request({mode:"auto"}))).status).toBe(429);expect(state.run).not.toHaveBeenCalled();
});
it("uses the locked settlement receipt date, not the earlier read",async()=>{
 const response=await POST(request({mode:"link",transactionId,invoiceId}));expect(await response.json()).toEqual({ok:true,linked:1,paidOn:"2026-10-20"});
 expect(state.read.mock.calls[0][1]).toBe("owner");
});
it("keeps a stale selection unresolved and redacts database/network causes",async()=>{
 state.link.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("Private financial detail"));
 expect((await POST(request({mode:"link",transactionId,invoiceId}))).status).toBe(409);const response=await POST(request({mode:"link",transactionId,invoiceId}));expect(response.status).toBe(500);expect(await response.text()).not.toContain("Private");
});
