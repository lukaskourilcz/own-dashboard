// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {Storage} from 'happy-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {SavedPositionsView} from '@/components/panels/career-saved-positions';
import {OwnerPreferencesProvider} from '@/lib/owner-preferences';
import type {SavedJobPosition,Updater} from '@/lib/types';
const gate=vi.hoisted(()=>({from:vi.fn(),confirm:vi.fn()}));
vi.mock('@/lib/supabase/client',()=>({createClient:()=>({from:gate.from})}));
vi.mock('@/components/ui/confirmation-dialog',()=>({useConfirmation:()=>gate.confirm}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',stamp='2026-10-26T12:00:00Z';
let root:Root,host:HTMLDivElement,client:QueryClient,source:SavedJobPosition;
const update=vi.fn<Updater<SavedJobPosition[]>>(),reveal=vi.fn();
function tree(actor=owner){return <QueryClientProvider client={client}><OwnerPreferencesProvider ownerId={actor}><SavedPositionsView readyOnly positions={[source]} setPositions={update} userId={actor} onPrepare={vi.fn()} onReveal={reveal}/></OwnerPreferencesProvider></QueryClientProvider>;}
beforeEach(()=>{vi.stubGlobal('localStorage',new Storage());document.documentElement.lang='en';host=document.createElement('div');document.body.append(host);root=createRoot(host);client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});source={id:'33333333-3333-4333-8333-333333333333',user_id:owner,listing_id:null,title:'Synthetic saved role',company:null,url:'https://thehub.io/jobs/synthetic-source',location:'Oslo',remote:null,source:'manual',description:null,cover_letter:'Synthetic original letter',notes:'Synthetic original note',cover_letter_url:null,readiness:'draft',saved_at:stamp,updated_at:stamp};gate.from.mockReset();gate.confirm.mockReset();update.mockReset();reveal.mockReset();});
afterEach(()=>{act(()=>root.unmount());host.remove();client.clear();vi.clearAllMocks();vi.unstubAllGlobals();document.documentElement.lang='';});
const removeControl=()=>host.querySelector<HTMLButtonElement>('button[aria-label="Remove saved position"]')!;
it('reserves once and retains the complete private source captured before confirmation',async()=>{
 let finish!:(accepted:boolean)=>void;gate.confirm.mockImplementation(()=>new Promise<boolean>(resolve=>{finish=resolve;}));const builder={delete:vi.fn(()=>builder),eq:vi.fn(()=>builder),select:vi.fn(()=>builder),retry:vi.fn(()=>builder),abortSignal:vi.fn(async()=>({data:[],error:null}))};gate.from.mockReturnValue(builder);
 await act(async()=>root.render(tree()));act(()=>{removeControl().click();removeControl().click();});expect(gate.confirm).toHaveBeenCalledOnce();source.updated_at='2026-10-26T12:00:00.000001Z';source.notes='Changed after confirmation began';await act(async()=>{finish(true);});
 expect(gate.from).toHaveBeenCalledExactlyOnceWith('saved_job_positions');expect(builder.eq).toHaveBeenCalledWith('updated_at',stamp);expect(builder.eq).toHaveBeenCalledWith('user_id',owner);expect(builder.retry).toHaveBeenCalledWith(false);expect(update).not.toHaveBeenCalled();
});
it('retires pending confirmation after owner replacement without sending any write',async()=>{
 let finish!:(accepted:boolean)=>void;gate.confirm.mockImplementation(()=>new Promise<boolean>(resolve=>{finish=resolve;}));await act(async()=>root.render(tree()));act(()=>removeControl().click());await act(async()=>root.render(tree(other)));await act(async()=>{finish(true);});expect(gate.from).not.toHaveBeenCalled();expect(update).not.toHaveBeenCalled();expect(reveal).not.toHaveBeenCalled();
});
it('retires an already-started request on unmount and ignores its late receipt',async()=>{
 gate.confirm.mockResolvedValue(true);let signal!:AbortSignal,settle!:(value:{data:unknown;error:null})=>void;const builder={delete:()=>builder,eq:()=>builder,select:()=>builder,retry:()=>builder,abortSignal:(captured:AbortSignal)=>{signal=captured;return new Promise(resolve=>{settle=resolve;});}};gate.from.mockReturnValue(builder);await act(async()=>root.render(tree()));await act(async()=>removeControl().click());expect(signal.aborted).toBe(false);await act(async()=>root.render(null));expect(signal.aborted).toBe(true);await act(async()=>settle({data:[source],error:null}));expect(update).not.toHaveBeenCalled();expect(reveal).not.toHaveBeenCalled();
});

it('keeps legacy unsafe posting URLs inert while retaining the readable private title',async()=>{
 source.url='javascript:alert(1)';await act(async()=>root.render(tree()));expect(host.querySelector('a')).toBeNull();expect(host.querySelector('[data-career-saved-title]')?.textContent).toBe(source.title);expect(host.textContent).toContain('Synthetic original note');
});
