import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createMigratedDatabase } from "../helpers/supabase-pglite";
const owner="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222";
let db:PGlite,appId:string;
const record=(id:string,date:string) => db.query<{id:string}>("select (record_job_application($1,null,$2::jsonb)).id as id",[id,JSON.stringify({title:"Synthetic application",applied_on:date})]);
beforeAll(async () => {
 db=await createMigratedDatabase({owner,instant:"2026-10-23T22:30:00Z"});
 await db.query("insert into auth.users(id,email) values($1,'other@example.test')",[other]);
 await db.query("insert into user_preferences(user_id,timezone) values($1,'Europe/Prague') on conflict(user_id) do update set timezone=excluded.timezone",[owner]);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec("set role authenticated");
},120000);
afterAll(async () => {await db?.close();});
it("accepts the owner's new day before UTC midnight and records matching responses",async () => {
 const result=await record("33333333-3333-4333-8333-333333333333","2026-10-24");appId=result.rows[0].id;
 const progress=await db.query<{id:string}>("select (update_job_application_progress($1,'interviewing','2026-10-24','positive',null,'Synthetic response')).id as id",[appId]);
 expect(progress.rows[0].id).toBe(appId);
 expect((await record("33333333-3333-4333-8333-333333333333","2026-10-25")).rows[0].id).toBe(appId);
});
it("rejects an actual future date and preserves history",async () => {
 await expect(record("44444444-4444-4444-8444-444444444444","2026-10-25")).rejects.toThrow("Invalid application date");
 await expect(db.query("select update_job_application_progress($1,'interviewing','2026-10-25','positive',null,'future')",[appId])).rejects.toThrow("Response cannot be in the future");
 expect((await db.query<{count:number}>("select count(*)::int as count from job_applications")).rows[0].count).toBe(1);
});
it("uses the stored west-of-UTC timezone and recovers an invalid legacy timezone",async () => {
 await db.query("update user_preferences set timezone='America/Los_Angeles' where user_id=$1",[owner]);
 await expect(record("55555555-5555-4555-8555-555555555555","2026-10-24")).rejects.toThrow("Invalid application date");
 expect((await record("55555555-5555-4555-8555-555555555555","2026-10-23")).rows).toHaveLength(1);
 await db.query("update user_preferences set timezone='invalid/legacy' where user_id=$1",[owner]);
 expect((await db.query<{day:string}>("select current_owner_day()::text as day")).rows[0].day).toBe("2026-10-24");
});
it("keeps invoker ownership and authenticated-only execution",async () => {
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
 await expect(db.query("select update_job_application_progress($1,'offer',null,null,null,'foreign')",[appId])).rejects.toThrow("Application not found");
 expect((await db.query("select prosecdef as definer,has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('service_role',oid,'execute') as service from pg_proc where proname='current_owner_day'")).rows).toEqual([{definer:false,anon:false,service:false}]);
});
