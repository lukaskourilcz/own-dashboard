import { z } from 'zod';
import { addDays,differenceInCalendarDays,format } from 'date-fns';
import { parseDateOnly } from '@/lib/date-keys';
import { tipTitleKey } from '@/lib/marketing-calendars';
import { contentHash } from './hashes';
import { CALENDAR_IMPORT_MAX_ENTRIES, CALENDAR_IMPORT_MAX_PRELAUNCH, CALENDAR_IMPORT_MAX_REFERENCES, CALENDAR_IMPORT_MAX_SOURCE_ID, CALENDAR_IMPORT_MAX_TEXT, CALENDAR_IMPORT_MAX_TYPE, CalendarImportDateSchema, CalendarImportStartSchema, calendarImportEndDate } from './calendar-import-contracts';
const authoredText = (maximum: number) => z.string().min(1).max(maximum).refine(value => value.trim().length > 0);
const Entry=z.object({
 id:authoredText(CALENDAR_IMPORT_MAX_SOURCE_ID),date:CalendarImportDateSchema,title:authoredText(CALENDAR_IMPORT_MAX_TEXT),
 kind:authoredText(CALENDAR_IMPORT_MAX_TYPE),platform:authoredText(CALENDAR_IMPORT_MAX_TYPE),status:z.string().max(CALENDAR_IMPORT_MAX_TYPE).optional(),
 time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
 tipRefs:z.array(z.string().max(CALENDAR_IMPORT_MAX_TEXT)).max(CALENDAR_IMPORT_MAX_REFERENCES).optional(),
 schedulePolicy:z.enum(['relative','fixed']).optional(),fixedDate:z.boolean().optional(),
}).passthrough();
const Plan=z.object({schemaVersion:z.literal('marketing-calendar/1'),project:z.enum(['devshark','dneskai']),name:authoredText(CALENDAR_IMPORT_MAX_TEXT),launch:CalendarImportDateSchema,entries:z.array(Entry).max(CALENDAR_IMPORT_MAX_ENTRIES),prelaunch:z.array(z.unknown()).max(CALENDAR_IMPORT_MAX_PRELAUNCH).optional()}).passthrough()
 .refine(plan=>plan.entries.reduce((total,entry)=>total+(entry.tipRefs?.length??0),0)<=CALENDAR_IMPORT_MAX_REFERENCES);
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
 const plan=Plan.parse(value);CalendarImportStartSchema.parse(start);
 const shift=differenceInCalendarDays(parseDateOnly(start),parseDateOnly(plan.launch));
 const byTitle=new Map<string,string[]>();for(const item of knowledge){const key=tipTitleKey(item.title);if(!key)continue;const matches=byTitle.get(key);if(matches)matches.push(item.id);else byTitle.set(key,[item.id]);}
 const unmatched=new Map<string,string>();const ambiguous=new Map<string,string>();
 const endsOn=calendarImportEndDate(start);
 const entries=plan.entries.map(entry=>{
  const text=JSON.stringify(entry);
  const fixed=entry.schedulePolicy==='fixed'||entry.fixedDate===true||datedOrCommercial(entry)||/FrontKon|mesic\.ai|měsíc\.ai|Hacktoberfest|voucher|discount|sleva|coupon|promo code/i.test(text);
  const sourceStatus=entry.status?.trim().toLowerCase();
  const completedStatus=sourceStatus==='published'||sourceStatus==='done'?sourceStatus:null;
  const completed=completedStatus!==null;
  const fresh=plan.project==='dneskai' && /news|edition|novink|zpráv|daily digest/i.test(text);
  const ids=(entry.tipRefs??[]).flatMap(title=>{const key=tipTitleKey(title);if(!key)return[];const matches=byTitle.get(key)??[];if(matches.length===0&&!unmatched.has(key))unmatched.set(key,title);if(matches.length>1&&!ambiguous.has(key))ambiguous.set(key,title);return matches.length===1?matches:[];});
  const date=CalendarImportDateSchema.parse(completed||fixed?entry.date:format(addDays(parseDateOnly(entry.date),shift),'yyyy-MM-dd'));
  const outsideWeek=date<start||date>endsOn;
  return {source_id:entry.id,date,local_time:entry.time??null,kind:entry.kind,platform:entry.platform,title:entry.title,original:entry,knowledge_ids:[...new Set(ids)],status:completedStatus??(outsideWeek?'backlog':fixed||fresh?'blocked':'planned'),needs_review:!completed&&(fixed||fresh)};
 });
 if(new Set(entries.map(e=>e.source_id)).size!==entries.length)throw new Error('duplicate-calendar-id');
 return {campaign:{brand:plan.project,name:plan.name,starts_on:start,ends_on:endsOn,time_zone:'Europe/Prague',source_snapshot:plan,source_hash:contentHash(plan),status:'draft'},entries,report:{inputCount:plan.entries.length,outputCount:entries.length,shiftDays:shift,held:entries.filter(e=>e.needs_review).length,backlog:entries.filter(e=>e.status==='backlog').length,unmatchedTipTitles:[...unmatched.values()],ambiguousTipTitles:[...ambiguous.values()],completed:entries.filter(e=>e.status==='done'||e.status==='published').length}};
}
export { pragueScheduledAt } from './clock';
