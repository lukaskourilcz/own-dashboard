import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { gotoPreview } from "./helpers";

/**
 * Authentic `/dev-preview` captures for `CHANGELOG.md`.
 *
 * Opt-in on purpose: an ordinary `npm run test:e2e` must never rewrite
 * committed binaries, so nothing here runs without CHANGELOG_CAPTURE. Run it
 * with:
 *
 *   CHANGELOG_CAPTURE=1 npx playwright test e2e/changelog-capture.spec.ts --project=desktop
 *
 * then point the matching `ChangelogFeature.media` in `src/lib/changelog.ts` at
 * the file and regenerate `CHANGELOG.md`. Conditions are documented in
 * `media/changelog/README.md`; `gotoPreview` is what fixes language, theme and
 * reduced motion, so captures stay comparable between entries.
 *
 * The waits below are the whole point of this file. A green test with a useless
 * image is the failure mode here, not a red one, so each capture waits on
 * something the screenshot actually depends on:
 *
 * - `AppToolbar` renders an `h1` for every tab and sits above the
 *   `AnimatePresence`, so a visible toolbar heading proves the tab changed and
 *   nothing about the panel below it.
 * - The panel's own `PageHeader` identifies the panel, but at this viewport the
 *   macOS layout hides its title block (`globals.css`:
 *   `.mac-page-header > div:first-child { display: none }`) because the toolbar
 *   already carries the title. So the heading is matched by text, not by
 *   visibility, and a control only that panel renders is what proves the panel
 *   painted.
 * - Two panel titles differ from their sidebar entry: the Money overview tab's
 *   panel is headed "Development finance".
 * - `dev-finance-panel.tsx` loads its charts through `next/dynamic` with
 *   `ssr: false` behind a `Skeleton`, and recharts animates on mount through
 *   `requestAnimationFrame`, which neither `prefers-reduced-motion` nor
 *   `MotionConfig` touches. That capture therefore waits for the chart surfaces
 *   to exist, for every skeleton to be gone, and then for the mount animation
 *   to finish. The wait belongs here, in the opt-in spec, not in product code.
 */

const OUTPUT_DIR = "media/changelog";

/**
 * How long recharts needs to settle. Its default `animationDuration` is
 * 1500 ms; the margin absorbs a slow first paint of the lazy chunk.
 */
const CHART_SETTLE_MS = 2_000;

/**
 * One capture: the sidebar destination, the panel's own `PageHeader` title
 * (which is not always the sidebar label), an optional button that loads a
 * panel which waits to be asked, a control only that panel renders (a button,
 * or a named group when the panel repeats its buttons per row), an optional
 * element to scroll to when the evidence sits below the fold, and whether the
 * panel draws charts that have to settle before the shutter.
 */
const CAPTURES: readonly {
  file: string;
  tab: string;
  /** Settings sits in the sidebar footer, outside its `nav`. */
  footerTab?: boolean;
  panelHeading: string;
  activate?: string;
  control: string;
  controlRole?: "button" | "group";
  scrollTo?: string;
  scrollBlock?: "start" | "center";
  charts: boolean;
}[] = [
  {
    file: "2026-09-26-ig-tips.png",
    tab: "IG TIPS",
    panelHeading: "IG TIPS",
    control: "Add tip",
    charts: false,
  },
  {
    file: "2026-09-26-tools.png",
    tab: "Tools",
    panelHeading: "Tools",
    // The detected list sits below the hand-added tools.
    control: "Check the repositories again",
    scrollTo: 'section[aria-labelledby="tools-detected"]',
    charts: false,
  },
  {
    file: "2026-09-26-settings-engagement.png",
    tab: "Settings",
    footerTab: true,
    panelHeading: "Settings",
    // Every active project row has its own Own/Freelance group.
    control: "Own or Freelance: Recipe box app",
    controlRole: "group",
    // Centre the list so the card title, both explanations and every
    // active project, own and freelance, are in frame.
    scrollTo: "ul:has(> li[data-settings-project])",
    scrollBlock: "center",
    charts: false,
  },
  {
    file: "2026-09-25-projects.png",
    tab: "Projects",
    panelHeading: "Projects",
    control: "Add project",
    // The cost donut above the table is a lazy recharts chunk.
    charts: true,
  },
  {
    file: "2026-09-25-competition.png",
    tab: "Competition",
    panelHeading: "Competition",
    control: "Add competitor",
    charts: false,
  },
  {
    file: "2026-09-25-development-finance.png",
    tab: "Money overview",
    panelHeading: "Development finance",
    control: "Manage subscriptions",
    charts: true,
  },
  {
    file: "2026-09-07-career-matching.png",
    tab: "Career",
    panelHeading: "Career",
    // Career loads nothing until the check is pressed (#81), so pressing it is
    // ordinary use of the real UI and what puts the listings in the frame.
    activate: "Check for new offers",
    control: "Open positions",
    charts: false,
  },
];

test.describe("changelog captures", () => {
  test.skip(
    !process.env.CHANGELOG_CAPTURE,
    "Opt-in: set CHANGELOG_CAPTURE=1 to rewrite the committed screenshots.",
  );

  for (const capture of CAPTURES) {
    test(`captures ${capture.file}`, async ({ page }, testInfo) => {
      test.skip(
        testInfo.project.name === "mobile",
        "Changelog captures are taken at the documented 1440x900 desktop viewport.",
      );

      await gotoPreview(page);
      // `aside` alone is ambiguous — jobs-panel.tsx renders a second one — so
      // match the sidebar by its own class.
      const sidebar = page.locator("aside.mac-sidebar");
      await (capture.footerTab ? sidebar : sidebar.locator("nav"))
        .getByRole("button", { name: capture.tab, exact: true })
        .click();

      // Identity: which panel is mounted, read from its hidden own heading.
      await expect(page.locator("[data-page-header] h1")).toHaveText(capture.panelHeading);
      if (capture.activate) {
        await page
          .locator("#main-content")
          .getByRole("button", { name: capture.activate, exact: true })
          .click();
      }
      // Paint: a control only this panel renders, below the AnimatePresence.
      const control = page
        .locator("#main-content")
        .getByRole(capture.controlRole ?? "button", { name: capture.control, exact: true });
      await expect(control).toBeVisible();
      if (capture.scrollTo) {
        const block = capture.scrollBlock ?? "start";
        await page.locator(capture.scrollTo).evaluate((element, position) => element.scrollIntoView({ block: position }), block);
        await expect(control).toBeInViewport();
      }

      if (capture.charts) {
        await expect(page.locator("#main-content svg.recharts-surface").first()).toBeVisible();
        await expect(page.locator("#main-content .animate-pulse")).toHaveCount(0);
        await page.waitForTimeout(CHART_SETTLE_MS);
      }

      mkdirSync(OUTPUT_DIR, { recursive: true });
      await page.locator("#main-content").screenshot({ path: `${OUTPUT_DIR}/${capture.file}` });
    });
  }
});
