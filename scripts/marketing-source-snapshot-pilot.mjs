/** Read-only local producer + actual DB deletion snapshot proof. No network, model, storage or publication. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire, builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ownRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  assert(['--producer-repo', '--overrides', '--output', '--question-id', '--task-id'].includes(args[i]) && args[i + 1], 'Expected named options with a value');
  options[args[i].slice(2)] = args[i + 1];
}
assert(options['producer-repo'] && options.overrides && options.output, 'Required: --producer-repo --overrides --output');
const producerRepo = path.resolve(options['producer-repo']);
const output = path.resolve(options.output);
const snapshotBytes = await readFile(path.resolve(options.overrides));
const snapshot = JSON.parse(snapshotBytes.toString('utf8'));
assert(snapshot.projectId === 'rvlybcjdpafwyeuojvhl' && Number.isFinite(Date.parse(snapshot.readAt)), 'Expected actual devShark DB observation metadata');
assert(Array.isArray(snapshot.rows) && snapshot.rows.length > 0 && snapshot.rows.every(row => row.deleted === true && row.is_custom === false && typeof row.question_id === 'string'), 'This bounded proof accepts only the verified complete all-deleted override snapshot');
assert(new Set(snapshot.rows.map(row => row.question_id)).size === snapshot.rows.length, 'Duplicate override IDs');
const producerCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: producerRepo, encoding: 'utf8' }).trim();
assert(!execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: producerRepo, encoding: 'utf8' }).trim(), 'Producer tracked files must match the recorded commit');
const work = await mkdtemp(path.join(tmpdir(), 'marketing-pilot-runtime-'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const absolutePackages = {
  name: 'absolute-external-packages',
  setup(builder) {
    builder.onResolve({ filter: /^[^./]/ }, args => {
      if (args.path.startsWith('node:') || builtinModules.includes(args.path)) return { path: args.path, external: true };
      return { path: createRequire(args.importer || path.join(args.resolveDir, 'package.json')).resolve(args.path), external: true };
    });
  },
};
async function compile(name, contents, repo) {
  const outfile = path.join(work, `${name}.cjs`);
  await build({ stdin: { contents, resolveDir: repo, sourcefile: `${name}.ts`, loader: 'ts' }, outfile, bundle: true, platform: 'node', format: 'cjs', target: 'node22', plugins: [absolutePackages], logLevel: 'silent' });
  return createRequire(import.meta.url)(outfile);
}
const network = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Network forbidden in local snapshot proof'); };
try {
  const producer = await compile('producer', `export { buildMarketingQuestionSnapshot } from './lib/questions-store'; export { loadWebdevQuestions } from './lib/webdev-bank'; export { questionPacket, codingPacket } from './lib/marketing/source'; export { ACTIVE_CODING_TASKS } from './lib/coding/active';`, producerRepo);
  const consumer = await compile('consumer', `export { parseSourcePacket, parseContentRevision } from './src/lib/marketing/contracts'; export { contentHash } from './src/lib/marketing/hashes'; export { authoredMarketingText, authoredCodingChallenge } from './src/lib/marketing/generation'; export { pendingMarketingTemplate, renderMarketingPreview } from './src/lib/marketing/render';`, ownRepo);
  const bank = await producer.loadWebdevQuestions();
  // Missing authored fields are safe only because every observed override is a deletion.
  // The actual producer merge preserves their base content but always withholds those IDs.
  const effective = producer.buildMarketingQuestionSnapshot(bank, snapshot.rows);
  const candidates = effective.filter(row => row.question.id !== 'rm-js-1' && row.question.category === 'javascript').map(row => producer.questionPacket(row, snapshot.readAt)).filter(packet => packet?.eligible);
  if (options['question-id']) assert(candidates.some(packet => packet.sourceId === `question:${options['question-id']}`), 'Requested question is not currently eligible');
  const template = consumer.pendingMarketingTemplate('devshark');
  assert(template.approved === false && template.approval === null, 'Read-only preview must not approve the template');
  function previewRevision(source, title, caption) {
    return consumer.parseContentRevision({ schemaVersion: 'marketing-content/1', brand: source.brand, title, caption, format: 'carousel', sources: [{ sourceId: source.sourceId, sourceRevision: source.sourceRevision, contentHash: source.contentHash }], knowledgeIds: [], assets: [], account: { id: 'unconnected-read-only-preview', platform: 'instagram', handle: 'devshark' }, scheduledAt: new Date(Date.parse(snapshot.readAt) + 86400000).toISOString(), timeZone: 'Europe/Prague', templateVersion: template.version, promptVersion: 'authored-read-only-preview/1', model: 'none-read-only-preview', traceId: null });
  }
  function validatePacket(value) {
    const source = consumer.parseSourcePacket(value);
    assert(source.eligible && consumer.contentHash(source.content) === source.contentHash, 'Producer eligibility and shared content hash must validate');
    return source;
  }
  let selected;
  let questionPreview;
  let questionSlides;
  let skippedForLayout = 0;
  for (const candidate of options['question-id'] ? candidates.filter(packet => packet.sourceId === `question:${options['question-id']}`) : candidates) {
    try {
      const source = validatePacket(candidate);
      const slides = [{ headline: source.content.title, body: consumer.authoredMarketingText(source.content.body, source.content.code), code: null, evidenceIndexes: [] }];
      if (source.content.code) slides.push({ headline: 'Code', body: source.content.category, code: source.content.code, evidenceIndexes: [] });
      slides.push({ headline: 'Choose an answer', body: source.content.options.map((option, index) => `${String.fromCharCode(65 + index)}. ${consumer.authoredMarketingText(option, null)}`).join('\n'), code: null, evidenceIndexes: [] });
      slides.push({ headline: 'Authored explanation', body: consumer.authoredMarketingText([source.content.answer, source.content.explanation].filter(Boolean).join('\n\n'), source.content.code), code: null, evidenceIndexes: [] });
      const rendered = await consumer.renderMarketingPreview({ draft: { revision: previewRevision(source, source.content.title, `${source.content.title}\n\n${source.canonicalUrl}`), slides }, template, revisionId: randomUUID() });
      selected = source; questionPreview = rendered; questionSlides = slides; break;
    } catch { skippedForLayout += 1; }
  }
  assert(selected && questionPreview, 'No actual eligible question fits the unchanged template');
  assert(!snapshot.rows.some(row => `question:${row.question_id}` === selected.sourceId), 'Selected question must not have a deletion override');
  const taskId = options['task-id'] ?? 'js-digit-sum';
  const task = producer.ACTIVE_CODING_TASKS.find(task => task.id === taskId);
  assert(task, 'Requested task is not issued by the actual active catalogue');
  const coding = validatePacket(producer.codingPacket(task, true, snapshot.readAt));
  assert(coding.content.answer === null && coding.content.explanation === null, 'No coding answer or solution is exported');
  const challenge = consumer.authoredCodingChallenge(coding);
  const codingPreview = await consumer.renderMarketingPreview({ draft: { revision: previewRevision(coding, challenge.title, challenge.caption), slides: challenge.slides }, template, revisionId: randomUUID() });
  await mkdir(output, { recursive: true, mode: 0o700 });
  for (const [name, source, slides, rendered] of [['question', selected, questionSlides, questionPreview], ['coding-task', coding, challenge.slides, codingPreview]]) {
    await writeFile(path.join(output, `${name}.source.json`), `${JSON.stringify(source, null, 2)}\n`, { mode: 0o600 });
    await writeFile(path.join(output, `${name}.authored-slides.json`), `${JSON.stringify(slides, null, 2)}\n`, { mode: 0o600 });
    for (const [index, preview] of rendered.entries()) await writeFile(path.join(output, `${name}-${index + 1}.jpg`), preview.jpeg, { mode: 0o600 });
  }
  const proof = { proofVersion: 'marketing-local-snapshot-proof/1', mode: 'actual-local-producer-plus-actual-db-snapshot', producedAt: new Date().toISOString(), liveProducerApiVerified: false, publicationEligible: false, databaseSnapshot: { projectId: snapshot.projectId, readAt: snapshot.readAt, rows: snapshot.rows.length, deletedRows: snapshot.rows.filter(row => row.deleted).length, sha256: sha256(snapshotBytes), selectedQuestionOverride: null }, producer: { repository: 'lukaskourilcz/react-express-app', commit: producerCommit, trackedTreeClean: true }, selected: [selected, coding].map(source => ({ sourceId: source.sourceId, sourceRevision: source.sourceRevision, contentHash: source.contentHash, eligible: source.eligible, eligibilityReason: source.eligibilityReason, canonicalUrl: source.canonicalUrl })), readOnlyPreview: { templateVersion: template.version, templateSha256: template.templateSha256, templateApproved: false, providerCalls: 0, storedRevision: false, ownerApproval: false, publishing: false, questionSlides: questionPreview.length, codingSlides: codingPreview.length, skippedQuestionLayouts: skippedForLayout, assets: [...questionPreview.map((preview, index) => ({ file: `question-${index + 1}.jpg`, sha256: preview.sha256 })), ...codingPreview.map((preview, index) => ({ file: `coding-task-${index + 1}.jpg`, sha256: preview.sha256 }))] } };
  await writeFile(path.join(output, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ selectedSourceIds: proof.selected.map(source => source.sourceId), output, databaseSnapshotAt: snapshot.readAt, producerCommit, liveProducerApiVerified: false, publishing: false }));
} finally {
  globalThis.fetch = network;
  await rm(work, { recursive: true, force: true });
}
