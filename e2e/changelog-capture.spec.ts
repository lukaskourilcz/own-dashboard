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
 */

const OUTPUT_DIR = "media/changelog";

/** One capture: a sidebar destination and the card to frame inside it. */
const CAPTURES = [
  { file: "2026-09-16-works.png", tab: "Works", heading: "Works" },
  { file: "2026-09-16-competition.png", tab: "Competition", heading: "Competition" },
  { file: "2026-09-16-development-finance.png", tab: "Money overview", heading: "Money overview" },
  { file: "2026-09-07-career-matching.png", tab: "Career", heading: "Career" },
] as const;

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
      await page.locator("aside").locator("nav").getByRole("button", { name: capture.tab, exact: true }).click();
      const title = page.getByRole("heading", { level: 1, name: capture.heading }).first();
      await expect(title).toBeVisible();

      mkdirSync(OUTPUT_DIR, { recursive: true });
      await page.locator("#main-content").screenshot({ path: `${OUTPUT_DIR}/${capture.file}` });
    });
  }
});
