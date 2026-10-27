import {expect,it} from 'vitest';
import {cronHeartbeatState,expectedIntervalMs,staleCronCount} from '@/lib/cron-heartbeat';
const minute=60_000,day=86_400_000;
const cadence=(schedule:string,runs_per_month=30)=>({schedule,runs_per_month});
const cron=(schedule='0 7 * * 1-5')=>({...cadence(schedule),enabled:true,heartbeat_url:'https://example.test/push/synthetic',last_success_at:'2026-10-23T07:00:00Z'});
it('uses the real weekend gap rather than a weekday average',()=>{
 expect(expectedIntervalMs(cadence('0 7 * * 1-5'))).toBe(3*day);
 expect(cronHeartbeatState(cron(),new Date('2026-10-25T18:00:00Z')).state).toBe('ok');
});
it('allows months without the requested day instead of treating them as missed reports',()=>{
 expect(expectedIntervalMs(cadence('0 7 31 * *'))).toBe(61*day);
 const row={...cron('0 7 31 * *'),last_success_at:'2026-03-31T07:00:00Z'};
 expect(cronHeartbeatState(row,new Date('2026-05-25T07:00:00Z')).state).toBe('ok');
});
it('matches every nonempty weekday set against a two-week enumerated calendar',()=>{
 for(let mask=1;mask<128;mask++){
  const selected=Array.from({length:7},(_,index)=>index).filter(index=>mask&(1<<index));
  const dates=Array.from({length:14},(_,index)=>index).filter(index=>selected.includes(index%7));
  let largest=0;for(let index=1;index<dates.length;index++)largest=Math.max(largest,dates[index]-dates[index-1]);
  expect(expectedIntervalMs(cadence(`0 7 * * ${selected.join(',')}`))).toBe(largest*day);
 }
});
it.each([29,30,31])('matches the longest real Gregorian gap for monthly day %i',date=>{
 let previous:number|undefined,largest=0;
 for(let year=2000;year<=2400;year++)for(let month=0;month<12;month++){
  const instant=Date.UTC(year,month,date);if(new Date(instant).getUTCMonth()!==month)continue;
  if(previous!==undefined)largest=Math.max(largest,instant-previous);previous=instant;
 }
 expect(expectedIntervalMs(cadence(`0 7 ${date} * *`))).toBe(largest);
});
it.each([['*/35 * * * *',35*minute],['*/59 * * * *',59*minute],['0 */23 * * *',23*60*minute],['0 7 * * 0,7',7*day],['0 7 * * 6-7',6*day],['0 7 * * 1-7',day]])('keeps field-reset step/weekday bounds for %s',(schedule,expected)=>{expect(expectedIntervalMs(cadence(schedule as string))).toBe(expected);});
it.each([NaN,Infinity,-Infinity,-1,0])('keeps an invalid coarse cadence finite and positive: %s',frequency=>{expect(expectedIntervalMs(cadence('unreadable',frequency))).toBe(30*day);});
it('does not imply sub-minute polling from a huge coarse cost estimate',()=>{expect(expectedIntervalMs(cadence('unreadable',Number.MAX_VALUE))).toBe(minute);});
it.each([new Date(NaN),new Date(0)])('does not judge a success from an unavailable/incompatible clock %s',now=>{expect(cronHeartbeatState(cron(),now).state).toBe('unknown');expect(staleCronCount([cron()],now)).toBe(0);});
it('keeps an unverifiable stored timestamp distinct from an absent success',()=>{const now=new Date('2026-10-27T12:00:00Z');expect(cronHeartbeatState({...cron(),last_success_at:'not-a-date'},now).state).toBe('unknown');expect(cronHeartbeatState({...cron(),last_success_at:null},now).state).toBe('never');expect(cronHeartbeatState({...cron(),last_success_at:'2026-10-27T12:06:00Z'},now).state).toBe('unknown');});
it('retains disabled and small-clock-skew behavior',()=>{const now=new Date('2026-10-27T12:00:00Z');expect(cronHeartbeatState({...cron(),enabled:false},new Date(NaN)).state).toBe('unmonitored');expect(cronHeartbeatState({...cron(),last_success_at:'2026-10-27T12:04:00Z'},now).state).toBe('ok');});
