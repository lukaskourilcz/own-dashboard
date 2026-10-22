import { test, expect, type Page } from '@playwright/test';
import { gotoPreview } from './helpers';

/**
 * Visual comparison of the Design Lab on the `/dev-preview` fixture posts (audit finding TESTS-14).
 *
 * The committed baselines are macOS renders: the app uses system UI fonts, so a Linux runner draws different
 * glyphs and would fail every comparison. These specs therefore run only on darwin and skip on the Linux CI
 * runner. To refresh the baselines after an intended visual change, run on macOS:
 *   ./node_modules/.bin/playwright test e2e/dneskai-lab-visual.spec.ts --update-snapshots
 * and review every changed PNG before committing it.
 *
 * Determinism: the browser clock is fixed (the fixture dates every post relative to "now" and the queue shows
 * minutes left), reduced motion is on, animations are frozen, the caret is hidden, the sticky action bar is
 * pinned in place and the fixed mobile navigation is hidden.
 */
test.skip(process.platform !== 'darwin', 'Design Lab baselines are macOS renders; system fonts differ on Linux.');

const FIXED_NOW = new Date('2026-10-20T06:00:00.000Z');
const SCREENSHOT = { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixelRatio: 0.01 } as const;

async function openLab(page: Page, lang: 'en' | 'cs') {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route('**/api/vercel/analytics?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"kind":"unconfigured"}' }));
  await gotoPreview(page, { lang, theme: 'light' });
  await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review');
  const lab = page.getByTestId('dneskai-lab');
  await expect(lab).toBeVisible();
  await expect(page.getByTestId('dneskai-lab-stage').getByTestId('dneskai-stage-slide')).toBeVisible();
  // The sticky action bar and the fixed mobile navigation follow the scroll position, so an element screenshot
  // taller than the viewport would paint them over whatever part was captured last. Pin the bar in place and
  // hide the navigation, which other specs cover, for the comparison. The topics list (#154) has its own checks
  // and screenshots in dneskai-lab.spec.ts and is hidden here too.
  await page.addStyleTag({ content: '[data-testid="dneskai-lab"] .sticky { position: static !important; backdrop-filter: none !important; } [data-testid="mobile-nav"] { visibility: hidden !important; } [data-testid="dneskai-topics"] { display: none !important; }' });
  await settleImages(page);
  return lab;
}

async function settleImages(page: Page) {
  // Lazy images outside the viewport load when the element screenshot scrolls to them; toHaveScreenshot then waits
  // for two identical frames.
  await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLImageElement>('[data-testid="dneskai-lab"] img'))
    .every((image) => image.loading === 'lazy' || (image.complete && image.naturalWidth > 0)));
  await page.evaluate(() => document.fonts.ready);
}

for (const lang of ['en', 'cs'] as const) test(`Design Lab matches its baseline (${lang})`, async ({ page }) => {
  const lab = await openLab(page, lang);
  await lab.evaluate((element) => element.scrollIntoView({ block: 'start' }));
  // The viewport, not the Lab element: on desktop the Lab scrolls inside the app window, so an element capture
  // taller than the window would show the desktop background instead of the content below the fold.
  await expect(page).toHaveScreenshot(`lab-${lang}.png`, SCREENSHOT);
});

test('each fixture post renders the same stage', async ({ page }) => {
  await openLab(page, 'en');
  const posts = page.getByTestId('dneskai-lab-queue-post');
  const count = await posts.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    await posts.nth(index).click();
    // A missed post's draft starts with a new time (owner decision 6), so leaving it asks to discard that change.
    const discard = page.getByRole('dialog').getByRole('button', { name: 'Discard changes', exact: true });
    if (await discard.waitFor({ timeout: 1_000 }).then(() => true, () => false)) await discard.click();
    await expect(posts.nth(index)).toHaveAttribute('aria-current', 'true');
    await settleImages(page);
    await expect(page.getByTestId('dneskai-lab-stage')).toHaveScreenshot(`stage-post-${index + 1}.png`, SCREENSHOT);
  }
});
