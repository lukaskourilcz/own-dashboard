import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { DEMO_DNESKAI_AUDIO_TRACKS } from '../src/lib/marketing/dneskai-audio-client';
import { dneskaiAudio } from '../src/lib/i18n/sections/dneskai-audio';
import { dneskaiSourceList } from '../src/lib/i18n/sections/dneskai-source-list';
import { DNESKAI_AUDIO_PREVIEW_STARTUP_MS } from '../src/lib/marketing/dneskai-audio-contracts';

// Invented silent PCM only; no downloaded track, credential or provider call.
function silentWav() {
  const length = 30 * 8000 * 2, data = Buffer.alloc(44 + length);
  data.write('RIFF'); data.writeUInt32LE(36 + length, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(length, 40); return data;
}
type AudioWindow = Window & { auditAudio: HTMLAudioElement[] };
for (const lang of ['en', 'cs'] as const) {
  test(`${lang}: native Music preview recovers an expired link and disposes on stop and navigation`, async ({ page }, info) => {
    const errors = watchConsole(page), t = dneskaiAudio[lang];
    await page.addInitScript(() => {
      const NativeAudio = window.Audio, state = window as unknown as AudioWindow;
      state.auditAudio = [];
      window.Audio = new Proxy(NativeAudio, { construct(target, args) {
        const audio = Reflect.construct(target, args) as HTMLAudioElement;
        audio.muted = true; state.auditAudio.push(audio); return audio;
      } });
    });
    await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
    let reads = 0, writes = 0, mediaReads = 0, fresh = false, delayedFresh = false;
    let releaseRefresh: (() => void) | undefined;
    await page.route('**/api/marketing/dneskai/audio', async route => {
      if (route.request().method() !== 'GET') { writes++; return route.fulfill({ status: 405, json: {} }); }
      reads++;
      if (fresh) await new Promise<void>(resolve => { releaseRefresh = resolve; });
      return route.fulfill({ json: { tracks: [{ ...DEMO_DNESKAI_AUDIO_TRACKS[0]!, previewUrl: `https://test-only.supabase.co/audio-preview-${fresh ? "fresh" : "expired"}.wav` }], trends: [], nextOffset: null } });
    });
    await page.route('https://test-only.supabase.co/audio-preview-*.wav', async route => {
      mediaReads++;
      // A valid response can take longer than the assertion default while
      // remaining inside the application's existing ten-second startup limit.
      if (route.request().url().endsWith('-fresh.wav') && !delayedFresh) {
        delayedFresh = true; await new Promise(resolve => setTimeout(resolve, 6_000));
      }
      return route.request().url().endsWith('-expired.wav') ? route.fulfill({ status: 403, body: '' })
        : route.fulfill({ status: 200, contentType: 'audio/wav', body: silentWav() });
    });
    const response = await page.goto('/dev-preview?project=dneskai&projectTab=sources&sourceSection=music&music=live');
    const mediaPolicy = response!.headers()['content-security-policy']!.split(';').map(value => value.trim()).find(value => value.startsWith('media-src '));
    expect(mediaPolicy).toBe("media-src 'self' https://*.supabase.co");
    const music = page.getByTestId('dneskai-audio-library');
    await expect(music.getByTestId('dneskai-audio-track')).toHaveCount(1);
    expect(mediaReads).toBe(0); expect(await page.evaluate(() => (window as unknown as AudioWindow).auditAudio.length)).toBe(0);
    await music.getByRole('button', { name: t.play('Quiet Circuit'), exact: true }).click();
    await expect(music.getByRole('alert')).toHaveText(t.previewFailed);
    await expect(music.getByRole('button', { name: t.retryPreview('Quiet Circuit'), exact: true })).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => (window as unknown as AudioWindow).auditAudio.every(audio => audio.paused && audio.getAttribute('src') === null))).toBe(true);
    for (const width of [360, 430, 768, 1024, 1440, 1728]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    await page.setViewportSize({ width: info.project.name === 'mobile' ? 360 : 1440, height: 900 });
    expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('[data-testid="dneskai-audio-library"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
    if (lang === 'cs') await music.screenshot({ path: `/tmp/app-audit-audio-preview-error-cs-${info.project.name}.png` });
    const beforeRefresh = reads; fresh = true;
    await music.getByRole('button', { name: t.refreshPreview, exact: true }).click();
    await expect.poll(() => reads).toBe(beforeRefresh + 1);
    const play = music.getByRole('button', { name: t.play('Quiet Circuit'), exact: true });
    await expect(play).toBeDisabled();
    releaseRefresh!();
    await expect(play).toBeEnabled();
    await play.click();
    const stop = music.getByRole('button', { name: t.stop('Quiet Circuit'), exact: true });
    await expect(stop).toHaveAttribute('aria-pressed', 'true', { timeout: DNESKAI_AUDIO_PREVIEW_STARTUP_MS + 1000 });
    expect(await page.evaluate(() => {
      const audio = (window as unknown as AudioWindow).auditAudio.at(-1)!;
      return audio.preload === 'none' && !audio.paused && audio.currentSrc.endsWith('-fresh.wav');
    })).toBe(true);
    await stop.click(); await expect(play).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => (window as unknown as AudioWindow).auditAudio.every(audio => audio.paused && audio.getAttribute('src') === null))).toBe(true);
    await play.click(); await expect(stop).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('tab', { name: dneskaiSourceList[lang].title, exact: true }).click();
    await expect(music).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as AudioWindow).auditAudio.every(audio => audio.paused && audio.getAttribute('src') === null))).toBe(true);
    expect(writes).toBe(0);
    expect(errors.filter(error => !(error.includes('403') && error.includes('audio-preview-expired.wav')))).toEqual([]);
  });
}
