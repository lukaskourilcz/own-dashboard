import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { dneskaiAudio } from '../src/lib/i18n/sections/dneskai-audio';
import { dneskaiLab } from '../src/lib/i18n/sections/dneskai-lab';
type AxePage = ConstructorParameters<typeof AxeBuilder>[0]['page'];
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.beforeEach(async ({ page }) => {
  await page.route('**/api/vercel/analytics?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"kind":"unconfigured"}' }));
});

for (const lang of ['en', 'cs'] as const) test(`Sources → Music lists the sample tracks read-only in the preview (${lang})`, async ({ page }, info) => {
  const errors = watchConsole(page), t = dneskaiAudio[lang];
  const calls: string[] = []; page.on('request', (request) => { if (request.url().includes('/api/marketing/')) calls.push(request.url()); });
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 360, height: 800 });
  await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
  await page.goto('/dev-preview?project=dneskai&projectTab=sources&sourceSection=music');
  const music = page.getByTestId('dneskai-audio-library');
  await expect(music).toBeVisible();
  await expect(music.getByRole('heading', { name: t.title, exact: true })).toBeVisible();
  await expect(music.getByTestId('dneskai-audio-track')).toHaveCount(2);
  await expect(music.getByRole('switch', { name: t.enable('Quiet Circuit'), exact: true })).toBeDisabled();
  await expect(music.getByTestId('dneskai-audio-upload')).toHaveCount(0);
  expect(calls).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const axe = await new AxeBuilder({ page: page as unknown as AxePage }).include('[data-testid="dneskai-audio-library"]').withTags(tags).analyze();
  expect(axe.violations).toEqual([]); expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath(`music-${lang}.png`), fullPage: true });
});

test('Lab picks a Reel track, saves a new version and approves its hash', async ({ page }, info) => {
  const errors = watchConsole(page), t = dneskaiLab.en, audio = dneskaiAudio.en;
  await gotoPreview(page); await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review');
  const lab = page.getByTestId('dneskai-lab');
  const picker = lab.getByTestId('dneskai-audio-picker');
  await expect(picker).toBeVisible();
  const select = picker.getByRole('combobox', { name: audio.picker.label, exact: true });
  await expect(select).toHaveValue('');
  // Only the enabled sample track is offered next to the rotation.
  await expect(select.locator('option')).toHaveText([audio.picker.rotation(null), 'Quiet Circuit · Sample artist · 1:12']);
  await select.selectOption({ label: 'Quiet Circuit · Sample artist · 1:12' });
  await expect(page.getByTestId('dneskai-lab-approve')).toBeDisabled();
  const axe = await new AxeBuilder({ page: page as unknown as AxePage }).include('[data-testid="dneskai-audio-picker"]').withTags(tags).analyze();
  expect(axe.violations).toEqual([]);
  await lab.getByRole('button', { name: t.actions.save, exact: true }).click();
  await expect(page).toHaveURL(/labPost=/);
  await expect(page.getByTestId('dneskai-lab-approve')).toBeEnabled();
  await expect(lab.getByTestId('dneskai-audio-picker').getByRole('combobox', { name: audio.picker.label, exact: true })).not.toHaveValue('');
  await page.getByTestId('dneskai-lab-approve').click();
  await expect(page.getByTestId('dneskai-lab-session')).toContainText('Approved. Scheduled');
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('lab-audio.png'), fullPage: true });
});

test('Lab switches a carousel to a Reel, saves a new version and approves its hash (#165)', async ({ page }) => {
  const errors = watchConsole(page), t = dneskaiLab.en, format = dneskaiAudio.en.format;
  await gotoPreview(page); await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review');
  const lab = page.getByTestId('dneskai-lab');
  const group = lab.getByTestId('dneskai-format-switch').getByRole('radiogroup', { name: format.label, exact: true });
  await expect(group.getByRole('radio', { name: format.carousel, exact: true })).toHaveAttribute('aria-checked', 'true');
  await group.getByRole('radio', { name: format.reel, exact: true }).click();
  await expect(page.getByTestId('dneskai-lab-approve')).toBeDisabled();
  const axe = await new AxeBuilder({ page: page as unknown as AxePage }).include('[data-testid="dneskai-format-switch"]').withTags(tags).analyze();
  expect(axe.violations).toEqual([]);
  await lab.getByRole('button', { name: t.actions.save, exact: true }).click();
  await expect(page).toHaveURL(/labPost=/);
  await expect(lab.getByTestId('dneskai-format-switch').getByRole('radio', { name: format.reel, exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('dneskai-lab-approve')).toBeEnabled();
  await page.getByTestId('dneskai-lab-approve').click();
  await expect(page.getByTestId('dneskai-lab-session')).toContainText('Approved. Scheduled');
  expect(errors).toEqual([]);
});
