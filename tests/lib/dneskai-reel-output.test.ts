import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { FileHandle } from 'node:fs/promises';
const hooks = vi.hoisted(() => ({ wrap: vi.fn() }));
vi.mock('node:fs/promises', async (original) => {
    const actual = await original<typeof import('node:fs/promises')>();
    return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
            const handle = await actual.open(...args);
            hooks.wrap(handle, args[0]);
            return handle;
        } };
});
beforeEach(() => {hooks.wrap.mockReset();});
import { renderDneskaiReel } from '@/lib/marketing/dneskai-reel-render';
const fixtures: string[] = [];
let slide: Buffer;
beforeAll(async () => {
    slide = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#2050e0' } }).jpeg().toBuffer();
});
afterAll(() => {
    for (const fixture of fixtures)
        rmSync(fixture, { recursive: true, force: true });
});
function encoder(size: number) {
    const dir = mkdtempSync(path.join(tmpdir(), 'audit-reel-output-'));
    fixtures.push(dir);
    const binary = path.join(dir, 'encoder.cjs'), receipt = path.join(dir, 'output-path.txt');
    writeFileSync(binary, '#!/usr/bin/env node\nconst fs=require("node:fs"),output=process.argv.at(-1);fs.writeFileSync(' + JSON.stringify(receipt) + ',output);fs.writeFileSync(output,"");fs.truncateSync(output,' + size + ');\n', { mode: 0o755 });
    return { binary, receipt };
}
it.each([0, 64 * 1024 * 1024 + 1])('refuses a successful encoder file outside the output bound: %s', async (size) => {
    const fixture = encoder(size);
    expect(await renderDneskaiReel({ slides: [slide], audio: null, ffmpegPath: fixture.binary }).then(() => 'unexpected-success', error => error.code)).toBe('reel-encode-failed');
    expect(existsSync(path.dirname(readFileSync(fixture.receipt, 'utf8')))).toBe(false);
});
it('rejects oversized audio before creating frames or starting the encoder', async () => {
    const fixture = encoder(1);
    expect(await renderDneskaiReel({ slides: [slide], audio: { id: '11111111-1111-4111-8111-111111111111', bytes: Buffer.alloc(20 * 1024 * 1024 + 1) }, ffmpegPath: fixture.binary }).then(() => 'unexpected-success', error => error.code)).toBe('reel-input-invalid');
    expect(existsSync(fixture.receipt)).toBe(false);
});
it('accepts the exact output ceiling using bounded read operations', async () => {
    let maximumRead = 0;
    hooks.wrap.mockImplementation((handle: FileHandle) => {
        const read = handle.read.bind(handle);
        vi.spyOn(handle, 'read').mockImplementation(((...args: unknown[]) => {
            maximumRead = Math.max(maximumRead, Number(args[2]));
            return read(...args as Parameters<typeof read>);
        }) as never);
    });
    const fixture = encoder(64 * 1024 * 1024), result = await renderDneskaiReel({ slides: [slide], audio: null, ffmpegPath: fixture.binary });
    expect(result.bytes.length).toBe(64 * 1024 * 1024);
    expect(maximumRead).toBe(1024 * 1024);
});
it('refuses an output that grows after its initial size check', async () => {
    let changed = false;
    hooks.wrap.mockImplementation((handle: FileHandle, file: string) => {
        const read = handle.read.bind(handle);
        vi.spyOn(handle, 'read').mockImplementation(((...args: unknown[]) => {
            if (!changed) {
                changed = true;
                appendFileSync(file, 'x');
            }
            return read(...args as Parameters<typeof read>);
        }) as never);
    });
    const fixture = encoder(100);
    await expect(renderDneskaiReel({ slides: [slide], audio: null, ffmpegPath: fixture.binary })).rejects.toMatchObject({ code: 'reel-encode-failed', message: 'reel-encode-failed' });
    expect(changed).toBe(true);
});
it('retires a stalled read and removes only its owned temporary output', async () => {
    const controller = new AbortController();
    let started = false;
    hooks.wrap.mockImplementation((handle: FileHandle) => {
        vi.spyOn(handle, 'read').mockImplementation((() => {
            started = true;
            return new Promise(() => {
            });
        }) as never);
    });
    const fixture = encoder(100), pending = renderDneskaiReel({ slides: [slide], audio: null, ffmpegPath: fixture.binary, signal: controller.signal }).catch(error => error);
    await vi.waitFor(() => expect(started).toBe(true), { timeout: 2000 });
    controller.abort('TEST_ONLY_PRIVATE_REASON');
    expect(await pending).toMatchObject({ code: 'reel-timeout', message: 'reel-timeout' });
    expect(existsSync(path.dirname(readFileSync(fixture.receipt, 'utf8')))).toBe(false);
});
