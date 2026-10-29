import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { gotoPreview, watchConsole } from './helpers';
import { marketingStateFixture, stateOwner } from '../tests/lib/marketing-state-fixture';
type AxePage = ConstructorParameters<typeof AxeBuilder>[0]['page'];
// MP4/H.264 needs Chrome's licensed codecs; default headless Chromium has none.
test.use({ channel: 'chrome' });
let clip: Buffer;
test.beforeAll(() => {
 if (!ffmpegPath) throw new Error('Native test encoder is unavailable');
 clip = execFileSync(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=32x32:r=10', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'], { timeout: 10_000, maxBuffer: 1024 * 1024 });
});
for (const lang of ['en', 'cs'] as const) for (const theme of ['light', 'dark'] as const) {
 test(`${lang}/${theme}: saved MP4 uses native controls and stays paused until keyboard playback`, async ({ page }, info) => {
  const errors = watchConsole(page), writes: string[] = [], owners: Array<string | undefined> = []; let requests = 0;
  await page.clock.setFixedTime(new Date('2026-10-29T10:00:00Z')); await page.emulateMedia({ reducedMotion: 'reduce' });
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 430, height: 900 });
  const value = marketingStateFixture(), row = value.revisions[0]; row.ready = true; row.revision.format = 'reel';
  row.revision.assets = [{ url: 'https://example.supabase.co/storage/v1/object/sign/test/review-clip.mp4', sha256: 'd'.repeat(64), mimeType: 'video/mp4', width: 32, height: 32, alt: 'Local codec test clip' }];
  await page.route('**/api/marketing/state', route => { owners.push(route.request().headers()['x-own-dashboard-owner']); return route.fulfill({ json: value }); });
  page.on('request', request => { if (request.url().includes('/api/marketing/') && request.method() !== 'GET') writes.push(request.url()); });
  await gotoPreview(page, { lang, theme });
  await page.route('https://example.supabase.co/storage/v1/object/sign/test/review-clip.mp4', route => { requests++; return route.fulfill({ contentType: 'video/mp4', body: clip }); });
  await page.goto('/dev-preview?tab=marketing&marketingState=live');
  const workspace = page.getByTestId('marketing-workspace'), video = workspace.locator('video'); await expect(video).toHaveCount(1); await expect(workspace.locator('article img')).toHaveCount(0);
  await video.scrollIntoViewIfNeeded();
  expect(await video.evaluate(element => (element as HTMLVideoElement).canPlayType('video/mp4; codecs="avc1.42E01E"'))).not.toBe('');
  try { await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2); } catch (error) {
   await info.attach('decoder-probe', { contentType: 'application/json', body: JSON.stringify(await video.evaluate(element => { const media = element as HTMLVideoElement; return { readyState: media.readyState, networkState: media.networkState, currentSrc: media.currentSrc, error: media.error && { code: media.error.code, message: media.error.message }, h264: media.canPlayType('video/mp4; codecs="avc1.42E01E"') }; })) }); throw error;
  }
  expect(await video.evaluate(element => { const media = element as HTMLVideoElement; return { controls: media.controls, autoplay: media.autoplay, paused: media.paused, preload: media.preload, inline: media.playsInline }; })).toEqual({ controls: true, autoplay: false, paused: true, preload: 'metadata', inline: true });
  await expect(video).toHaveAccessibleName('Local codec test clip');
  await video.focus(); await video.press('Space'); await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
  await video.evaluate(element => (element as HTMLVideoElement).pause());
  expect((await new AxeBuilder({ page: page as unknown as AxePage }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(requests).toBeGreaterThan(0); expect(owners).toEqual([stateOwner]); expect(writes).toEqual([]); expect(errors).toEqual([]);
 });
}
