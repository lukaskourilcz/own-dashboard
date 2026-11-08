import { vi, expect, it } from 'vitest';
vi.mock('server-only', () => ({}));
import { readFullMarketingCalendar } from '@/lib/marketing/calendar-source';

it('reads the full committed calendar without dropping fields and records its provenance', async () => {
  const plan = await readFullMarketingCalendar('devshark') as {
    schemaVersion: string; project: string; entries: unknown[];
    _importProvenance: { file: string; fileSha256: string };
  };
  expect(plan.schemaVersion).toBe('marketing-calendar/1');
  expect(plan.project).toBe('devshark');
  expect(Array.isArray(plan.entries)).toBe(true);
  expect(plan.entries.length).toBeGreaterThan(0);
  expect(plan._importProvenance.file).toBe('content/marketing-calendars/marketingshark.json');
  expect(plan._importProvenance.fileSha256).toMatch(/^[a-f0-9]{64}$/);
});

it('rejects an unknown brand instead of importing an empty plan', async () => {
  await expect(readFullMarketingCalendar('nope' as never)).rejects.toThrow('calendar-source-unavailable');
});
