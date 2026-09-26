// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DetectedToolsSection, type DetectionView } from "@/components/tools/detected-tools-section";
import { mergeDetectedTools, toolKey, type DetectedToolsResponse, type ProjectStackStatus } from "@/lib/stack-detection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tools = mergeDetectedTools([
  {
    project: { id: "p1", name: "own-dashboard" },
    source: "about-project",
    entries: [{ name: "Supabase", key: toolKey("Supabase"), whatItDoes: "Database and auth", specificity: 1 }],
  },
  {
    project: { id: "p2", name: "devShark" },
    source: "about-project",
    entries: [{ name: "Supabase", key: toolKey("Supabase"), whatItDoes: "Scores and grading", specificity: 1 }],
  },
  {
    project: { id: "p3", name: "DNESKAi" },
    source: "package-json",
    entries: [{ name: "next", key: "next", whatItDoes: "", specificity: 1 }],
  },
]);

const status = (projectName: string, extra: Partial<ProjectStackStatus>): ProjectStackStatus => ({
  projectId: projectName,
  projectName,
  repo: `me/${projectName}`,
  status: "ok",
  source: "about-project",
  toolCount: 1,
  ...extra,
});

const response = (overrides: Partial<DetectedToolsResponse> = {}): DetectedToolsResponse => ({
  connected: true,
  checkedAt: "2026-09-26T10:00:00Z",
  projects: [
    status("own-dashboard", {}),
    status("DNESKAi", { source: "package-json" }),
    status("LINKA", { status: "unreadable", source: null, toolCount: 0 }),
    status("Design Lab", { repo: null, status: "inherited", source: null, toolCount: 0, parentName: "boardlessAI" }),
  ],
  tools,
  ...overrides,
});

let container: HTMLDivElement;
let root: Root;

function render(view: DetectionView, props: Partial<{ tools: typeof tools; filtered: boolean; checking: boolean; canCheck: boolean; onCheckAgain: () => void }> = {}) {
  act(() => {
    root.render(
      <DetectedToolsSection
        view={view}
        tools={props.tools ?? (view.kind === "ok" ? view.data.tools : [])}
        filtered={props.filtered ?? false}
        checking={props.checking ?? false}
        canCheck={props.canCheck}
        onCheckAgain={props.onCheckAgain ?? (() => undefined)}
        maxRepositories={12}
      />,
    );
  });
}

const text = () => container.textContent ?? "";
const checkButton = () => [...container.querySelectorAll("button")].find((element) => /Check|Checking/.test(element.textContent ?? ""));

beforeEach(() => {
  document.documentElement.lang = "en";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("DetectedToolsSection", () => {
  it("announces loading and keeps the recheck disabled while a check runs", () => {
    render({ kind: "loading" }, { checking: true });
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain("Reading the active projects' repositories…");
    expect(container.querySelector("section")?.getAttribute("aria-busy")).toBe("true");
    expect(checkButton()?.disabled).toBe(true);
    expect(checkButton()?.textContent).toBe("Checking…");
  });

  it("explains an error, a rate limit and a disconnected GitHub account", () => {
    const onCheckAgain = vi.fn();
    render({ kind: "error" }, { onCheckAgain });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Could not read the repositories. Check again in a moment.");
    act(() => checkButton()!.click());
    expect(onCheckAgain).toHaveBeenCalledTimes(1);

    render({ kind: "rate-limited" });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("checked too often");

    render({ kind: "disconnected" });
    expect(text()).toContain("GitHub is not connected");
    expect(container.querySelectorAll("[data-detected-tool]")).toHaveLength(0);
  });

  it("lists each detected tool with its projects, source and a detected marker", () => {
    render({ kind: "ok", data: response() });
    const rows = [...container.querySelectorAll("[data-detected-tool]")];
    expect(rows.map((row) => row.getAttribute("data-detected-tool"))).toEqual(["next", "supabase"]);
    const supabase = rows[1]!;
    expect(supabase.querySelector('[aria-label="Used in: Supabase"]')?.textContent).toBe("own-dashboarddevShark");
    expect(supabase.textContent).toContain("Auto-detected · about-project.md");
    // Two projects describe it differently, so each project's note is available.
    expect(supabase.querySelector("details summary")?.textContent).toBe("How each project uses it");
    expect(supabase.querySelector("details")?.textContent).toContain("devShark — Scores and grading");
    // A package.json entry has no description of its own.
    expect(rows[0]!.textContent).toContain("Runtime dependency in package.json");
    expect(rows[0]!.textContent).toContain("Auto-detected · package.json");
  });

  it("shows the first 20 of a long list until asked, and every match while filtering", () => {
    const names = Array.from({ length: 25 }, (_, index) => `Tool ${String(index + 1).padStart(2, "0")}`);
    const many = mergeDetectedTools([
      {
        project: { id: "p1", name: "boardlessAI" },
        source: "about-project",
        entries: names.map((name) => ({ name, key: toolKey(name), whatItDoes: "", specificity: 1 })),
      },
    ]);
    const data = response({ tools: many });
    const rows = () => container.querySelectorAll("#tools-detected-list > li").length;
    const toggle = () => [...container.querySelectorAll("button")].find((element) => /^Show (all|the first)/.test(element.textContent ?? ""));

    render({ kind: "ok", data }, { tools: many });
    expect(rows()).toBe(20);
    expect(toggle()?.textContent).toBe("Show all 25 tools");
    expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
    expect(toggle()?.getAttribute("aria-controls")).toBe("tools-detected-list");
    act(() => toggle()!.click());
    expect(rows()).toBe(25);
    expect(toggle()?.textContent).toBe("Show the first 20");
    expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
    act(() => toggle()!.click());
    expect(rows()).toBe(20);

    render({ kind: "ok", data }, { tools: many, filtered: true });
    expect(rows()).toBe(25);
    expect(toggle()).toBeUndefined();
  });

  it("opens the repository list when a repository could not be read", () => {
    render({ kind: "ok", data: response() });
    const details = container.querySelector("details:not([data-detected-tool] details)") as HTMLDetailsElement;
    expect(details.open).toBe(true);
    expect(details.querySelector("summary")?.textContent).toBe("Repositories: 2 of 4 active projects read");
    const statuses = [...details.querySelectorAll("[data-repository-status]")].map((row) => row.textContent);
    expect(statuses).toEqual([
      "own-dashboard1 tool from about-project.md",
      "DNESKAi1 tool from package.json",
      "LINKAGitHub does not show this repository to the connected account",
      "Design LabPart of the boardlessAI repository",
    ]);
  });

  it("tells an empty result from a missing repository and from a filter", () => {
    render({ kind: "ok", data: response({ tools: [], projects: [status("own-dashboard", { status: "empty", toolCount: 0 })] }) });
    expect(text()).toContain("list no tools yet");
    render({ kind: "ok", data: response({ tools: [], projects: [status("Acme", { repo: null, status: "no-repository", source: null, toolCount: 0 })] }) });
    expect(text()).toContain("No active project has a GitHub repository linked.");
    render({ kind: "ok", data: response() }, { tools: [], filtered: true });
    expect(text()).toContain("No tool found in the repositories matches.");
  });

  it("disables the recheck in the fixture preview", () => {
    render({ kind: "ok", data: response() }, { canCheck: false });
    expect(checkButton()?.disabled).toBe(true);
  });

  it("speaks Czech", () => {
    document.documentElement.lang = "cs";
    render({ kind: "ok", data: response() });
    expect(text()).toContain("Zjištěno z repozitářů");
    expect(text()).toContain("Zjištěno automaticky");
    expect(text()).toContain("Repozitáře: načteno 2 z 4 aktivních projektů");
  });
});
