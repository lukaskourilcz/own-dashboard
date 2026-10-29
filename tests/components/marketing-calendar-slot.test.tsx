// @vitest-environment happy-dom
import { act,StrictMode } from 'react';
import { createRoot,type Root } from 'react-dom/client';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { MarketingPanel } from '@/components/panels/marketing-panel';
import { NavigationGuardProvider } from '@/components/navigation-guard';
import { OwnerPreferencesProvider } from '@/lib/owner-preferences';
import { calendarReleaseCopy } from '@/lib/marketing/calendar-release-copy';
import { marketingWorkspace } from '@/lib/i18n/sections/marketing-workspace';
import { qk } from '@/lib/queries/keys';
import { calendarReleaseFixture } from '../lib/marketing-calendar-release-fixture';
import { stateOwner } from '../lib/marketing-state-fixture';
const m=vi.hoisted(()=>({lang:'en' as 'en'|'cs'}));
vi.mock('@/lib/i18n/lang',async original=>({...await original<typeof import('@/lib/i18n/lang')>(),useLang:()=>({lang:m.lang})}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement,root:Root,client:QueryClient;
beforeEach(()=>{m.lang='en';host=document.createElement('div');document.body.append(host);root=createRoot(host);client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});vi.setSystemTime(new Date('2026-10-29T10:00:00Z'));});
afterEach(()=>{act(()=>root.unmount());host.remove();client.clear();vi.unstubAllGlobals();vi.useRealTimers();});
const render=()=>act(()=>root.render(<StrictMode><QueryClientProvider client={client}><NavigationGuardProvider><OwnerPreferencesProvider ownerId={stateOwner}><MarketingPanel onOpenKnowledge={vi.fn()}/></OwnerPreferencesProvider></NavigationGuardProvider></QueryClientProvider></StrictMode>));
const ready=()=>vi.waitFor(async()=>{await act(async()=>{});expect(host.textContent).toContain('Reviewed draft');});
const buttons=(scope:ParentNode=document)=>[...scope.querySelectorAll<HTMLButtonElement>('button')];
const button=(text:string,scope:ParentNode=document)=>buttons(scope).find(item=>item.textContent===text)!;
const editor=()=>[...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(item=>item.querySelector('form'))!;
const choose=()=>{const select=editor().querySelector('select')!;act(()=>{select.value=select.options[1].value;select.dispatchEvent(new Event('change',{bubbles:true}));});return select.value;};
const open=async()=>{render();await ready();act(()=>host.querySelector<HTMLButtonElement>('#marketing-tab-calendar')!.click());act(()=>button(calendarReleaseCopy[m.lang].opener).click());};
const settled=()=>act(async()=>{await client.getQueryCache().find({queryKey:qk.marketingState})!.promise?.catch(()=>undefined);});
for(const lang of ['en','cs'] as const){
 it(`${lang}: confirms one captured slot attempt, reloads once and never publishes`,async()=>{
  m.lang=lang;const {state,intent,receipt}=calendarReleaseFixture();let reads=0;const posts:RequestInit[]=[];vi.stubGlobal('fetch',vi.fn(async(url,options?:RequestInit)=>{if(url==='/api/marketing/calendar-entries'){posts.push(options!);return Response.json(receipt);}expect(options?.method??'GET').toBe('GET');reads++;return Response.json(reads===1?state:{...state,entries:[receipt.entry]});}));
  await open();choose();await act(async()=>{const save=button(calendarReleaseCopy[lang].save,editor());save.click();save.click();await vi.waitFor(()=>expect(reads).toBe(2));});await settled();expect(posts).toHaveLength(1);expect(JSON.parse(posts[0].body as string)).toEqual(intent);expect(posts[0].headers).toEqual({'Content-Type':'application/json','x-own-dashboard-owner':stateOwner});expect(editor()).toBeUndefined();expect(host.textContent).toContain(marketingWorkspace[lang].slotPrepared);
 });
 it(`${lang}: requires an explicit successful fresh read after uncertainty even when the payload and clock are identical`,async()=>{
  m.lang=lang;const {state}=calendarReleaseFixture();let reads=0,posts=0,failRead=false;vi.stubGlobal('fetch',vi.fn(async(url)=>{if(url==='/api/marketing/calendar-entries'){posts++;return Response.json({ok:true});}reads++;return failRead?Response.json({error:'unavailable'},{status:503}):Response.json(state);}));
  await open();const selected=choose();await act(async()=>{button(calendarReleaseCopy[lang].save,editor()).click();});await vi.waitFor(async()=>{await act(async()=>{});expect(editor().textContent).toContain(calendarReleaseCopy[lang].unconfirmed);});expect(posts).toBe(1);expect(reads).toBe(1);expect(button(calendarReleaseCopy[lang].save,editor()).disabled).toBe(true);
  failRead=true;act(()=>button(calendarReleaseCopy[lang].reload,editor()).click());await settled();expect(button(calendarReleaseCopy[lang].save,editor()).disabled).toBe(true);expect(editor().querySelector('select')!.value).toBe(selected);
  failRead=false;act(()=>button(calendarReleaseCopy[lang].reload,editor()).click());await settled();await vi.waitFor(async()=>{await act(async()=>{});expect(button(calendarReleaseCopy[lang].save,editor()).disabled).toBe(false);});expect(editor().textContent).toContain(calendarReleaseCopy[lang].rechecked);expect(reads).toBe(3);expect(posts).toBe(1);
 });
 it(`${lang}: keeps an edited source choice when the entry disappears and guards discarding it`,async()=>{
  m.lang=lang;const {state}=calendarReleaseFixture();let reads=0;vi.stubGlobal('fetch',vi.fn(async()=>Response.json(++reads===1?state:{...state,campaigns:[],entries:[]})));await open();const selected=choose();act(()=>button(marketingWorkspace[lang].refresh,host).click());await settled();await vi.waitFor(async()=>{await act(async()=>{});expect(editor().textContent).toContain(calendarReleaseCopy[lang].missing);});expect(editor().querySelector('select')!.value).toBe(selected);expect(button(calendarReleaseCopy[lang].save,editor()).disabled).toBe(true);
  act(()=>button(calendarReleaseCopy[lang].cancel,editor()).click());const dialogs=[...document.querySelectorAll('[role="dialog"]')];expect(dialogs).toHaveLength(2);act(()=>button(lang==='cs'?'Zůstat zde':'Stay here').click());expect(editor().querySelector('select')!.value).toBe(selected);
  act(()=>button(calendarReleaseCopy[lang].cancel,editor()).click());act(()=>button(lang==='cs'?'Zahodit a odejít':'Discard and leave').click());expect(editor()).toBeUndefined();expect(reads).toBe(2);
 });
}
it.each(['source','entry','expiry'] as const)('does not silently adopt a changed %s after a refresh',async kind=>{
 const {state}=calendarReleaseFixture(),changed=structuredClone(state);if(kind==='source')changed.sources[0].packet.sourceRevision='v2';if(kind==='entry')changed.entries[0].capture_hash='f'.repeat(64);if(kind==='expiry')changed.sources[0].packet.expiresAt='2026-10-29T09:00:00Z';let reads=0;vi.stubGlobal('fetch',vi.fn(async()=>Response.json(++reads===1?state:changed)));await open();const selected=choose();act(()=>button(marketingWorkspace.en.refresh,host).click());await settled();await vi.waitFor(async()=>{await act(async()=>{});expect(editor().textContent).toContain(kind==='entry'?calendarReleaseCopy.en.changed:kind==='expiry'?calendarReleaseCopy.en.noSource:calendarReleaseCopy.en.sourceChanged);});expect(editor().querySelector('select')!.value).toBe(selected);expect(button(calendarReleaseCopy.en.save,editor()).disabled).toBe(true);
 if(kind==='source'){const choice=editor().querySelector('select')!;act(()=>{choice.value=choice.options[choice.options.length-1].value;choice.dispatchEvent(new Event('change',{bubbles:true}));});expect(choice.value).not.toBe(selected);expect(button(calendarReleaseCopy.en.save,editor()).disabled).toBe(false);}
});
it('retires an in-flight slot on unmount, guards exits and refuses its late receipt',async()=>{
 const {state,receipt}=calendarReleaseFixture();let finish!:(value:Response)=>void,signal:AbortSignal|undefined;const fetcher=vi.fn((url,options?:RequestInit)=>url==='/api/marketing/calendar-entries'?new Promise<Response>(resolve=>{finish=resolve;signal=options?.signal as AbortSignal;}):Promise.resolve(Response.json(state)));vi.stubGlobal('fetch',fetcher);await open();choose();act(()=>button(calendarReleaseCopy.en.save,editor()).click());await vi.waitFor(()=>expect(signal).toBeDefined());act(()=>button(calendarReleaseCopy.en.cancel,editor()).click());expect(button('Discard and leave').disabled).toBe(true);const exit=new Event('beforeunload',{cancelable:true});window.dispatchEvent(exit);expect(exit.defaultPrevented).toBe(true);
 act(()=>root.render(null));expect(signal?.aborted).toBe(true);expect(client.getQueryState(qk.marketingState)?.isInvalidated).toBe(true);await act(async()=>{finish(Response.json(receipt));await Promise.resolve();});expect(fetcher).toHaveBeenCalledTimes(2);expect(editor()).toBeUndefined();
});
it('can save and leave through the shared guard only after exact confirmation',async()=>{
 const {state,receipt}=calendarReleaseFixture();let posts=0;vi.stubGlobal('fetch',vi.fn(async url=>{if(url==='/api/marketing/calendar-entries'){posts++;return Response.json(receipt);}return Response.json(state);}));await open();choose();act(()=>button(calendarReleaseCopy.en.cancel,editor()).click());await act(async()=>{button('Save and leave').click();await vi.waitFor(()=>expect(editor()).toBeUndefined());});expect(posts).toBe(1);expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('explains an inactive plan before any attempted release',async()=>{const {state}=calendarReleaseFixture();state.campaigns[0].status='draft';const fetcher=vi.fn(async()=>Response.json(state));vi.stubGlobal('fetch',fetcher);await open();expect(editor().textContent).toContain(calendarReleaseCopy.en.inactive);expect(editor().querySelector('select')!.disabled).toBe(true);expect(button(calendarReleaseCopy.en.save,editor()).disabled).toBe(true);expect(fetcher).toHaveBeenCalledOnce();});
it('rebases a changed entry only after the owner discards the retained draft',async()=>{
 const {state}=calendarReleaseFixture(),changed=structuredClone(state);changed.entries[0].capture_hash='f'.repeat(64);changed.entries[0].local_time='11:00';let reads=0;vi.stubGlobal('fetch',vi.fn(async()=>Response.json(++reads===1?state:changed)));await open();choose();act(()=>button(calendarReleaseCopy.en.reload,editor()).click());await settled();await vi.waitFor(async()=>{await act(async()=>{});expect(editor().textContent).toContain(calendarReleaseCopy.en.changed);});act(()=>button(calendarReleaseCopy.en.reset,editor()).click());expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);act(()=>button('Stay here').click());expect(editor().querySelector<HTMLInputElement>('input[type="time"]')!.value).toBe('09:00');act(()=>button(calendarReleaseCopy.en.reset,editor()).click());act(()=>button('Discard and leave').click());expect(editor().querySelector<HTMLInputElement>('input[type="time"]')!.value).toBe('11:00');expect(editor().querySelector('select')!.value).toBe('');expect(reads).toBe(2);
});
it('rechecks source expiry at click time before the next shared clock tick',async()=>{
 const {state}=calendarReleaseFixture();state.sources[0].packet.expiresAt='2026-10-29T10:00:01Z';const fetcher=vi.fn(async()=>Response.json(state));vi.stubGlobal('fetch',fetcher);await open();choose();expect(button(calendarReleaseCopy.en.save,editor()).disabled).toBe(false);vi.setSystemTime(new Date('2026-10-29T10:00:02Z'));act(()=>button(calendarReleaseCopy.en.save,editor()).click());expect(fetcher).toHaveBeenCalledOnce();act(()=>window.dispatchEvent(new Event('focus')));expect(editor().textContent).toContain(calendarReleaseCopy.en.noSource);expect(button(calendarReleaseCopy.en.save,editor()).disabled).toBe(true);
});
