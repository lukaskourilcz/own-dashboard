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
  expect(imported.campaign.ends_on).toBe('2026-11-16');
  expect(planCampaignImport(original,'2026-10-18',[])).toEqual(imported);
 });
 it('preserves content and fixed/completed dates while moving relative slots',()=>{const r=planCampaignImport(plan,'2026-10-18',[{id:'tip1',title:'A'}]);expect(r.entries.map(e=>e.date)).toEqual(['2026-10-18','2026-11-02','2026-10-05']);expect(r.entries[1].needs_review).toBe(true);expect(r.entries[0].knowledge_ids).toEqual(['tip1']);expect(r.campaign.ends_on).toBe('2026-11-16');expect(r.entries[0].original).toEqual(plan.entries[0]);});
 it('keeps Prague clock time across DST and rejects duplicated clock slots',()=>{expect(pragueScheduledAt('2026-10-18','09:00')).toBe('2026-10-18T07:00:00.000Z');expect(pragueScheduledAt('2026-10-25','09:00')).toBe('2026-10-25T08:00:00.000Z');expect(()=>pragueScheduledAt('2026-10-25','02:30')).toThrow();});
 it('reports ambiguous knowledge links without inventing mappings',()=>{expect(planCampaignImport(plan,'2026-10-18',[{id:'1',title:'A'},{id:'2',title:'a'}]).report.ambiguousTipTitles).toEqual(['A']);});
});
