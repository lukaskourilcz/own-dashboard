import { z } from 'zod';
import { addDays,differenceInCalendarDays,format } from 'date-fns';
import { parseDateOnly } from '@/lib/date-keys';
import { tipTitleKey } from '@/lib/marketing-calendars';
import { contentHash } from './hashes';
const Entry=z.object({id:z.string().min(1),date:z.iso.date(),title:z.string().min(1),kind:z.string(),platform:z.string(),status:z.string().optional(),time:z.string().nullable().optional(),tipRefs:z.array(z.string()).optional()}).passthrough();
const Plan=z.object({schemaVersion:z.literal('marketing-calendar/1'),project:z.enum(['devshark','dneskai']),name:z.string(),launch:z.iso.date(),entries:z.array(Entry).max(1000),prelaunch:z.array(z.unknown()).max(200).optional()}).passthrough();
export function planCampaignImport(value:unknown,start:string,knowledge:Array<{id:string;title:string}>){
 const plan=Plan.parse(value);z.iso.date().parse(start);
 const shift=differenceInCalendarDays(parseDateOnly(start),parseDateOnly(plan.launch));
 const byTitle=new Map<string,string[]>();for(const item of knowledge){const key=tipTitleKey(item.title);byTitle.set(key,[...(byTitle.get(key)??[]),item.id]);}
 const unmatched=new Set<string>();const ambiguous=new Set<string>();
 const entries=plan.entries.map(entry=>{
  const text=JSON.stringify(entry);
  const fixed=entry.schedulePolicy==='fixed'||entry.fixedDate===true||/FrontKon|mesic\.ai|měsíc\.ai|Hacktoberfest|voucher|discount|sleva|coupon|promo code/i.test(text);
  const completed=entry.status==='published'||entry.status==='done';
  const fresh=plan.project==='dneskai' && /news|edition|novink|zpráv|daily digest/i.test(text);
  const ids=(entry.tipRefs??[]).flatMap(title=>{const matches=byTitle.get(tipTitleKey(title))??[];if(matches.length===0)unmatched.add(title);if(matches.length>1)ambiguous.add(title);return matches.length===1?matches:[];});
  return {source_id:entry.id,date:completed||fixed?entry.date:format(addDays(parseDateOnly(entry.date),shift),'yyyy-MM-dd'),local_time:entry.time??null,kind:entry.kind,platform:entry.platform,title:entry.title,original:entry,knowledge_ids:[...new Set(ids)],status:completed?entry.status:fixed||fresh?'blocked':'planned',needs_review:!completed&&(fixed||fresh)};
 });
 if(new Set(entries.map(e=>e.source_id)).size!==entries.length)throw new Error('duplicate-calendar-id');
 return {campaign:{brand:plan.project,name:plan.name,starts_on:start,ends_on:format(addDays(parseDateOnly(start),29),'yyyy-MM-dd'),time_zone:'Europe/Prague',source_snapshot:plan,source_hash:contentHash(plan),status:'draft'},entries,report:{inputCount:plan.entries.length,outputCount:entries.length,shiftDays:shift,held:entries.filter(e=>e.needs_review).length,unmatchedTipTitles:[...unmatched],ambiguousTipTitles:[...ambiguous],completed:entries.filter(e=>e.status==='done'||e.status==='published').length}};
}
export { pragueScheduledAt } from './clock';
