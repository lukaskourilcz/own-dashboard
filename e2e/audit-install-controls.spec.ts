import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { app } from '../src/lib/i18n/sections/app';
type InstallWindow = Window & { auditInstallRead: boolean; auditPrompts: number };

for (const lang of ['en', 'cs'] as const) {
  test(`${lang}: install invitation survives blocked storage and keeps toolbar and banner targets reachable`, async ({ page }, info) => {
    const errors = watchConsole(page), t = app[lang];
    await page.addInitScript(() => {
      const state = window as unknown as InstallWindow;
      state.auditInstallRead = false; state.auditPrompts = 0;
      const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
      Storage.prototype.getItem = function (key) {
        if (key === 'dashboard.installDismissed') { state.auditInstallRead = true; throw new DOMException('Fixture blocked storage', 'SecurityError'); }
        return get.call(this, key);
      };
      Storage.prototype.setItem = function (key, value) {
        if (key === 'dashboard.installDismissed') throw new DOMException('Fixture blocked storage', 'SecurityError');
        return set.call(this, key, value);
      };
    });
    await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
    await page.goto('/dev-preview?project=harbor-bakery');
    await expect.poll(() => page.evaluate(() => (window as unknown as InstallWindow).auditInstallRead)).toBe(true);
    const offer = () => page.evaluate(() => {
      const state = window as unknown as InstallWindow;
      window.dispatchEvent(Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
        prompt: async () => { state.auditPrompts++; }, userChoice: Promise.resolve({ outcome: 'dismissed' }),
      }));
    });
    await offer();
    const banner = page.getByRole('region', { name: t.installTitle, exact: true });
    await expect(banner).toBeVisible();
    for (const width of [360, 430, 640, 767, 768, 1024, 1440, 1728]) {
      await page.setViewportSize({ width, height: 900 });
      const minimum = width < 768 ? 44 : 32;
      const controls = [page.getByTestId('toolbar-back'), ...await banner.getByRole('button').all()];
      if (width >= 640) controls.push(page.getByRole('button', { name: t.commandPalette, exact: true }));
      for (const button of controls) await expect.poll(async () => (await button.boundingBox())!.height).toBeGreaterThanOrEqual(minimum);
      if (width < 768) expect((await banner.boundingBox())!.y + (await banner.boundingBox())!.height).toBeLessThan((await page.getByTestId('mobile-nav').boundingBox())!.y - 8);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    await page.setViewportSize({ width: info.project.name === 'mobile' ? 360 : 1440, height: 900 });
    expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('[aria-label="' + t.installTitle + '"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
    if (lang === 'cs') await banner.screenshot({ path: `/tmp/app-audit-install-banner-cs-${info.project.name}.png` });
    await banner.getByRole('button', { name: t.install, exact: true }).focus();
    await page.keyboard.press('Enter'); await expect(banner).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as InstallWindow).auditPrompts)).toBe(1);
    await offer(); await expect(banner).toBeVisible();
    await banner.getByRole('button', { name: t.notNow, exact: true }).click(); await expect(banner).toHaveCount(0);
    await offer(); await expect(banner).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as InstallWindow).auditPrompts)).toBe(1);
    expect(errors).toEqual([]);
  });
}
