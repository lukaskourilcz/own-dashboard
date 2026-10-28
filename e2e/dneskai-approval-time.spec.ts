import { test, expect } from '@playwright/test';
import { gotoPreview, watchConsole } from './helpers';
import { dneskaiLab } from '../src/lib/i18n/sections/dneskai-lab';
import { describeMarketingCode } from '../src/lib/marketing/marketing-codes';
import { pragueScheduledAt } from '../src/lib/marketing/clock';
for (const lang of ['en', 'cs'] as const) test(`elapsed scheduled approval refuses a stale click without changing the saved post (${lang})`, async ({ page }) => {
  const errors = watchConsole(page), privateCalls: string[] = [], t = dneskaiLab[lang];
  page.on('request', request => { if (request.url().includes('/api/marketing/')) privateCalls.push(request.url()); });
  await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' }); await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review');
  const lab = page.getByTestId('dneskai-lab'), approve = lab.getByTestId('dneskai-lab-approve'); await expect(approve).toBeEnabled();
  const planned = lab.getByLabel(`${t.post.slot} · Europe/Prague`, { exact: true }), initial = await planned.inputValue(), [date, time] = initial.split('T');
  const caption = lab.getByRole('textbox', { name: t.post.caption, exact: true }), originalCaption = await caption.inputValue(), hash = await approve.textContent();
  const publish = lab.getByTestId('dneskai-lab-publish-now'), wasDisabled = await publish.isDisabled();
  await page.clock.install({ time: new Date(pragueScheduledAt(date!, time!.slice(0, 5))) });
  await approve.click(); await expect(lab.getByRole('alert')).toContainText(describeMarketingCode('schedule-expired', lang).happened);
  await expect(planned).toHaveValue(initial); await expect(caption).toHaveValue(originalCaption); await expect(approve).toHaveText(hash!);
  expect(await publish.isDisabled()).toBe(wasDisabled);
  expect(privateCalls).toEqual([]); expect(errors).toEqual([]);
});
