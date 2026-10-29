import { expect,it } from 'vitest';
import { marketingCalendarGroups,marketingCalendarStatus } from '@/lib/marketing/calendar-view';
import { collectionPage } from '@/lib/collection-page';
import { marketingStateFixture,stateId } from './marketing-state-fixture';
it('groups each captured campaign once and preserves every row in its authored-order bucket',()=>{
 const {campaigns,entries}=marketingStateFixture(),campaign=campaigns[0],seed=entries[0];
 const authored=[{...seed,id:stateId(20),date:'2026-10-28',status:'published'},{...seed,id:stateId(21),status:'backlog'},{...seed,id:stateId(22),date:'2026-10-28',status:'done'},{...seed,id:stateId(23),date:'2026-11-05'},{...seed,id:stateId(24),status:'archived'},seed];const before=structuredClone(authored),[group]=marketingCalendarGroups(campaigns,authored);
 expect(group.week).toEqual([seed]);expect(group.backlog).toEqual([authored[1],authored[3]]);expect(group.retired).toEqual([authored[4]]);expect(group.history).toEqual([authored[0],authored[2]]);expect(group.end).toBe(campaign.ends_on);expect(authored).toEqual(before);
});
it('bounds 10000 selected entries without rescanning their campaign identity for every head',()=>{
 const state=marketingStateFixture(),seed=state.entries[0],campaigns=Array.from({length:10},(_,index)=>({...state.campaigns[0],id:stateId(100+index)}));let identityReads=0;
 const entries=Array.from({length:10000},(_,index)=>({...seed,id:stateId(1000+index),get campaign_id(){identityReads++;return campaigns[index%10].id;},status:index%3===0?'archived':'planned'}));const groups=marketingCalendarGroups(campaigns,entries);expect(identityReads).toBe(10000);expect(groups).toHaveLength(10);
 const recovered=groups.flatMap(group=>Object.values({week:group.week,backlog:group.backlog,retired:group.retired,history:group.history}).flatMap(rows=>Array.from({length:collectionPage(rows,0,20).pages},(_,index)=>collectionPage(rows,index,20).items).flat()));expect(recovered).toHaveLength(10000);expect(new Set(recovered.map(row=>row.id)).size).toBe(10000);
});
it.each(['en','cs'] as const)('%s: describes stored status without inferring Stories setup or claiming unknown entries are planned',lang=>{
 const {entries}=marketingStateFixture(),entry={...entries[0],kind:'story',needs_review:false};expect(marketingCalendarStatus({...entry,status:'blocked'},lang)).toBe(lang==='cs'?'Blokováno':'Blocked');expect(marketingCalendarStatus({...entry,status:'planned'},lang)).toBe(lang==='cs'?'Naplánováno':'Planned');expect(marketingCalendarStatus({...entry,status:'future-unknown'},lang)).toBe(lang==='cs'?'Čeká na kontrolu':'Needs review');
});
