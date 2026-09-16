/**
 * The dated changelog: what shipped, on which day, in the owner's own words.
 *
 * This module is canonical. `CHANGELOG.md` at the repository root is generated
 * from it by `renderChangelogMarkdown`, and `tests/lib/changelog.test.ts` fails
 * when the two disagree — the same mirroring idea as `src/lib/new-project-guide.ts`,
 * inverted so the typed data is the source rather than the prose. Nothing under
 * `src/` reads the filesystem, so keeping the entries in TypeScript is what lets
 * the weekly review render them without a build-time file read.
 *
 * Entry text is English only, like the other repository-content modules; the
 * surrounding UI chrome stays bilingual through `src/lib/i18n`.
 *
 * Screenshots are authentic `/dev-preview` captures committed under
 * `media/changelog/` (see `media/changelog/README.md` for the capture command).
 * `media: null` is the legitimate "not captured yet" state — never point a
 * feature at a placeholder, a stock image or generated UI.
 */

export type ChangelogMedia = {
  /** Repository-relative path, e.g. `media/changelog/2026-09-16-works.png`. */
  path: string;
  /** What the capture shows, for the markdown image alt text. */
  alt: string;
};

export type ChangelogFeature = {
  title: string;
  summary: string;
  /** An authentic `/dev-preview` capture, or null while none has been taken. */
  media: ChangelogMedia | null;
};

export type ChangelogEntry = {
  /** `YYYY-MM-DD` — the day the work landed on `main`. */
  date: string;
  title: string;
  features: ChangelogFeature[];
  /** One line each: corrections too small to deserve a feature block. */
  fixes: string[];
};

/** A weekly review, reduced to the two fields the changelog window needs. */
export type ReviewWindow = {
  week_start: string;
  status: "draft" | "completed";
};

/** How many entries the weekly review shows before it stops listing them. */
export const SHIPPED_ENTRY_LIMIT = 2;

/**
 * Every published entry, newest first. Each one groups work that actually
 * landed on `main` on or shortly before its date; do not add an entry for
 * planned work.
 */
export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-09-16",
    title: "Works, Competition and development finance",
    features: [
      {
        title: "Portfolio registry and Works",
        summary:
          "The daily projects are materialized from a code-level registry, so a repository shows up in Projects even when the GitHub allow-list predates it. Projects carry a scope, a parent and a portfolio key, and client repositories open as Works with the same workspace.",
        media: {
          path: "media/changelog/2026-09-16-works.png",
          alt: "The Works table listing the client repository gym-plzen with its client Acme s.r.o., a healthy status, the linked GitHub repository, its monthly cost and its open-task count.",
        },
      },
      {
        title: "Competition",
        summary:
          "Each project keeps its competitors with a score, useful features, social content, pricing model and the lessons taken from them, editable in a dialog and reachable from a project workspace tab.",
        media: {
          path: "media/changelog/2026-09-16-competition.png",
          alt: "Competition grouped by project, with filters for project, type and review date, a count of two competitors of which one needs a refresh, and TLDR AI under aifirst marked direct, scored 5 of 5 and reviewed on 2026-09-13.",
        },
      },
      {
        title: "Development finance in the Money overview",
        summary:
          "Money reports recurring commitments, paid invoices, the unallocated remainder and a twelve-month timeline. A subscription is split across projects by share and a paid invoice inherits that split, so nothing has to be guessed.",
        media: {
          path: "media/changelog/2026-09-16-development-finance.png",
          alt: "Development finance in the Money overview: 2 806,05 Kč recurring per month, split 80% to Projects, 15% to Works and 4% unallocated, a warning that two subscription amounts are unchecked against an invoice, and a twelve-month committed-versus-paid bar chart above by-project and by-vendor donuts.",
        },
      },
      {
        title: "Reviewed Ideas and pricing-filtered link exports",
        summary:
          "The resource library gained reviewed Ideas, a tighter link taxonomy and exports that can be filtered by pricing model.",
        media: null,
      },
    ],
    fixes: [
      "Inactive subscription rows on Home use muted text instead of reduced opacity, which the mobile accessibility scan had flagged for contrast.",
      "Quarterly billing joined the supported subscription cycles.",
      "Ideas reconcile against the current resource library instead of the original seed list.",
    ],
  },
  {
    date: "2026-09-11",
    title: "Resource library, freelance profiles and Drive-backed applications",
    features: [
      {
        title: "Searchable resource library",
        summary:
          "Links are browsable as expandable cards with search, so a saved resource can be found without scrolling the whole list.",
        media: null,
      },
      {
        title: "Freelance profiles and proposal tracking",
        summary:
          "Opportunities gained an own-only platform directory with editable profile and service drafts, proposal text, document links and a platform-filtered response rate. A draft never implies a published external account or a sent proposal.",
        media: null,
      },
      {
        title: "Prepared applications connected to Drive",
        summary:
          "Career links each prepared position to its posting and its Google Drive letter, records a sent snapshot atomically, keeps progress history and reports first replies, follow-up dates and cohort response statistics.",
        media: null,
      },
    ],
    fixes: [],
  },
  {
    date: "2026-09-07",
    title: "Career rebuilt around job matching",
    features: [
      {
        title: "Match scoring and tailored letters",
        summary:
          "Career was redesigned around an explicit, comparable match score per listing and application letters written for the specific position, with selected leads and letter guidance alongside them.",
        media: {
          path: "media/changelog/2026-09-07-career-matching.png",
          alt: "Career's open positions beside one listing's detail: a senior React role at Ecomail.cz scored 88% stack overlap, the six matched skills listed, GraphQL named as the single gap, and the note that overlap is not a hiring probability.",
        },
      },
      {
        title: "A saved stage before applying",
        summary:
          "A position can be saved before it becomes an application, so the pipeline separates interest from a letter that was actually sent.",
        media: null,
      },
    ],
    fixes: [
      "Live job pages are given longer to respond before a listing is treated as gone.",
    ],
  },
];

const MARKDOWN_INTRO = `What shipped in OwnDashboard, newest first, one dated entry per release.

\`src/lib/changelog.ts\` is the source of truth for these entries and this file is
generated from it, so edit the module and regenerate — \`tests/lib/changelog.test.ts\`
fails when the two disagree. Publish a new entry at least every two weeks, with one
authentic \`/dev-preview\` capture per feature (see \`media/changelog/README.md\`).
A feature without a capture yet carries no image at all; never stand in a
placeholder or generated screenshot.`;

/**
 * The exact text of `CHANGELOG.md`. Pure: the same entries always render the
 * same bytes, which is what makes the mirror test a real gate.
 */
export function renderChangelogMarkdown(entries: readonly ChangelogEntry[]): string {
  const blocks: string[] = ["# Changelog", MARKDOWN_INTRO];

  for (const entry of entries) {
    blocks.push(`## ${entry.date} — ${entry.title}`);
    if (entry.features.length > 0) {
      blocks.push("### Shipped");
      for (const feature of entry.features) {
        const bullet = `- **${feature.title}** — ${feature.summary}`;
        blocks.push(
          feature.media
            ? `${bullet}\n\n  ![${feature.media.alt}](${feature.media.path})`
            : bullet,
        );
      }
    }
    if (entry.fixes.length > 0) {
      blocks.push("### Fixes");
      blocks.push(entry.fixes.map((fix) => `- ${fix}`).join("\n"));
    }
  }

  return `${blocks.join("\n\n")}\n`;
}

/**
 * The `week_start` of the newest completed review that closed before the week
 * being written. Drafts do not count — an unfinished review has not been read,
 * so the shipped window should still reach back past it. Returns null when no
 * earlier review was ever completed.
 *
 * Pure by design: the current week is passed in, never derived from a clock.
 */
export function previousCompletedReviewDate(
  reviews: readonly ReviewWindow[],
  currentWeekStart: string,
): string | null {
  let newest: string | null = null;
  for (const review of reviews) {
    if (review.status !== "completed") continue;
    if (review.week_start >= currentWeekStart) continue;
    if (newest === null || review.week_start > newest) newest = review.week_start;
  }
  return newest;
}

/**
 * The entries published after `since`, newest first, capped at `limit`.
 *
 * `since === null` means there is no earlier completed review to measure from —
 * either the first review ever, or one older than the twelve weeks the loader
 * fetches — so the newest entries are shown instead of nothing. An empty result
 * with a non-null `since` is the honest "nothing shipped since then" state.
 */
export function entriesSince(
  entries: readonly ChangelogEntry[],
  since: string | null,
  limit: number = SHIPPED_ENTRY_LIMIT,
): ChangelogEntry[] {
  if (limit <= 0) return [];
  const window = since === null ? entries : entries.filter((entry) => entry.date > since);
  return window.slice(0, limit);
}
