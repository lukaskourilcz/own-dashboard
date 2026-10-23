/** Static artifact validation only. Browser proof is collected through Chrome/Cua. */
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
const root=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(root,'../../..');
const data=JSON.parse(await readFile(path.join(root,'plan-data.json'),'utf8'));
const loaded=JSON.parse((await readFile(path.join(root,'plan-data.js'),'utf8')).replace(/^window\.AUDIT_DATA = /,'').replace(/;\s*$/,''));
assert.deepEqual(loaded,data,'Browser and readable data differ');
assert.equal(data.components.length,155); assert.equal(data.areas.length,27); assert.equal(data.spots.length,8); assert.equal(data.code.length,7);
const byId=new Map(data.evidence.map(e=>[e.id,e])); assert.equal(byId.size,data.evidence.length);
for(const e of data.evidence) for(const file of [e.image,e.dom,e.metrics]) await access(path.join(root,file));
for(const component of data.components) await access(path.join(repo,component.path));
for(const spot of data.spots) {
 assert(byId.has(spot.evidence));
 const source=await readFile(path.join(repo,spot.path),'utf8'); assert(spot.line>0&&spot.line<=source.split('\n').length);
 for(const h of spot.hotspots) assert(h.x>=0&&h.y>=0&&h.x+h.w<=100&&h.y+h.h<=100);
}
for(const area of data.areas) assert(byId.has(area.evidence));
const pages=['index.html','code-review.html','ux-audit.html','validation.html'];
const parsed=new Map();
for(const name of pages) {
 const window=new Window(); window.document.write(await readFile(path.join(root,name),'utf8')); const document=window.document;
 assert.equal(document.querySelectorAll('h1').length,1,`${name}: single document title`);
 const ids=[...document.querySelectorAll('[id]')].map(e=>e.id);assert.equal(ids.length,new Set(ids).size,`${name}: duplicate IDs`);
 parsed.set(name,document);
 for(const element of document.querySelectorAll('[href],[src]')) {
  const ref=element.getAttribute('href')??element.getAttribute('src');
  if(!ref||/^(https?:|data:)/.test(ref))continue;
  const [file]=ref.split('#');if(file)await access(path.resolve(root,file));
 }
}
for(const item of data.code)assert(parsed.get('code-review.html').getElementById(item.id.toLowerCase()));
assert((await readFile(path.join(root,'plan.js'),'utf8')).includes('assets/existing-fixture-slide.png'));await access(path.join(root,'assets/existing-fixture-slide.png'));
console.log(JSON.stringify({result:'pass',applicationCaptures:data.evidence.length,componentPaths:data.components.length,destinations:data.areas.length,visualTreatments:data.spots.length,codeFindings:data.code.length,readingPages:pages.length,checks:['local references','source paths and lines','unique IDs','code anchors','highlight bounds','browser data parity']}));
