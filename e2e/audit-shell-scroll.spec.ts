import { expect, test } from '@playwright/test';
import { gotoPreview, watchConsole } from './helpers';

for (const lang of ['en', 'cs'] as const) test(`${lang}: editor scrolling keeps desktop navigation and toolbar in their window`, async ({ page }) => {
  const errors = watchConsole(page);
  await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
  await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review');
  const lab = page.getByTestId('dneskai-lab');
  await expect(lab).toBeVisible();
  for (const width of [360, 430, 768, 1024, 1440, 1728]) {
    await page.setViewportSize({ width, height: 1000 });
    await lab.evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (width < 768) continue;
    const frame = await page.evaluate(() => {
      const outer = document.querySelector('.mac-window')!, toolbar = document.querySelector('.mac-toolbar')!, sidebar = document.querySelector('.mac-sidebar')!;
      return { outerTop: outer.scrollTop, toolbarTop: toolbar.getBoundingClientRect().top, sidebarTop: sidebar.getBoundingClientRect().top, windowTop: outer.getBoundingClientRect().top };
    });
    expect(frame.outerTop).toBe(0);
    expect(frame.toolbarTop).toBe(frame.windowTop);
    expect(frame.sidebarTop).toBe(frame.windowTop);
    // Focus another editor control without allowing the outer window to scroll.
    const field = lab.locator('textarea').first();
    await field.evaluate(element => element.focus());
    await expect(field).toBeFocused();
    expect(await page.locator('.mac-window').evaluate(element => element.scrollTop)).toBe(0);
  }
  expect(errors).toEqual([]);
});
