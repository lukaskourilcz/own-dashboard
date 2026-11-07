import { assignHook, type Assignment } from "./assign.js";
import type { CategoryLists, QuizSubject } from "./evaluate.js";
import type { Language, Library, Vertical } from "./schema.js";

/**
 * The category lists devShark declares in `config/marketingshark.json`.
 *
 * Duplicated here rather than read from config because the studio is a leaf package with no
 * orchestrator dependency, and because a preview must render the same whatever the config says —
 * a fixture that moved when a brand edited its lists would stop being a fixture.
 */
export const FIXTURE_CATEGORY_LISTS: Readonly<Record<Vertical, CategoryLists>> = {
  dev: {
    commonUse: ["javascript", "typescript", "git", "css", "html", "react", "nodejs"],
    interview: ["dsa", "algorithms", "system-design", "databases", "javascript", "typescript"],
    core: ["internet", "git", "security", "databases", "testing"]
  }
};

export interface FixtureItem {
  readonly id: string;
  readonly vertical: Vertical;
  readonly topic: string;
  readonly subject: QuizSubject;
}

/**
 * Preview items carrying real quiz metadata.
 *
 * Each one is chosen to land on a different part of the gate space, so the /admin previews show
 * what the gates actually do rather than three renders of the always pool: a four-option d3 core
 * question, a d4 snippet question that opens the `hasCode` pool, and a commonUse question for the
 * `{topic}` token.
 */
export const FIXTURE_ITEMS: readonly FixtureItem[] = [
  {
    id: "fixture-dev-core",
    vertical: "dev",
    topic: "Git",
    subject: { difficulty: 3, hasCode: false, category: "git", optionCount: 4, canonicalEnglishQuestion: "What does a fast-forward merge actually do?" }
  },
  {
    id: "fixture-dev-code",
    vertical: "dev",
    topic: "React",
    subject: { difficulty: 4, hasCode: true, category: "react", optionCount: 4, canonicalEnglishQuestion: "What does this hook return?" }
  },
  {
    id: "fixture-dev-common",
    vertical: "dev",
    topic: "JavaScript",
    subject: { difficulty: 2, hasCode: false, category: "javascript", optionCount: 4, canonicalEnglishQuestion: "Why does this coerce to a string?" }
  }
];

export function fixtureItem(vertical: Vertical): FixtureItem {
  return FIXTURE_ITEMS.find((item) => item.vertical === vertical) ?? FIXTURE_ITEMS[0]!;
}

export interface FixtureAssignment {
  readonly item: FixtureItem;
  readonly assignment: Assignment | null;
  readonly line: Record<Language, string> | null;
}

/**
 * Run the real assignment against a fixture item.
 *
 * No cooldown history and no previous archetype: a preview is a picture of the gates, not of a
 * channel's week, and feeding it live channel state would make the same page render differently
 * every morning for reasons that have nothing to do with the template.
 */
export function fixtureAssignment(library: Library, item: FixtureItem): FixtureAssignment {
  const result = assignHook({
    library,
    context: { subject: item.subject, categoryLists: FIXTURE_CATEGORY_LISTS[item.vertical] },
    identity: { channel: `${item.vertical}-preview`, date: "2026-08-08", itemId: item.id },
    vertical: item.vertical,
    history: []
  });

  if (result.outcome === "no-hook") return { item, assignment: null, line: null };

  const variant = result.assignment.hook.variants[item.vertical];
  return {
    item,
    assignment: result.assignment,
    line: {
      en: variant.en.replaceAll("{topic}", item.topic),
      cs: variant.cs.replaceAll("{topic}", item.topic)
    }
  };
}
