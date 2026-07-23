export const ABOUT_PROJECT_FILE = "about-project.md";

export type ProjectKnowledgeItem = {
  name: string;
  description: string;
};

export type ProjectKnowledge = {
  summary: string;
  techStack: ProjectKnowledgeItem[];
  libraries: ProjectKnowledgeItem[];
};

const TECH_HEADINGS = [
  "tech stack",
  "technology",
  "technologies",
  "technologie",
  "stack",
];
const LIBRARY_HEADINGS = [
  "libraries",
  "library",
  "dependencies",
  "third-party",
  "third party",
  "knihovny",
  "zavislosti",
  "závislosti",
  "integrations",
  "integrace",
];

function normalizeHeading(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseItem(line: string): ProjectKnowledgeItem | null {
  const raw = line
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/\*\*/g, "")
    .trim();
  if (!raw) return null;
  const match =
    raw.match(/^(.+?)\s+(?:—|–|-)\s+(.+)$/) ??
    raw.match(/^`?([^`:]+)`?\s*:\s*(.+)$/);
  if (!match) {
    return { name: raw.replace(/`/g, ""), description: "" };
  }
  return {
    name: match[1].trim().replace(/`/g, ""),
    description: match[2].trim(),
  };
}

export function parseAboutProject(markdown: string): ProjectKnowledge {
  const techStack: ProjectKnowledgeItem[] = [];
  const libraries: ProjectKnowledgeItem[] = [];
  const summary: string[] = [];
  let section: "summary" | "tech" | "libraries" | "other" = "summary";
  let seenKnowledgeSection = false;

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      const normalized = normalizeHeading(heading[1]);
      if (TECH_HEADINGS.some((value) => normalized.includes(value))) {
        section = "tech";
        seenKnowledgeSection = true;
      } else if (
        LIBRARY_HEADINGS.some((value) => normalized.includes(value))
      ) {
        section = "libraries";
        seenKnowledgeSection = true;
      } else {
        section = seenKnowledgeSection ? "other" : "summary";
      }
      continue;
    }
    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) {
      const item = parseItem(line);
      if (item && section === "tech") techStack.push(item);
      if (item && section === "libraries") libraries.push(item);
      continue;
    }
    if (section === "summary" && line.trim()) {
      summary.push(line.trim().replace(/[*_`]/g, ""));
    }
  }

  return {
    summary: summary.join(" ").slice(0, 600),
    techStack,
    libraries,
  };
}
