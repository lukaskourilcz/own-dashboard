import { type Assignment } from "./assign.js";
import type { CategoryLists, QuizSubject } from "./evaluate.js";
import type { Language, Library, Vertical } from "./schema.js";
/**
 * The category lists devShark declares in `config/marketingshark.json`.
 *
 * Duplicated here rather than read from config because the studio is a leaf package with no
 * orchestrator dependency, and because a preview must render the same whatever the config says —
 * a fixture that moved when a brand edited its lists would stop being a fixture.
 */
export declare const FIXTURE_CATEGORY_LISTS: Readonly<Record<Vertical, CategoryLists>>;
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
export declare const FIXTURE_ITEMS: readonly FixtureItem[];
export declare function fixtureItem(vertical: Vertical): FixtureItem;
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
export declare function fixtureAssignment(library: Library, item: FixtureItem): FixtureAssignment;
//# sourceMappingURL=fixtures.d.ts.map