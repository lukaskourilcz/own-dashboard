// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Storage } from 'happy-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { OwnerPreferencesProvider } from '@/lib/owner-preferences';
import { JobsPanel } from '@/components/panels/jobs-panel';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmationProvider } from '@/components/ui/confirmation-dialog';
import { jobs } from '@/lib/i18n/sections/jobs';
import { jobListings, savedJobPositions, jobApplications } from '@/lib/demo/fixtures';

const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc: state.rpc }) }));
vi.mock('@/components/panels/oslo-career-workspace', () => ({ OsloCareerWorkspace: () => null, OsloLetterReview: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, host: HTMLDivElement, client: QueryClient;
afterEach(() => {
  act(() => root?.unmount()); host?.remove(); client?.clear();
  document.documentElement.lang = ''; vi.unstubAllGlobals(); vi.clearAllMocks();
});
it('keeps a different query-based vacancy saveable despite saved/applied siblings', async () => {
  vi.stubGlobal('localStorage', new Storage()); document.documentElement.lang = 'en';
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const owner='11111111-1111-4111-8111-111111111111';
  const url = (id: string) => `https://thehub.io/jobs/query?jobId=${id}`;
  const listing = { ...jobListings[0]!, id: '44444444-4444-4444-8444-444444444444', url: url('three') };
  const saved = { ...savedJobPositions[0]!, url: url('one') };
  const applied = { ...jobApplications[0]!, listing_id: null, url: url('two') };
  const update = vi.fn();
  state.rpc.mockImplementation((_name,input) => {
    const builder={retry:()=>builder,abortSignal:async()=>({data:{ownerId:owner,requestId:input.p_saved_id,created:true,row:{...saved,id:input.p_saved_id,user_id:owner,url:listing.url,listing_id:listing.id,title:listing.title,company:listing.company,source:listing.source,location:listing.location,description:listing.description,remote:listing.remote,cover_letter:'',notes:null,readiness:'draft',cover_letter_url:null}},error:null})};return builder;
  });
  await act(async () => root!.render(<QueryClientProvider client={client}><OwnerPreferencesProvider ownerId={owner}><TooltipProvider><ConfirmationProvider><JobsPanel
    activated onActivate={vi.fn()} isPreview listings={[listing]} savedPositions={[saved]} applications={[applied]} userId={owner}
    userStates={[]} setUserStates={vi.fn()} setSavedPositions={update} setApplications={vi.fn()} events={[]} setEvents={vi.fn()}
    templates={[]} setTemplates={vi.fn()} lastRun={null}
  /></ConfirmationProvider></TooltipProvider></OwnerPreferencesProvider></QueryClientProvider>));
  const open = [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === jobs.en.openTab)!;
  await act(async () => { open.click(); await new Promise(resolve => setTimeout(resolve, 20)); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
  const article = host.querySelector('article')!;
  expect(article).not.toBeNull();
  const save = [...article.querySelectorAll('button')].find(button => button.textContent?.trim() === jobs.en.savePosition)!;
  expect(save).toBeDefined(); expect(save.disabled).toBe(false);
  expect(article.textContent).not.toContain(` · ${jobs.en.savedBadge}`);
  expect(article.textContent).not.toContain(` · ${jobs.en.appliedBadge}`);
  await act(async () => { save.click(); await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(state.rpc).toHaveBeenCalledWith('capture_career_listing',expect.objectContaining({p_expected_owner:owner,p_url:url('three'),p_listing_id:listing.id}));
  expect(update).toHaveBeenCalledOnce();
});
