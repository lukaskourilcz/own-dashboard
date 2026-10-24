import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeMarketingCode, marketingCodeKnown, marketingCodeTexts, MARKETING_KNOWN_CODES } from '@/lib/marketing/marketing-codes';
import { marketingJobErrorCode, safeMarketingJobs } from '@/lib/marketing/job-health';
import { MARKETING_PROVIDER_FAILURE_CODES } from '@/lib/marketing/provider-errors';
import { DNESKAI_RENDER_FAILURE_CODES } from '@/lib/marketing/dneskai-render';

const root = path.resolve(__dirname, '../..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
// Every module under src/lib/marketing, subfolders included, so a code added in a new folder is checked too.
const marketingFiles = (readdirSync(path.join(root, 'src/lib/marketing'), { recursive: true }) as string[]).filter((file) => file.endsWith('.ts')).map((file) => `src/lib/marketing/${file.split(path.sep).join('/')}`);
const quoted = String.raw`["'\`]([a-z][a-z0-9-]*)["'\`]`;
const collect = (source: string, pattern: RegExp) => [...source.matchAll(pattern)].map((match) => match[1]!).filter((code) => !code.endsWith('-'));

/**
 * Every code the marketing modules can record for the owner: thrown error classes, `fail`/`hold` refusals,
 * publisher outcomes, scheduler step codes and the approval reasons of the revisions route. Codes built from a
 * template literal (`meta-http-${status}`, `container-${status}`) are covered by the family patterns.
 */
function emittedCodes(): Map<string, string> {
  const codes = new Map<string, string>();
  const add = (file: string, values: string[]) => { for (const code of values) if (!codes.has(code)) codes.set(code, file); };
  for (const file of marketingFiles) {
    const source = read(file);
    add(file, collect(source, new RegExp(String.raw`new [A-Z][A-Za-z]*Error\(${quoted}`, 'g')));
    add(file, collect(source, new RegExp(String.raw`\b(?:fail|hold)\(${quoted}`, 'g')));
    add(file, collect(source, new RegExp(String.raw`result\('(?:held|failed|reconciliation|pending)', ?${quoted}`, 'g')));
    add(file, collect(source, new RegExp(String.raw`(?:errorCode|code): ?${quoted}`, 'g')));
    // A native feed's result envelope: every literal in `envelope('error', a ? 'x' : 'y')`.
    for (const call of source.matchAll(/envelope\('error', ?([^\n]*?)\);/g)) add(file, collect(call[1]!, new RegExp(quoted, 'g')));
  }
  const route = read('src/app/api/marketing/revisions/route.ts');
  add('revisions/route.ts', collect(route, /:'([a-z][a-z0-9-]+)'/g).filter((code) => /^(?:revision|render|schedule|source|account|campaign)-/.test(code)));
  add('revisions/route.ts', collect(route, /error:'([a-z][a-z0-9-]+)'/g));
  // Codes that are not owner-facing: values of other fields that share the `code:` key in object literals.
  for (const ignored of ['custom', 'dry-run', 'jetbrains-mono-400']) codes.delete(ignored);
  return codes;
}

describe('marketing code texts (#119)', () => {
  it('gives every listed code distinct, non-empty English and Czech text and a next step', () => {
    expect(MARKETING_KNOWN_CODES.length).toBeGreaterThan(250);
    for (const code of MARKETING_KNOWN_CODES) {
      const text = marketingCodeTexts(code);
      expect(text.en.trim(), code).not.toBe('');
      expect(text.cs.trim(), code).not.toBe('');
      expect(text.en, code).not.toBe(text.cs);
      expect(text.next.en.trim(), code).not.toBe('');
      expect(text.next.cs.trim(), code).not.toBe('');
      expect(text.en, code).not.toMatch(/[a-z]+-[a-z]+-[a-z]+/);
      expect(text.cs, code).not.toMatch(/[a-z]+-[a-z]+-[a-z]+/);
    }
  });

  it('has text for every code the marketing modules emit', () => {
    expect(marketingFiles.some((file) => file.startsWith('src/lib/marketing/free-feeds/'))).toBe(true);
    const missing = [...emittedCodes()].filter(([code]) => !marketingCodeKnown(code)).map(([code, file]) => `${code} (${file})`);
    expect(missing).toEqual([]);
  });

  it('covers the provider, render, generation v5, media, edit, account and tick codes by name', () => {
    const named = [...MARKETING_PROVIDER_FAILURE_CODES, ...DNESKAI_RENDER_FAILURE_CODES,
      'dneskai-daily-generation-budget-exhausted', 'dneskai-daily-generation-budget-invalid', 'dneskai-daily-generation-budget-unavailable',
      'brief-invalid', 'brief-slot-taken', 'render-validation-failed', 'dneskai-media-loader-required', 'picture-credits-too-long', 'picture-not-single-photo',
      'media-lease-lost', 'media-excluded-small', 'media-http-403', 'media-page-http-404', 'media-page-fetch-failed',
      'deck-asset-outside-brief', 'deck-edit-slide-count', 'deck-edit-slots-changed', 'deck-edit-slide-invalid', 'deck-edit-invalid', 'deck-edit-unsupported', 'render-attach-failed',
      'text-clipped', 'unsupported-glyph', 'text-unplaced', 'image-low-resolution', 'render-blocked', 'revision-not-ready',
      'account-unavailable', 'meta-http-400', 'access-token-expired', 'remote-account-handle-mismatch',
      'source-disabled', 'reader-disabled', 'empty-source', 'collection-timeout', 'source-rate-limited', 'fetch-failed',
      'yield-to-publication', 'tick-budget-exhausted', 'publishing-failed', 'collection-failed', 'container-error', 'remote-container-in_progress'];
    expect(named.filter((code) => !marketingCodeKnown(code))).toEqual([]);
  });

  it('reads an unknown code as the generic text and never shows a malformed one', () => {
    for (const lang of ['en', 'cs'] as const) {
      const unknown = describeMarketingCode('zz-never-recorded', lang);
      expect(unknown).toMatchObject({ code: 'zz-never-recorded', known: false });
      expect(unknown.happened).toBe(lang === 'cs' ? 'Něco neproběhlo podle očekávání.' : 'Something did not finish as expected.');
      expect(describeMarketingCode('Bearer SECRET token', lang)).toMatchObject({ code: null, known: false });
      expect(describeMarketingCode(null, lang).code).toBeNull();
    }
    expect(describeMarketingCode('meta-http-429', 'cs').happened).toContain('HTTP 429');
    expect(describeMarketingCode('dneskai-daily-generation-budget-exhausted', 'cs')).toMatchObject({ known: true, happened: 'Denní limit generování DNESKAi je vyčerpaný.' });
  });

  it('lets job health carry the new codes and still replaces free text', () => {
    expect(marketingJobErrorCode('dneskai-daily-generation-budget-exhausted')).toBe('dneskai-daily-generation-budget-exhausted');
    expect(marketingJobErrorCode('render-validation-failed')).toBe('render-validation-failed');
    expect(marketingJobErrorCode('provider-overloaded')).toBe('provider-overloaded');
    expect(marketingJobErrorCode('Authorization Bearer PRIVATE')).toBe('generation-failed');
    expect(marketingJobErrorCode('')).toBeNull();
    const [row] = safeMarketingJobs([{ id: '00000000-0000-4000-8000-000000000001', status: 'failed', error_code: 'brief-deck-invalid', brand: 'dneskai', created_at: '2026-10-20T12:00:00Z' }]);
    expect(row?.errorCode).toBe('brief-deck-invalid');
  });
  it('does not treat inherited dictionary properties as localized code text', () => {
    for (const code of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
      expect(marketingCodeKnown(code)).toBe(false);
      for (const lang of ['en', 'cs'] as const) {
        const description = describeMarketingCode(code, lang);
        expect(description.known).toBe(false); expect(typeof description.happened).toBe('string');
        expect(description.happened).toBe(lang === 'cs' ? 'Něco neproběhlo podle očekávání.' : 'Something did not finish as expected.');
      }
    }
  });
});
