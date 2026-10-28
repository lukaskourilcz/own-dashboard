import { writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { dneskaiLab } from '../src/lib/i18n/sections/dneskai-lab';
import { pragueScheduledAt } from '../src/lib/marketing/clock';
for (const width of [360, 430, 768, 1024, 1440, 1728]) for (const lang of ['en', 'cs'] as const) test(`slot expiry updates without replacing the owner's draft: ${width} ${lang}`, async ({ page }, info) => {
  const t = dneskaiLab[lang], errors = watchConsole(page), privateCalls: string[] = [];
  await page.setViewportSize({ width, height: 1100 }); page.on('request', request => { if (request.url().includes('/api/marketing/')) privateCalls.push(request.url()); });
  await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' }); await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review');
  const lab = page.getByTestId('dneskai-lab'); await expect(lab.getByTestId('dneskai-lab-approve')).toBeEnabled();
  const planned = lab.getByLabel(`${t.post.slot} · Europe/Prague`, { exact: true }), initial = await planned.inputValue(), [date, time] = initial.split('T');
  const original = pragueScheduledAt(date!, time!.slice(0, 5)); await page.clock.install({ time: new Date(Date.parse(original) - 120_000) });
  const caption = lab.getByRole('textbox', { name: t.post.caption, exact: true }); await caption.fill('Retained caption before expiry'); await expect(planned).not.toHaveAttribute('aria-describedby');
  await page.clock.fastForward(61_000); await caption.fill('Retained caption after expiry');
  const description = await planned.getAttribute('aria-describedby'); expect(description).toBeTruthy();
  const warning = page.locator(`[id="${description}"]`), [start, end] = t.post.slotExpired('CLOCK').split('CLOCK');
  await expect(warning).toContainText(start!); await expect(warning).toContainText(end!); await expect(planned).toHaveValue(initial); await expect(caption).toHaveValue('Retained caption after expiry');
  const field = planned.locator('..'); expect(await field.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include(`[id="${await planned.getAttribute('id')}"]`).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  if (lang === 'cs' && [430, 1440].includes(width)) {
    await field.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
    expect(await planned.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); })).toBe(true); const box = (await field.boundingBox())!, marks = [];
    for (const [index, target] of [field.locator('label'), planned, warning].entries()) { const value = (await target.boundingBox())!; marks.push({ n: index + 1, x: 100 * (value.x - box.x) / box.width, y: 100 * (value.y - box.y) / box.height, w: 100 * value.width / box.width, h: 100 * value.height / box.height }); }
    await field.screenshot({ path: info.outputPath(`slot-expiry-cs-${width}.png`) }); writeFileSync(info.outputPath(`slot-expiry-cs-${width}.json`), JSON.stringify({ box, marks }, null, 2) + '\n');
  }
  expect(privateCalls).toEqual([]); expect(errors).toEqual([]);
});
