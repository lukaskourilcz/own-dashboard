// @vitest-environment happy-dom
import { act } from "react";
import { createRoot,type Root } from "react-dom/client";
import { Storage } from "happy-dom";
import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { afterEach,expect,it,vi } from "vitest";
import { CareerProgressDialog } from "@/components/panels/career-progress-dialog";
import type { JobApplication } from "@/lib/types";
const state=vi.hoisted(() => ({rpc:vi.fn(),contact:vi.fn()}));
vi.mock("@/lib/supabase/client",() => ({createClient:() => ({rpc:state.rpc,from:() => ({update:() => ({eq:() => ({select:() => ({single:state.contact})})})})})}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root|undefined,host:HTMLDivElement,client:QueryClient;
afterEach(()=>{act(()=>root?.unmount());host?.remove();client?.clear();document.documentElement.lang="";vi.unstubAllGlobals();});
it("keeps confirmed progress visible when the optional contact request rejects",async()=>{
 vi.stubGlobal("localStorage",new Storage());document.documentElement.lang="en";
 host=document.createElement("div");document.body.append(host);root=createRoot(host);client=new QueryClient();
 const app={id:"app",user_id:"owner",listing_id:null,title:"Synthetic role",company:"Fixture",url:null,source:null,location:null,cover_letter:"",status:"applied",applied_on:"2026-10-01",notes:null,created_at:"",updated_at:"",contact_name:null,contact_email:null} satisfies JobApplication;
 state.rpc.mockResolvedValue({data:app,error:null});state.contact.mockRejectedValue(new Error("offline"));
 const update=vi.fn(),close=vi.fn();
 await act(async()=>root!.render(<QueryClientProvider client={client}><CareerProgressDialog app={app} onClose={close} setApplications={update}/></QueryClientProvider>));
 const input=document.querySelector<HTMLInputElement>("#contact-name")!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"Recruiter");input.dispatchEvent(new Event("input",{bubbles:true}));});
 await act(async()=>{document.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));await new Promise(done=>setTimeout(done,25));});
 expect(update).toHaveBeenCalledOnce();expect(close).not.toHaveBeenCalled();
 expect(document.querySelector('[role="alert"]')?.textContent).toContain("contact");
 expect(input.value).toBe("Recruiter");
});
