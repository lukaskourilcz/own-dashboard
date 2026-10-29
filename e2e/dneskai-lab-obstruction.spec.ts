import { writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { dneskaiLab } from '../src/lib/i18n/sections/dneskai-lab';
import { pragueScheduledAt } from '../src/lib/marketing/clock';
for (const width of [360, 430, 768, 1024, 1440, 1728]) for (const lang of ['en', 'cs'] as const) for (const dirty of [false, true]) test(`Lab fields stay reachable while ${dirty ? 'dirty' : 'focused'}: ${width} ${lang}`, async ({ page }, info) => {
  const t = dneskaiLab[lang], errors = watchConsole(page); await page.setViewportSize({ width, height: 1100 });
  await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' }); await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review');
  const lab = page.getByTestId('dneskai-lab'), approve = lab.getByTestId('dneskai-lab-approve'), actions = lab.getByRole('group', { name: t.actions.label, exact: true }); await expect(approve).toBeEnabled();
  const planned = lab.getByLabel(`${t.post.slot} · Europe/Prague`, { exact: true }), initial = await planned.inputValue();
  if (dirty) {
    const [date, time] = initial.split('T'); const at = pragueScheduledAt(date!, time!.slice(0, 5)); await page.clock.install({ time: new Date(Date.parse(at) - 120_000) });
    const caption = lab.getByRole('textbox', { name: t.post.caption, exact: true }); await caption.fill('Retained draft before expiry'); await page.clock.fastForward(61_000); await caption.fill('Retained draft after expiry');
    await expect(approve).toBeDisabled();
  } else await planned.focus();
  // Ordinary nearest scrolling must reveal the actual input, without a centred capture workaround.
  await planned.locator('..').scrollIntoViewIfNeeded();
  expect(await planned.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); })).toBe(true);
  await expect(planned).toHaveValue(initial);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('[data-testid="dneskai-lab-session"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  if (dirty && lang === 'cs' && [430, 1440].includes(width)) {
    const field = planned.locator('..'), box = (await field.boundingBox())!, marks = [];
    for (const [index, target] of [field.locator('label'), planned, field.locator('p')].entries()) { const value = (await target.boundingBox())!; marks.push({ n: index + 1, x: 100 * (value.x - box.x) / box.width, y: 100 * (value.y - box.y) / box.height, w: 100 * value.width / box.width, h: 100 * value.height / box.height }); }
    await field.screenshot({ path: info.outputPath(`lab-unobstructed-cs-${width}.png`) }); writeFileSync(info.outputPath(`lab-unobstructed-cs-${width}.json`), JSON.stringify({ box, marks }, null, 2) + '\n');
  }
  if (!dirty) { await lab.getByTestId('dneskai-lab-post-title').focus(); await expect(approve).toBeEnabled(); await expect(actions).toBeInViewport(); }
  expect(errors).toEqual([]);
});
