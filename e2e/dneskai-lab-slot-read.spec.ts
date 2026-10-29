import { writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { dneskaiLab } from '../src/lib/i18n/sections/dneskai-lab';
for (const width of [360, 430, 768, 1024, 1440, 1728]) for (const lang of ['en', 'cs'] as const) test(`Lab slot availability recovers without a false empty claim: ${width} ${lang}`, async ({ page }, info) => {
  const t = dneskaiLab[lang], errors = watchConsole(page), privateCalls: string[] = [];
  await page.setViewportSize({ width, height: 1000 }); await page.clock.install({ time: new Date('2026-10-28T09:00:00Z') });
  page.on('request', request => { if (request.url().includes('/api/marketing/')) privateCalls.push(request.url()); });
  await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' }); await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review&labPost=d0e5ca10-0000-4000-8000-000000000011&calendarUnknown=1');
  const notice = page.getByTestId('dneskai-lab-moved'), retry = notice.getByRole('button', { name: t.actions.moved.retry, exact: true });
  await expect(notice.getByRole('status')).toHaveText(t.actions.moved.unavailable); await expect(notice).not.toContainText(t.actions.moved.none); await expect(page.getByTestId('dneskai-lab-move')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('[data-testid="dneskai-lab-moved"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  if (width < 768) expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  if (lang === 'cs' && [430, 1440].includes(width)) {
    await notice.scrollIntoViewIfNeeded(); const box = (await notice.boundingBox())!, marks = [];
    for (const [index, target] of [notice.getByRole('heading'), notice.getByRole('status'), retry].entries()) { const value = (await target.boundingBox())!; marks.push({ n: index + 1, x: 100 * (value.x - box.x) / box.width, y: 100 * (value.y - box.y) / box.height, w: 100 * value.width / box.width, h: 100 * value.height / box.height }); }
    await notice.screenshot({ path: info.outputPath(`lab-slot-read-cs-${width}.png`) }); writeFileSync(info.outputPath(`lab-slot-read-cs-${width}.json`), JSON.stringify({ box, marks }, null, 2) + '\n');
  }
  await page.evaluate(() => { const url = new URL(location.href); url.searchParams.delete('calendarUnknown'); history.replaceState(history.state, '', url); });
  await retry.focus(); await retry.press('Enter'); const move = page.getByTestId('dneskai-lab-move'); await expect(move).toBeEnabled(); await expect(move).toBeFocused(); await expect(move).toContainText('12:30');
  await move.click(); const dialog = page.getByRole('dialog'); await expect(dialog).toContainText('12:30'); await dialog.getByRole('button', { name: t.actions.cancel, exact: true }).click();
  expect(privateCalls).toEqual([]); expect(errors).toEqual([]);
});
