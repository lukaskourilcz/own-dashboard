import { cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const libvipsInclude = './node_modules/@img/sharp-libvips-*/lib/**/*';
async function configuredIncludes() {
  // Inspect config syntax only; never evaluate its environment/Sentry branches.
  const source = ts.createSourceFile('next.config.ts', await readFile('next.config.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  let object: ts.ObjectLiteralExpression | undefined;
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'outputFileTracingIncludes' && ts.isObjectLiteralExpression(node.initializer)) object = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  const includes: Record<string, string[]> = {};
  for (const property of object?.properties ?? []) {
    if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.name) || !ts.isArrayLiteralExpression(property.initializer)) continue;
    includes[property.name.text] = property.initializer.elements.filter(ts.isStringLiteral).map(value => value.text);
  }
  return includes;
}
function probeResult(result: Pick<SpawnSyncReturns<string>, 'status' | 'signal' | 'error' | 'stdout'>, missingLibraryExpected = false) {
  // A native loader may terminate instead of throwing JS. Only the negative probe may normalize that.
  expect(result.error).toBeUndefined();
  if (missingLibraryExpected && (result.status !== 0 || result.signal !== null)) return { loaded: false };
  expect(result.status).toBe(0); expect(result.signal).toBeNull();
  return JSON.parse(result.stdout) as { loaded: boolean; cjsCallable?: boolean; esmCallable?: boolean; format?: string; width?: number; height?: number };
}
function probe(directory: string, missingLibraryExpected = false) {
  // Both official exports must load; encode an actual 1px JPEG without inherited keys, hooks or network.
  const script = `(async()=>{try{const cjs=require("sharp"),esm=(await import("sharp")).default;if(typeof cjs!=="function"||typeof esm!=="function")return console.log(JSON.stringify({loaded:false}));const bytes=await esm({create:{width:1,height:1,channels:3,background:{r:0,g:0,b:0}}}).jpeg().toBuffer();const info=await esm(bytes).metadata();console.log(JSON.stringify({loaded:true,cjsCallable:true,esmCallable:true,format:info.format,width:info.width,height:info.height}));}catch{console.log(JSON.stringify({loaded:false}));}})();`;
  const result = spawnSync(process.execPath, ['-e', script], { cwd: directory, env: { PATH: process.env.PATH, NODE_ENV: 'test' }, encoding: 'utf8', timeout: 10000 });
  return probeResult(result, missingLibraryExpected);
}
describe('marketing native JPEG runtime package closure, no provider/source/credential access', () => {
  it('normalizes only negative native exits/signals; positive probes and failed spawning stay strict', () => {
    for (const failure of [{ status: 1, signal: null }, { status: null, signal: 'SIGABRT' as const }]) {
      const result = { ...failure, stdout: 'TEST-ONLY-NATIVE-ERROR-NOT-PARSED' };
      expect(probeResult(result, true)).toEqual({ loaded: false });
      expect(() => probeResult(result)).toThrow();
    }
    expect(() => probeResult({ status: null, signal: null, stdout: '', error: new Error('TEST-ONLY-SPAWN-FAILED') }, true)).toThrow();
  });
  it('requires libvips runtime assets omitted by the observed NFT and includes them only on the rendering and JPEG-import routes', async () => {
    const includes = await configuredIncludes();
    const routes = Object.entries(includes).filter(([, patterns]) => patterns.includes(libvipsInclude)).map(([route]) => route).sort();
    expect(routes).toEqual(['/api/marketing/jobs/*/execute', '/api/marketing/n8n', '/api/marketing/offline-import']);
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'marketing-native-package-test-'));
    try {
      const installed = path.resolve('node_modules'), target = path.join(temporary, 'node_modules');
      await mkdir(target);
      for (const name of ['sharp', 'detect-libc']) await cp(path.join(installed, name), path.join(target, name), { recursive: true });
      const imagePackages = await readdir(path.join(installed, '@img'));
      const binaries: { root: string; name: string; binary: string }[] = [];
      for (const name of imagePackages.filter(value => value === 'colour' || value.startsWith('sharp-'))) {
        const root = path.join(installed, '@img', name);
        if (name.startsWith('sharp-libvips-')) {
          const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
          const binary: unknown = manifest.exports?.['./binary'];
          expect(typeof binary).toBe('string');
          if (typeof binary !== 'string') throw new Error('test-native-package-contract-invalid');
          binaries.push({ root, name, binary });
          // Reproduce the observed tracing omission, keeping public package metadata/support files.
          await cp(root, path.join(target, '@img', name), { recursive: true, filter: source => source !== path.resolve(root, binary) });
        } else await cp(root, path.join(target, '@img', name), { recursive: true });
      }
      expect(binaries.length).toBeGreaterThan(0);
      expect(probe(temporary, true)).toEqual({ loaded: false });
      // Materialize the configured, platform-neutral library-directory include.
      for (const entry of binaries) await cp(path.join(entry.root, 'lib'), path.join(target, '@img', entry.name, 'lib'), { recursive: true });
      expect(probe(temporary)).toEqual({ loaded: true, cjsCallable: true, esmCallable: true, format: 'jpeg', width: 1, height: 1 });
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }, 20000);
});
