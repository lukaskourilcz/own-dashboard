// @vitest-environment happy-dom
import {act,useLayoutEffect} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useCareerTemplateWrite} from '@/components/panels/use-career-template-write';
import {OwnerPreferencesProvider} from '@/lib/owner-preferences';
import {qk} from '@/lib/queries/keys';
import type {CoverLetterTemplate,Updater} from '@/lib/types';
const gate=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn(),request:vi.fn(),confirm:vi.fn(),eq:vi.fn()}));
vi.mock('@/lib/supabase/client',()=>({createClient:()=>({from:gate.from,rpc:gate.rpc})}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333',stamp='2026-10-26T12:00:00.000001Z',later='2026-10-26T12:00:00.000002Z';
let root:Root,host:HTMLDivElement,client:QueryClient,source:CoverLetterTemplate,writer:ReturnType<typeof useCareerTemplateWrite>;
const templates=vi.fn<Updater<CoverLetterTemplate[]>>();
function Harness({actor=owner}:{actor?:string}){const value=useCareerTemplateWrite({userId:actor,setTemplates:templates});useLayoutEffect(()=>{writer=value;},[value]);return null;}
function tree(actor=owner){return <QueryClientProvider client={client}><OwnerPreferencesProvider ownerId={actor}><Harness actor={actor}/></OwnerPreferencesProvider></QueryClientProvider>;}
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});source={id,user_id:owner,name:'Synthetic template',body:'Synthetic original letter',created_at:stamp,updated_at:stamp};client.setQueryData(qk.coverLetterTemplates,[source]);for(const mock of [gate.from,gate.rpc,gate.request,gate.confirm,gate.eq,templates])mock.mockReset();const builder={insert:()=>builder,delete:()=>builder,update:()=>builder,eq:(key:string,value:string)=>{gate.eq(key,value);return builder;},select:()=>builder,retry:()=>builder,abortSignal:(signal:AbortSignal)=>gate.request(signal)};gate.from.mockReturnValue(builder);
 templates.mockImplementation(next=>{const current=client.getQueryData<CoverLetterTemplate[]>(qk.coverLetterTemplates)!;client.setQueryData(qk.coverLetterTemplates,typeof next==='function'?next(current):next);});
});
afterEach(()=>{act(()=>root.unmount());host.remove();client.clear();});
it('reserves once and captures the full source before confirmation, retaining conflicts',async()=>{
 let finish!:(accepted:boolean)=>void;gate.confirm.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));gate.request.mockResolvedValue({data:[],error:null});await act(async()=>root.render(tree()));let pending!:Promise<unknown>;act(()=>{pending=writer.remove(source,gate.confirm);void writer.remove(source,gate.confirm);});expect(gate.confirm).toHaveBeenCalledOnce();source={...source,body:'Synthetic newer props',updated_at:later};await act(async()=>{finish(true);await pending;});expect(gate.eq).toHaveBeenCalledWith('updated_at',stamp);expect(writer.failure?.reason).toBe('changed');expect(templates).not.toHaveBeenCalled();
});
it('cancels confirmation without an SDK write or cache change',async()=>{
 gate.confirm.mockResolvedValue(false);await act(async()=>root.render(tree()));await act(async()=>writer.remove(source,gate.confirm));expect(gate.from).not.toHaveBeenCalled();expect(templates).not.toHaveBeenCalled();expect(writer.isPending()).toBe(false);
});
it.each(['owner','unmount'] as const)('retires %s during confirmation before sending a write',async mode=>{
 let finish!:(accepted:boolean)=>void;gate.confirm.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));await act(async()=>root.render(tree()));act(()=>{void writer.remove(source,gate.confirm);});await act(async()=>root.render(mode==='owner'?tree(other):null));await act(async()=>finish(true));expect(gate.from).not.toHaveBeenCalled();expect(templates).not.toHaveBeenCalled();
});
it('ignores an already-started uncooperative SDK receipt after unmount',async()=>{
 let finish!:(value:{data:unknown;error:null})=>void;gate.confirm.mockResolvedValue(true);gate.request.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));await act(async()=>root.render(tree()));await act(async()=>{void writer.remove(source,gate.confirm);});const signal=gate.request.mock.calls[0][0] as AbortSignal;await act(async()=>root.render(null));expect(signal.aborted).toBe(true);await act(async()=>finish({data:[source],error:null}));expect(templates).not.toHaveBeenCalled();
});
it('keeps the template present while pending and cancels canonical reads before confirmed removal',async()=>{
 let finish!:(value:{data:unknown;error:null})=>void;gate.confirm.mockResolvedValue(true);gate.request.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const signals:AbortSignal[]=[];for(const queryKey of [qk.coverLetterTemplates])void client.fetchQuery({queryKey,queryFn:({signal})=>{signals.push(signal);return new Promise(()=>{});}}).catch(()=>undefined);await act(async()=>root.render(tree()));await act(async()=>{void writer.remove(source,gate.confirm);});expect(client.getQueryData(qk.coverLetterTemplates)).toEqual([source]);await act(async()=>finish({data:[source],error:null}));expect(signals.every(signal=>signal.aborted)).toBe(true);expect(client.getQueryData(qk.coverLetterTemplates)).toEqual([]);
});
it('preserves newer template snapshots instead of rolling the collection back',async()=>{
 let finish!:(value:{data:unknown;error:null})=>void;gate.confirm.mockResolvedValue(true);gate.request.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));await act(async()=>root.render(tree()));await act(async()=>{void writer.remove(source,gate.confirm);});const newer=[{...source,body:'Synthetic newer note',updated_at:later}];client.setQueryData(qk.coverLetterTemplates,newer);const base=client.getQueryData(qk.coverLetterTemplates);await act(async()=>finish({data:[source],error:null}));expect(client.getQueryData(qk.coverLetterTemplates)).toBe(base);
});
it('retries the exact uncertain creation once without duplicating its cache row',async()=>{
 const created={...source,id:other};gate.request.mockResolvedValueOnce({data:null,error:{code:'503'}}).mockResolvedValueOnce({data:[created],error:null});await act(async()=>root.render(tree()));await act(async()=>writer.create(other,{name:source.name,body:source.body}));expect(writer.failure).toMatchObject({kind:'create',id:other,reason:'unavailable'});client.setQueryData(qk.coverLetterTemplates,[source,created]);const base=client.getQueryData(qk.coverLetterTemplates);await act(async()=>writer.retry());expect(writer.failure).toBeNull();expect(client.getQueryData(qk.coverLetterTemplates)).toBe(base);expect(gate.request).toHaveBeenCalledTimes(2);expect(gate.rpc).not.toHaveBeenCalled();
});
it('saves only a captured body patch and never replaces a newer cache row',async()=>{
 let finish!:(value:{data:unknown;error:null})=>void;gate.request.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));await act(async()=>root.render(tree()));act(()=>{void writer.update(source,{body:'Synthetic next letter'});void writer.update(source,{body:'Synthetic second click'});});const newer={...source,name:'Synthetic newer name',updated_at:'2026-10-26T12:00:00.000003Z'};client.setQueryData(qk.coverLetterTemplates,[newer]);const base=client.getQueryData(qk.coverLetterTemplates);await act(async()=>finish({data:[{...source,body:'Synthetic next letter',updated_at:later}],error:null}));expect(gate.request).toHaveBeenCalledOnce();expect(client.getQueryData(qk.coverLetterTemplates)).toBe(base);expect(writer.failure).toBeNull();
});
it('retains the original failure on failed reload and adopts a complete explicit successful reload',async()=>{
 gate.request.mockResolvedValue({data:[],error:null});gate.confirm.mockResolvedValue(true);await act(async()=>root.render(tree()));await act(async()=>writer.remove(source,gate.confirm));const failure=writer.failure;gate.rpc.mockReturnValue({retry:()=>({abortSignal:()=>Promise.resolve({data:null,error:{code:'503'}})})});await act(async()=>writer.reload(id));expect(writer.failure).toBe(failure);expect(writer.reloadFailed).toBe(true);expect(templates).not.toHaveBeenCalled();gate.rpc.mockReturnValue({retry:()=>({abortSignal:()=>Promise.resolve({data:{ownerId:owner,collection:'cover_letter_templates',rows:[{...source,updated_at:later}]},error:null})})});await act(async()=>writer.reload(id));expect(writer.failure).toBeNull();expect(writer.reloadFailed).toBe(false);expect(client.getQueryData(qk.coverLetterTemplates)).toEqual([{...source,updated_at:later}]);
});
