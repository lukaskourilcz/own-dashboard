/** Local synthetic cleaner comparison, not an application latency benchmark. */
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
const output = process.argv[2];
if (!output) throw new Error('Pass a JSON evidence destination.');
const suffix = value => value.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').slice(0, 12000);
const before = value => suffix(value.replace(/<[^>]*>/g, ' '));
const after = value => suffix(value.replace(/<[^>]*(?:>|$)/g, tag => tag.endsWith('>') ? ' ' : tag));
const examples = ['React <b>TypeScript</b>', 'React <broken', 'React <> &amp; Node&nbsp;js', 'React <a<b> TypeScript'];
const malformed = 'React ' + '<'.repeat(24000);
for (const value of [...examples, malformed]) if (before(value) !== after(value)) throw new Error('Output changed.');
function measure(clean, rounds) {
 clean(malformed);
 const samples = [];
 for (let run = 0; run < rounds; run++) {
  const start = performance.now(); clean(malformed); samples.push(performance.now() - start);
 }
 return samples.sort((a,b) => a-b)[Math.floor(samples.length / 2)];
}
const evidence = {
 method:'Synthetic 24,006-character input within the 100,000-character raw description bound; equal 12,000-character output; median of five isolated cleaner calls after one warmup. Concurrent local verification may affect timings.',
 node:process.version,inputCharacters:malformed.length,outputCharacters:after(malformed).length,
 legacyMilliseconds:measure(before,5),linearMilliseconds:measure(after,5),
 limitation:'This compares only the exact legacy/replacement cleanup expressions. It does not measure the complete normalizer, network, production latency or billing.',
};
writeFileSync(output, JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence));
