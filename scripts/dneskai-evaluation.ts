import { readFile, writeFile } from 'node:fs/promises';
import { evaluateDneskaiSelection } from '../src/lib/marketing/dneskai-evaluation';

async function main() {
  const [input, output, extra] = process.argv.slice(2);
  if (!input || !output || extra) throw new Error('Usage: INPUT_JSON OUTPUT_JSON');
  const bytes = await readFile(input);
  if (bytes.length > 4_000_000) throw new Error('Input exceeds the offline evaluation limit');
  const report = evaluateDneskaiSelection(JSON.parse(bytes.toString('utf8')));
  await writeFile(output, JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ sampleSize: report.sampleSize, correct: report.correct, abstentions: report.abstentions, providerCalls: 0 }));
}
main().catch(() => { console.error('Offline evaluation failed; input/output paths and content are withheld.'); process.exitCode = 1; });
