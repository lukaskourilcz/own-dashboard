import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { probeDneskaiAudioDuration } from '@/lib/marketing/dneskai-audio';
vi.mock('server-only', () => ({}));
const children = vi.hoisted(() => new Map<string, import('node:child_process').ChildProcess>());
vi.mock('node:child_process', async original => {
  const actual = await original<typeof import('node:child_process')>();
  return {...actual, spawn: (...args: Parameters<typeof actual.spawn>) => {
    const child = actual.spawn(...args);
    children.set(String(args[0]), child);
    return child;
  }};
});

let folder: string;
beforeAll(async () => { folder = await mkdtemp(path.join(tmpdir(), 'audio-probe-fixture-')); });
afterAll(async () => { await rm(folder, { recursive: true, force: true }); });
async function childFixture(name: string) {
  const script = path.join(folder, `${name}.sh`), pidFile = path.join(folder, `${name}.pid`);
  const quoted = "'" + pidFile.replaceAll("'", "'\"'\"'") + "'";
  await writeFile(script, `#!/bin/sh\nprintf '%s' "$$" > ${quoted}\ntrap '' TERM\nprintf '%s\\n' 'Duration: 00:01:00.00' ' Stream #0:0: Audio: mp3' >&2\nwhile :; do :; done\n`); await chmod(script, 0o700);
  return { script, pidFile };
}
function expectStopped(script: string) {
  const pid = children.get(script)?.pid; expect(Number.isSafeInteger(pid)).toBe(true);
  if (pid === undefined) throw new Error('Fixture child did not spawn');
  expect(() => process.kill(pid, 0)).toThrow();
}
describe('bounded local audio probing', () => {
  it.each(['mp3', 'wav', 'ogg', 'aac', 'm4a'])('probes and decodes a real %s file', async extension => {
    const file = path.join(folder, `fixture.${extension}`);
    execFileSync(ffmpeg as unknown as string, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-y', file]);
    const duration = await probeDneskaiAudioDuration(await readFile(file)); expect(duration).toBeGreaterThan(1900); expect(duration).toBeLessThan(2300);
  });
  it('does not mistake a metadata title for the measured duration', async () => {
    const file = path.join(folder, 'metadata.mp3');
    execFileSync(ffmpeg as unknown as string, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-metadata', 'title=Duration: 00:10:00.00', '-y', file]);
    const duration = await probeDneskaiAudioDuration(await readFile(file)); expect(duration).toBeGreaterThan(1900); expect(duration).toBeLessThan(2300);
  });
  it('kills a stalled decoder even when it prints plausible metadata and ignores SIGTERM', async () => {
    const { script } = await childFixture('timeout'), start = performance.now();
    await expect(probeDneskaiAudioDuration(Buffer.from('fixture'), { ffmpegPath: script, timeoutMs: 1500 })).rejects.toMatchObject({ code: 'audio-library-unavailable' });
    expect(performance.now() - start).toBeLessThan(4000); expectStopped(script);
  });
  it('kills a decoder on caller cancellation and does not expose the abort reason', async () => {
    const { script, pidFile } = await childFixture('abort'), controller = new AbortController();
    const pending = probeDneskaiAudioDuration(Buffer.from('fixture'), { ffmpegPath: script, signal: controller.signal });
    const outcome = pending.then(() => ({ name: 'unexpected-success', message: '' }), error => ({ name: error.name, message: error.message }));
    try {
      // Readiness may take longer than Vitest's default one-second polling window.
      // This changes only the fixture wait, within the unchanged 15-second probe cap.
      await vi.waitFor(async () => expect(await readFile(pidFile, 'utf8')).toMatch(/^\d+$/), {timeout:4000});
      controller.abort(new Error('synthetic-private-abort-reason'));
      expect(await outcome).toEqual({name:'AbortError',message:'Request aborted'});
      expectStopped(script);
    } finally {
      // A failed readiness assertion must still reap the fixture child.
      controller.abort();
      await outcome;
    }
  });
  it('refuses unsupported playlists even when they refer to a valid local audio file', async () => {
    const file = path.join(folder, 'local.wav'); execFileSync(ffmpeg as unknown as string, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-y', file]);
    expect(await probeDneskaiAudioDuration(Buffer.from(`ffconcat version 1.0\nfile '${file}'\n`))).toBeNull();
  });
  it('refuses empty, oversized and already-cancelled input before starting a child', async () => {
    expect(await probeDneskaiAudioDuration(Buffer.alloc(0), { ffmpegPath: '/not-a-fixture-binary' })).toBeNull();
    expect(await probeDneskaiAudioDuration(Buffer.alloc(20 * 1024 * 1024 + 1), { ffmpegPath: '/not-a-fixture-binary' })).toBeNull();
    const controller = new AbortController(); controller.abort(); await expect(probeDneskaiAudioDuration(Buffer.from('fixture'), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('reports an unavailable executable without hanging or trusting partial output', async () => {
    await expect(probeDneskaiAudioDuration(Buffer.from('fixture'), { ffmpegPath: path.join(folder, 'absent') })).rejects.toMatchObject({ code: 'audio-library-unavailable' });
  });
});
