import { vi,expect,it } from 'vitest';
vi.mock('server-only',()=>({}));
import { readFullMarketingCalendar } from '@/lib/marketing/calendar-source';
it('reads full immutable commit content without dropping fields',async()=>{
 const commit='a'.repeat(40);const plan={schemaVersion:'marketing-calendar/1',project:'devshark',entries:[{body:'Authored original copy',assets:['logo.svg']}],prelaunch:[{status:'done'}]};
 const fetcher=vi.fn(async(path:string)=>path.includes('/commits?')?Response.json([{sha:commit}]):new Response(JSON.stringify(plan)));
 const result=await readFullMarketingCalendar(fetcher,'devshark');
 expect(result.entries).toEqual(plan.entries);expect(result.prelaunch).toEqual(plan.prelaunch);expect(result._importProvenance.sourceCommit).toBe(commit);
 expect(fetcher.mock.calls[1][0]).toContain(`?ref=${commit}`);
});
it('rejects unavailable repositories instead of importing an empty plan',async()=>{
 await expect(readFullMarketingCalendar(async()=>new Response(null,{status:401}),'dneskai')).rejects.toThrow('calendar-repository-unavailable');
});
