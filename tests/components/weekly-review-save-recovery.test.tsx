// @vitest-environment happy-dom
import { act,useState } from 'react';
import { createRoot,type Root } from 'react-dom/client';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { WeeklyPlanningFlow } from '@/components/work/weekly-planning';
import { NavigationGuardProvider,useGuardedNavigation } from '@/components/navigation-guard';
import { mondayKey } from '@/lib/date-keys';
import type { WeeklyReview } from '@/lib/types';
const state=vi.hoisted(()=>({now:new Date(),owner:'11111111-1111-4111-8111-111111111111',save:vi.fn(),load:vi.fn(),update:vi.fn(),upsert:vi.fn()}));
vi.mock('@/lib/use-now',()=>({useNow:()=>state.now}));
vi.mock('@/lib/weekly-focus',()=>({loadWeeklyFocusSnapshot:async()=>[]}));
vi.mock('@/lib/weekly-review-save',async original=>({...await original<typeof import('@/lib/weekly-review-save')>(),saveWeeklyReview:(...args:unknown[])=>state.save(...args),loadWeeklyReview:(...args:unknown[])=>state.load(...args)}));
vi.mock('@/lib/supabase/user',()=>({currentUserId:async()=>state.owner}));
vi.mock('@/lib/supabase/client',()=>({createClient:()=>({from:()=>({upsert:(input:unknown)=>{state.upsert(input);return{select:()=>({single:()=>new Promise(()=>{})})};}})})}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,container:HTMLDivElement,client:QueryClient,owner:string,source:WeeklyReview;
const button=(text:string)=>[...container.querySelectorAll('button')].find(b=>b.textContent?.trim()===text)!;
const settle=async()=>act(async()=>{for(let i=0;i<4;i++)await new Promise(done=>setTimeout(done,0));});
function Exit(){const navigate=useGuardedNavigation();const [left,setLeft]=useState(false);return <><button onClick={()=>navigate(()=>setLeft(true))}>Leave Work</button>{left&&<p>Left Work</p>}</>;}
function render(step='time'){
 act(()=>root.render(<QueryClientProvider client={client}><NavigationGuardProvider><WeeklyPlanningFlow ownerId={state.owner} reviews={[{...source,items:{...source.items,step}}]} setReviews={state.update} projects={[]} organizations={[]} todos={[]} lastWeekCalendar={{ok:true,events:[]}}/><Exit/></NavigationGuardProvider></QueryClientProvider>));
}
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-25T10:00:00Z'));document.documentElement.lang='en';state.now=new Date();owner='11111111-1111-4111-8111-111111111111';state.owner=owner;state.save.mockReset().mockImplementation(()=>new Promise(()=>{}));state.upsert.mockReset();state.load.mockReset();state.update.mockReset();source={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',user_id:owner,week_start:mondayKey(state.now),status:'draft',summary:'Keep my summary',items:{step:'time',facts:['Keep my fact']},completed_at:null,created_at:'2026-10-19T09:00:00Z',updated_at:'2026-10-24T09:00:00.123456Z'};container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});});
afterEach(()=>{act(()=>root.unmount());container.remove();client.clear();vi.useRealTimers();});
it('keeps the current step until the captured save is confirmed and reserves repeated clicks immediately',async()=>{
 render();await settle();act(()=>{button('Next').click();button('Next').click();});await settle();
 expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe('Step 1/5');expect(state.save).toHaveBeenCalledTimes(1);expect(state.upsert).not.toHaveBeenCalled();
});
it('locks input and pending navigation while preserving the entire draft after refusal',async()=>{
 let fail!:(error:Error)=>void;state.save.mockImplementation(()=>new Promise((_resolve,reject)=>{fail=reject;}));render('summary');await settle();
 act(()=>button('Save draft').click());await settle();expect(container.querySelector('fieldset')!.disabled).toBe(true);
 act(()=>button('Leave Work').click());await settle();expect(container.textContent).not.toContain('Left Work');expect(document.querySelector('[role="dialog"]')).not.toBeNull();
 await act(async()=>fail(Error('Private SQL failure')));await settle();expect(container.querySelector('textarea')!.value).toBe('Keep my summary');expect(container.textContent).not.toContain('Private SQL');
});
it('never sends a previous owner draft using the next signed-in identity',async()=>{
 render('summary');await settle();state.owner='22222222-2222-4222-8222-222222222222';render('summary');await settle();act(()=>button('Save draft').click());await settle();expect(state.save).not.toHaveBeenCalled();expect(state.upsert).not.toHaveBeenCalled();
});
it('never moves an already-open draft into a new Monday after the shared clock advances',async()=>{
 render('summary');await settle();state.now=new Date(state.now.getTime()+7*86400000);vi.setSystemTime(state.now);render('summary');await settle();act(()=>button('Save draft').click());await settle();expect(state.save).not.toHaveBeenCalled();expect(state.upsert).not.toHaveBeenCalled();
});

const setText=(text:string)=>act(()=>{const field=container.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(field,text);field.dispatchEvent(new Event('input',{bubbles:true}));});
it('advances only after a persisted receipt and applies only captured record fields',async()=>{
 let finish!:(value:unknown)=>void;state.save.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));render();await settle();act(()=>button('Next').click());await settle();
 const request=state.save.mock.calls[0]![1];expect(request.expected).toEqual({...source,items:{...source.items,step:'time'}});expect(request.patch.summary).toBeUndefined();expect(request.patch.items.facts).toBeUndefined();
 await act(async()=>finish({kind:'saved',ownerId:owner,weekStart:source.week_start,sourceUpdatedAt:source.updated_at,review:{...source,items:{...source.items,...request.patch.items},updated_at:'2026-10-25T09:00:00Z'}}));await settle();
 expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe('Step 2/5');expect(state.update).toHaveBeenCalledTimes(1);
});
it('retains a typed draft through failure and retries with the same source and stable record id',async()=>{
 state.save.mockRejectedValue(Error('Private transport refusal'));render('summary');await settle();setText('Retain my new summary');act(()=>button('Save draft').click());await settle();
 expect(container.querySelector('textarea')!.value).toBe('Retain my new summary');expect(container.querySelector('[role="alert"]')?.textContent).toContain('save could not be confirmed');expect(container.textContent).not.toContain('Private transport');
 const first=state.save.mock.calls[0]![1];act(()=>button('Save draft').click());await settle();expect(state.save.mock.calls[1]![1]).toEqual(first);expect(state.update).not.toHaveBeenCalled();
});
it('keeps a conflicting draft selectable, blocks another save and reloads only after explicit discard',async()=>{
 state.save.mockResolvedValue({kind:'conflict',ownerId:owner,weekStart:source.week_start,sourceUpdatedAt:'2026-10-25T09:00:00Z',review:null});render('summary');await settle();setText('My changed draft');act(()=>button('Save draft').click());await settle();
 expect(container.querySelector('textarea')!.value).toBe('My changed draft');expect(container.querySelector('textarea')!.readOnly).toBe(true);expect(container.querySelector('fieldset')!.disabled).toBe(false);expect(button('Save draft').disabled).toBe(true);
 const updated={...source,summary:'Saved by another tab',items:{step:'summary',facts:['New saved fact']},updated_at:'2026-10-25T09:00:00Z'};state.load.mockResolvedValue(updated);act(()=>button('Discard draft and reload').click());await settle();expect(container.querySelector('textarea')!.value).toBe('Saved by another tab');expect(button('Save draft').disabled).toBe(false);
});
it('registers a pending save before a same-frame navigation can leave',async()=>{render('summary');await settle();act(()=>{button('Save draft').click();button('Leave Work').click();});await settle();expect(container.textContent).not.toContain('Left Work');expect(document.querySelector('[role="dialog"]')).not.toBeNull();});
it('keeps a typed draft when a newer parent snapshot arrives instead of adopting its version',async()=>{
 state.save.mockRejectedValue(Error('Fixture unavailable'));render('summary');await settle();setText('My retained draft');const original={...source,items:{...source.items,step:'summary'}};source={...source,summary:'Other device',updated_at:'2026-10-25T09:00:00Z'};render('summary');await settle();expect(container.querySelector('textarea')!.value).toBe('My retained draft');act(()=>button('Save draft').click());await settle();expect(state.save.mock.calls[0]![1].expected).toEqual(original);
});
it('cancels late callbacks on unmount without changing records',async()=>{
 let finish!:(value:unknown)=>void;state.save.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));render('summary');await settle();act(()=>button('Save draft').click());await settle();const signal=state.save.mock.calls[0]![2] as AbortSignal;
 act(()=>root.unmount());root=createRoot(container);expect(signal.aborted).toBe(true);await act(async()=>finish({kind:'saved',ownerId:owner,weekStart:source.week_start,sourceUpdatedAt:source.updated_at,review:source}));await settle();expect(state.update).not.toHaveBeenCalled();
});
it('includes an unadded objective in Save Draft with a stable retry identity',async()=>{
 state.save.mockRejectedValue(Error('Fixture unavailable'));render('objectives');await settle();const field=container.querySelector('input')!;act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(field,'Keep the typed objective');field.dispatchEvent(new Event('input',{bubbles:true}));});act(()=>button('Save draft').click());await settle();const first=state.save.mock.calls[0]![1];expect(first.patch.items.objectives).toMatchObject([{text:'Keep the typed objective',done:false}]);act(()=>button('Save draft').click());await settle();expect(state.save.mock.calls[1]![1].patch.items.objectives).toEqual(first.patch.items.objectives);expect(field.value).toBe('Keep the typed objective');
});

it('uses a full owner/week reload after explicit discard so Calendar data cannot remain on the old week',async()=>{
 const reload=vi.spyOn(window.location,'reload').mockImplementation(()=>{});render('summary');await settle();state.now=new Date(state.now.getTime()+7*86400000);vi.setSystemTime(state.now);render('summary');await settle();act(()=>button('Discard draft and reload').click());expect(reload).toHaveBeenCalledTimes(1);expect(state.load).not.toHaveBeenCalled();reload.mockRestore();
});
