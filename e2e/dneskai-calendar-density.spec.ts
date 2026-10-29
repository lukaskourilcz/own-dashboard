import { writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { dneskaiWorkspace } from '../src/lib/i18n/sections/dneskai-workspace';

for (const width of [360, 430, 768, 1024, 1440, 1728]) {
  for (const lang of ['en', 'cs'] as const) for (const theme of ['light', 'dark'] as const) {
    test(`Calendar keeps intrinsic day heights and keyboard issue disclosure: ${width} ${lang} ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 1100 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const errors = watchConsole(page), t = dneskaiWorkspace[lang];
      await page.route('**/api/vercel/analytics?**', route => route.fulfill({ json: { kind: 'unconfigured' } }));
      await gotoPreview(page, { lang, theme });
      await page.goto('/dev-preview?project=dneskai');
      await page.getByRole('tab', { name: t.tabs.calendar, exact: true }).click();
      const view = page.getByTestId('dneskai-calendar'), days = view.getByTestId('dneskai-calendar-day');
      await expect(days).toHaveCount(7);
      const issue = view.locator('details[data-testid="dneskai-code-disclosure"]').first(), summary = issue.locator('summary');
      await expect(summary).toBeVisible();
      expect(await issue.evaluate(element => (element as HTMLDetailsElement).open)).toBe(false);
      const next = issue.getByTestId('dneskai-code-next');
      await expect(next).toBeHidden();
      if (width < 768) expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await summary.focus();
      await summary.press('Enter');
      await expect(next).toBeVisible();
      await expect(summary).toBeFocused();
      await expect(issue.locator('dl')).toBeVisible();
      await summary.press('Space');
      await expect(next).toBeHidden();
      const geometry = await days.evaluateAll(elements => elements.map(element => {
        const box = element.getBoundingClientRect(), content = element.lastElementChild!.getBoundingClientRect();
        return { width: box.width, height: box.height, blank: box.bottom - content.bottom };
      }));
      for (const day of geometry) expect(day.blank).toBeLessThanOrEqual(2);
      expect(Math.max(...geometry.map(day => day.width)) - Math.min(...geometry.map(day => day.width))).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('[data-testid="dneskai-calendar"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
      if (lang === 'cs' && theme === 'dark' && [430, 1440].includes(width)) {
        await view.evaluate(element => element.scrollIntoView({ block: 'start' }));
        const box = (await view.boundingBox())!, first = (await days.first().boundingBox())!;
        const clip = { ...box, height: Math.min(box.height, first.y + first.height - box.y + 1, 1100 - box.y - (width < 768 ? 80 : 0)) };
        const marks = [];
        for (const [index, element] of [view.locator('h2'), days.first(), summary].entries()) {
          const value = (await element.boundingBox())!, left = Math.max(clip.x, value.x), top = Math.max(clip.y, value.y);
          marks.push({ n: index + 1, x: 100 * (left - clip.x) / clip.width, y: 100 * (top - clip.y) / clip.height, w: 100 * Math.max(0, Math.min(clip.x + clip.width, value.x + value.width) - left) / clip.width, h: 100 * Math.max(0, Math.min(clip.y + clip.height, value.y + value.height) - top) / clip.height });
        }
        await page.screenshot({ path: info.outputPath(`calendar-density-cs-${width}.png`), clip });
        writeFileSync(info.outputPath(`calendar-density-cs-${width}.json`), JSON.stringify({ box: clip, marks, geometry }, null, 2) + '\n');
      }
      expect(errors).toEqual([]);
    });
  }
}
