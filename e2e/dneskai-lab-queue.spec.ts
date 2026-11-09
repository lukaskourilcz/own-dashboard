import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { dneskaiLab } from '../src/lib/i18n/sections/dneskai-lab';
type AxePage = ConstructorParameters<typeof AxeBuilder>[0]['page'];

/**
 * Dnes and Zítra in the Design Lab (owner request, 9 November 2026): at most about five cards at once, the rest
 * scrolls inside the panel with a fade at the bottom, a focusable region with a name, at desktop and phone widths.
 * `labFixture=busy` puts seven posts and one job on tomorrow.
 */
for (const [lang, width] of [['en', 1440], ['cs', 1440], ['en', 360], ['cs', 390]] as const) test(`Lab day panels scroll past five cards at ${width} px (${lang})`, async ({ page }, info) => {
  const errors = watchConsole(page), t = dneskaiLab[lang].queue;
  await page.route('**/api/vercel/analytics?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"kind":"unconfigured"}' }));
  await page.setViewportSize({ width, height: 900 });
  await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
  await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review&labFixture=busy');
  const queue = page.getByTestId('dneskai-lab-queue');
  await expect(queue).toBeVisible();
  const tomorrow = queue.getByRole('region', { name: t.scrollLabel(t.tomorrow) });
  await expect(tomorrow.getByTestId('dneskai-lab-queue-post')).toHaveCount(7);
  await expect(tomorrow).toHaveAttribute('data-scrolls', 'true');
  await expect(tomorrow).toHaveAttribute('data-more', 'true');
  await expect(tomorrow).toHaveAttribute('tabindex', '0');

  // About five cards fit; the sixth starts below the visible edge.
  const box = await tomorrow.evaluate((element) => ({ height: element.clientHeight, scroll: element.scrollHeight, overflow: getComputedStyle(element).overflowY }));
  expect(box.overflow).toBe('auto');
  expect(box.scroll).toBeGreaterThan(box.height);
  const visible = await tomorrow.evaluate((element) => {
    const frame = element.getBoundingClientRect();
    return Array.from(element.querySelectorAll('[data-testid="dneskai-lab-queue-post"]')).filter((card) => { const r = card.getBoundingClientRect(); return r.top >= frame.top - 1 && r.bottom <= frame.bottom + 1; }).length;
  });
  expect(visible).toBeGreaterThanOrEqual(4);
  expect(visible).toBeLessThanOrEqual(5);

  // Today has fewer cards: no scroll, no tab stop, no fade.
  const today = queue.getByRole('region', { name: t.scrollLabel(t.today) });
  await expect(today).toHaveAttribute('data-scrolls', 'false');
  await expect(today).not.toHaveAttribute('tabindex', '0');

  const axe = await new AxeBuilder({ page: page as unknown as AxePage }).include('[data-testid="dneskai-lab-queue"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(axe.violations.map((violation) => violation.id)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await queue.screenshot({ path: `test-results/dneskai-lab-queue-${lang}-${width}-${info.project.name}.png` });

  // Keyboard: the focused region scrolls with the arrow keys and End; the fade goes once the last card shows.
  await tomorrow.focus();
  await expect(tomorrow).toBeFocused();
  await page.keyboard.press('End');
  await expect.poll(() => tomorrow.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(tomorrow).toHaveAttribute('data-more', 'false');
  await page.keyboard.press('Home');
  await expect.poll(() => tomorrow.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(tomorrow).toHaveAttribute('data-more', 'true');
  await queue.screenshot({ path: `test-results/dneskai-lab-queue-${lang}-${width}-${info.project.name}-top.png` });

  // A card below the edge, once chosen, is scrolled into view inside the region only.
  await tomorrow.getByTestId('dneskai-lab-queue-post').last().click();
  await expect(tomorrow.getByTestId('dneskai-lab-queue-post').last()).toHaveAttribute('aria-current', 'true');
  expect(errors).toEqual([]);
});
