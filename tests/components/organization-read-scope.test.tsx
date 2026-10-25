// @vitest-environment happy-dom
import { act, StrictMode, useCallback, useMemo } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createClient } from '@supabase/supabase-js';
import { afterEach, expect, it, vi } from 'vitest';
import { OwnerPreferencesProvider, useOwnerPreferences } from '@/lib/owner-preferences';
import { useEntityStore } from '@/lib/queries/entities';
import { readOrganizationRecords } from '@/lib/organization-records';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT=true;
const owner='11111111-1111-4111-8111-111111111111';let root:Root,host:HTMLDivElement,qc:QueryClient;
const transport=vi.fn<typeof fetch>(async()=>Response.json([]));
const api=createClient('https://example.supabase.co','TEST-ONLY-public',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:transport}});
function Probe(){const context=useOwnerPreferences()!,key=useMemo(()=>['organizations',context.ownerId],[context.ownerId]);const load=useCallback(async(query?:{signal:AbortSignal})=>{const captured=context.capture();return(await readOrganizationRecords(api,{ownerId:captured.ownerId,signal:query?AbortSignal.any([captured.signal,query.signal]):captured.signal})).data;},[context]);const[rows,,status]=useEntityStore(key,[],load,{seeded:false,retry:false});return<output>{JSON.stringify({...status,count:rows.length})}</output>;}
afterEach(()=>{act(()=>root?.unmount());host?.remove();qc?.clear();transport.mockClear();});
it('resumes the owner lifetime before a Strict Mode query subscribes again',async()=>{
 host=document.createElement('div');document.body.append(host);root=createRoot(host);qc=new QueryClient({defaultOptions:{queries:{retry:false}}});await act(async()=>root.render(<StrictMode><QueryClientProvider client={qc}><OwnerPreferencesProvider ownerId={owner}><Probe/></OwnerPreferencesProvider></QueryClientProvider></StrictMode>));
 await vi.waitFor(async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});expect(JSON.parse(host.querySelector('output')!.textContent!)).toEqual({ready:true,failed:false,count:0});});expect(transport.mock.calls.length).toBeGreaterThanOrEqual(1); expect(transport.mock.calls.length).toBeLessThanOrEqual(2); expect(transport.mock.calls.filter(([,init])=>init?.signal && !init.signal.aborted)).toHaveLength(1);
});
it('reports a failed refresh separately while retaining the last complete snapshot',async()=>{
 let fail=false;transport.mockImplementation(async()=>fail?Response.json({message:'PRIVATE TEST'},{status:503}):Response.json([]));
 host=document.createElement('div');document.body.append(host);root=createRoot(host);qc=new QueryClient({defaultOptions:{queries:{retry:false}}});await act(async()=>root.render(<QueryClientProvider client={qc}><OwnerPreferencesProvider ownerId={owner}><Probe/></OwnerPreferencesProvider></QueryClientProvider>));
 await vi.waitFor(async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});expect(JSON.parse(host.querySelector('output')!.textContent!)).toEqual({ready:true,failed:false,count:0});});
 fail=true;await act(async()=>{await qc.refetchQueries({queryKey:['organizations',owner],exact:true});});await vi.waitFor(async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});expect(JSON.parse(host.querySelector('output')!.textContent!)).toEqual({ready:true,failed:false,refreshFailed:true,count:0});});
 fail=false;await act(async()=>{await qc.refetchQueries({queryKey:['organizations',owner],exact:true});});await vi.waitFor(async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});expect(JSON.parse(host.querySelector('output')!.textContent!)).toEqual({ready:true,failed:false,count:0});});
});
