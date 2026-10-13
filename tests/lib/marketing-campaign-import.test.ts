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
