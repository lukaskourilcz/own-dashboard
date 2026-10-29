import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only",()=>({}));
import { readPaymentMatchingSnapshot } from "@/lib/payment-matching-server";
import { createMigratedDatabase, setDatabaseTime } from "../helpers/supabase-pglite";
const owner="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222";
let db:PGlite,invoice:string,second:string,tx:string,foreignTx:string;
type Snapshot={invoices:{id:string;updated_at:string;items_version:string}[];transactions:{id:string;match_version:string}[];items:unknown[]};
const snapshot=async(uid=owner)=>(await db.query<{data:Snapshot}>("select payment_matching_snapshot($1) as data",[uid])).rows[0].data;
const input=(s:Snapshot,invoiceId=invoice,transactionId=tx)=>({invoice_id:invoiceId,transaction_id:transactionId,invoice_updated_at:s.invoices.find(r=>r.id===invoiceId)!.updated_at,items_version:s.invoices.find(r=>r.id===invoiceId)!.items_version,transaction_version:s.transactions.find(r=>r.id===transactionId)!.match_version,source:"auto"});
const settle=async(rows:unknown[],uid=owner)=>(await db.query<{data:unknown[]}>("select settle_invoice_payments($1,$2::jsonb) as data",[uid,JSON.stringify(rows)])).rows[0].data;
beforeAll(async()=>{
 db=await createMigratedDatabase({owner,instant:"2026-10-23T12:00:00Z"});await db.query("insert into auth.users(id) values($1)",[other]);
 const inv=(await db.query<{id:string}>("insert into invoices(user_id,number,status,issue_date,due_date,currency,payment_method) values($1,'2026001','issued','2026-10-01','2026-11-01','CZK','bank'),($1,'2026002','issued','2026-10-01','2026-11-01','CZK','bank') returning id",[owner])).rows;
 [invoice,second]=inv.map(r=>r.id);await db.query("insert into invoice_items(user_id,invoice_id,description,quantity,unit_price,vat_rate,position) values($1,$2,'Synthetic work',1,1000,0,0),($1,$3,'Second work',1,1000,0,0)",[owner,invoice,second]);
 tx=(await db.query<{id:string}>("insert into transactions(user_id,kind,amount,currency,occurred_on,variable_symbol) values($1,'income',1000,'CZK','2026-10-20','2026001') returning id",[owner])).rows[0].id;
 foreignTx=(await db.query<{id:string}>("insert into transactions(user_id,kind,amount,currency,occurred_on,variable_symbol) values($1,'income',1000,'CZK','2026-10-20','2026001') returning id",[other])).rows[0].id;
 await db.exec(`create function public.test_settlement_failure() returns trigger language plpgsql as $$ begin if new.status='paid' and current_setting('audit.fail_settlement',true)='true' then raise exception 'Synthetic invoice failure'; end if; return new; end $$;
 create trigger test_settlement_failure before update on public.invoices for each row execute function public.test_settlement_failure();`);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec("set role authenticated");
},120000);
afterAll(async()=>{await db?.close();});
it("reads complete owned inputs past the REST limit and refuses owner injection",async()=>{
 await db.query("insert into transactions(user_id,kind,amount,currency,occurred_on) select $1,'income',1,'CZK','2026-10-20' from generate_series(1,1201)",[owner]);
 const s=await snapshot();expect(s.transactions).toHaveLength(1202);expect(s.transactions.some(t=>t.id===foreignTx)).toBe(false);expect(s.items).toHaveLength(2);
 await expect(snapshot(other)).rejects.toThrow("Owner required");await expect(settle([],other)).rejects.toThrow("Owner required");
});
it("rolls back the transaction link if updating the invoice fails",async()=>{
 const s=await snapshot();await db.query("select set_config('audit.fail_settlement','true',false)");await expect(settle([input(s)])).rejects.toThrow("Synthetic invoice failure");
 expect((await db.query("select invoice_id from transactions where id=$1",[tx])).rows).toEqual([{invoice_id:null}]);
 expect((await db.query("select status from invoices where id=$1",[invoice])).rows).toEqual([{status:"issued"}]);await db.query("select set_config('audit.fail_settlement','false',false)");
});
it("rejects stale amounts, invoice lines and header versions without writing",async()=>{
 const s=await snapshot();await db.query("update transactions set amount=999 where id=$1",[tx]);expect(await settle([input(s)])).toEqual([]);await db.query("update transactions set amount=1000 where id=$1",[tx]);
 await db.query("update invoice_items set unit_price=1001 where invoice_id=$1",[invoice]);expect(await settle([input(s)])).toEqual([]);await db.query("update invoice_items set unit_price=1000 where invoice_id=$1",[invoice]);
 await setDatabaseTime(db,"2026-10-23T12:01:00Z");await db.query("update invoices set updated_at=now() where id=$1",[invoice]);expect(await settle([input(s)])).toEqual([]);
});
it("commits both owned records once, deriving paid date from the locked payment",async()=>{
 const request=input(await snapshot());const receipt={transaction_id:tx,invoice_id:invoice,paid_on:"2026-10-20",changed:true};expect(await settle([request])).toEqual([receipt]);expect(await settle([request])).toEqual([{...receipt,changed:false}]);
 expect((await db.query("select status,paid_on::text from invoices where id=$1",[invoice])).rows).toEqual([{status:"paid",paid_on:"2026-10-20"}]);
 const later={...request,invoice_id:second};expect(await settle([later])).toEqual([]);
});
it("keeps owner discovery service-only and service snapshots explicitly owner-scoped",async()=>{
 await expect(db.query("select payment_matching_owners()")).rejects.toThrow("permission denied");
 await db.exec("reset role;set role service_role");expect((await db.query<{data:string[]}>("select payment_matching_owners() as data")).rows[0].data).toEqual([owner]);
 const foreign=await snapshot(other);expect(foreign.transactions).toHaveLength(0); // no issued invoices for this owner
 await db.exec("reset role;set role authenticated");
 const privileges=(await db.query<{proname:string;prosecdef:boolean;anon:boolean}>("select proname,prosecdef,has_function_privilege('anon',oid,'execute') as anon from pg_proc where proname in ('payment_matching_snapshot','settle_invoice_payments','payment_matching_owners') order by proname")).rows;
 expect(privileges.every(r=>r.prosecdef===false&&r.anon===false)).toBe(true);
});
it("validates actual PostgreSQL snapshots through the server port",async()=>{
 const client={rpc:async()=>({data:await snapshot(),error:null})} as unknown as SupabaseClient;
 const value=await readPaymentMatchingSnapshot(client,owner);expect(value.invoices).toHaveLength(2);expect(value.transactions).toHaveLength(1201);
 expect(value.invoices.find(i=>i.id===invoice)?.items_version).toBeNull();
});
it("refuses an oversized snapshot instead of matching a partial financial ledger",async()=>{
 await db.query("insert into transactions(user_id,kind,amount,currency,occurred_on) select $1,'income',1,'CZK','2026-10-20' from generate_series(1,18800)",[owner]);
 await expect(snapshot()).rejects.toThrow("Payment matching exceeds the complete read bound");
});
