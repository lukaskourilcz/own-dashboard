import { test, expect, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { todos } from '../src/lib/i18n/sections/todos';
import { settings } from '../src/lib/i18n/sections/settings';
import { common } from '../src/lib/i18n/sections/common';
async function checkTargets(region: Locator, minimum: number) {
  await expect.poll(() => region.locator('[role="checkbox"],[role="switch"]').evaluateAll((elements, minimum) => elements.filter(el => el.getClientRects().length).map(el => {
    const box = el.getBoundingClientRect(); return Math.min(box.width, box.height);
  }).every(size => size >= minimum), minimum)).toBe(true);
}
for (const lang of ['en', 'cs'] as const) {
  test(`${lang}: settings toggles retain compact marks, full targets and keyboard or edge activation`, async ({ page }, info) => {
    const errors = watchConsole(page), t = settings[lang]; await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' }); await page.goto('/dev-preview?tab=settings');
    const main = page.locator('#main-content'); await expect(page.locator('#show-czech-career')).toBeVisible(); await expect.poll(() => main.getByRole('switch').count()).toBeGreaterThan(5);
    for (const width of [360, 430, 768, 1024, 1440, 1728]) {
      await page.setViewportSize({ width, height: 1000 }); await checkTargets(main, width < 768 ? 44 : 32);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    await page.setViewportSize({ width: info.project.name === 'mobile' ? 360 : 1440, height: 1000 });
    const checkbox = page.locator('#show-czech-career'), was = await checkbox.getAttribute('aria-checked');
    await checkbox.click({ position: { x: 3, y: 3 } }); await expect(checkbox).toHaveAttribute('aria-checked', was === 'true' ? 'false' : 'true');
    await checkbox.focus(); await page.keyboard.press('Space'); await expect(checkbox).toHaveAttribute('aria-checked', was!);
    const toggle = main.getByRole('switch', { name: t.renewalNotifications, exact: true }), wasOn = await toggle.getAttribute('aria-checked');
    await toggle.click({ position: { x: 3, y: 3 } }); await expect(toggle).toHaveAttribute('aria-checked', wasOn === 'true' ? 'false' : 'true');
    await toggle.focus(); await page.keyboard.press('Enter'); await expect(toggle).toHaveAttribute('aria-checked', wasOn!);
    await page.keyboard.press('Space'); await expect(toggle).toHaveAttribute('aria-checked', wasOn === 'true' ? 'false' : 'true');
    if (lang === 'cs') await checkbox.locator('..').screenshot({ path: `/tmp/app-audit-settings-checkbox-cs-${info.project.name}.png` });
    expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('#main-content').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]); expect(errors).toEqual([]);
  });
  test(`${lang}: task rows and task creation switches share reachable targets without overflowing`, async ({ page }, info) => {
    const errors = watchConsole(page), t = todos[lang]; await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' }); await page.goto('/dev-preview?tab=tasks');
    const main = page.locator('#main-content'); await expect(main.getByRole('checkbox').first()).toBeVisible();
    for (const width of [360, 430, 768, 1024, 1440, 1728]) { await page.setViewportSize({ width, height: 1000 }); await checkTargets(main, width < 768 ? 44 : 32); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }
    await page.setViewportSize({ width: info.project.name === 'mobile' ? 360 : 1440, height: 1000 });
    if (lang === 'cs') await main.screenshot({ path: `/tmp/app-audit-task-targets-cs-${info.project.name}.png` });
    await main.getByRole('button', { name: t.addTask, exact: true }).click(); const dialog = page.getByRole('dialog'); await checkTargets(dialog, info.project.name === 'mobile' ? 44 : 32);
    const toggle = dialog.getByRole('switch'); await toggle.focus(); await page.keyboard.press('Space'); await expect(toggle).toHaveAttribute('aria-checked', 'true'); await page.keyboard.press('Space'); await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await dialog.getByRole('button', { name: common[lang].cancel, exact: true }).click(); await expect(dialog).toHaveCount(0);
    expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('#main-content').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]); expect(errors).toEqual([]);
  });
}
