import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createMigratedDatabase } from "../helpers/supabase-pglite";
import { evaluateRuleApplication, parseRuleApplicationReceipt, parseRuleApplicationSnapshot } from "@/lib/transaction-rule-application";

const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
let db: PGlite, foreignId: string, projectId: string, ruleId: string;
const snapshot = async () => parseRuleApplicationSnapshot((await db.query<{ data: unknown }>("select transaction_rule_snapshot() as data")).rows[0].data, owner);
const apply = async (version: string, plan: unknown) => (await db.query<{ data: unknown }>("select apply_transaction_rule_plan($1,$2::jsonb) as data", [version, JSON.stringify(plan)])).rows[0].data;
beforeAll(async () => {
  db = await createMigratedDatabase({ owner, instant: "2026-10-24T00:43:00Z" });
  await db.query("insert into auth.users(id) values($1)", [other]);
  foreignId = (await db.query<{ id: string }>("insert into transactions(user_id,kind,amount,currency,occurred_on,note) values($1,'expense',9,'CZK','2026-10-23','Foreign synthetic merchant') returning id", [other])).rows[0].id;
  projectId = (await db.query<{ id: string }>("insert into projects(user_id,slug,name) values($1,'synthetic-rule-parent','Synthetic rule parent') returning id", [owner])).rows[0].id;
  await db.query("insert into transactions(user_id,kind,amount,currency,occurred_on,note) select $1,'expense',n,'CZK','2026-10-23','Synthetic merchant '||n from generate_series(1,1201) n", [owner]);
  ruleId = (await db.query<{ id: string }>("insert into transaction_rules(user_id,name,conditions,actions) values($1,'Synthetic rule','[{\"field\":\"note\",\"op\":\"contains\",\"value\":\"merchant\"}]','{\"category\":\"Work\"}') returning id", [owner])).rows[0].id;
  await db.exec(`create function public.test_rule_write() returns trigger language plpgsql as $$ begin
    if current_setting('audit.rule_write',true)='fail' and old.amount=1201 then raise exception 'Synthetic later failure'; end if;
    if current_setting('audit.rule_write',true)='suppress' and old.amount=1201 then return null; end if;
    if current_setting('audit.rule_write',true)='alter' and old.amount=1201 then new.category:='Unexpected'; end if;
    return new; end $$;
    create trigger test_rule_write before update on transactions for each row execute function public.test_rule_write();`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]); await db.exec("set role authenticated");
}, 120000);
afterAll(async () => { await db?.close(); });
it("reads every owned row beyond REST caps and keeps grants invoker-only", async () => {
  const data = await snapshot(); expect(data.transactions).toHaveLength(1201); expect(data.context.rulesVersion).toMatch(/^[0-9a-f]{32}$/);
  expect(data.transactions.every(row => row.user_id === owner && row.id !== foreignId)).toBe(true);
  expect((await db.query("select proname,prosecdef,has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('service_role',oid,'execute') as service from pg_proc where proname in ('transaction_rule_snapshot','apply_transaction_rule_plan','lock_transaction_rule_owner') order by proname")).rows).toEqual([
    { proname: "apply_transaction_rule_plan", prosecdef: false, anon: false, service: false },
    { proname: "lock_transaction_rule_owner", prosecdef: false, anon: false, service: false },
    { proname: "transaction_rule_snapshot", prosecdef: false, anon: false, service: false },
  ]);
});
it.each(["fail", "suppress", "alter"])("rolls back the entire plan after a %s write", async mode => {
  const data = await snapshot(), evaluated = evaluateRuleApplication(data, data.context.rules);
  await db.query("select set_config('audit.rule_write',$1,false)", [mode]);
  await expect(apply(data.context.rulesVersion, evaluated.plan)).rejects.toThrow(mode === "fail" ? "Synthetic later failure" : "Rule writes not confirmed");
  expect((await db.query("select count(*)::int as n from transactions where category is not null")).rows).toEqual([{ n: 0 }]);
  await db.query("select set_config('audit.rule_write','off',false)");
});
it("refuses stale rows without overwriting a manual edit or partially applying", async () => {
  const data = await snapshot(), evaluated = evaluateRuleApplication(data, data.context.rules);
  await db.query("update transactions set category='Owner edit' where id=$1", [data.transactions[0].id]);
  await expect(apply(data.context.rulesVersion, evaluated.plan)).rejects.toThrow("Transactions changed");
  expect((await db.query("select count(*)::int as n from transactions where category='Work'")).rows).toEqual([{ n: 0 }]);
});
it("refuses changed, inserted and removed rules, including empty plans", async () => {
  const initial = await snapshot(); await db.query("update transaction_rules set name='Owner renamed rule' where id=$1", [ruleId]);
  await expect(apply(initial.context.rulesVersion, [])).rejects.toThrow("Rules changed");
  const changed = await snapshot();
  const inserted = (await db.query<{ id: string }>("insert into transaction_rules(user_id,name,conditions,actions) values($1,'Synthetic second rule','[]','{}') returning id", [owner])).rows[0].id;
  await expect(apply(changed.context.rulesVersion, [])).rejects.toThrow("Rules changed");
  const added = await snapshot(); await db.query("delete from transaction_rules where id=$1", [inserted]);
  await expect(apply(added.context.rulesVersion, [])).rejects.toThrow("Rules changed");
});
it("refuses missing and foreign parents and targets before writing", async () => {
  const data = await snapshot(), row = data.transactions[0];
  await expect(apply(data.context.rulesVersion, [{ id: foreignId, version: row.version, changes: { category: "Work" } }])).rejects.toThrow("Transactions changed");
  await db.query("delete from projects where id=$1", [projectId]);
  await expect(apply(data.context.rulesVersion, [{ id: row.id, version: row.version, changes: { project_id: projectId } }])).rejects.toThrow("Rule parent changed");
  expect((await db.query("select count(*)::int as n from transactions where category='Work'")).rows).toEqual([{ n: 0 }]);
});
it("confirms every changed identity in one atomic pass and preserves financial fields", async () => {
  const data = await snapshot(), evaluated = evaluateRuleApplication(data, data.context.rules);
  const receipt = await apply(data.context.rulesVersion, evaluated.plan);
  expect(parseRuleApplicationReceipt(receipt, evaluated.plan.map(row => row.id))).toBe(1201);
  expect((await db.query("select count(*)::int as n,sum(amount)::text as total from transactions where category='Work'")).rows).toEqual([{ n: 1201, total: "721801.00" }]);
  const settled = await snapshot(); expect(evaluateRuleApplication(settled, settled.context.rules).plan).toEqual([]);
  expect(parseRuleApplicationReceipt(await apply(settled.context.rulesVersion, []), [])).toBe(0);
});
it("refuses duplicate targets, arbitrary financial columns and over-limit plans", async () => {
  const data = await snapshot(), row = data.transactions[0], valid = { id: row.id, version: row.version, changes: { note: null } };
  for (const plan of [[valid, valid], [{ ...valid, changes: { amount: "0" } }], [{ ...valid, changes: { project_id: 1 } }], [null]]) await expect(apply(data.context.rulesVersion, plan)).rejects.toThrow();
  await expect(apply(data.context.rulesVersion, Array(20001).fill(valid))).rejects.toThrow("Rule plan exceeds the complete write bound");
  await expect(apply(data.context.rulesVersion, [{ ...valid, changes: { note: "x".repeat(4194304) } }])).rejects.toThrow("Rule plan exceeds the complete write bound");
});
it("refuses a ledger over the complete read bound instead of returning a prefix", async () => {
  await db.query("insert into transactions(user_id,kind,amount,currency,occurred_on,note) select $1,'expense',1,'CZK','2026-10-23','Synthetic overflow' from generate_series(1,18800)", [owner]);
  await expect(snapshot()).rejects.toThrow("Rule snapshot exceeds the complete read bound");
});
