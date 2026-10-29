// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MarketingJobHealthSummary } from '@/components/marketing/job-health';
import { safeMarketingJobs, marketingJobHealth } from '@/lib/marketing/job-health';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement; let root: Root;
const jobs = marketingJobHealth(safeMarketingJobs(['queued', 'running', 'failed', 'reconciliation'].map((status, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, status, brand: 'devshark', created_at: '2026-10-13T12:00:00Z', error_code: status === 'failed' ? 'provider-failed' : null,
}))));
function render(lang: 'cs' | 'en', refreshing = false) {
  act(() => root.render(<MarketingJobHealthSummary jobs={jobs} lang={lang} refreshing={refreshing}/>));
}
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
describe('visible generation health in review', () => {
  it.each(['cs', 'en'] as const)('shows honest pending/failure/uncertain states in %s without a duplicate status control', lang => {
    const fetcher = vi.spyOn(globalThis, 'fetch'); render(lang);
    for (const text of lang === 'cs' ? ['Čeká', 'Generuje se', 'Problém', 'Ověřit výsledek', 'Požadavek poskytovateli ohlásil problém.'] : ['Waiting', 'Generating', 'Problem', 'Verify the result', 'The provider request reported a problem.']) expect(container.textContent).toContain(text);
    expect(container.textContent).toContain(lang === 'cs' ? 'Před zadáním dalšího generování zkontrolujte problém.' : 'Review the problem before requesting another generation.');
    expect(container.querySelector('section')?.getAttribute('aria-labelledby')).toBe(container.querySelector('h2')?.id);
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(container.querySelectorAll('time')).toHaveLength(4);
    expect(container.querySelector('button')).toBeNull(); expect(fetcher).not.toHaveBeenCalled(); fetcher.mockRestore();
    expect(container.querySelectorAll('article,img')).toHaveLength(0);
  });
  it('announces a pending read without a second refresh control', () => {
    render('cs', true); expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    render('en'); expect(container.querySelector('[aria-busy="false"]')).not.toBeNull();
  });
});
for (const lang of ['en', 'cs'] as const) {
 it.each(['unavailable', 'worker-fence-lost', 'worker-lease-expired', 'reconciliation'])(`${lang}: does not claim that an uncertain %s result saved no draft`, kind => {
  const uncertain = marketingJobHealth(safeMarketingJobs([{ id: '00000001-0000-4000-8000-000000000000', status: ['unavailable', 'reconciliation'].includes(kind) ? kind : 'failed', brand: 'devshark', created_at: '2026-10-13T12:00:00Z', error_code: kind.startsWith('worker-') ? kind : null }]));
  act(() => root.render(<MarketingJobHealthSummary jobs={uncertain} lang={lang} refreshing={false}/>));
  expect(container.textContent).not.toContain(lang === 'cs' ? 'Hotový návrh se neuložil.' : 'No finished draft was saved.');
  expect(container.textContent).toContain(lang === 'cs' ? 'Výsledek není jistý.' : 'The result is uncertain.');
 });
}
it('reuses one public locale formatter across jobs and same-language renders', () => {
 const NativeFormatter = Intl.DateTimeFormat;
 const formatter = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locales, options) { return new NativeFormatter(locales, options); }); render('en');
 expect(formatter).toHaveBeenCalledOnce(); const times = [...container.querySelectorAll('time')].map(item => item.textContent);
 render('en'); expect(formatter).toHaveBeenCalledOnce(); expect([...container.querySelectorAll('time')].map(item => item.textContent)).toEqual(times);
 render('cs'); expect(formatter).toHaveBeenCalledTimes(2);
});
