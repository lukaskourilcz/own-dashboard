// @vitest-environment happy-dom
import {act,useLayoutEffect} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useCareerApplicationRecordWrite} from '@/components/panels/use-career-application-record-write';
import {OwnerPreferencesProvider} from '@/lib/owner-preferences';
import {qk} from '@/lib/queries/keys';
import type {JobApplication,JobApplicationEvent,Updater} from '@/lib/types';
const gate=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn(),request:vi.fn(),confirm:vi.fn(),eq:vi.fn()}));
vi.mock('@/lib/supabase/client',()=>({createClient:()=>({from:gate.from,rpc:gate.rpc})}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333',stamp='2026-10-26T12:00:00.000001Z',later='2026-10-26T12:00:00.000002Z';
let root:Root,host:HTMLDivElement,client:QueryClient,source:JobApplication,writer:ReturnType<typeof useCareerApplicationRecordWrite>;
const applications=vi.fn<Updater<JobApplication[]>>(),events=vi.fn<Updater<JobApplicationEvent[]>>();
function Harness({actor=owner}:{actor?:string}){const value=useCareerApplicationRecordWrite({userId:actor,setApplications:applications,setEvents:events});useLayoutEffect(()=>{writer=value;},[value]);return null;}
function tree(actor=owner){return <QueryClientProvider client={client}><OwnerPreferencesProvider ownerId={actor}><Harness actor={actor}/></OwnerPreferencesProvider></QueryClientProvider>;}
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});source={id,user_id:owner,listing_id:null,title:'Synthetic role',company:null,url:null,source:null,location:null,remote:false,cover_letter:'Synthetic original letter',status:'applied',applied_on:'2026-10-01',notes:'Synthetic private note',created_at:stamp,updated_at:stamp,organization_id:null,next_follow_up_at:null,cover_letter_url:null,request_id:null,responded_on:null,response_kind:null,contact_name:null,contact_email:null};client.setQueryData(qk.jobApplications,[source]);client.setQueryData(qk.jobApplicationEvents,[{id:'44444444-4444-4444-8444-444444444444',user_id:owner,application_id:id,kind:'applied',detail:'2026-10-01',created_at:stamp}]);for(const mock of [gate.from,gate.rpc,gate.request,gate.confirm,gate.eq,applications,events])mock.mockReset();const builder={delete:()=>builder,update:()=>builder,eq:(key:string,value:string)=>{gate.eq(key,value);return builder;},select:()=>builder,retry:()=>builder,abortSignal:(signal:AbortSignal)=>gate.request(signal)};gate.from.mockReturnValue(builder);
 applications.mockImplementation(next=>{const current=client.getQueryData<JobApplication[]>(qk.jobApplications)!;client.setQueryData(qk.jobApplications,typeof next==='function'?next(current):next);});events.mockImplementation(next=>{const current=client.getQueryData<JobApplicationEvent[]>(qk.jobApplicationEvents)!;client.setQueryData(qk.jobApplicationEvents,typeof next==='function'?next(current):next);});
});
afterEach(()=>{act(()=>root.unmount());host.remove();client.clear();});
it('reserves once and captures the full source before confirmation, retaining conflicts',async()=>{
 let finish!:(accepted:boolean)=>void;gate.confirm.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));gate.request.mockResolvedValue({data:[],error:null});await act(async()=>root.render(tree()));let pending!:Promise<unknown>;act(()=>{pending=writer.remove(source,gate.confirm);void writer.remove(source,gate.confirm);});expect(gate.confirm).toHaveBeenCalledOnce();source={...source,notes:'Synthetic newer props',updated_at:later};await act(async()=>{finish(true);await pending;});expect(gate.eq).toHaveBeenCalledWith('updated_at',stamp);expect(writer.failure?.reason).toBe('changed');expect(applications).not.toHaveBeenCalled();expect(events).not.toHaveBeenCalled();
});
it('cancels confirmation without an SDK write or cache change',async()=>{
 gate.confirm.mockResolvedValue(false);await act(async()=>root.render(tree()));await act(async()=>writer.remove(source,gate.confirm));expect(gate.from).not.toHaveBeenCalled();expect(applications).not.toHaveBeenCalled();expect(writer.isPending()).toBe(false);
});
it.each(['owner','unmount'] as const)('retires %s during confirmation before sending a write',async mode=>{
 let finish!:(accepted:boolean)=>void;gate.confirm.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));await act(async()=>root.render(tree()));act(()=>{void writer.remove(source,gate.confirm);});await act(async()=>root.render(mode==='owner'?tree(other):null));await act(async()=>finish(true));expect(gate.from).not.toHaveBeenCalled();expect(applications).not.toHaveBeenCalled();
});
it('ignores an already-started uncooperative SDK receipt after unmount',async()=>{
 let finish!:(value:{data:unknown;error:null})=>void;gate.confirm.mockResolvedValue(true);gate.request.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));await act(async()=>root.render(tree()));await act(async()=>{void writer.remove(source,gate.confirm);});const signal=gate.request.mock.calls[0][0] as AbortSignal;await act(async()=>root.render(null));expect(signal.aborted).toBe(true);await act(async()=>finish({data:[source],error:null}));expect(applications).not.toHaveBeenCalled();expect(events).not.toHaveBeenCalled();
});
it('keeps row/history present while pending and cancels canonical reads before confirmed removal',async()=>{
 let finish!:(value:{data:unknown;error:null})=>void;gate.confirm.mockResolvedValue(true);gate.request.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const signals:AbortSignal[]=[];for(const queryKey of [qk.jobApplications,qk.jobApplicationEvents])void client.fetchQuery({queryKey,queryFn:({signal})=>{signals.push(signal);return new Promise(()=>{});}}).catch(()=>undefined);await act(async()=>root.render(tree()));await act(async()=>{void writer.remove(source,gate.confirm);});expect(client.getQueryData(qk.jobApplications)).toEqual([source]);expect((client.getQueryData(qk.jobApplicationEvents) as unknown[])).toHaveLength(1);await act(async()=>finish({data:[source],error:null}));expect(signals.every(signal=>signal.aborted)).toBe(true);expect(client.getQueryData(qk.jobApplications)).toEqual([]);expect(client.getQueryData(qk.jobApplicationEvents)).toEqual([]);
});
it('preserves newer application/history snapshots instead of rolling the collection back',async()=>{
 let finish!:(value:{data:unknown;error:null})=>void;gate.confirm.mockResolvedValue(true);gate.request.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));await act(async()=>root.render(tree()));await act(async()=>{void writer.remove(source,gate.confirm);});const newer=[{...source,notes:'Synthetic newer note',updated_at:later}],history=[{id:'55555555-5555-4555-8555-555555555555',user_id:owner,application_id:id,kind:'note',detail:'Synthetic newer history',created_at:later}];client.setQueryData(qk.jobApplications,newer);client.setQueryData(qk.jobApplicationEvents,history);const appBase=client.getQueryData(qk.jobApplications),eventBase=client.getQueryData(qk.jobApplicationEvents);await act(async()=>finish({data:[source],error:null}));expect(client.getQueryData(qk.jobApplications)).toBe(appBase);expect(client.getQueryData(qk.jobApplicationEvents)).toBe(eventBase);expect(events).not.toHaveBeenCalled();
});
it('updates the letter without cancelling or rewriting unrelated history',async()=>{
 gate.request.mockResolvedValue({data:[{...source,cover_letter:'Synthetic next letter',updated_at:later}],error:null});let historySignal!:AbortSignal;void client.fetchQuery({queryKey:qk.jobApplicationEvents,queryFn:({signal})=>{historySignal=signal;return new Promise(()=>{});}}).catch(()=>undefined);await act(async()=>root.render(tree()));await act(async()=>writer.saveLetter(source,'Synthetic next letter'));expect((client.getQueryData<JobApplication[]>(qk.jobApplications))![0].cover_letter).toBe('Synthetic next letter');expect(historySignal.aborted).toBe(false);expect(events).not.toHaveBeenCalled();
});
