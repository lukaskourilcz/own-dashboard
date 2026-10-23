import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const routes = ['tick', 'revisions', 'jobs/[id]/execute', 'dneskai/media', 'n8n', 'offline-import', 'dneskai/render-reel', 'dneskai/audio'];

async function check(addonPlatform: string, libraryPlatform: string, libraryName: string, omitLibrary = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'render-trace-check-'));
  try {
    await mkdir(path.join(root, 'scripts'));
    await copyFile('scripts/check-render-traces.mjs', path.join(root, 'scripts/check-render-traces.mjs'));
    const library = `node_modules/@img/sharp-libvips-${libraryPlatform}/lib/${libraryName}`;
    const files = [
      `node_modules/@img/sharp-${addonPlatform}/lib/sharp-${addonPlatform}-0.35.5.node`,
      library,
      'vendor/carousel-studio/fonts/test.ttf',
      'node_modules/ffmpeg-static/ffmpeg',
    ];
    for (const file of files) {
      if (omitLibrary && file === library) continue;
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), 'fixture');
    }
    for (const route of routes) {
      const trace = path.join(root, '.next/server/app/api/marketing', route, 'route.js.nft.json');
      await mkdir(path.dirname(trace), { recursive: true });
      await writeFile(trace, JSON.stringify({ files: files.map(file => path.relative(path.dirname(trace), path.join(root, file))) }));
    }
    return spawnSync(process.execPath, [path.join(root, 'scripts/check-render-traces.mjs')], {
      encoding: 'utf8', timeout: 10_000, env: { PATH: process.env.PATH, NODE_ENV: "test" },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('native render trace checker platform boundaries', () => {
  it.each([
    ['linux-x64', 'libvips-cpp.so.8.18.7'],
    ['linuxmusl-arm64', 'libvips-cpp.so.8.18.7'],
    ['darwin-arm64', 'libvips-cpp.8.18.7.dylib'],
  ])('accepts complete matching %s packages', async (platform, name) => {
    const result = await check(platform, platform, name);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('all 8 marketing render routes');
  });

  it.each([
    ['linux-x64', 'darwin-arm64', 'libvips-cpp.8.18.7.dylib', false],
    ['darwin-arm64', 'darwin-arm64', 'libvips-cpp.so.8.18.7', false],
    ['linux-x64', 'linux-x64', 'libvips-cpp.8.18.7.dylib', false],
    ['linux-x64', 'linux-x64', 'libvips-cpp.so.8.18.7', true],
  ])('rejects mismatched formats, platforms and absent files (%s / %s / %s / %s)', async (addon, library, name, missing) => {
    const result = await check(addon, library, name, missing);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('8 of 8 marketing routes');
  });
});
