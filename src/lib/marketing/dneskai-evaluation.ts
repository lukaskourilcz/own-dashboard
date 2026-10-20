import { z } from 'zod';
import { DneskaiCandidateSchema } from './dneskai-contracts';
import { contentHash } from './hashes';

const expectation = z.strictObject({
  id: z.string().min(1).max(200),
  expected: z.enum(['eligible', 'insufficient', 'out-of-scope', 'duplicate']),
  duplicateOf: z.string().min(1).max(200).optional(),
}).refine(row => row.expected === 'duplicate' ? Boolean(row.duplicateOf) : row.duplicateOf === undefined);
const inputSchema = z.strictObject({
  schemaVersion: z.literal('dneskai-evaluation/1'),
  labelAuthority: z.enum(['agent', 'owner-declared']),
  expectations: z.array(expectation).min(1).max(200),
  predictions: z.array(DneskaiCandidateSchema).min(1).max(200),
}).superRefine((input, context) => {
  const expected = new Set(input.expectations.map(row => row.id));
  const actual = new Set(input.predictions.map(row => row.id));
  if (expected.size !== input.expectations.length || actual.size !== input.predictions.length
    || expected.size !== actual.size || [...expected].some(id => !actual.has(id))) {
    context.addIssue({ code: 'custom', message: 'Evaluation IDs must match exactly', path: ['predictions'] });
  }
});

/** Offline scoring only. Labels are declared judgments, never publication approval. */
export function evaluateDneskaiSelection(value: unknown) {
  const input = inputSchema.parse(value);
  const predictions = new Map(input.predictions.map(row => [row.id, row]));
  let acceptedTrue = 0, acceptedFalse = 0, relevant = 0, duplicates = 0, duplicateCorrect = 0;
  const cases = input.expectations.map(label => {
    const row = predictions.get(label.id)!;
    const accepted = row.status === 'new' || row.status === 'selected';
    if (label.expected === 'eligible') { relevant++; if (accepted) acceptedTrue++; }
    else if (accepted) acceptedFalse++;
    if (label.expected === 'duplicate') duplicates++;
    const correct = label.expected === 'eligible' ? accepted
      : label.expected === 'insufficient' ? row.status === 'held'
      : label.expected === 'out-of-scope' ? row.status === 'rejected'
      : row.status === 'duplicate' && row.duplicateOf === label.duplicateOf;
    if (label.expected === 'duplicate' && correct) duplicateCorrect++;
    return {
      caseHash: contentHash({ id: row.id, contentHash: row.contentHash }),
      expected: label.expected, actual: row.status, correct,
      abstained: row.status === 'held' && label.expected !== 'insufficient',
    };
  });
  return {
    schemaVersion: 'dneskai-evaluation-report/1' as const,
    labelAuthority: input.labelAuthority,
    // Neither a declared owner label nor a score verifies source facts.
    factVerification: false, publicationApproval: false, providerCalls: 0,
    datasetHash: contentHash(input.expectations.map(label => ({ ...label, contentHash: predictions.get(label.id)!.contentHash }))),
    sampleSize: cases.length, correct: cases.filter(row => row.correct).length,
    abstentions: cases.filter(row => row.abstained).length,
    acceptedTrue, acceptedFalse,
    acceptedPrecision: acceptedTrue + acceptedFalse ? acceptedTrue / (acceptedTrue + acceptedFalse) : null,
    relevantRecall: relevant ? acceptedTrue / relevant : null,
    duplicateRecall: duplicates ? duplicateCorrect / duplicates : null,
    cases,
  };
}
