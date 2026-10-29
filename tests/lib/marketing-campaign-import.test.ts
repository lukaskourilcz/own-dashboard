import { describe,it,expect } from 'vitest';
import { planCampaignImport,pragueScheduledAt } from '@/lib/marketing/campaign-import';
import { readFileSync } from 'node:fs';
const plan={schemaVersion:'marketing-calendar/1',project:'devshark',name:'test-only',launch:'2026-10-04',entries:[{id:'a',date:'2026-10-04',title:'Question',kind:'carousel',platform:'instagram',tipRefs:['A']},{id:'b',date:'2026-11-02',title:'Discount expiry',kind:'post',platform:'threads'},{id:'c',date:'2026-10-05',title:'Completed setup',kind:'task',platform:'web',status:'done'}]};
describe('campaign restart',()=>{
 for(const [file,count] of [['caught-up',139],['marketingshark',156]] as const)it(`preserves every full ${file} record and prelaunch snapshot`,()=>{
  const original=JSON.parse(readFileSync(`fixtures/marketing-calendars/${file}.json`,'utf8'));
  const imported=planCampaignImport(original,'2026-10-18',[]);
  expect(imported.report.inputCount).toBe(count);expect(imported.entries).toHaveLength(count);
  expect(imported.entries.map(entry=>entry.original)).toEqual(original.entries);
  expect(imported.campaign.source_snapshot).toEqual(original);
  expect(imported.campaign.ends_on).toBe('2026-10-24');
  expect(planCampaignImport(original,'2026-10-18',[])).toEqual(imported);
 });
 it('preserves content and fixed/completed dates while moving relative slots',()=>{const r=planCampaignImport(plan,'2026-10-18',[{id:'tip1',title:'A'}]);expect(r.entries.map(e=>e.date)).toEqual(['2026-10-18','2026-11-02','2026-10-05']);expect(r.entries[1].needs_review).toBe(true);expect(r.entries[0].knowledge_ids).toEqual(['tip1']);expect(r.campaign.ends_on).toBe('2026-10-24');expect(r.entries[0].original).toEqual(plan.entries[0]);});
 it('keeps Prague clock time across DST and rejects duplicated clock slots',()=>{expect(pragueScheduledAt('2026-10-18','09:00')).toBe('2026-10-18T07:00:00.000Z');expect(pragueScheduledAt('2026-10-25','09:00')).toBe('2026-10-25T08:00:00.000Z');expect(()=>pragueScheduledAt('2026-10-25','02:30')).toThrow();});
 it('reports ambiguous knowledge links without inventing mappings',()=>{expect(planCampaignImport(plan,'2026-10-18',[{id:'1',title:'A'},{id:'2',title:'a'}]).report.ambiguousTipTitles).toEqual(['A']);});
 it('holds the preserved real devShark dated QOTD and launch-price rows',()=>{
  const original=JSON.parse(readFileSync('fixtures/marketing-calendars/marketingshark.json','utf8'));
  const imported=planCampaignImport(original,'2026-10-18',[]);
  const daily=imported.entries.find(entry=>entry.title==='QOTD 04 Oct: CSS (/daily)')!;
  const price=imported.entries.find(entry=>entry.title.startsWith('Launch price: what 1.80'))!;
  for(const entry of [daily,price]){
   expect(entry).toBeDefined();expect(entry.needs_review).toBe(true);expect(entry.status).toBe('backlog');
   expect(entry.date).toBe(entry.original.date);expect(entry.title).toBe(entry.original.title);
   expect(entry.original).toEqual(original.entries.find((row:{id:string})=>row.id===entry.source_id));
  }
  expect(daily.original.body).toContain('/daily/2026-10-04');
  expect(imported.campaign.source_snapshot).toEqual(original);
 });
 it.each([
  {title:'QOTD 04 Oct: CSS (/daily)'},
  {id:'qotd-20261004',title:'CSS question'},
  {title:'CSS question',body:'Question served at https://devshark.app/daily/2026-10-04'},
  {title:'Release notes for October 4'},
  {title:'Review výsledků 25. 10.'},
  {title:'Launch price: what 1.80 € gets you'},
  {title:'Limited offer: Premium for €1.80'},
  {title:'Premium',body:'Regular pricing is 3.99 EUR per month'},
  {title:'Premium prices change tomorrow'},
  {title:'Premium',body:'99 Kč měsíčně'},
  {title:'Nabídka: cena 99 Kč'},
 ])('requires review without rewriting explicit dated or commercial copy %j',(patch)=>{
  const entry={id:'a',date:'2026-10-04',kind:'thread',platform:'threads',...patch};
  const r=planCampaignImport({...plan,entries:[entry]},'2026-10-18',[]);
  expect(r.entries[0]).toMatchObject({date:'2026-10-04',title:entry.title,status:'backlog',needs_review:true,original:entry});
 });
 it('keeps ordinary learning slots relative and ignores pricing words in linked presentation advice',()=>{
  const entry={id:'a',date:'2026-10-04',title:'Explain CSS specificity',kind:'thread',platform:'threads',body:'Show why one selector wins.',tipRefs:['Make the professional profile answer offer, proof and next step']};
  const r=planCampaignImport({...plan,entries:[entry]},'2026-10-18',[]);
  expect(r.entries[0]).toMatchObject({date:'2026-10-18',status:'planned',needs_review:false,original:entry});
 });
 it('preserves completed dated and priced records as history rather than new review or scheduled work',()=>{
  const entries=[{id:'done',date:'2026-10-04',title:'QOTD 04 Oct: CSS (/daily)',kind:'thread',platform:'threads',status:'published'},
   {id:'done-price',date:'2026-10-05',title:'Launch price: 1.80 €',kind:'task',platform:'web',status:'done'}];
  const r=planCampaignImport({...plan,entries},'2026-10-18',[]);
  expect(r.entries.map(entry=>[entry.date,entry.status,entry.needs_review])).toEqual([['2026-10-04','published',false],['2026-10-05','done',false]]);
  expect(r.report.completed).toBe(2);expect(r.report.held).toBe(0);
 });
});

it.each(['id', 'title', 'kind', 'platform', 'name', 'blank-title', 'time', 'schedule-policy', 'fixed-flag', 'zero-date', 'window-overflow', 'shift-overflow'] as const)('refuses %s input before offering an unsaveable preview', kind => {
 const value = { ...plan, entries: [{ ...plan.entries[0], time: '09:00', schedulePolicy: 'relative', fixedDate: false }] };
 let start = '2026-10-18';
 if (kind === 'id') value.entries[0].id = 'i'.repeat(301);
 if (kind === 'title') value.entries[0].title = 'x'.repeat(10001);
 if (kind === 'kind') value.entries[0].kind = 'x'.repeat(101);
 if (kind === 'platform') value.entries[0].platform = 'x'.repeat(101);
 if (kind === 'name') value.name = 'x'.repeat(10001);
 if (kind === 'blank-title') value.entries[0].title = '   ';
 if (kind === 'time') value.entries[0].time = '24:00';
 if (kind === 'schedule-policy') value.entries[0].schedulePolicy = 'guess-for-me';
 if (kind === 'fixed-flag') Object.assign(value.entries[0], { fixedDate: 'true' });
 if (kind === 'zero-date') value.entries[0].date = '0000-01-01';
 if (kind === 'window-overflow') start = '9999-12-31';
 if (kind === 'shift-overflow') { value.launch = '0001-01-01'; value.entries[0].date = '9999-12-31'; }
 expect(() => planCampaignImport(value, start, [])).toThrow();
});
it('keeps exact storage field ceilings and unknown authored fields unchanged', () => {
 const entry = { ...plan.entries[0], id: 'i'.repeat(300), title: 'x'.repeat(10000), kind: 'k'.repeat(100), platform: 'p'.repeat(100), time: '23:59', unknownAuthoredField: { body: 'Keep this exact text' } };
 const value = { ...plan, name: 'n'.repeat(10000), entries: [entry], unknownPlanField: { retained: true } };
 const prepared = planCampaignImport(value, '2026-10-18', []);
 expect(prepared.entries[0].original).toEqual(entry); expect(prepared.campaign.source_snapshot).toEqual(value);
 expect(prepared.entries[0]).toMatchObject({ source_id: entry.id, title: entry.title, kind: entry.kind, platform: entry.platform, local_time: '23:59' });
});
it('bounds total reference-matching work and refuses oversized reference text', () => {
 const tipRefs = Array.from({ length: 1001 }, (_, i) => `Reference ${i}`);
 const entries = Array.from({ length: 10 }, (_, i) => ({ ...plan.entries[0], id: `item-${i}`, tipRefs }));
 expect(() => planCampaignImport({ ...plan, entries }, '2026-10-18', [])).toThrow();
 expect(() => planCampaignImport({ ...plan, entries: [{ ...plan.entries[0], tipRefs: ['x'.repeat(10001)] }] }, '2026-10-18', [])).toThrow();
});
it('keeps blank references in authored history without showing empty unmatched rows', () => {
 const entry = { ...plan.entries[0], tipRefs: ['', '   '] };
 const value = planCampaignImport({ ...plan, entries: [entry] }, '2026-10-18', []);
 expect(value.entries[0].original).toEqual(entry); expect(value.report.unmatchedTipTitles).toEqual([]); expect(value.report.ambiguousTipTitles).toEqual([]);
});
it.each(['PUBLISHED', ' Done '])('keeps %s history at its original date while preserving the exact source status', status => {
 const entry = { ...plan.entries[0], status };
 const value = planCampaignImport({ ...plan, entries: [entry] }, '2026-10-18', []);
 expect(value.entries[0]).toMatchObject({ date: '2026-10-04', status: status.trim().toLowerCase(), needs_review: false, original: entry }); expect(value.report.completed).toBe(1);
});

it('preserves the first authored spelling of each unmatched or ambiguous reference without duplicate review rows', () => {
 const entry = { ...plan.entries[0], tipRefs: [' A useful tip ', 'a useful tip', 'A useful tip'] };
 const value = { ...plan, entries: [entry] };
 const absent = planCampaignImport(value, '2026-10-18', []);
 expect(absent.report.unmatchedTipTitles).toEqual([' A useful tip ']); expect(absent.entries[0].original).toEqual(entry);
 const ambiguous = planCampaignImport(value, '2026-10-18', [{ id: 'one', title: 'A useful tip' }, { id: 'two', title: 'a useful tip' }]);
 expect(ambiguous.report.ambiguousTipTitles).toEqual([' A useful tip ']); expect(ambiguous.entries[0].knowledge_ids).toEqual([]);
});
it('keeps the last representable seven-day window and the exact reference-work ceiling', () => {
 const value = planCampaignImport({ ...plan, entries: [plan.entries[0]] }, '9999-12-25', []);
 expect(value.campaign.ends_on).toBe('9999-12-31'); expect(value.entries[0].date).toBe('9999-12-25');
 const tipRefs = Array.from({ length: 10000 }, (_, i) => `Reference ${i}`);
 const full = planCampaignImport({ ...plan, entries: [{ ...plan.entries[0], tipRefs }] }, '2026-10-18', []);
 expect(full.report.unmatchedTipTitles).toHaveLength(10000); expect(full.entries[0].original.tipRefs).toEqual(tipRefs);
});
