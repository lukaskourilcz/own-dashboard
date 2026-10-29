import {createHash,randomUUID} from 'node:crypto';
import {expect,type Page} from '@playwright/test';
import {gotoPreview} from './helpers';
import {sessionOwner} from './owner-session-fixtures';
import {jobs} from '../src/lib/i18n/sections/jobs';
import type {SavedJobPosition,JobApplication,JobApplicationEvent,CoverLetterTemplate} from '../src/lib/types';
import {databaseVersion} from '../src/lib/database-version';
export const applicationStamp='2026-10-26T12:00:00.000001Z',applicationLater='2026-10-26T12:00:00.000002Z';
export const applicationSource=():SavedJobPosition=>({id:'33333333-dddd-4ddd-8ddd-dddddddddddd',user_id:sessionOwner,listing_id:null,title:'Synthetic frontend position',company:'Synthetic company',url:'https://thehub.io/jobs/synthetic-application',source:'manual',location:'Oslo',remote:false,description:'Synthetic React TypeScript position',cover_letter:'Synthetic private letter',notes:'Synthetic private note',cover_letter_url:null,readiness:'draft',saved_at:applicationStamp,updated_at:applicationStamp});
export function applicationReceipt(source:SavedJobPosition,input:Record<string,unknown>,created=true){
 const fields=input.p_payload as Record<string,string|null>,version=String(BigInt(Date.parse(source.updated_at))*BigInt(1000)+BigInt((source.updated_at.match(/\.(\d+)/)?.[1]??'').padEnd(6,'0').slice(3)));
 const values=[sessionOwner,source.id,version,fields.title,fields.company,fields.url,fields.cover_letter,fields.cover_letter_url,fields.applied_on,fields.notes];
 const fingerprint=createHash('sha256').update(values.map(value=>value===null?'-1:':`${Buffer.byteLength(value)}:${value}`).join('')).digest('hex');
 const row={id:'44444444-dddd-4ddd-8ddd-dddddddddddd',user_id:sessionOwner,listing_id:source.listing_id,...fields,source:source.source,location:source.location,remote:source.remote,status:'applied',created_at:applicationLater,updated_at:applicationLater,organization_id:null,next_follow_up_at:null,request_id:source.id,responded_on:null,response_kind:null,contact_name:null,contact_email:null} as JobApplication;
 const event:JobApplicationEvent={id:'55555555-dddd-4ddd-8ddd-dddddddddddd',user_id:sessionOwner,application_id:row.id,kind:'applied',detail:fields.applied_on,created_at:applicationLater};
 return{ownerId:sessionOwner,requestId:source.id,fingerprint,created,row,event};
}
export function progressReceipt(source:JobApplication,patch:Record<string,unknown>){
 const row={...source,...patch} as JobApplication,changed=Object.entries(patch).some(([key,value])=>key==='next_follow_up_at'&&typeof value==='string'&&typeof source.next_follow_up_at==='string'?databaseVersion(value)!==databaseVersion(source.next_follow_up_at):source[key as keyof JobApplication]!==value);
 const version=databaseVersion(source.updated_at)!+BigInt(1),next=`${new Date(Number(version/BigInt(1000))).toISOString().slice(0,23)}${String(version%BigInt(1000)).padStart(3,'0')}Z`;
 row.updated_at=changed?next:source.updated_at;const events:JobApplicationEvent[]=[];
 const event=(kind:'status'|'note',detail:string)=>({id:randomUUID(),user_id:source.user_id,application_id:source.id,kind,detail,created_at:next});
 if(source.status!==row.status)events.push(event('status',row.status));
 if(['responded_on','response_kind','next_follow_up_at','notes'].some(key=>{const a=source[key as keyof JobApplication],b=row[key as keyof JobApplication];return key==='next_follow_up_at'&&typeof a==='string'&&typeof b==='string'?databaseVersion(a)!==databaseVersion(b):a!==b;}))events.push(event('note',JSON.stringify({responded_on:row.responded_on??null,response_kind:row.response_kind??null,follow_up_at:row.next_follow_up_at??null,notes:row.notes??null})));
 return{ownerId:source.user_id,source:{id:source.id,updatedAt:source.updated_at},row,events};
}
export async function openApplication(page:Page,lang:'en'|'cs',initial=applicationSource(),open=true,applications:JobApplication[]=[],events:JobApplicationEvent[]=[],templates:CoverLetterTemplate[]=[]){
 const store={saved:[initial],applications,events,templates,reads:0,failRead:false,errors:[] as string[]};page.on('pageerror',error=>store.errors.push(error.message));await gotoPreview(page,{lang,theme:lang==='cs'?'dark':'light'});
 await page.route('**/rest/v1/rpc/read_career_records',route=>{const input=route.request().postDataJSON();expect(input.p_expected_owner).toBe(sessionOwner);store.reads++;const collection=input.p_entity;return route.fulfill(store.failRead&&['saved_job_positions','job_applications','cover_letter_templates'].includes(collection)?{status:503,json:{message:'PRIVATE TEST'}}:{json:{ownerId:sessionOwner,collection,rows:collection==='saved_job_positions'?store.saved:collection==='job_applications'?store.applications:collection==='job_application_events'?store.events:collection==='cover_letter_templates'?store.templates:[]}});});
 await page.goto('/dev-preview?tab=career&career=records');const main=page.getByRole('main');await main.getByRole('button',{name:new RegExp(`^${initial.readiness==='ready'?(lang==='cs'?'Přihlášky k odeslání':'Applications to send'):jobs[lang].savedTab}`)}).click();
 if(open)await main.locator(`[data-career-position="${initial.id}"]`).getByRole('button',{name:initial.readiness==='ready'?(lang==='cs'?'Zkontrolovat / označit odeslání':'Review / mark as sent'):jobs[lang].prepareApplication,exact:true}).click();
 return{store,main,dialog:page.getByRole('dialog',{name:jobs[lang].applyTitle,exact:true})};
}
