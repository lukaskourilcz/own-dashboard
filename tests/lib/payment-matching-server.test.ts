import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only",()=>({}));
import { runPaymentMatching } from "@/lib/payment-matching-server";
const uuid=(n:number)=>`33333333-3333-4333-8333-${String(n).padStart(12,"0")}`;
const invoice=(n=1)=>({id:uuid(n),number:`2026${n}`,variable_symbol:`2026${n}`,currency:"CZK",status:"issued",round_total:false,issue_date:"2026-10-01",updated_at:"2026-10-23T12:00:00Z",payment_method:"bank",items_version:"a".repeat(32)});
const tx=(n=1)=>({id:uuid(10000+n),kind:"income",amount:1000,currency:"CZK",note:null,occurred_on:"2026-10-20",variable_symbol:`2026${n}`,invoice_id:null,match_version:"b".repeat(32)});
const line=(n=1)=>({id:uuid(20000+n),invoice_id:uuid(n),quantity:1,unit_price:1000,vat_rate:0});
let snapshot:{invoices:ReturnType<typeof invoice>[];transactions:ReturnType<typeof tx>[];items:ReturnType<typeof line>[]};
const insert=vi.fn(),rpc=vi.fn(),client={rpc,from:()=>({insert})} as unknown as SupabaseClient;
beforeEach(()=>{snapshot={invoices:[invoice()],transactions:[tx()],items:[line()]};insert.mockReset().mockResolvedValue({error:null});rpc.mockReset().mockImplementation(async(name,body)=>{
 if(name==="payment_matching_snapshot")return {data:snapshot,error:null};
 return {data:body.p_matches.map((m:{invoice_id:string;transaction_id:string})=>({...m,paid_on:"2026-10-20",changed:true})),error:null};
});});
it("finds a later eligible payment past 1201 unmatched rows with one read and one atomic write",async()=>{
 snapshot.transactions=[...Array.from({length:1201},(_,n)=>({...tx(n+2),variable_symbol:"",amount:1})),tx()];
 expect((await runPaymentMatching(client,uuid(0))).linked).toBe(1);expect(rpc).toHaveBeenCalledTimes(2);expect(insert).toHaveBeenCalledOnce();
 expect(rpc.mock.calls[1][1].p_matches).toEqual([{invoice_id:uuid(1),transaction_id:uuid(10001),source:"auto",invoice_updated_at:invoice().updated_at,items_version:"a".repeat(32),transaction_version:"b".repeat(32)}]);
});
it("caps settlement at 100 pairs and sends one notification batch",async()=>{
 snapshot={invoices:Array.from({length:101},(_,n)=>invoice(n+1)),transactions:Array.from({length:101},(_,n)=>tx(n+1)),items:Array.from({length:101},(_,n)=>line(n+1))};
 const result=await runPaymentMatching(client,uuid(0));expect(result.matched).toHaveLength(101);expect(result.linked).toBe(100);expect(rpc.mock.calls[1][1].p_matches).toHaveLength(100);expect(insert.mock.calls[0][0]).toHaveLength(100);expect(insert).toHaveBeenCalledOnce();
});
it("retains confirmed settlement when notification delivery rejects",async()=>{
 insert.mockRejectedValue(new Error("Synthetic notification failure"));expect((await runPaymentMatching(client,uuid(0))).linked).toBe(1);
});
it("refuses malformed or duplicate source data before writes",async()=>{
 snapshot.invoices.push(invoice());await expect(runPaymentMatching(client,uuid(0))).rejects.toThrow("Duplicate matching records");expect(rpc).toHaveBeenCalledOnce();expect(insert).not.toHaveBeenCalled();
});
it("does not report an unrelated or duplicate nominal settlement receipt",async()=>{
 rpc.mockImplementation(async(name)=>name==="payment_matching_snapshot"?{data:snapshot,error:null}:{data:[{transaction_id:uuid(999),invoice_id:uuid(1),paid_on:"2026-10-20",changed:true}],error:null});
 await expect(runPaymentMatching(client,uuid(0))).rejects.toThrow("Invalid settlement receipt");expect(insert).not.toHaveBeenCalled();
});
