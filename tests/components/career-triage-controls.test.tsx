// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {Storage} from 'happy-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {JobsPanel} from '@/components/panels/jobs-panel';
import {OwnerPreferencesProvider} from '@/lib/owner-preferences';
import {TooltipProvider} from '@/components/ui/tooltip';
import {jobListings} from '@/lib/demo/fixtures';
import type {JobListing,JobUserState} from '@/lib/types';
import {jobs} from '@/lib/i18n/sections/jobs';
const gate=vi.hoisted(()=>({rpc:vi.fn(),confirm:vi.fn()}));
vi.mock('@/lib/supabase/client',()=>({createClient:()=>({rpc:gate.rpc})}));
vi.mock('@/components/ui/confirmation-dialog',()=>({useConfirmation:()=>gate.confirm}));
vi.mock('@/lib/use-prefs',()=>({useCvLinks:()=>({cs:'',en:''}),useCzechCareerVisibility:()=>({showCzechCareer:false})}));
vi.mock('@/components/panels/oslo-career-workspace',()=>({OsloCareerWorkspace:()=>null,OsloLetterReview:()=>null}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',stamp='2026-10-26T12:00:00Z';
let root:Root,host:HTMLDivElement,client:QueryClient,source:JobListing,state:JobUserState;
const update=vi.fn<(next:JobUserState[]|((previous:JobUserState[])=>JobUserState[]))=>void>();
const settle=async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});};
function tree(actor=owner){return <QueryClientProvider client={client}><OwnerPreferencesProvider ownerId={actor}><TooltipProvider><JobsPanel activated onActivate={vi.fn()} isPreview listings={[source]} userStates={[state]} setUserStates={update} savedPositions={[]} setSavedPositions={vi.fn()} applications={[]} setApplications={vi.fn()} events={[]} setEvents={vi.fn()} templates={[]} setTemplates={vi.fn()} lastRun={null} userId={actor}/></TooltipProvider></OwnerPreferencesProvider></QueryClientProvider>;}
beforeEach(()=>{vi.stubGlobal('localStorage',new Storage());document.documentElement.lang='en';host=document.createElement('div');document.body.append(host);root=createRoot(host);client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});update.mockReset();source={...jobListings[0],id:'44444444-4444-4444-8444-444444444444',title:'Synthetic React frontend engineer',source:'remotive',url:'https://remotive.com/remote-jobs/synthetic-triage-control',location:'Europe',remote:true,last_seen_at:stamp};state={id:'33333333-3333-4333-8333-333333333333',user_id:owner,listing_id:source.id,state:'shortlisted',created_at:stamp,updated_at:stamp};const builder={retry:()=>builder,abortSignal:async()=>({data:null,error:{code:'P0002'}})};gate.rpc.mockReturnValue(builder);});
afterEach(()=>{act(()=>root.unmount());host.remove();client.clear();vi.clearAllMocks();vi.unstubAllGlobals();document.documentElement.lang='';});
async function open(){await act(async()=>root.render(tree()));act(()=>{[...host.querySelectorAll('button')].find(button=>button.textContent?.trim()===jobs.en.openTab)!.click();});await settle();await settle();return host.querySelector<HTMLButtonElement>('[data-career-delete]')!;}
it('reserves once and captures nested source/state versions before the confirmation wait',async()=>{
 let finish!:(accepted:boolean)=>void;gate.confirm.mockImplementation(()=>new Promise<boolean>(resolve=>{finish=resolve;}));const button=await open();expect(button).not.toBeNull();
 act(()=>{button.click();button.click();});expect(gate.confirm).toHaveBeenCalledOnce();const originalUrl=source.url;
 source.url='https://remotive.com/remote-jobs/new-version';source.last_seen_at='2026-10-26T12:00:00.000001Z';state.state='deleted';state.updated_at='2026-10-26T12:00:00.000001Z';
 await act(async()=>{finish(true);});await settle();expect(gate.rpc).toHaveBeenCalledExactlyOnceWith('apply_career_triage',{p_expected_owner:owner,p_changes:[expect.objectContaining({listingId:source.id,url:originalUrl,lastSeenAt:stamp,next:'deleted',expected:{id:state.id,state:'shortlisted',createdAt:stamp,updatedAt:stamp}})]});expect(update).not.toHaveBeenCalled();
});
it('retires confirmation before any SDK write when the original owner scope is replaced',async()=>{
 let finish!:(accepted:boolean)=>void;gate.confirm.mockImplementation(()=>new Promise<boolean>(resolve=>{finish=resolve;}));const button=await open();act(()=>button.click());expect(gate.confirm).toHaveBeenCalledOnce();await act(async()=>root.render(tree(other)));await act(async()=>{finish(true);});await settle();expect(gate.rpc).not.toHaveBeenCalled();expect(update).not.toHaveBeenCalled();
});
