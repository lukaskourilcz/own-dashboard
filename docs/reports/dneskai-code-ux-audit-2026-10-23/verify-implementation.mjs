import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(root, 'implementation.html'), 'utf8');
const validation = JSON.parse(readFileSync(resolve(root, 'implementation-validation.json'), 'utf8'));
const evidence = JSON.parse(readFileSync(resolve(root, 'implementation-evidence.json'), 'utf8'));
assert.equal(validation.releaseChecksPassed, true);
assert.match(validation.applicationCommit, /^[a-f0-9]{7,40}$/);
assert.equal(evidence.length, 22);
assert.equal(new Set(evidence.map(item => item.image)).size, 22);
for (const item of evidence) {
  const raw = readFileSync(resolve(root, item.image));
  assert.equal(raw.subarray(1, 4).toString(), 'PNG');
  assert.equal(raw.readUInt32BE(16), item.width);
  assert.equal(raw.readUInt32BE(20), item.height);
  assert.equal(createHash('sha256').update(raw).digest('hex'), item.sha256);
  assert.ok([360, 1440].includes(item.viewportWidth));
  assert.equal(item.width, item.viewportWidth * item.deviceScaleFactor);
  assert.equal(item.height, item.viewportHeight * item.deviceScaleFactor);
  assert.ok(html.includes(item.image), `Missing capture ${item.image}`);
}
assert.equal((html.match(/<h1(?:\s|>)/g) ?? []).length, 1);
assert.equal((html.match(/class="comparison"/g) ?? []).length, 7);
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, 'Duplicate HTML IDs');
let localLinks = 0;
for (const [, value] of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
  assert.ok(!/^(https?:)?\/\//.test(value), `Unexpected external dependency: ${value}`);
  const [path, anchor] = value.split('#');
  if (path) { assert.ok(existsSync(resolve(root, path)), `Missing local file: ${path}`); localLinks++; }
  else if (anchor) assert.ok(ids.includes(anchor), `Missing anchor: ${anchor}`);
}
console.log(`Verified ${evidence.length} hashed captures, 7 comparisons and ${localLinks} local references.`);
