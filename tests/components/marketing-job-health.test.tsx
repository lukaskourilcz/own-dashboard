// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MarketingJobHealthSummary } from '@/components/marketing/job-health';
import { safeMarketingJobs, marketingJobHealth } from '@/lib/marketing/job-health';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement; let root: Root;
const onRefresh = vi.fn();
const jobs = marketingJobHealth(safeMarketingJobs(['queued', 'running', 'failed', 'reconciliation'].map((status, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, status, brand: 'devshark', created_at: '2026-10-13T12:00:00Z', error_code: status === 'failed' ? 'provider-failed' : null,
}))));
function render(lang: 'cs' | 'en', disabled = false, refreshing = false) {
  act(() => root.render(<MarketingJobHealthSummary jobs={jobs} lang={lang} disabled={disabled} refreshing={refreshing} onRefresh={onRefresh}/>));
}
beforeEach(() => { onRefresh.mockReset(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
describe('visible generation health in review', () => {
  it.each(['cs', 'en'] as const)('shows honest pending/failure/uncertain states in %s and retries only a status read', lang => {
    const fetcher = vi.spyOn(globalThis, 'fetch'); render(lang);
    for (const text of lang === 'cs' ? ['Čeká', 'Generuje se', 'Problém', 'Ověřit výsledek', 'Poskytovatel generování nedokončil.'] : ['Waiting', 'Generating', 'Problem', 'Verify the result', 'The provider did not finish generation.']) expect(container.textContent).toContain(text);
    expect(container.textContent).toContain(lang === 'cs' ? 'Než vlastník zadá nové generování, zkontrolujte problém.' : 'Review the problem before the owner requests another generation.');
    expect(container.querySelector('section')?.getAttribute('aria-labelledby')).toBe(container.querySelector('h2')?.id);
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(container.querySelectorAll('time')).toHaveLength(4);
    const button = container.querySelector('button')!; expect(button.className).toContain('h-11');
    act(() => button.click()); expect(onRefresh).toHaveBeenCalledOnce(); expect(fetcher).not.toHaveBeenCalled(); fetcher.mockRestore();
    expect(container.querySelectorAll('article,img')).toHaveLength(0);
  });
  it('disables status checking during a read and in readonly preview', () => {
    render('cs', false, true); expect(container.querySelector('button')?.disabled).toBe(true);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    render('en', true); act(() => container.querySelector('button')!.click()); expect(onRefresh).not.toHaveBeenCalled();
  });
});
