// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {DneskaiAudioPicker} from '@/components/marketing/dneskai/lab/audio-picker';
import {DneskaiAudioLibrary} from '@/components/marketing/dneskai-audio-library';
import {DEMO_DNESKAI_AUDIO_TRACKS} from '@/lib/marketing/dneskai-audio-client';
import {dneskaiAudio} from '@/lib/i18n/sections/dneskai-audio';
import {TooltipProvider} from '@/components/ui/tooltip';
vi.mock('@/lib/supabase/client',()=>({createClient:()=>({})}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement,root:Root,client:QueryClient;
const sound={audioId:'9',title:'Synthetic Meta sound',artist:null,type:'music',durationMs:null,coverUrl:null,daysSeen:1,nicheCount:3,tiktok:false,attachable:true};
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});});
afterEach(()=>{act(()=>root.unmount());host.remove();client.clear();vi.unstubAllGlobals();});
const render=(node:React.ReactNode)=>act(()=>root.render(<QueryClientProvider client={client}><TooltipProvider>{node}</TooltipProvider></QueryClientProvider>));
const settle=()=>act(async()=>{for(let index=0;index<10;index++)await new Promise(done=>setTimeout(done,20));});
for(const lang of ['en','cs'] as const){
 it(`${lang}: the picker retains its exact saved sound and tracks through optional failure`,async()=>{
  let available=true;const fetcher=vi.fn(async()=>Response.json({tracks:[DEMO_DNESKAI_AUDIO_TRACKS[0]],trends:available?[sound]:[],trendsStatus:available?'ready':'unavailable',nextOffset:null}));vi.stubGlobal('fetch',fetcher);const change=vi.fn();render(<DneskaiAudioPicker value="ig:9" onChange={change} preview={false} lang={lang}/>);await settle();expect(host.querySelector('select')?.value).toBe('ig:9');expect(host.textContent).toContain(sound.title);available=false;await act(async()=>client.refetchQueries());await settle();expect(host.querySelector('select')?.value).toBe('ig:9');expect(host.textContent).toContain(dneskaiAudio[lang].trends.unavailable);expect(host.textContent).toContain('Quiet Circuit');expect(host.textContent).toContain(dneskaiAudio[lang].selectedMissing);expect(change).not.toHaveBeenCalled();available=true;const retry=[...host.querySelectorAll('button')].find(button=>button.textContent===dneskaiAudio[lang].trends.retry)!;await act(async()=>retry.click());await settle();expect(host.textContent).toContain(sound.title);expect(host.textContent).not.toContain(dneskaiAudio[lang].trends.unavailable);expect(host.querySelector('select')?.value).toBe('ig:9');expect(fetcher).toHaveBeenCalledTimes(3);
 });
 it(`${lang}: the library distinguishes unavailable, empty and disabled suggestions`,async()=>{
  let status='unavailable';vi.stubGlobal('fetch',vi.fn(async()=>Response.json({tracks:[DEMO_DNESKAI_AUDIO_TRACKS[0]],trends:[],trendsStatus:status,nextOffset:null})));render(<DneskaiAudioLibrary lang={lang}/>);await settle();expect(host.textContent).toContain('Quiet Circuit');expect(host.textContent).toContain(dneskaiAudio[lang].trends.unavailable);expect(host.textContent).not.toContain(dneskaiAudio[lang].trends.empty);status='ready';const retry=[...host.querySelectorAll('button')].find(button=>button.textContent===dneskaiAudio[lang].trends.retry)!;await act(async()=>retry.click());await settle();expect(host.textContent).toContain(dneskaiAudio[lang].trends.empty);expect(host.textContent).not.toContain(dneskaiAudio[lang].trends.unavailable);status='disabled';await act(async()=>client.refetchQueries());await settle();expect(host.querySelector('[data-testid="dneskai-audio-trends"]')).toBeNull();expect(host.textContent).toContain('Quiet Circuit');
 });
}
