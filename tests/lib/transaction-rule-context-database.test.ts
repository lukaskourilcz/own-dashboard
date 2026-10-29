import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createMigratedDatabase } from "../helpers/supabase-pglite";
import { parseTransactionRuleContext } from "@/lib/transaction-rule-data";

const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
let db: PGlite, ruleId: string;
const read = async (uid: string | null = null) => (await db.query<{ data: unknown }>("select transaction_rule_context($1) as data", [uid])).rows[0].data;
beforeAll(async () => {
  db = await createMigratedDatabase({ owner, instant: "2026-10-23T22:00:00Z" });
  await db.query("insert into auth.users(id) values($1)", [other]);
  for (const uid of [owner, other]) {
    await db.query("insert into projects(user_id,slug,name) select $1::uuid,$1::text||'-audit-'||n,'Synthetic project '||n from generate_series(1,1201) n", [uid]);
    await db.query("insert into subscriptions(user_id,name,amount,currency) select $1,'Synthetic subscription '||n,1,'CZK' from generate_series(1,1201) n", [uid]);
    const result = await db.query<{ id: string }>("insert into transaction_rules(user_id,name,conditions,actions) values($1,'Synthetic rule','[{\"field\":\"note\",\"op\":\"contains\",\"value\":\"merchant\"}]','{\"category\":null}') returning id", [uid]);
    if (uid === owner) ruleId = result.rows[0].id;
  }
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await db.exec("set role authenticated");
}, 120000);
afterAll(async () => { await db?.close(); });

it("returns complete owned context beyond the REST row cap", async () => {
  const value = parseTransactionRuleContext(await read(), owner);
  expect(value.rules).toHaveLength(1); expect(value.rules[0].id).toBe(ruleId);
  expect(value.projectIds).toHaveLength(1201); expect(value.subscriptionIds).toHaveLength(1201);
  expect(value.dropped).toBe(0);
  await expect(read(other)).rejects.toThrow("Owner required");
});
it("keeps anonymous grants closed and service ownership explicit", async () => {
  const grants = (await db.query<{ prosecdef: boolean; anon: boolean }>("select prosecdef,has_function_privilege('anon',oid,'execute') as anon from pg_proc where proname='transaction_rule_context'")).rows;
  expect(grants).toEqual([{ prosecdef: false, anon: false }]);
  await db.exec("reset role; set role service_role");
  await expect(read()).rejects.toThrow("Owner required");
  expect(parseTransactionRuleContext(await read(other), other).rules).toHaveLength(1);
  await db.exec("reset role; set role authenticated");
});
it("refuses over-limit rule counts and bytes instead of returning a prefix", async () => {
  await db.query("insert into transaction_rules(user_id,name,conditions,actions) select $1,'Synthetic extra','[]','{}' from generate_series(1,1000)", [owner]);
  await expect(read()).rejects.toThrow("Rule context exceeds the complete read bound");
  await db.query("delete from transaction_rules where user_id=$1 and id<>$2", [owner, ruleId]);
  await db.query("update transaction_rules set name=repeat('x',4194304) where id=$1", [ruleId]);
  await expect(read()).rejects.toThrow("Rule context exceeds the complete read bound");
});
