import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state=vi.hoisted(() => ({ row:null as Record<string, unknown>|null, error:false, signal:undefined as AbortSignal|undefined, owner:"" }));
vi.mock("@/lib/supabase/server", () => ({ createClient:async(signal:AbortSignal)=>{
 state.signal=signal; const builder={ select:()=>builder,eq:(_key:string,value:string)=>{state.owner=value;return builder;},abortSignal:()=>builder,maybeSingle:async()=>({data:state.row,error:state.error?{}:null})}; return {from:()=>builder};
} }));
import { loadUserPreferences } from "@/lib/user-prefs";
beforeEach(()=>{Object.assign(state,{row:null,error:false,signal:undefined,owner:""});});
it("confirms absent-row defaults, with independent arrays on each read",async()=>{
 const first=await loadUserPreferences("owner");first.selected_calendar_ids.push("modified");
 expect(await loadUserPreferences("owner")).toMatchObject({sync_available:true,selected_calendar_ids:["primary"]});expect(state.owner).toBe("owner");expect(state.signal).toBeInstanceOf(AbortSignal);
});
it.each([{user_id:"foreign"},{user_id:"owner",notifications_renewals:"false"},{user_id:"owner",display_currency:"invalid"}])("does not hydrate untrusted rows (%j)",async row=>{state.row=row;expect(await loadUserPreferences("owner")).toMatchObject({sync_available:false});});
it("does not claim synchronization on database errors or aborts",async()=>{
 state.error=true;expect(await loadUserPreferences("owner")).toMatchObject({sync_available:false});
 state.error=false;const controller=new AbortController();controller.abort("private");expect(await loadUserPreferences("owner",controller.signal)).toMatchObject({sync_available:false});
});
