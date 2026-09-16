import { describe, expect, it } from "vitest";
import { duplicateCategoryCandidates, filterLibrary, planCategoryMerge, resourceKey, UNCATEGORIZED_LINKS } from "@/lib/link-library";
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

describe("category merge", () => {
  const merging = [
    {id:"a",category_id:"design"},
    {id:"b",category_id:"design"},
    {id:"c",category_id:"security"},
    {id:"d",category_id:null},
  ] as AiLink[];

  it("moves only the source category's records and never merges a category into itself", () => {
    expect(planCategoryMerge(merging,"design","security")).toEqual(["a","b"]);
    expect(planCategoryMerge(merging,"design",null)).toEqual(["a","b"]);
    expect(planCategoryMerge(merging,"design","design")).toEqual([]);
    expect(planCategoryMerge(merging,"empty","security")).toEqual([]);
    expect(planCategoryMerge(merging,"","security")).toEqual([]);
  });

  it("suggests duplicates across accents, case, separators and an English plural, keeping the first one", () => {
    const cats = [
      {id:"1",name:"Design"},
      {id:"2",name:"design"},
      {id:"3",name:"Typografie"},
      {id:"4",name:"Typografié"},
      {id:"5",name:"AI tools"},
      {id:"6",name:"AI-Tool"},
      {id:"7",name:"Security"},
      {id:"8",name:"CSS"},
      {id:"9",name:"CS"},
    ] as AiCategory[];
    expect(duplicateCategoryCandidates(cats).map(([keep,dup]) => [keep.id,dup.id])).toEqual([["1","2"],["3","4"],["5","6"]]);
    expect(duplicateCategoryCandidates([])).toEqual([]);
    expect(duplicateCategoryCandidates([{id:"7",name:"Security"}] as AiCategory[])).toEqual([]);
  });
});
