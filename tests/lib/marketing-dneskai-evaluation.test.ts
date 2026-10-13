import { describe, expect, it } from 'vitest';
import { evaluateDneskaiSelection } from '@/lib/marketing/dneskai-evaluation';
import type { DneskaiCandidate } from '@/lib/marketing/dneskai-contracts';

function row(id: string, status: DneskaiCandidate['status'], duplicateOf: string | null = null): DneskaiCandidate {
  return { id, status, duplicateOf, sourceId: 'OFFLINE-TEST', externalId: id,
    title: 'PRIVATE TITLE', text: 'PRIVATE SOURCE', url: 'https://example.test/private',
    targetDate: null, publishedAt: '2026-10-13T12:00:00Z', fetchedAt: '2026-10-13T12:00:00Z',
    mediaUrls: [], contentHash: 'a'.repeat(64), category: 'ai-news', relevance: 0.9, reason: null };
}
describe('offline DNESKAi evaluation', () => {
  it('reports false acceptance, conservative abstention and exact duplicate binding without text', () => {
    const result = evaluateDneskaiSelection({ schemaVersion: 'dneskai-evaluation/1', labelAuthority: 'agent',
      expectations: [{id:'1',expected:'eligible'},{id:'2',expected:'eligible'}, {id:'3',expected:'out-of-scope'},
        {id:'4',expected:'duplicate',duplicateOf:'prior'}, {id:'5',expected:'insufficient'}],
      predictions: [row('1','new'),row('2','held'),row('3','new'),row('4','duplicate','wrong-prior'),row('5','held')] });
    expect(result).toMatchObject({ sampleSize:5, correct:2, abstentions:1, acceptedTrue:1, acceptedFalse:1,
      acceptedPrecision:0.5, relevantRecall:0.5, duplicateRecall:0, providerCalls:0, publicationApproval:false });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|example\.test|wrong-prior/);
  });
  it('does not call a zero-denominator metric zero and labels owner judgments as declared', () => {
    const result = evaluateDneskaiSelection({schemaVersion:'dneskai-evaluation/1',labelAuthority:'owner-declared',
      expectations:[{id:'1',expected:'insufficient'}], predictions:[row('1','held')]});
    expect(result).toMatchObject({acceptedPrecision:null,relevantRecall:null,duplicateRecall:null,factVerification:false});
  });
  it.each(['duplicate-label','missing-prediction','duplicate-prediction','wrong-id'])('rejects %s bindings rather than quietly dropping cases', mutation => {
    const expectations = [{id:'1',expected:'eligible'}]; const predictions=[row('1','new')];
    if(mutation==='duplicate-label')expectations.push(expectations[0]);
    if(mutation==='missing-prediction')predictions.length=0;
    if(mutation==='duplicate-prediction')predictions.push(predictions[0]);
    if(mutation==='wrong-id')predictions[0].id='another';
    expect(()=>evaluateDneskaiSelection({schemaVersion:'dneskai-evaluation/1',labelAuthority:'agent',expectations,predictions})).toThrow();
  });
});
