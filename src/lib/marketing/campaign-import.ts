import { z } from 'zod';
import { addDays,differenceInCalendarDays,format } from 'date-fns';
import { parseDateOnly } from '@/lib/date-keys';
import { tipTitleKey } from '@/lib/marketing-calendars';
import { contentHash } from './hashes';
const Entry=z.object({id:z.string().min(1),date:z.iso.date(),title:z.string().min(1),kind:z.string(),platform:z.string(),status:z.string().optional(),time:z.string().nullable().optional(),tipRefs:z.array(z.string()).optional()}).passthrough();
const Plan=z.object({schemaVersion:z.literal('marketing-calendar/1'),project:z.enum(['devshark','dneskai']),name:z.string(),launch:z.iso.date(),entries:z.array(Entry).max(1000),prelaunch:z.array(z.unknown()).max(200).optional()}).passthrough();
const MONTH='(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DATED_CONTENT=new RegExp(`\\b20\\d{2}-\\d{2}-\\d{2}\\b|\\b(?:0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?\\s+${MONTH}\\b|\\b${MONTH}\\s+(?:0?[1-9]|[12]\\d|3[01])\\b|(?:^|[^\\p{L}\\p{N}])(?:0?[1-9]|[12]\\d|3[01])\\.\\s*(?:0?[1-9]|1[0-2])\\.(?:\\s*20\\d{2})?`, 'iu');
const DATED_DAILY_ID=/(?:qotd|daily|question-of-the-day)[\s:/_-]*(?:20\d{2})[\s:/_-]*(?:0[1-9]|1[0-2])[\s:/_-]*(?:0[1-9]|[12]\d|3[01])\b/i;
const OFFER_CLAIM=/\b(?:prices?|pricing|offer|offers|sale|early[- ]bird|cena|ceny|nab[ií]dka|nab[ií]dky)\b|\d+(?:[.,]\d+)?\s*(?:€|\$|£|EUR\b|USD\b|GBP\b|CZK\b|Kč(?!\p{L}))|(?:€|\$|£|\bEUR|\bUSD|\bGBP|\bCZK)\s*\d/iu;
function datedOrCommercial(entry:z.infer<typeof Entry>):boolean{
 // Inspect authored copy/source identifiers, not the slot's date/time or
 // linked tip titles ("offer, proof and next step" is presentation advice).
 const copy=['title','hook','body','caption','detail','description','cta','url','sourceUrl','canonicalUrl','sourceId','dailyDate','editionDate','contentDate']
  .flatMap(key=>typeof entry[key]==='string'?[entry[key]]:[]).join('\n');
 return DATED_CONTENT.test(copy)||DATED_DAILY_ID.test(`${entry.id}\n${copy}`)||OFFER_CLAIM.test(copy);
}
export function planCampaignImport(value:unknown,start:string,knowledge:Array<{id:string;title:string}>){
 const plan=Plan.parse(value);z.iso.date().parse(start);
 const shift=differenceInCalendarDays(parseDateOnly(start),parseDateOnly(plan.launch));
 const byTitle=new Map<string,string[]>();for(const item of knowledge){const key=tipTitleKey(item.title);byTitle.set(key,[...(byTitle.get(key)??[]),item.id]);}
 const unmatched=new Set<string>();const ambiguous=new Set<string>();
 const endsOn=format(addDays(parseDateOnly(start),6),'yyyy-MM-dd');
 const entries=plan.entries.map(entry=>{
  const text=JSON.stringify(entry);
  const fixed=entry.schedulePolicy==='fixed'||entry.fixedDate===true||datedOrCommercial(entry)||/FrontKon|mesic\.ai|měsíc\.ai|Hacktoberfest|voucher|discount|sleva|coupon|promo code/i.test(text);
  const completed=entry.status==='published'||entry.status==='done';
  const fresh=plan.project==='dneskai' && /news|edition|novink|zpráv|daily digest/i.test(text);
  const ids=(entry.tipRefs??[]).flatMap(title=>{const matches=byTitle.get(tipTitleKey(title))??[];if(matches.length===0)unmatched.add(title);if(matches.length>1)ambiguous.add(title);return matches.length===1?matches:[];});
  const date=completed||fixed?entry.date:format(addDays(parseDateOnly(entry.date),shift),'yyyy-MM-dd');
  const outsideWeek=date<start||date>endsOn;
  return {source_id:entry.id,date,local_time:entry.time??null,kind:entry.kind,platform:entry.platform,title:entry.title,original:entry,knowledge_ids:[...new Set(ids)],status:completed?entry.status:outsideWeek?'backlog':fixed||fresh?'blocked':'planned',needs_review:!completed&&(fixed||fresh)};
 });
 if(new Set(entries.map(e=>e.source_id)).size!==entries.length)throw new Error('duplicate-calendar-id');
 return {campaign:{brand:plan.project,name:plan.name,starts_on:start,ends_on:endsOn,time_zone:'Europe/Prague',source_snapshot:plan,source_hash:contentHash(plan),status:'draft'},entries,report:{inputCount:plan.entries.length,outputCount:entries.length,shiftDays:shift,held:entries.filter(e=>e.needs_review).length,backlog:entries.filter(e=>e.status==='backlog').length,unmatchedTipTitles:[...unmatched],ambiguousTipTitles:[...ambiguous],completed:entries.filter(e=>e.status==='done'||e.status==='published').length}};
}
export { pragueScheduledAt } from './clock';
