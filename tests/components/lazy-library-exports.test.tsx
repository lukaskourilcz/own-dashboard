// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/link-export",async importOriginal=>{const actual=await importOriginal<typeof import("@/lib/link-export")>();return {...actual,buildLinkExport:vi.fn(actual.buildLinkExport)};});
vi.mock("@/lib/tip-export",async importOriginal=>{const actual=await importOriginal<typeof import("@/lib/tip-export")>();return {...actual,buildTipExport:vi.fn(actual.buildTipExport)};});
import { LinkExportDialog } from "@/components/panels/link-export-dialog";
import { TipExportDialog } from "@/components/panels/tip-export-dialog";
import { buildLinkExport } from "@/lib/link-export";
import { buildTipExport } from "@/lib/tip-export";
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement,root:Root;
afterEach(()=>{act(()=>root?.unmount());host?.remove();vi.clearAllMocks();});
it.each(["links","tips"])("does not build a hidden %s export when its page renders",async kind=>{
 host=document.createElement("div");document.body.append(host);root=createRoot(host);
 await act(async()=>root.render(kind==="links"?<LinkExportDialog links={[]} categories={[]} scope="link"/>:<TipExportDialog links={[]}/>));
 expect(buildLinkExport).not.toHaveBeenCalled();expect(buildTipExport).not.toHaveBeenCalled();
 await act(async()=>host.querySelector("button")!.click());
 expect(kind==="links"?buildLinkExport:buildTipExport).toHaveBeenCalledOnce();
});
