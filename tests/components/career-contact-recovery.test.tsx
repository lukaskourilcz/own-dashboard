// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {Storage} from 'happy-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {CareerProgressDialog} from '@/components/panels/career-progress-dialog';
import {OwnerPreferencesProvider} from '@/lib/owner-preferences';
import {qk} from '@/lib/queries/keys';
import type {JobApplication,Updater,JobApplicationEvent} from '@/lib/types';
const gate=vi.hoisted(()=>({rpc:vi.fn(),request:vi.fn(),from:vi.fn()}));
vi.mock('@/lib/supabase/client',()=>({createClient:()=>({rpc:gate.rpc,from:gate.from})}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333',stamp='2026-10-26T12:00:00.000001Z',later='2026-10-26T12:00:00.000002Z';
let root:Root,host:HTMLDivElement,client:QueryClient,source:JobApplication;
const update=vi.fn<Updater<JobApplication[]>>(),events=vi.fn<Updater<JobApplicationEvent[]>>(),close=vi.fn();
const receipt=()=>({ownerId:owner,source:{id,updatedAt:stamp},row:{...source,contact_name:'Synthetic contact',updated_at:later},events:[]});
function tree(actor=owner){return <QueryClientProvider client={client}><OwnerPreferencesProvider ownerId={actor}><CareerProgressDialog app={source} userId={actor} onClose={close} setApplications={update} setEvents={events}/></OwnerPreferencesProvider></QueryClientProvider>;}
beforeEach(()=>{vi.stubGlobal('localStorage',new Storage());document.documentElement.lang='en';host=document.createElement('div');document.body.append(host);root=createRoot(host);client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});source={id,user_id:owner,listing_id:null,title:'Synthetic role',company:'Synthetic company',url:null,source:'manual',location:'Oslo',remote:false,cover_letter:'Synthetic private letter',status:'applied',applied_on:'2026-10-01',notes:'Synthetic original note',created_at:stamp,updated_at:stamp,organization_id:null,next_follow_up_at:null,cover_letter_url:null,request_id:null,responded_on:null,response_kind:null,contact_name:null,contact_email:null};client.setQueryData(qk.jobApplications,[source]);client.setQueryData(qk.jobApplicationEvents,[]);for(const mock of [gate.rpc,gate.request,gate.from,update,events,close])mock.mockReset();const builder={retry:()=>builder,abortSignal:(signal:AbortSignal)=>gate.request(signal)};gate.rpc.mockReturnValue(builder);});
afterEach(()=>{act(()=>root.unmount());host.remove();client.clear();document.documentElement.lang='';vi.unstubAllGlobals();});
async function open(){await act(async()=>root.render(tree()));const input=document.querySelector<HTMLInputElement>('#contact-name')!;act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Synthetic contact');input.dispatchEvent(new Event('input',{bubbles:true}));});return input;}
function submit(){document.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));}
it('retains the contact/progress draft on an unconfirmed atomic save with no second write',async()=>{
 gate.request.mockResolvedValue({data:null,error:{code:'XX000',message:'PRIVATE TEST'}});const input=await open();await act(async()=>submit());expect(gate.rpc).toHaveBeenCalledExactlyOnceWith('update_captured_job_application',{p_expected_owner:owner,p_id:id,p_updated_at:stamp,p_patch:{contact_name:'Synthetic contact'}});expect(gate.from).not.toHaveBeenCalled();expect(update).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();expect(input.value).toBe('Synthetic contact');expect(input.readOnly).toBe(true);expect(document.querySelector('[role="alert"]')?.textContent).toContain('unconfirmed');
});
it('reserves the same frame and keeps the opening source despite newer props',async()=>{
 let finish!:(value:{data:unknown;error:null})=>void;gate.request.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));await open();act(()=>{submit();submit();});expect(gate.rpc).toHaveBeenCalledOnce();const confirmed=receipt();source={...source,notes:'Synthetic newer props',updated_at:later};await act(async()=>root.render(tree()));await act(async()=>finish({data:confirmed,error:null}));expect(close).toHaveBeenCalledOnce();expect(update).toHaveBeenCalledOnce();expect(gate.rpc.mock.calls[0][1].p_updated_at).toBe(stamp);
});
it.each(['owner','unmount'] as const)('retires %s and ignores an uncooperative late receipt',async mode=>{
 let finish!:(value:{data:unknown;error:null})=>void;gate.request.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));await open();act(()=>submit());const signal=gate.request.mock.calls[0][0] as AbortSignal;expect(signal.aborted).toBe(false);const confirmed=receipt();await act(async()=>root.render(mode==='owner'?tree(other):null));expect(signal.aborted).toBe(true);await act(async()=>finish({data:confirmed,error:null}));expect(update).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();
});
it('cancels both canonical reads before applying a confirmed receipt',async()=>{
 const signals:AbortSignal[]=[];for(const queryKey of [qk.jobApplications,qk.jobApplicationEvents])void client.fetchQuery({queryKey,queryFn:({signal})=>{signals.push(signal);return new Promise(()=>{});}}).catch(()=>undefined);gate.request.mockImplementation(async()=>({data:receipt(),error:null}));await open();await act(async()=>submit());expect(signals.every(signal=>signal.aborted)).toBe(true);expect(update).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();
});
it('refuses an unrelated private-field receipt without updating or closing the draft',async()=>{
 gate.request.mockImplementation(async()=>({data:{...receipt(),row:{...receipt().row,notes:'Unexpected private note'}},error:null}));const input=await open();await act(async()=>submit());expect(update).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();expect(input.value).toBe('Synthetic contact');expect(document.querySelector('[role="alert"]')?.textContent).toContain('unconfirmed');
});
it('retires the paired history read when an explicit application reload fails',async()=>{
 let historySignal!:AbortSignal,finish!:(value:{data:unknown;error:null})=>void;
 gate.rpc.mockImplementation((name:string,args:Record<string,string>)=>{const builder={retry:()=>builder,abortSignal:(signal:AbortSignal)=>{
  if(name==='update_captured_job_application')return Promise.resolve({data:null,error:{code:'P0002'}});
  if(args.p_entity==='job_applications')return Promise.resolve({data:null,error:{code:'XX000',message:'PRIVATE TEST'}});
  historySignal=signal;return new Promise(resolve=>{finish=resolve;});
 }};return builder;});
 const input=await open();await act(async()=>submit());const reload=[...document.querySelectorAll('button')].find(button=>button.textContent==='Discard draft and load latest')!;await act(async()=>reload.click());expect(historySignal.aborted).toBe(true);expect(input.value).toBe('Synthetic contact');expect(document.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');await act(async()=>finish({data:{ownerId:owner,collection:'job_application_events',rows:[]},error:null}));expect(update).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();expect(input.value).toBe('Synthetic contact');
});
