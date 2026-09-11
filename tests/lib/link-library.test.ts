import { describe, expect, it } from "vitest";
import { filterLibrary, resourceKey, UNCATEGORIZED_LINKS } from "@/lib/link-library";
import type { AiCategory, AiLink } from "@/lib/types";

const categories = [{id:"design",name:"Typografie"}] as AiCategory[];
const links = [
  {id:"a",title:"České písmo",url:"https://example.com/fonts",description:"Fluid layout",pricing:"free",category_id:"design",created_at:"2026-01-01"},
  {id:"b",title:"Hosted editor",url:"https://example.com/editor",description:"Fluid layout",pricing:"freemium",category_id:null,created_at:"2026-02-01"},
  {id:"c",title:"Old reference",url:"https://example.com/old",description:null,pricing:null,category_id:"deleted",created_at:"2026-03-01"},
] as AiLink[];

describe("resource library discovery", () => {
  it("combines category, accent-insensitive multi-word search and price without losing the source array", () => {
    expect(filterLibrary(links,categories,"ceske typografie","free","design","name").map(x=>x.id)).toEqual(["a"]);
    expect(filterLibrary(links,categories,"fluid","paid","all","name")).toEqual([]);
    expect(filterLibrary(links,categories,"","all",UNCATEGORIZED_LINKS,"newest").map(x=>x.id)).toEqual(["c","b"]);
    expect(filterLibrary(links,categories,"","unknown","all","name").map(x=>x.id)).toEqual(["c"]);
    expect(links.map(x=>x.id)).toEqual(["a","b","c"]);
  });
  it("detects cosmetic URL duplicates while preserving distinct resources and rejecting credential URLs", () => {
    expect(resourceKey("https://www.example.com/docs/?utm_source=email#start")).toBe(resourceKey("http://example.com/docs"));
    expect(resourceKey("https://example.com/?page=1")).not.toBe(resourceKey("https://example.com/?page=2"));
    expect(resourceKey("https://user:secret@example.com/")).toBeNull();
    expect(resourceKey("javascript:alert(1)")).toBeNull();
  });
});
