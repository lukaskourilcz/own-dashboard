// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { RecurringPlans } from '@/components/overview/recurring-plans';
import { PlansPanel } from '@/components/panels/plans-panel';
import { ConfirmationProvider } from '@/components/ui/confirmation-dialog';
import { TooltipProvider } from '@/components/ui/tooltip';
import { NavigationGuardProvider } from '@/components/navigation-guard';
import { OwnerPreferencesProvider } from '@/lib/owner-preferences';
import { plans as copy } from '@/lib/i18n/sections/plans';
import type { Plan } from '@/lib/types';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
const backend=vi.hoisted(()=>({api:null as unknown as SupabaseClient}));
vi.mock('@/lib/supabase/client',()=>({createClient:()=>backend.api}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',stamp='2026-10-25T17:00:00Z';
let host:HTMLDivElement,root:Root,client:QueryClient,db:PGlite,emulator:SupabaseEmulator;
let initialRows:Plan[]=[],recurring=false;
let intercept:(request:Request,next:()=>Promise<Response>)=>Promise<Response>,sent:Request[];
beforeAll(async()=>{db=await createMigratedDatabase({owner,instant:stamp});await db.query('insert into auth.users(id) values($1)',[other]);},120000);
beforeEach(async()=>{
 await db.exec('reset role; delete from plans');initialRows=[];recurring=false;document.documentElement.lang='en';sent=[];intercept=(_request,next)=>next();
 emulator=new SupabaseEmulator(db,'https://offline.supabase.test',{service:'TEST-ONLY-service',users:{[owner]:'TEST-ONLY-owner'}},()=>new Date(stamp));
 backend.api=createClient('https://offline.supabase.test','TEST-ONLY-public',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:'Bearer TEST-ONLY-owner'},fetch:(input,init)=>{const request=new Request(input,init);sent.push(request);return intercept(request,()=>emulator.fetch(request));}}});
 host=document.createElement('div');document.body.append(host);root=createRoot(host);client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
});
afterEach(()=>{act(()=>root.unmount());host.remove();client.clear();document.documentElement.lang='';vi.unstubAllGlobals();vi.restoreAllMocks();});afterAll(async()=>db?.close());
function Harness(){const[plans,setPlans]=useState<Plan[]>(initialRows);return recurring?<RecurringPlans plans={plans} setPlans={setPlans}/>:<PlansPanel plans={plans} setPlans={setPlans}/>;}
const render=(identity=owner,show=true)=>act(()=>root.render(<QueryClientProvider client={client}><OwnerPreferencesProvider ownerId={identity}><TooltipProvider><ConfirmationProvider><NavigationGuardProvider>{show&&<Harness/>}</NavigationGuardProvider></ConfirmationProvider></TooltipProvider></OwnerPreferencesProvider></QueryClientProvider>));
function fill(id:string,value:string){const field=document.getElementById(id)!;act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));});}
function start(){render();act(()=>[...host.querySelectorAll('button')].find(button=>button.textContent===copy.en.newPlan)!.click());fill('plan-title','Calendar failure');fill('plan-date','2026-11-01');act(()=>document.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')!.click());}
const submit=()=>act(()=>document.querySelector('[role="dialog"] form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
async function settle(assert:()=>void){await vi.waitFor(async()=>{await act(async()=>{await new Promise(done=>setTimeout(done,10));});assert();},{timeout:5000});}
for(const failure of ['network','http','link'] as const)it(`keeps one confirmed plan when optional Calendar fails (${failure})`,async()=>{
 const calendar=vi.fn<typeof fetch>(async()=>{if(failure==='network')throw Error('PRIVATE TEST');return Response.json(failure==='link'?{id:'created-event',ownerId:owner}:{},{status:failure==='link'?200:503});});vi.stubGlobal('fetch',calendar);
 if(failure==='link')intercept=(request,next)=>request.method==='PATCH'?Promise.resolve(Response.json({message:'PRIVATE TEST'},{status:503})):next();
 start();submit();await settle(()=>expect(document.querySelector('[role="dialog"]')).toBeNull());expect(host.textContent).toContain('Calendar failure');expect(host.querySelector('[role="status"]')?.textContent).toBe(failure==='link'?copy.en.calendarLinkFailed:copy.en.calendarEventFailed);
 expect((await db.query('select title,linked_calendar_event_id from plans')).rows).toEqual([{title:'Calendar failure',linked_calendar_event_id:null}]);expect(sent.filter(request=>request.method==='POST')).toHaveLength(1);expect(calendar).toHaveBeenCalledOnce();expect(calendar.mock.calls[0][1]?.headers).toMatchObject({'x-calendar-owner':owner});
});
for(const disposal of ['owner','panel'] as const)it(`does not start optional Calendar work after original ${disposal} disposal, even if the plan already committed`,async()=>{
 let release!:()=>void;intercept=async(request,next)=>{const response=await next();if(request.method==='POST')await new Promise<void>(resolve=>{release=resolve;});return response;};const calendar=vi.fn();vi.stubGlobal('fetch',calendar);start();submit();await settle(()=>expect(release).toBeTypeOf('function'));
 expect(document.getElementById('plan-title')!.closest('fieldset')!.disabled).toBe(true);render(disposal==='owner'?other:owner,disposal==='owner');await act(async()=>{release();await Promise.resolve();});expect(calendar).not.toHaveBeenCalled();expect(host.textContent).not.toContain('Calendar failure');expect((await db.query('select user_id,linked_calendar_event_id from plans')).rows).toEqual([{user_id:owner,linked_calendar_event_id:null}]);
});
it('retries an uncertain creation with the same id and starts Calendar only after recovering its confirmed row',async()=>{
 let lose=true;intercept=async(request,next)=>{const response=await next();if(request.method==='POST'&&lose){lose=false;return Response.json({message:'PRIVATE TEST lost response'},{status:503});}return response;};const calendar=vi.fn().mockResolvedValue(Response.json({id:'created-event',ownerId:owner}));vi.stubGlobal('fetch',calendar);start();submit();
 await settle(()=>expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe(copy.en.saveUnconfirmed));expect((document.getElementById('plan-title') as HTMLInputElement).value).toBe('Calendar failure');expect(calendar).not.toHaveBeenCalled();const initial=(await db.query<{id:string}>('select id from plans')).rows[0].id;
 submit();await settle(()=>expect(document.querySelector('[role="dialog"]')).toBeNull());expect((await db.query('select id,linked_calendar_event_id from plans')).rows).toEqual([{id:initial,linked_calendar_event_id:'created-event'}]);expect(calendar).toHaveBeenCalledOnce();expect(sent.filter(request=>request.method==='POST')).toHaveLength(2);expect(sent.filter(request=>request.method==='GET')).toHaveLength(1);
});

async function seedPlan(link: string|null = null) {
 await db.query("insert into plans(user_id,title,status,recurrence,notes,linked_calendar_event_id) values($1,'Owned existing plan','active','weekly','Preserved note',$2)",[owner,link]);
 initialRows=(await db.query<{row:Plan}>('select to_jsonb(p) as row from plans p')).rows.map(result=>result.row);return initialRows[0];
}
function remove(){act(()=>host.querySelector<HTMLButtonElement>(`button[aria-label="Owned existing plan: ${copy.en.deletePlan}"]`)!.click());}
function confirmDelete(){act(()=>[...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button=>button.textContent==='Delete')!.click());}
it('keeps a newer plan and sends no Calendar cleanup after a stale deletion receipt',async()=>{
 const source=await seedPlan('retained-event');await db.query("update plans set notes='Newer note' where id=$1",[source.id]);const calendar=vi.fn();vi.stubGlobal('fetch',calendar);render();remove();confirmDelete();
 await settle(()=>expect(host.querySelector('[role="alert"]')?.textContent).toContain(copy.en.planChanged));expect(host.textContent).toContain(source.title);expect((await db.query('select notes from plans')).rows).toEqual([{notes:'Newer note'}]);expect(calendar).not.toHaveBeenCalled();expect(sent.filter(request=>request.method==='DELETE')).toHaveLength(1);
});
it('keeps a confirmed plan deletion when optional Calendar cleanup fails, without retrying either write',async()=>{
 await seedPlan('retained-event');const calendar=vi.fn().mockResolvedValue(Response.json({error:'PRIVATE TEST'},{status:503}));vi.stubGlobal('fetch',calendar);render();remove();confirmDelete();await settle(()=>expect(host.querySelector('[role="status"]')?.textContent).toBe(copy.en.calendarDeleteFailed));
 expect(host.textContent).not.toContain('Owned existing plan');expect((await db.query('select id from plans')).rows).toEqual([]);expect(sent.filter(request=>request.method==='DELETE')).toHaveLength(1);expect(calendar).toHaveBeenCalledOnce();expect(calendar.mock.calls[0][1]).toMatchObject({method:'DELETE',headers:{'x-calendar-owner':owner}});
});
it('Home confirms a completion version and preserves the other plan fields',async()=>{
 const source=await seedPlan();recurring=true;render();await settle(()=>expect(host.querySelector(`button[aria-label="Owned existing plan: ${copy.en.markDone}"]`)).not.toBeNull());
 act(()=>host.querySelector<HTMLButtonElement>(`button[aria-label="Owned existing plan: ${copy.en.markDone}"]`)!.click());await settle(()=>expect(host.querySelector(`button[aria-label="Owned existing plan: ${copy.en.markNotDone}"]`)).not.toBeNull());
 const row=(await db.query<{row:Plan}>('select to_jsonb(p) as row from plans p')).rows[0].row;expect(row).toEqual({...source,last_completed_at:row.last_completed_at,updated_at:row.updated_at});expect(row.last_completed_at).not.toBeNull();expect(row.updated_at).not.toBe(source.updated_at);expect(sent.map(request=>request.method)).toEqual(['PATCH']);
});
