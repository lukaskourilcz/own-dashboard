import { describe, expect, it } from "vitest";
import { connectedLinkIds, matchesConnection, projectForRepository, referencesForLink, referencesForProject } from "@/lib/link-references";
import { ideaPromptDraft, ideaPromptDrafts } from "@/lib/idea-prompts";
import type { AiLink, AiLinkProject, Project } from "@/lib/types";

const projects = [
  { id: "p1", name: "aifirst", slug: "aifirst", repo_full_name: "lukaskourilcz/aifirst" },
  { id: "p2", name: "GoVIRAL", slug: "goviral", repo_full_name: null },
  { id: "p3", name: "LINKA", slug: "phone-app", repo_full_name: "lukaskourilcz/phone-app" },
] as Project[];

const links = [
  { id: "l1", title: "Podcast Index API", url: "https://podcastindex.org", record_type: "link" },
  { id: "l2", title: "Cap sponsor placements", url: "https://example.com/idea", record_type: "idea", description: "At most three slots per issue.", rating_rationale: "Protects the reading promise.", source_urls: ["https://www.therundown.ai/advertise-with-us", "not a url"], project_relevance: [{ repository: "aifirst", reason: "Direct sponsor slots are the model." }, { repository: "nxt-portfolio", reason: "Out of scope here." }] },
  { id: "l3", title: "Orphan idea", url: "https://example.com/orphan", record_type: "idea", description: "", project_relevance: [] },
] as AiLink[];

const references = [
  { id: "r1", link_id: "l1", project_id: "p1", status: "used", note: "" },
  { id: "r2", link_id: "l1", project_id: "missing", status: "planned", note: "" },
  { id: "r3", link_id: "l2", project_id: "p2", status: "planned", note: "next sprint" },
] as AiLinkProject[];

describe("link references", () => {
  it("joins references to the records that still exist and drops dangling ones", () => {
    expect(referencesForLink("l1", references, projects).map((r) => r.project.name)).toEqual(["aifirst"]);
    expect(referencesForProject("p2", references, links).map((r) => `${r.link.title}:${r.status}`)).toEqual(["Cap sponsor placements:planned"]);
    expect(referencesForProject("p3", references, links)).toEqual([]);
  });

  it("marks connected links and filters by connection", () => {
    const connected = connectedLinkIds(references);
    expect([...connected].sort()).toEqual(["l1", "l2"]);
    expect(matchesConnection("l3", "unconnected", connected)).toBe(true);
    expect(matchesConnection("l3", "connected", connected)).toBe(false);
    expect(matchesConnection("l3", "all", connected)).toBe(true);
  });

  it("resolves relevance slugs by project slug, repository name or display name", () => {
    expect(projectForRepository("aifirst", projects)?.id).toBe("p1");
    expect(projectForRepository("phone-app", projects)?.id).toBe("p3");
    expect(projectForRepository("GoVIRAL", projects)?.id).toBe("p2");
    expect(projectForRepository("unknown", projects)).toBeNull();
    expect(projectForRepository("  ", projects)).toBeNull();
  });
});

describe("idea prompts", () => {
  it("builds a deterministic prompt from the idea's own fields and resolves the first known project", () => {
    const draft = ideaPromptDraft(links[1], projects);
    expect(draft.project?.id).toBe("p1");
    expect(draft.name).toBe("Cap sponsor placements");
    expect(draft.description).toBe("Protects the reading promise.");
    expect(draft.body).toContain("Implement this idea in the aifirst repository (lukaskourilcz/aifirst).");
    expect(draft.body).toContain("Idea: Cap sponsor placements");
    expect(draft.body).toContain("At most three slots per issue.");
    expect(draft.body).toContain("- aifirst: Direct sponsor slots are the model.");
    expect(draft.body).toContain("- https://www.therundown.ai/advertise-with-us");
    expect(draft.body).not.toContain("not a url");
    expect(draft.body).toContain("Constraints: [add scope limits, budget or deadlines here]");
    expect(ideaPromptDraft(links[1], projects).body).toBe(draft.body);
  });

  it("keeps an idea without a matching project and names the placeholder for an empty description", () => {
    const draft = ideaPromptDraft(links[2], projects);
    expect(draft.project).toBeNull();
    expect(draft.body.startsWith("Implement this idea.\n")).toBe(true);
    expect(draft.body).toContain("[describe the idea]");
  });

  it("lists only ideas whose name is not already a prompt", () => {
    expect(ideaPromptDrafts(links, projects, ["cap sponsor placements"]).map((d) => d.name)).toEqual(["Orphan idea"]);
    expect(ideaPromptDrafts(links, projects, []).map((d) => d.name)).toEqual(["Cap sponsor placements", "Orphan idea"]);
  });
});
