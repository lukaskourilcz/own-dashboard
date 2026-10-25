// @vitest-environment happy-dom
import { act, useLayoutEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Storage } from 'happy-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterEach, expect, it, vi } from 'vitest';
import { OwnerPreferencesProvider } from '@/lib/owner-preferences';
import { NavigationGuardProvider, useGuardedNavigation } from '@/components/navigation-guard';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmationProvider } from '@/components/ui/confirmation-dialog';
import { CompetitionPanel } from '@/components/panels/competition-panel';
import { ProjectCompetition } from '@/components/projects/project-competition';
import { portfolio } from '@/lib/i18n/sections/portfolio';
import { common } from '@/lib/i18n/sections/common';
import { projects } from '@/lib/demo/fixtures';
import type { Competitor, Updater } from '@/lib/types';
const backend = vi.hoisted(() => ({ api: null as SupabaseClient | null }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => backend.api }));
vi.mock('@/lib/supabase/user', () => ({ currentUserId: async () => '11111111-1111-4111-8111-111111111111' }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222', id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', stamp = '2026-10-25T13:00:00Z';
const project = { ...projects[0]!, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user_id: owner };
const record = (): Competitor => ({ id, user_id: owner, project_id: project.id, name: 'Synthetic competitor', url: null, summary: 'Keep summary', category: 'direct', useful_features: ['Keep feature'], social_content: '', pricing_model: '', lessons: '', relevance_score: 3, score_rationale: '', social_links: [], source_urls: [], reviewed_at: '2099-01-01', sort_order: 7, created_at: stamp, updated_at: stamp });
type Call = { url: URL; method: string; body: Record<string, unknown> | null; signal?: AbortSignal | null };
let sequence = 0;
let root: Root | undefined, host: HTMLDivElement, qc: QueryClient, calls: Call[], updates: unknown[], handler: (call: Call) => Promise<Response> | Response, changeRows: Updater<Competitor[]>;
function Exit() { const request = useGuardedNavigation(); const [exited, setExited] = useState(false); return <button data-test-exit onClick={() => request(() => setExited(true))}>{exited ? 'Exited' : 'Exit'}</button>; }
function State({ initial, surface }: { initial: Competitor[]; surface: 'all' | 'project' }) { const [rows, setRows] = useState(initial); useLayoutEffect(() => { changeRows = setRows; }, []); return <>{surface === 'project' ? <ProjectCompetition project={project} competitors={rows} setCompetitors={next => { updates.push(next); setRows(next); }} /> : <CompetitionPanel projects={[project]} competitors={rows} setCompetitors={next => { updates.push(next); setRows(next); }} onOpenProject={() => {}} />}<output data-test-rows>{JSON.stringify(rows)}</output></>; }
function View({ identity = owner, initial = [record()], surface = 'project' }: { identity?: string; initial?: Competitor[]; surface?: 'all' | 'project' }) { return <QueryClientProvider client={qc}><NavigationGuardProvider><TooltipProvider><ConfirmationProvider><OwnerPreferencesProvider ownerId={identity}><Exit /><State initial={initial} surface={surface} /></OwnerPreferencesProvider></ConfirmationProvider></TooltipProvider></NavigationGuardProvider></QueryClientProvider>; }
async function render(lang: 'en' | 'cs' = 'en', initial = [record()], surface: 'all' | 'project' = 'project') {
 document.documentElement.lang = lang; vi.stubGlobal('localStorage', new Storage()); calls = []; updates = []; handler = () => Response.json([]);
 backend.api = createClient('https://example.supabase.co', 'TEST-ONLY-public', { auth: { storageKey: `TEST-ONLY-competitors-${++sequence}`, persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: async (input, init) => { const request = new Request(input, init), body = await request.text(), call = { url: new URL(request.url), method: request.method, body: body ? JSON.parse(body) : null, signal: init?.signal ?? request.signal }; calls.push(call); return handler(call); } } });
 host = document.createElement('div'); document.body.append(host); root = createRoot(host); qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); await act(async () => root!.render(<View initial={initial} surface={surface} />));
}
const button = (text: string) => [...document.querySelectorAll('button')].find(node => node.textContent === text)!;
const action = (prefix: string) => [...host.querySelectorAll('button')].find(node => node.getAttribute('aria-label')?.startsWith(prefix))!;
const rows = () => JSON.parse(host.querySelector('[data-test-rows]')!.textContent!) as Competitor[];
function change(selector: string, value: string) { act(() => { const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!; const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function settle(check: () => void) { await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); check(); }); }
function submit() { act(() => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
function creationReceipt(call: Call) { return { ...record(), sort_order: 0, ...call.body, created_at: stamp, updated_at: stamp }; }
function edit() { act(() => action(portfolio.en.editCompetitor).click()); }
afterEach(() => { act(() => root?.unmount()); host?.remove(); qc?.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.documentElement.lang = ''; });
it('uses a stable caller id and retains it across failed creation retries', async () => {
 await render('en', []); act(() => button(portfolio.en.addCompetitor).click()); change('#competitor-name', 'Draft'); handler = () => Response.json({ message: 'PRIVATE TEST' }, { status: 503 }); submit(); await settle(() => expect(document.querySelector('form button[type="submit"]')?.hasAttribute('disabled')).toBe(false));
 expect(calls[0]!.body!.id).toMatch(/^[0-9a-f-]{36}$/); const capturedId = calls[0]!.body!.id;
 handler = call => Response.json([creationReceipt(call)]); submit(); await settle(() => expect(rows()).toHaveLength(1)); expect(calls.map(c => c.body!.id)).toEqual([capturedId, capturedId]);
});
it('keeps a zero-row deletion rather than treating it as success', async () => {
 await render(); act(() => action(portfolio.en.deleteCompetitor).click()); act(() => button(common.en.delete).click()); await settle(() => expect(calls).toHaveLength(1)); await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); }); expect(rows()).toHaveLength(1); expect(updates).toHaveLength(0);
});
it('filters an edit by its captured owner and database version', async () => {
 await render(); edit(); change('#competitor-name', 'Changed'); handler = call => Response.json([{ ...record(), ...call.body, updated_at: '2026-10-25T13:00:01Z' }]); submit(); await settle(() => expect(calls).toHaveLength(1)); expect(calls[0]!.url.searchParams.get('user_id')).toBe(`eq.${owner}`); expect(calls[0]!.url.searchParams.get('updated_at')).toBe(`eq.${stamp}`);
});
it('does not silently discard an invalid source URL while saving the other lines', async () => {
 await render(); edit(); change('#competitor-sources', 'https://example.test/good\ninvalid-address'); submit(); await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); }); expect(calls).toHaveLength(0); expect(document.querySelector<HTMLTextAreaElement>('#competitor-sources')!.value).toContain('invalid-address');
});
it.each(['en', 'cs'] as const)('keeps safe localized errors and the failed draft (%s)', async lang => {
 await render(lang, []); act(() => button(portfolio[lang].addCompetitor).click()); change('#competitor-name', 'Kept draft'); handler = () => Response.json({ message: 'PRIVATE TEST database diagnostic' }, { status: 503 }); submit();
 await settle(() => expect(document.querySelector('[role="alert"]')?.textContent).toBe(portfolio[lang].competitorSaveUnconfirmed)); expect(document.querySelector<HTMLInputElement>('#competitor-name')!.value).toBe('Kept draft'); expect(document.body.textContent).not.toContain('PRIVATE TEST'); expect(updates).toHaveLength(0); expect(calls).toHaveLength(1);
});
it('reserves one same-turn creation and prevents destructive exits while it is pending', async () => {
 await render('en', []); act(() => button(portfolio.en.addCompetitor).click()); change('#competitor-name', 'Pending draft'); let release!: (response: Response) => void; handler = () => new Promise(resolve => { release = resolve; });
 act(() => { const form = document.querySelector('form')!; form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await settle(() => expect(calls).toHaveLength(1));
 expect(document.querySelector<HTMLFieldSetElement>('fieldset')!.disabled).toBe(true); expect(button(common.en.cancel).disabled).toBe(true); act(() => host.querySelector<HTMLButtonElement>('[data-test-exit]')!.click()); expect(button(common.en.unsaved.discard).disabled).toBe(true); expect(document.body.textContent).toContain(common.en.unsaved.pendingTitle);
 await act(async () => release(Response.json([creationReceipt(calls[0]!)]))); await settle(() => expect(host.querySelector('[data-test-exit]')!.textContent).toBe('Exited')); expect(rows()).toHaveLength(1);
});
it('offers guarded discard and preserves the draft when staying', async () => {
 await render('en', []); act(() => button(portfolio.en.addCompetitor).click()); change('#competitor-name', 'Keep until discarded'); act(() => button(common.en.cancel).click()); expect(document.body.textContent).toContain(common.en.unsaved.title); act(() => button(common.en.unsaved.stay).click()); expect(document.querySelector<HTMLInputElement>('#competitor-name')!.value).toBe('Keep until discarded');
 act(() => button(common.en.cancel).click()); act(() => button(common.en.unsaved.discard).click()); expect(document.querySelector('form')).toBeNull(); act(() => button(portfolio.en.addCompetitor).click()); expect(document.querySelector<HTMLInputElement>('#competitor-name')!.value).toBe(''); expect(calls).toHaveLength(0);
});
it('saves the draft before a requested navigation', async () => {
 await render('en', []); act(() => button(portfolio.en.addCompetitor).click()); change('#competitor-name', 'Save on exit'); act(() => host.querySelector<HTMLButtonElement>('[data-test-exit]')!.click()); handler = call => Response.json([creationReceipt(call)]); act(() => button(common.en.unsaved.save).click()); await settle(() => expect(host.querySelector('[data-test-exit]')!.textContent).toBe('Exited')); expect(rows()).toHaveLength(1);
});
it('closes an unchanged edit without a request or a dirty prompt', async () => {
 await render(); edit(); act(() => button(common.en.cancel).click()); expect(document.querySelector('form')).toBeNull(); expect(document.body.textContent).not.toContain(common.en.unsaved.title); expect(calls).toHaveLength(0);
});
it('sends only changed fields and keeps unrelated legacy URLs, whitespace and ordering', async () => {
 const source = { ...record(), url: 'Unsupported legacy URL', social_links: ['Legacy social'], summary: '  Preserve whitespace  ' }; await render('en', [source]); edit(); change('#competitor-name', 'Changed name'); handler = call => Response.json([{ ...source, ...call.body, updated_at: '2026-10-25T13:00:00.000001Z' }]); submit(); await settle(() => expect(document.querySelector('form')).toBeNull()); expect(calls[0]!.body).toEqual({ name: 'Changed name' }); expect(rows()[0]).toMatchObject({ name: 'Changed name', url: source.url, summary: source.summary, social_links: source.social_links, sort_order: 7 });
});
it('retains a zero-row edit and its draft without treating it as saved', async () => {
 await render(); edit(); change('#competitor-name', 'Draft conflict'); submit(); await settle(() => expect(document.querySelector('form [role="alert"]')?.textContent).toBe(portfolio.en.competitorChanged)); expect(rows()[0]!.name).toBe('Synthetic competitor'); expect(document.querySelector<HTMLInputElement>('#competitor-name')!.value).toBe('Draft conflict'); expect(updates).toHaveLength(0);
});
it('keeps a newer cached row when an older edit completes', async () => {
 await render(); edit(); change('#competitor-name', 'Confirmed old edit'); let release!: (response: Response) => void; handler = () => new Promise(resolve => { release = resolve; }); submit(); await settle(() => expect(calls).toHaveLength(1)); const newer = { ...record(), summary: 'Newer cached summary', updated_at: '2026-10-25T13:00:02Z' }; act(() => changeRows([newer])); await act(async () => release(Response.json([{ ...record(), name: 'Confirmed old edit', updated_at: '2026-10-25T13:00:01Z' }]))); await settle(() => expect(document.querySelector('form')).toBeNull()); expect(rows()).toEqual([newer]);
});
it('captures a deletion before confirmation and preserves a newer cached version', async () => {
 await render(); act(() => action(portfolio.en.deleteCompetitor).click()); const newer = { ...record(), summary: 'Newer cached summary', updated_at: '2026-10-25T13:00:02Z' }; act(() => changeRows([newer])); handler = () => Response.json([record()]); act(() => button(common.en.delete).click()); await settle(() => expect(action(portfolio.en.deleteCompetitor).disabled).toBe(false)); expect(calls[0]!.url.searchParams.get('updated_at')).toBe(`eq.${stamp}`); expect(calls[0]!.url.searchParams.get('user_id')).toBe(`eq.${owner}`); expect(rows()).toEqual([newer]);
});
it('coalesces confirmation and releases it on cancellation without a request', async () => {
 await render(); act(() => { action(portfolio.en.deleteCompetitor).click(); action(portfolio.en.deleteCompetitor).click(); }); expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1); act(() => button(common.en.cancel).click()); await settle(() => expect(action(portfolio.en.deleteCompetitor).disabled).toBe(false)); expect(calls).toHaveLength(0); expect(rows()).toHaveLength(1);
});
it.each(['en', 'cs'] as const)('shows linked URL validation and allows correction without dropping lines (%s)', async lang => {
 await render(lang); act(() => action(portfolio[lang].editCompetitor).click()); change('#competitor-sources', 'https://example.test/good\ninvalid-address'); const input = document.querySelector<HTMLTextAreaElement>('#competitor-sources')!; act(() => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))); expect(input.getAttribute('aria-invalid')).toBe('true'); expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe(portfolio[lang].competitorUrlInvalid); expect(document.querySelector<HTMLButtonElement>('form button[type="submit"]')!.disabled).toBe(true);
 change('#competitor-sources', 'https://example.test/good\nHTTPS://EXAMPLE.TEST/corrected'); expect(input.hasAttribute('aria-invalid')).toBe(false); handler = call => Response.json([{ ...record(), ...call.body, updated_at: '2026-10-25T13:00:01Z' }]); submit(); await settle(() => expect(document.querySelector('form')).toBeNull()); expect(calls[0]!.body).toEqual({ source_urls: ['https://example.test/good', 'HTTPS://EXAMPLE.TEST/corrected'] });
});
it('retains the creation id even after edits following an uncertain response', async () => {
 await render('en', []); act(() => button(portfolio.en.addCompetitor).click()); change('#competitor-name', 'First intent'); handler = () => Response.json({ message: 'PRIVATE TEST' }, { status: 503 }); submit(); await settle(() => expect(document.querySelector('[role="alert"]')).not.toBeNull()); const originalId = calls[0]!.body!.id; change('#competitor-name', 'Edited retry'); handler = call => Response.json([creationReceipt(call)]); submit(); await settle(() => expect(rows()).toHaveLength(1)); expect(calls[1]!.body!.id).toBe(originalId); expect(calls[1]!.body!.name).toBe('Edited retry');
});
it('aborts a pending creation on account replacement and keeps the new owner draft', async () => {
 await render('en', []); act(() => button(portfolio.en.addCompetitor).click()); change('#competitor-name', 'Old owner'); let release!: (response: Response) => void; handler = () => new Promise(resolve => { release = resolve; }); submit(); await settle(() => expect(calls).toHaveLength(1)); const call = calls[0]!; await act(async () => root!.render(<View identity={other} initial={[]} />)); expect(call.signal?.aborted).toBe(true); act(() => button(portfolio.en.addCompetitor).click()); change('#competitor-name', 'New owner draft'); await act(async () => release(Response.json([creationReceipt(call)]))); expect(document.querySelector<HTMLInputElement>('#competitor-name')!.value).toBe('New owner draft'); expect(updates).toHaveLength(0);
});
it('abandons an unmounted deletion confirmation before it can send a request', async () => {
 await render(); act(() => action(portfolio.en.deleteCompetitor).click()); act(() => { root!.unmount(); root = undefined; }); expect(calls).toHaveLength(0); expect(updates).toHaveLength(0);
});

it.each(['en', 'cs'] as const)('uses the same confirmed edit controls on the full Competition page (%s)', async lang => {
 await render(lang,[record()],'all'); act(() => action(portfolio[lang].editCompetitor).click()); change('#competitor-name','Full-page edit'); handler=call=>Response.json([{...record(),...call.body,updated_at:'2026-10-25T13:00:01Z'}]); submit(); await settle(()=>expect(document.querySelector('form')).toBeNull()); expect(rows()[0]!.name).toBe('Full-page edit'); expect(calls[0]!.url.searchParams.get('updated_at')).toBe(`eq.${stamp}`); expect(calls[0]!.body).toEqual({name:'Full-page edit'});
});
it('does not accept a foreign or partial creation receipt',async()=>{
 await render('en',[]);act(()=>button(portfolio.en.addCompetitor).click());change('#competitor-name','Owned draft');handler=call=>Response.json([{...creationReceipt(call),user_id:other}]);submit();await settle(()=>expect(document.querySelector('form [role="alert"]')?.textContent).toBe(portfolio.en.competitorSaveUnconfirmed));expect(rows()).toEqual([]);expect(updates).toHaveLength(0);
});
