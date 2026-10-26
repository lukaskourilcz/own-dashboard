// @vitest-environment happy-dom
import {act,useLayoutEffect} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {OwnerPreferencesProvider} from '@/lib/owner-preferences';
import {useCareerApplicationDraft} from '@/components/panels/use-career-application-draft';
import {CareerApplicationError,type CareerApplicationReceipt} from '@/lib/career-application-save';
import type {SavedJobPosition,Updater,JobApplication,JobApplicationEvent} from '@/lib/types';
import {qk} from '@/lib/queries/keys';
const gate=vi.hoisted(()=>({record:vi.fn(),update:vi.fn(),read:vi.fn()}));
vi.mock('@/lib/career-application-save',async original=>({...await original<typeof import('@/lib/career-application-save')>(),recordCareerApplication:gate.record}));
vi.mock('@/lib/career-saved-records',async original=>({...await original<typeof import('@/lib/career-saved-records')>(),updateCareerSavedRecord:gate.update}));
vi.mock('@/lib/career-records',async original=>({...await original<typeof import('@/lib/career-records')>(),readCareerRecords:gate.read}));
vi.mock('@/lib/supabase/client',()=>({createClient:()=>({})}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333',stamp='2026-10-26T12:00:00.000001Z',later='2026-10-26T12:00:00.000002Z';
let root:Root,host:HTMLDivElement,client:QueryClient,source:SavedJobPosition,draft:ReturnType<typeof useCareerApplicationDraft>;
const saved=vi.fn<Updater<SavedJobPosition[]>>(),apps=vi.fn<Updater<JobApplication[]>>(),events=vi.fn<Updater<JobApplicationEvent[]>>(),recorded=vi.fn(),confirmed=vi.fn();
function Harness({actor=owner}:{actor?:string}){const value=useCareerApplicationDraft({source,userId:actor,day:'2026-10-26',setSavedPositions:saved,setApplications:apps,setEvents:events,onRecorded:recorded,onDraftSaved:confirmed});useLayoutEffect(()=>{draft=value;},[value]);return <output>{value.form.notes}</output>;}
function tree(actor=owner){return <QueryClientProvider client={client}><OwnerPreferencesProvider ownerId={actor}><Harness actor={actor}/></OwnerPreferencesProvider></QueryClientProvider>;}
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});source={id,user_id:owner,listing_id:null,title:'Synthetic position',company:null,url:'https://example.test/job',source:'manual',location:'Oslo',remote:false,description:null,cover_letter:'Synthetic original letter',notes:'Synthetic original note',cover_letter_url:null,readiness:'draft',saved_at:stamp,updated_at:stamp};for(const mock of [gate.record,gate.update,gate.read,saved,apps,events,recorded,confirmed])mock.mockReset();});
afterEach(()=>{act(()=>root.unmount());host.remove();client.clear();});
it('captures the opening version, reserves the same frame and retries exactly the uncertain intent',async()=>{
 gate.record.mockRejectedValue(new CareerApplicationError());await act(async()=>root.render(tree()));act(()=>draft.update({notes:'Synthetic edited note'}));source={...source,notes:'Newer props note',updated_at:later};await act(async()=>root.render(tree()));await act(async()=>{draft.record();draft.record();});
 expect(gate.record).toHaveBeenCalledOnce();const first=gate.record.mock.calls[0];expect(first[2]).toMatchObject({updated_at:stamp,notes:'Synthetic original note'});expect(first[3]).toMatchObject({notes:'Synthetic edited note'});expect(draft.form.notes).toBe('Synthetic edited note');expect(draft.locked).toBe(true);
 act(()=>draft.update({notes:'Must not replace uncertain intent'}));await act(async()=>draft.retry());expect(gate.record).toHaveBeenCalledTimes(2);expect(gate.record.mock.calls[1].slice(2)).toEqual(first.slice(2));expect(saved).not.toHaveBeenCalled();expect(recorded).not.toHaveBeenCalled();
});
it('saves changed fields only and keeps oversized unchanged legacy text intact',async()=>{
 source.cover_letter='x'.repeat(70_000);gate.update.mockImplementation(async(_db,_scope,before,patch)=>({...before,...patch,updated_at:later}));await act(async()=>root.render(tree()));act(()=>draft.update({notes:'Synthetic edited note'}));await act(async()=>{expect(await draft.saveDraft()).toBe(true);});expect(gate.update.mock.calls[0][2]).toMatchObject({updated_at:stamp,cover_letter:source.cover_letter});expect(gate.update.mock.calls[0][3]).toEqual({notes:'Synthetic edited note'});expect(draft.form.coverLetter).toBe(source.cover_letter);expect(confirmed).toHaveBeenCalledOnce();
});
it('keeps a conflict draft through a failed reload, then rebases only on the explicit successful reload',async()=>{
 gate.record.mockRejectedValue(new CareerApplicationError('changed'));await act(async()=>root.render(tree()));act(()=>draft.update({notes:'Synthetic retained draft'}));await act(async()=>draft.record());gate.read.mockRejectedValue(new Error('PRIVATE TEST'));await act(async()=>draft.reload());expect(draft.reloadFailed).toBe(true);expect(draft.failure?.reason).toBe('changed');expect(draft.form.notes).toBe('Synthetic retained draft');expect(draft.locked).toBe(true);
 gate.read.mockResolvedValue({data:[{...source,notes:'Synthetic newer note',updated_at:later}]});await act(async()=>draft.reload());expect(draft.form.notes).toBe('Synthetic newer note');expect(draft.failure).toBeNull();await act(async()=>draft.record());expect(gate.record.mock.calls[1][2]).toMatchObject({updated_at:later,notes:'Synthetic newer note'});
});
it.each(['owner','unmount'] as const)('retires %s during a pending action and ignores its late confirmation',async mode=>{
 let finish!:(receipt:CareerApplicationReceipt)=>void;gate.record.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));await act(async()=>root.render(tree()));act(()=>draft.record());const signal=gate.record.mock.calls[0][1].signal as AbortSignal;expect(signal.aborted).toBe(false);await act(async()=>root.render(mode==='owner'?tree(other):null));expect(signal.aborted).toBe(true);await act(async()=>finish({} as CareerApplicationReceipt));expect(saved).not.toHaveBeenCalled();expect(recorded).not.toHaveBeenCalled();
});
it('cancels all canonical reads before applying receipts and preserves newer cached progress',async()=>{
 const application={id:'44444444-4444-4444-8444-444444444444',user_id:owner,request_id:id} as JobApplication,receipt={ownerId:owner,requestId:id,row:application,event:null} as CareerApplicationReceipt;
 client.setQueryData(qk.jobApplications,[]);client.setQueryData(qk.jobApplicationEvents,[]);client.setQueryData(qk.savedJobPositions,[source]);const signals:AbortSignal[]=[];
 for(const queryKey of [qk.savedJobPositions,qk.jobApplications,qk.jobApplicationEvents])void client.fetchQuery({queryKey,queryFn:({signal})=>{signals.push(signal);return new Promise(()=>{});}}).catch(()=>undefined);
 gate.record.mockResolvedValue(receipt);await act(async()=>root.render(tree()));await act(async()=>draft.record());expect(signals).toHaveLength(3);expect(signals.every(signal=>signal.aborted)).toBe(true);expect(recorded).toHaveBeenCalledOnce();
 const updater=apps.mock.calls[0][0] as (rows:JobApplication[])=>JobApplication[],newer=[{...application,notes:'Synthetic newer progress'}];expect(updater(newer)).toBe(newer);
});
