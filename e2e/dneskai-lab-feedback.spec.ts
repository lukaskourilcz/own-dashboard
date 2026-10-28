import { writeFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { dneskaiLab } from '../src/lib/i18n/sections/dneskai-lab';
async function edit(page: Page, width: number, lang: 'en' | 'cs', theme: 'light' | 'dark') {
  await page.setViewportSize({ width, height: 1100 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/vercel/analytics?**', route => route.fulfill({ json: { kind: 'unconfigured' } }));
  await gotoPreview(page, { lang, theme }); await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review');
  const lab = page.getByTestId('dneskai-lab'), approve = lab.getByTestId('dneskai-lab-approve'), t = dneskaiLab[lang];
  await expect(approve).toBeEnabled();
  await lab.getByTestId('dneskai-slide-inspector').getByRole('textbox', { name: t.slide.fields.headline, exact: true }).fill(lang === 'cs' ? 'Krátký návrh před uložením' : 'Short draft before saving');
  await expect(approve).toBeDisabled(); return { lab, approve, t };
}
for (const width of [360, 430, 768, 1024, 1440, 1728]) for (const lang of ['en', 'cs'] as const) for (const theme of ['light', 'dark'] as const) {
  test(`Lab has one approval instruction beside its actions: ${width} ${lang} ${theme}`, async ({ page }, info) => {
    const errors = watchConsole(page), { lab, approve, t } = await edit(page, width, lang, theme);
    await expect(lab.getByText(t.actions.dirty, { exact: false })).toHaveCount(1);
    const actions = lab.getByRole('group', { name: t.actions.label, exact: true });
    await expect(actions.getByRole('status')).toHaveText(t.actions.dirty);
    const description = await approve.getAttribute('aria-describedby'); expect(description).toBeTruthy();
    await expect(page.locator(`[id="${description}"]`)).toHaveText(t.actions.dirty);
    await expect(lab.getByTestId('dneskai-draft-badge')).toBeVisible();
    expect(await actions.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (width < 768) for (const button of await actions.getByRole('button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('[data-testid="dneskai-lab-session"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
    if (lang === 'cs' && theme === 'dark' && [430, 1440].includes(width)) {
      await actions.scrollIntoViewIfNeeded(); const box = (await actions.boundingBox())!, marks = [];
      for (const [index, target] of [actions.getByRole('status'), approve, actions.getByRole('button', { name: t.actions.discard, exact: true })].entries()) {
        const value = (await target.boundingBox())!; marks.push({ n: index + 1, x: 100 * (value.x - box.x) / box.width, y: 100 * (value.y - box.y) / box.height, w: 100 * value.width / box.width, h: 100 * value.height / box.height });
      }
      await actions.screenshot({ path: info.outputPath(`lab-feedback-cs-${width}.png`) }); writeFileSync(info.outputPath(`lab-feedback-cs-${width}.json`), JSON.stringify({ box, marks }, null, 2) + '\n');
    }
    const discard = actions.getByRole('button', { name: t.actions.discard, exact: true }); await discard.focus(); await discard.press('Enter');
    await expect(lab.getByText(t.actions.dirty, { exact: false })).toHaveCount(0); await expect(approve).toBeEnabled(); await expect(approve).toBeFocused(); expect(errors).toEqual([]);
  });
}
test('discard keeps keyboard focus on the surviving approval action', async ({ page }) => {
  const { lab, approve, t } = await edit(page, 1440, 'cs', 'dark');
  const discard = lab.getByRole('button', { name: t.actions.discard, exact: true }); await discard.focus(); await discard.press('Enter');
  await expect(approve).toBeEnabled(); await expect(approve).toBeFocused();
});
test('discard focuses the post heading when its original version cannot be approved', async ({ page }) => {
  const errors = watchConsole(page), t = dneskaiLab.en;
  await gotoPreview(page, { lang: 'en', theme: 'dark' }); await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review&labPost=d0e5ca10-0000-4000-8000-000000000010');
  const lab = page.getByTestId('dneskai-lab'), approve = lab.getByTestId('dneskai-lab-approve'); await expect(approve).toBeDisabled();
  await lab.getByTestId('dneskai-slide-inspector').getByRole('textbox', { name: t.slide.fields.headline, exact: true }).fill('Another unsaved headline');
  const discard = lab.getByRole('button', { name: t.actions.discard, exact: true }); await discard.focus(); await discard.press('Enter');
  await expect(approve).toBeDisabled(); await expect(lab.getByTestId('dneskai-lab-post-title')).toBeFocused(); expect(errors).toEqual([]);
});
