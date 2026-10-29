import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createMigratedDatabase } from "../helpers/supabase-pglite";
const owner="11111111-1111-4111-8111-111111111111", other="22222222-2222-4222-8222-222222222222";
let db:PGlite,source:string,target:string,foreign:string,link:string;
const merge=(from=source,to:string|null=target,ids=[link],name="Source")=>db.query("select merge_library_category($1,$2,$3,$4::uuid[]) as result",[from,to,name,ids]);
beforeAll(async()=>{
 db=await createMigratedDatabase({owner,instant:"2026-10-23T12:00:00Z"});await db.query("insert into auth.users(id) values($1)",[other]);
 const categories=(await db.query<{id:string}>("insert into ai_categories(user_id,name) values($1,'Source'),($1,'Target'),($2,'Foreign') returning id",[owner,other])).rows;
 [source,target,foreign]=categories.map(r=>r.id);link=(await db.query<{id:string}>("insert into ai_links(user_id,title,url,category_id) values($1,'Synthetic link','https://example.test',$2) returning id",[owner,source])).rows[0].id;
 await db.exec(`create function public.test_merge_delete_failure() returns trigger language plpgsql as $$ begin if current_setting('audit.fail_delete',true)='true' then raise exception 'Synthetic delete failure'; end if; return old; end $$;
 create trigger test_merge_delete_failure before delete on public.ai_categories for each row execute function public.test_merge_delete_failure();`);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec("set role authenticated");
},120000);
afterAll(async()=>{await db?.close();});
it("rejects foreign targets, missing membership, duplicate membership and stale names without moving resources",async()=>{
 await expect(merge(source,foreign)).rejects.toThrow("Target category not found");
 await expect(merge(source,target,[])).rejects.toThrow("Category resources changed");
 await expect(merge(source,target,[link,link])).rejects.toThrow("Category resources changed");
 await expect(merge(source,target,[link],"Old name")).rejects.toThrow("Category changed");
 expect((await db.query("select category_id from ai_links where id=$1",[link])).rows).toEqual([{category_id:source}]);
});
it("rolls back moved links if deleting the source fails",async()=>{
 await db.query("select set_config('audit.fail_delete','true',false)");await expect(merge()).rejects.toThrow("Synthetic delete failure");
 expect((await db.query("select category_id from ai_links where id=$1",[link])).rows).toEqual([{category_id:source}]);
 expect((await db.query("select id from ai_categories where id=$1",[source])).rows).toHaveLength(1);
 await db.query("select set_config('audit.fail_delete','false',false)");
});
it("moves the complete source and removes only that owner category",async()=>{
 expect((await merge()).rows).toEqual([{result:{source_id:source,target_id:target,moved_ids:[link]}}]);
 expect((await db.query("select category_id from ai_links where id=$1",[link])).rows).toEqual([{category_id:target}]);
 expect((await db.query("select id from ai_categories where id=$1",[source])).rows).toHaveLength(0);
 await expect(merge(foreign,target,[],"Foreign")).rejects.toThrow("Source category not found");
});
it("allows an explicit move to Uncategorized and grants only authenticated invoker execution",async()=>{
 await merge(target,null,[link],"Target");expect((await db.query("select category_id from ai_links where id=$1",[link])).rows).toEqual([{category_id:null}]);
 expect((await db.query("select prosecdef,has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('service_role',oid,'execute') as service from pg_proc where proname='merge_library_category'")).rows).toEqual([{prosecdef:false,anon:false,service:false}]);
});
