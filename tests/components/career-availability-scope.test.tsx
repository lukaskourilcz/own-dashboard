// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { JobsPanel } from '@/components/panels/jobs-panel';
import { OwnerPreferencesProvider } from '@/lib/owner-preferences';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmationProvider } from '@/components/ui/confirmation-dialog';
import { jobs } from '@/lib/i18n/sections/jobs';
import { jobListings } from '@/lib/demo/fixtures';
import { qk } from '@/lib/queries/keys';
import type { AvailabilityReceipt } from '@/lib/jobs/availability-client';
vi.mock('@/lib/supabase/client',()=>({createClient:()=>({})}));
vi.mock('@/lib/use-prefs',()=>({useCvLinks:()=>({cs:'',en:''}),useCzechCareerVisibility:()=>({showCzechCareer:false})}));
vi.mock('@/components/panels/oslo-career-workspace',()=>({OsloCareerWorkspace:()=>null,OsloLetterReview:()=>null}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const listing={...jobListings[0],id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',source:'remotive',url:'https://remotive.com/remote-jobs/synthetic/one'};
let host:HTMLDivElement,root:Root,client:QueryClient,network:ReturnType<typeof vi.fn>;
beforeEach(()=>{document.documentElement.lang='en';network=vi.fn();vi.stubGlobal('fetch',network);host=document.createElement('div');document.body.append(host);root=createRoot(host);client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});});
afterEach(()=>{act(()=>root.unmount());host.remove();client.clear();vi.unstubAllGlobals();vi.restoreAllMocks();document.documentElement.lang='';});
function tree(rows=[listing]) { return <QueryClientProvider client={client}><OwnerPreferencesProvider ownerId={owner}><TooltipProvider><ConfirmationProvider><JobsPanel activated onActivate={vi.fn()} isPreview={false} listings={rows} userStates={[]} setUserStates={vi.fn()} savedPositions={[]} setSavedPositions={vi.fn()} applications={[]} setApplications={vi.fn()} events={[]} setEvents={vi.fn()} templates={[]} setTemplates={vi.fn()} lastRun={null} userId={owner}/></ConfirmationProvider></TooltipProvider></OwnerPreferencesProvider></QueryClientProvider>; }
async function settle() { await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));}); }
async function render(rows=[listing]) {
 await act(async()=>root.render(tree(rows)));
 await act(async()=>{[...host.querySelectorAll('button')].find(button=>button.textContent===jobs.en.openTab)!.click();});
 await settle();await settle();
}
const packet=(rows=[listing],candidates=rows.length,previouslyChecked=0)=>({ownerId:owner,candidateVersion:'a'.repeat(64),states:Object.fromEntries(rows.map(row=>[row.id,'open'])),versions:Object.fromEntries(rows.map(row=>[row.id,{source:row.source,title:row.title,url:row.url,lastSeenAt:row.last_seen_at}])),checkedAt:new Date().toISOString(),candidates,previouslyChecked,remaining:candidates-previouslyChecked-rows.length});
const moreButton=()=>[...host.querySelectorAll('button')].find(button=>button.textContent?.startsWith('Check more listings'))!;
const sibling={...listing,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',title:'Synthetic React frontend sibling',url:'https://remotive.com/remote-jobs/synthetic/two'};
it('never presents a foreign-account availability receipt as an open vacancy',async()=>{
 network.mockResolvedValue(Response.json({...packet(),ownerId:other}));await render();expect(host.querySelectorAll('[data-career-listing]')).toHaveLength(0);expect(host.textContent).toContain('Availability could not be checked');
});

it('accepts only the exact original offer version and hides an updated same-id offer without another request',async()=>{
 network.mockResolvedValue(Response.json(packet()));await render();expect(host.querySelectorAll('[data-career-listing]')).toHaveLength(1);expect(new Headers(network.mock.calls[0][1].headers).get('x-own-dashboard-owner')).toBe(owner);
 await act(async()=>root.render(tree([{...listing,title:'Changed React frontend title'}])));await settle();expect(host.querySelectorAll('[data-career-listing]')).toHaveLength(0);expect(network).toHaveBeenCalledOnce();
});
it('admits one same-frame next window, captures its version and merges only a matching confirmed result',async()=>{
 let finish!:(value:Response)=>void;network.mockResolvedValueOnce(Response.json(packet([listing],2))).mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve;}));await render([listing,sibling]);
 const button=moreButton();act(()=>{button.click();button.click();});await settle();expect(network).toHaveBeenCalledTimes(2);expect(JSON.parse(network.mock.calls[1][1].body)).toEqual({checkedIds:[listing.id],expectedVersion:'a'.repeat(64)});expect(button.disabled).toBe(true);
 finish(Response.json(packet([sibling],2,1)));await settle();await settle();expect(host.querySelectorAll('[data-career-listing]')).toHaveLength(2);expect(moreButton()).toBeUndefined();expect(network).toHaveBeenCalledTimes(2);
});
it('keeps a next-window failure visible until an explicit successful retry without exposing provider text',async()=>{
 network.mockResolvedValueOnce(Response.json(packet([listing],2))).mockResolvedValueOnce(Response.json({error:'PRIVATE TEST'},{status:503})).mockResolvedValueOnce(Response.json(packet([sibling],2,1)));await render([listing,sibling]);act(()=>moreButton().click());await settle();await settle();expect(host.querySelectorAll('[role=alert]')).toHaveLength(1);expect(host.textContent).not.toContain('PRIVATE TEST');act(()=>moreButton().click());await settle();await settle();expect(host.querySelector('[role=alert]')).toBeNull();expect(host.querySelectorAll('[data-career-listing]')).toHaveLength(2);expect(network).toHaveBeenCalledTimes(3);
});
it.each(['unmount','newer-cache'] as const)('does not apply a late next-window receipt after %s',async kind=>{
 let finish!:(value:Response)=>void;network.mockResolvedValueOnce(Response.json(packet([listing],2))).mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve;}));await render([listing,sibling]);act(()=>moreButton().click());await settle();const signal=network.mock.calls[1][1].signal as AbortSignal;
 const key=[...qk.jobAvailability,owner];let newer:AvailabilityReceipt|undefined;
 if(kind==='unmount'){act(()=>root.render(null));expect(signal.aborted).toBe(true);}else{newer={...packet([listing],2),candidateVersion:'b'.repeat(64)} as AvailabilityReceipt;act(()=>client.setQueryData(key,newer));}
 finish(Response.json(packet([sibling],2,1)));await settle();await settle();const cached=client.getQueryData<AvailabilityReceipt>(key)!;expect(Object.keys(cached.states)).toEqual([listing.id]);if(newer)expect(cached.candidateVersion).toBe(newer.candidateVersion);expect(network).toHaveBeenCalledTimes(2);
});
