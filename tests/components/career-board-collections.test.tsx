// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CareerBoard } from '@/components/panels/career-board';
import { jobs } from '@/lib/i18n/sections/jobs';
import { jobApplications, savedJobPositions } from '@/lib/demo/fixtures';
import type { JobApplication, JobApplicationStatus } from '@/lib/types';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const apps=Array.from({length:21},(_,i)=>({...jobApplications[0],id:`app-${i}`,title:`Synthetic React role ${String(i).padStart(2,'0')}`,url:`https://thehub.io/jobs/app-${i}`,status:'applied' as const,applied_on:'2026-10-25'}));
const saved=Array.from({length:12},(_,i)=>({...savedJobPositions[0],id:`saved-${i}`,title:`Synthetic saved role ${String(i).padStart(2,'0')}`,url:`https://thehub.io/jobs/saved-${i}`,saved_at:'2026-10-25T12:00:00Z'}));
const statuses:JobApplicationStatus[]=['applied','interviewing','offer','rejected','withdrawn'];
const statusLabel={applied:jobs.en.statusApplied,interviewing:jobs.en.statusInterviewing,offer:jobs.en.statusOffer,rejected:jobs.en.statusRejected,withdrawn:jobs.en.statusWithdrawn};
vi.mock('@/components/ui/select',()=>({SimpleSelect:({value,onValueChange,options,...props}:{value:string;onValueChange:(value:string)=>void;options:{value:string;label:string}[]})=><select {...props} role="combobox" value={value} onChange={event=>onValueChange(event.target.value)}>{options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>}));
let root:Root,host:HTMLDivElement;
beforeEach(()=>{document.documentElement.lang='en';host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();document.documentElement.lang='';});
function tree(rows:JobApplication[]=apps,onStatus:(app:JobApplication,status:JobApplicationStatus)=>Promise<unknown>=vi.fn(async()=>{})){return <CareerBoard applications={rows} savedPositions={saved} statuses={statuses} statusLabel={statusLabel} onStatus={onStatus} onProgress={vi.fn()} onPrepare={vi.fn()}/>;}
it('mounts only ten saved and ten applied cards while preserving both complete column counts',async()=>{
 await act(async()=>root.render(tree()));expect(host.querySelectorAll('a')).toHaveLength(20);expect([...host.querySelectorAll('h3')].map(el=>el.textContent)).toContain('Saved12');expect([...host.querySelectorAll('h3')].map(el=>el.textContent)).toContain('Applied21');
});
it('pages each complete column independently without calling a mutation',async()=>{
 const save=vi.fn(async()=>{});await act(async()=>root.render(tree(apps,save)));const nav=[...host.querySelectorAll('nav')].find(node=>node.getAttribute('aria-label')==='Applied pages')!;
 act(()=>[...nav.querySelectorAll('button')].find(button=>button.textContent==='Next')!.click());expect(host.querySelector('[data-career-board-column="applied"] a')?.textContent).toBe(apps[10].title);expect(host.querySelector('[data-career-board-column="saved"] a')?.textContent).toBe(saved[0].title);expect(save).not.toHaveBeenCalled();
 act(()=>[...nav.querySelectorAll('button')].find(button=>button.textContent==='Next')!.click());expect(nav.textContent).toContain('21–21 of 21');
 await act(async()=>root.render(tree(apps.slice(0,20),save)));expect(nav.textContent).toContain('11–20 of 20');expect(host.querySelectorAll('[data-career-board-application]')).toHaveLength(10);
});
it.each(['confirmed','failed','unmounted'] as const)('reveals and focuses an off-page move only after %s evidence',async outcome=>{
 const rows=[...apps.map(app=>({...app,applied_on:'2026-10-01'})),...apps.slice(0,21).map((app,index)=>({...app,id:`interview-${index}`,status:'interviewing' as const,applied_on:'2026-10-25'}))];
 let finish!:()=>void,reject!:(error:Error)=>void;const save=vi.fn(()=>new Promise<void>((resolve,no)=>{finish=resolve;reject=no;}));await act(async()=>root.render(tree(rows,save)));
 const control=host.querySelector<HTMLSelectElement>(`[data-career-board-application="${apps[0].id}"] select`)!;
 await act(async()=>{control.value='interviewing';control.dispatchEvent(new Event('change',{bubbles:true}));control.dispatchEvent(new Event('change',{bubbles:true}));});expect(save).toHaveBeenCalledOnce();expect(control.disabled).toBe(true);
 if(outcome==='unmounted'){act(()=>root.render(null));await act(async()=>finish());return;}
 if(outcome==='failed'){await act(async()=>reject(Error('Synthetic refused move')));expect(control.disabled).toBe(false);expect(document.activeElement).toBe(control);expect(host.querySelector('[data-career-board-column="applied"] a')?.textContent).toBe(apps[0].title);return;}
 await act(async()=>{root.render(tree(rows.map(row=>row.id===apps[0].id?{...row,status:'interviewing'}:row),save));finish();});
 const moved=host.querySelector<HTMLElement>(`[data-career-board-column="interviewing"] [data-career-board-application="${apps[0].id}"]`)!;expect(moved).not.toBeNull();expect(document.activeElement).toBe(moved.querySelector('[role="combobox"]'));expect(moved.closest('[data-career-board-column]')?.textContent).toContain('21–22 of 22');
});
it('does not take focus back from a newer page action when an earlier move completes',async()=>{
 let finish!:()=>void;const save=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));await act(async()=>root.render(tree(apps,save)));
 const control=host.querySelector<HTMLSelectElement>(`[data-career-board-application="${apps[0].id}"] select`)!;
 await act(async()=>{control.value='interviewing';control.dispatchEvent(new Event('change',{bubbles:true}));});
 const nav=[...host.querySelectorAll('nav')].find(node=>node.getAttribute('aria-label')==='Applied pages')!,next=[...nav.querySelectorAll('button')].find(button=>button.textContent==='Next')!;
 act(()=>{next.focus();next.click();});
 await act(async()=>{root.render(tree(apps.map(row=>row.id===apps[0].id?{...row,status:'interviewing'}:row),save));finish();});
 expect(document.activeElement).toBe(next);expect(nav.textContent).toContain('11–20 of 20');
});
