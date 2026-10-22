import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { dneskaiDryDayOutDir } from '../helpers/dneskai-dry-day-out';

// TESTS-11: the dry-day artefacts used to go to a hard-coded path from an old cloud session.
describe('dneskaiDryDayOutDir', () => {
  it('defaults to a dneskai-dry-day folder in the OS temporary directory', () => {
    expect(dneskaiDryDayOutDir({}, '/var/tmp')).toBe(path.resolve('/var/tmp/dneskai-dry-day'));
    expect(dneskaiDryDayOutDir({ DNESKAI_DRY_DAY_OUT: '  ' }, '/var/tmp')).toBe(path.resolve('/var/tmp/dneskai-dry-day'));
  });

  it('uses DNESKAI_DRY_DAY_OUT when set, resolved to an absolute path', () => {
    expect(dneskaiDryDayOutDir({ DNESKAI_DRY_DAY_OUT: '/srv/review/dry-day' }, '/var/tmp')).toBe(path.resolve('/srv/review/dry-day'));
    expect(dneskaiDryDayOutDir({ DNESKAI_DRY_DAY_OUT: 'out/dry-day' }, '/var/tmp')).toBe(path.resolve('out/dry-day'));
  });

  it('never points at a session-specific scratch path', () => {
    expect(dneskaiDryDayOutDir({}, '/var/tmp')).not.toMatch(/claude-0|scratchpad/);
  });
});
