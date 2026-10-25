// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { enGB, cs } from 'date-fns/locale';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MarketingWeekCard } from '@/components/work/marketing-week';
import { marketing } from '@/lib/i18n/sections/marketing';
import { MARKETING_CALENDAR_SOURCES, parseMarketingCalendar } from '@/lib/marketing-calendars';
const language = vi.hoisted(() => ({ value: 'en' as 'en' | 'cs' }));
vi.mock('@/lib/i18n', () => ({ useDict: () => ({ marketing: marketing[language.value] }), useLang: () => ({ lang: language.value }), useDateLocale: () => language.value === 'cs' ? cs : enGB }));
vi.mock('@/lib/use-now', () => ({ useNow: () => new Date('2026-10-25T12:00:00Z') }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root; let client: QueryClient;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); client = new QueryClient(); });
afterEach(() => { act(() => root.unmount()); host.remove(); client.clear(); });
it.each(['en', 'cs'] as const)('renders imported unknown and inherited calendar codes as plain text (%s)', lang => {
  language.value = lang;
  const codes = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'new-provider-kind'];
  const parsed = parseMarketingCalendar(JSON.stringify({ schemaVersion: 'marketing-calendar/1', project: 'devshark',
    entries: [...codes, 'blocked'].map((code, index) => ({ id: `entry-${index}`, date: '2026-10-25', title: `ENTRY-${index}`, status: code, kind: code, platform: code })),
    prelaunch: codes.map((code, index) => ({ id: `pre-${index}`, due: '2026-10-25', title: `PRE-${index}`, status: code, owner: code })),
  }), 'devshark');
  expect(parsed.ok).toBe(true); if (!parsed.ok) throw new Error('fixture-calendar-invalid');
  act(() => root.render(<QueryClientProvider client={client}><MarketingWeekCard preview={{ checkedAt: '2026-10-25T12:00:00Z', sources: [{ ...MARKETING_CALENDAR_SOURCES[0], status: 'ok', detail: null, calendar: parsed.calendar }] }} /></QueryClientProvider>));
  expect(host.querySelectorAll('[data-marketing-entry]')).toHaveLength(6);
  expect(host.querySelectorAll('[data-marketing-prelaunch]')).toHaveLength(5);
  for (let index = 0; index < codes.length; index++) {
    expect(host.querySelector(`[data-marketing-entry="entry-${index}"]`)?.textContent).toContain(codes[index].toLowerCase());
    expect(host.querySelector(`[data-marketing-prelaunch="pre-${index}"]`)?.textContent).toContain(codes[index]);
  }
  expect(host.querySelector('[data-marketing-entry="entry-5"]')?.textContent).toContain(marketing[lang].status.blocked);
  expect(host.textContent).not.toMatch(/function |native code|\[object Object\]/);
});
