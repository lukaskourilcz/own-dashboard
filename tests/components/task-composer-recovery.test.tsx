// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Storage } from 'happy-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TaskComposer } from '@/components/tasks/task-composer';
import { NavigationGuardProvider, useGuardedNavigation } from '@/components/navigation-guard';
import { qk } from '@/lib/queries/keys';
import { todos } from '@/lib/i18n/sections/todos';
import { common } from '@/lib/i18n/sections/common';
import type { TaskWrite, TaskWriteReceipt } from '@/lib/task-write';
const state=vi.hoisted(()=>({write:vi.fn(),ok:vi.fn(),navigate:vi.fn()}));
vi.mock('@/lib/task-write',async original=>({...await original<typeof import('@/lib/task-write')>(),writeTask:(...args:unknown[])=>state.write(...args)}));
vi.mock('@/lib/supabase/client',()=>({createClient:()=>({})}));
vi.mock('@/components/ui/toast',()=>({useToast:()=>({ok:state.ok})}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
let root:Root,host:HTMLDivElement,client:QueryClient,actor:string,lang:'en'|'cs';
function confirmed(command:TaskWrite):TaskWriteReceipt{
 if(command.action!=='create')throw Error('Fixture expects create');
 return{kind:'saved',ownerId:command.ownerId,id:command.id,task:{id:command.id,user_id:command.ownerId,done:false,created_at:'2026-10-25T00:00:00.123456Z',updated_at:'2026-10-25T00:00:00.123456Z',category:null,source:null,repo_id:null,repo_full_name:null,repo_owner:null,repo_name:null,repo_url:null,needed_raw:null,needed_assignee:null,generated_at:null,opportunity_id:null,job_application_id:null,...command.values}};
}
function Leave(){const navigate=useGuardedNavigation();return <button onClick={()=>navigate(state.navigate)}>TEST_ONLY_LEAVE</button>;}
function Harness({ownerId}:{ownerId:string}){const[open,setOpen]=useState(true);return <QueryClientProvider client={client}><NavigationGuardProvider><TaskComposer ownerId={ownerId} projects={[]} organizations={[]} open={open} onOpenChange={setOpen}/><button onClick={()=>setOpen(true)}>TEST_ONLY_REOPEN</button><Leave/></NavigationGuardProvider></QueryClientProvider>;}
const dialogs=()=>[...document.querySelectorAll<HTMLElement>('[role="dialog"]')];
const source=()=>dialogs()[0];
const title=()=>source().querySelector<HTMLInputElement>('input[id$="-title"]')!;
const button=(text:string,scope:ParentNode=document)=>[...scope.querySelectorAll<HTMLButtonElement>('button')].find(element=>element.textContent?.trim()===text)!;
function fill(element:HTMLInputElement,value:string){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));}
const submit=()=>source().querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
const render=async()=>{await act(async()=>root.render(<Harness ownerId={actor}/>));};
const settle=async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});};
beforeEach(async()=>{
 vi.clearAllMocks();actor=owner;lang='en';const storage=new Storage();storage.setItem('lang',lang);vi.stubGlobal('localStorage',storage);document.documentElement.lang=lang;
 host=document.createElement('div');document.body.append(host);root=createRoot(host);client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});client.setQueryData(qk.todos,[]);
 state.write.mockImplementation(async(_db:unknown,command:TaskWrite)=>confirmed(command));await render();
});
afterEach(()=>{act(()=>root?.unmount());host?.remove();client?.clear();vi.unstubAllGlobals();document.documentElement.lang='cs';});

for(const locale of ['en','cs'] as const){
 it(`${locale}: pending form blocks duplicate submit/dismissal and keeps one id after failure/retry`,async()=>{
  if(locale==='cs'){lang=locale;(localStorage as Storage).setItem('lang',lang);document.documentElement.lang=lang;await render();}
  act(()=>fill(title(),'Retained task draft'));
  let resolve!:(value:unknown)=>void;state.write.mockReturnValueOnce(new Promise(done=>{resolve=done;}));
  act(()=>{submit();submit();button(todos[lang].addTask,source()).click();});expect(state.write).toHaveBeenCalledTimes(1);
  expect(title().disabled).toBe(true);expect(button(common[lang].cancel,source()).disabled).toBe(true);expect(source().querySelector('fieldset')?.disabled).toBe(true);
  act(()=>source().dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(dialogs()).toHaveLength(1);
  await act(async()=>resolve(Promise.reject(new Error('TEST_ONLY_PRIVATE'))));await settle();
  expect(title().value).toBe('Retained task draft');expect(source().textContent).toContain(todos[lang].createErr);expect(source().textContent).not.toContain('TEST_ONLY_PRIVATE');
  const first=state.write.mock.calls[0][1];act(submit);await settle();expect(state.write).toHaveBeenCalledTimes(2);expect(state.write.mock.calls[1][1]).toEqual(first);
  expect(dialogs()).toHaveLength(0);expect(client.getQueryData<unknown[]>(qk.todos)).toHaveLength(1);expect(state.ok).toHaveBeenCalledOnce();
 });
}
it('captures a pending flag synchronously for a same-frame guarded exit',async()=>{
 act(()=>fill(title(),'Pending draft'));
 let resolve!:(value:unknown)=>void;state.write.mockReturnValueOnce(new Promise(done=>{resolve=done;}));
 act(()=>{submit();button('TEST_ONLY_LEAVE',host).click();});expect(dialogs()).toHaveLength(2);
 const guard=dialogs().at(-1)!;expect(guard.textContent).toContain(common.en.unsaved.pendingTitle);expect(button(common.en.unsaved.discard,guard).disabled).toBe(true);expect(state.navigate).not.toHaveBeenCalled();
 await act(async()=>resolve(confirmed(state.write.mock.calls[0][1])));await settle();expect(state.navigate).toHaveBeenCalledOnce();
});
it('protects a same-frame edit before React has committed its fields',async()=>{
 act(()=>{fill(title(),'Immediate draft');button('TEST_ONLY_LEAVE',host).click();});expect(dialogs()).toHaveLength(2);expect(state.navigate).not.toHaveBeenCalled();
 act(()=>button(common.en.unsaved.stay,dialogs().at(-1)!).click());expect(title().value).toBe('Immediate draft');
});
it('keeps closed drafts and their retry identity until confirmation or explicit discard',async()=>{
 act(()=>fill(title(),'Closed draft'));state.write.mockRejectedValueOnce(new Error('Private fixture refusal'));act(submit);await settle();const first=state.write.mock.calls[0][1];
 act(()=>button(common.en.cancel,source()).click());expect(dialogs()).toHaveLength(0);act(()=>button('TEST_ONLY_REOPEN',host).click());expect(title().value).toBe('Closed draft');
 act(submit);await settle();expect(state.write.mock.calls[1][1].id).toBe(first.id);
});
it('keeps a conflicting or removed draft selectable without another create attempt',async()=>{
 act(()=>fill(title(),'Copyable draft'));
 state.write.mockImplementationOnce(async(_db:unknown,command:TaskWrite)=>({kind:'conflict',ownerId:owner,id:command.id,task:null}));act(submit);await settle();
 expect(title().readOnly).toBe(true);expect(title().disabled).toBe(false);expect(title().value).toBe('Copyable draft');act(()=>{title().select();submit();});expect(state.write).toHaveBeenCalledTimes(1);
 expect(title().selectionStart).toBe(0);expect(title().selectionEnd).toBe('Copyable draft'.length);
 act(()=>button(todos.en.discardDraft,source()).click());expect(title().value).toBe('');act(()=>fill(title(),'New explicit task'));act(submit);await settle();expect(state.write.mock.calls[1][1].id).not.toBe(state.write.mock.calls[0][1].id);
});
it('freezes an old owner draft and ignores a late response after identity changes',async()=>{
 act(()=>fill(title(),'Old owner text'));let resolve!:(value:unknown)=>void;state.write.mockReturnValueOnce(new Promise(done=>{resolve=done;}));act(submit);const command=state.write.mock.calls[0][1];
 actor=other;await render();expect(state.write.mock.calls[0][2].aborted).toBe(true);await act(async()=>resolve(confirmed(command)));await settle();
 expect(title().value).toBe('Old owner text');expect(title().readOnly).toBe(true);expect(source().textContent).toContain(todos.en.ownerChanged);expect(client.getQueryData(qk.todos)).toEqual([]);expect(state.ok).not.toHaveBeenCalled();
 act(submit);expect(state.write).toHaveBeenCalledTimes(1);
});
it('aborts on unmount and never applies a late success to the cache or a new dialog',async()=>{
 act(()=>fill(title(),'Unmounted text'));let resolve!:(value:unknown)=>void;state.write.mockReturnValueOnce(new Promise(done=>{resolve=done;}));act(submit);const command=state.write.mock.calls[0][1],signal=state.write.mock.calls[0][2];
 act(()=>root.unmount());expect(signal.aborted).toBe(true);await act(async()=>resolve(confirmed(command)));expect(client.getQueryData(qk.todos)).toEqual([]);expect(state.ok).not.toHaveBeenCalled();
 root=createRoot(host);await render();expect(title().value).toBe('');
});
it('preserves oversized text and counts Unicode characters like the database',async()=>{
 act(()=>fill(title(),'😀'.repeat(501)));expect(title().value).toHaveLength(1002);expect(title().getAttribute('aria-invalid')).toBe('true');expect(button(todos.en.addTask,source()).disabled).toBe(true);expect(source().textContent).toContain(todos.en.titleLimit);
 act(()=>fill(title(),'😀'.repeat(500)));expect(title().hasAttribute('aria-invalid')).toBe(false);expect(button(todos.en.addTask,source()).disabled).toBe(false);act(submit);await settle();expect(state.write.mock.calls[0][1].values.title).toHaveLength(1000);
});
it('preserves newer unrelated cache data while applying a confirmed creation without another list read',async()=>{
 act(()=>fill(title(),'Confirmed task'));const invalidate=vi.spyOn(client,'invalidateQueries');act(submit);await settle();
 expect(client.getQueryData<unknown[]>(qk.todos)).toHaveLength(1);expect(invalidate.mock.calls.filter(([args])=>args?.queryKey===qk.todos)).toHaveLength(0);
});
it('retains a confirmed creation when an older recovery read resolves later',async()=>{
 let release!:(rows:unknown[])=>void;
 const read=client.fetchQuery({queryKey:qk.todos,queryFn:()=>new Promise<unknown[]>(resolve=>{release=resolve;})}).catch(()=>undefined);
 act(()=>fill(title(),'Confirmed while older read waits'));act(submit);await settle();expect(client.getQueryData<unknown[]>(qk.todos)).toHaveLength(1);
 await act(async()=>{release([]);await read;});expect(client.getQueryData<unknown[]>(qk.todos)).toHaveLength(1);
});
