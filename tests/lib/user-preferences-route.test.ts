import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state=vi.hoisted(() => ({ write:vi.fn(),user:true }));
vi.mock("@/lib/supabase/server",() => ({createClient:async () => ({auth:{getUser:async () => ({data:{user:state.user?{id:"owner"}:null}})},from:() => ({upsert:state.write})})}));
import { PATCH } from "@/app/api/user/preferences/route";
const request=(body:unknown,origin="https://app.example") => new Request("https://app.example/api/user/preferences",{method:"PATCH",headers:{origin,"content-type":"application/json"},body:JSON.stringify(body)});
beforeEach(() => {state.user=true;state.write.mockReset().mockResolvedValue({error:null});});
it.each([null,[],42,"bad",{timezone:"not-a-zone"},{timezone:42},{nudge_hour:24},{nudge_hour:-1},{nudge_hour:1.5},{nudge_hour:"5"},{display_currency:"XXX"}])("rejects invalid preferences before writing (%j)",async body => {
 expect((await PATCH(request(body))).status).toBe(400);expect(state.write).not.toHaveBeenCalled();
});
it("preserves explicit clears and known widgets without accepting a foreign owner",async () => {
 expect((await PATCH(request({timezone:null,nudge_hour:null,selected_calendar_ids:[],visible_repo_ids:[],dashboard_layout:["todos","unknown","todos"],user_id:"foreign",display_currency:"CZK"}))).status).toBe(200);
 expect(state.write.mock.calls[0][0]).toMatchObject({user_id:"owner",timezone:null,nudge_hour:null,selected_calendar_ids:[],visible_repo_ids:[],dashboard_layout:["todos"],display_currency:"CZK"});
});
it("accepts an IANA timezone and reminder edge hours",async () => {
 expect((await PATCH(request({timezone:"Europe/Prague",nudge_hour:0}))).status).toBe(200);
 expect((await PATCH(request({timezone:"America/Los_Angeles",nudge_hour:23}))).status).toBe(200);
});
it("retains authentication and origin checks",async () => {
 expect((await PATCH(request({},"https://foreign.example"))).status).toBe(403);state.user=false;
 expect((await PATCH(request({}))).status).toBe(401);expect(state.write).not.toHaveBeenCalled();
});
