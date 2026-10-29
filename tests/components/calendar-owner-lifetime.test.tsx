// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CalendarPanel } from '@/components/panels/calendar-panel';
import { OwnerPreferencesProvider } from '@/lib/owner-preferences';
import { NavigationGuardProvider } from '@/components/navigation-guard';
import { calendar } from '@/lib/i18n/sections/calendar';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement,root:Root,client:QueryClient;
beforeEach(()=>{document.documentElement.lang='en';host=document.createElement('div');document.body.append(host);root=createRoot(host);client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});});
afterEach(()=>{act(()=>root.unmount());host.remove();client.clear();document.documentElement.lang='';delete document.documentElement.dataset.guestTour;vi.unstubAllGlobals();vi.restoreAllMocks();});
const render=(id=owner)=>act(()=>root.render(<QueryClientProvider client={client}><OwnerPreferencesProvider ownerId={id}><NavigationGuardProvider><CalendarPanel/></NavigationGuardProvider></OwnerPreferencesProvider></QueryClientProvider>));
function title(value:string){const field=document.querySelector<HTMLInputElement>('[role="dialog"] input[maxlength="500"]')!;act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));});return field;}
function open(){act(()=>[...host.querySelectorAll('button')].find(button=>button.textContent===calendar.en.newEvent)!.click());}
const submit=()=>act(()=>document.querySelector('[role="dialog"] form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
it('cancels the original owner on replacement and cannot apply its late calendar receipt to the new form',async()=>{
 let release!:(response:Response)=>void;const network=vi.fn<typeof fetch>(()=>new Promise(resolve=>{release=resolve;}));vi.stubGlobal('fetch',network);render();open();const field=title('Private owner A event');submit();
 await act(async()=>{await vi.waitFor(()=>expect(network).toHaveBeenCalledOnce());});const options=network.mock.calls[0][1]!;expect(options.headers).toMatchObject({'x-calendar-owner':owner});expect(field.closest("fieldset")!.disabled).toBe(true);
 render(other);expect(options.signal?.aborted).toBe(true);await act(async()=>{release(Response.json({id:'synthetic-event',ownerId:owner}));await Promise.resolve();});open();expect(document.querySelector<HTMLInputElement>('[role="dialog"] input[maxlength="500"]')!.value).toBe('');expect(document.body.textContent).not.toContain(calendar.en.eventAdded);expect(network).toHaveBeenCalledOnce();
});
it('announces a guest action once without a request or a second local error',async()=>{
 document.documentElement.dataset.guestTour='true';const network=vi.fn(),blocked=vi.fn();vi.stubGlobal('fetch',network);window.addEventListener('guest-action-blocked',blocked);try{
 render();open();title('Synthetic guest event');submit();await act(async()=>{await Promise.resolve();});expect(network).not.toHaveBeenCalled();expect(blocked).toHaveBeenCalledOnce();expect(document.querySelector('[role="dialog"] [role="alert"]')).toBeNull();
 }finally{window.removeEventListener('guest-action-blocked',blocked);}
});
