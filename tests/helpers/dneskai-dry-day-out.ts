import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Where the dry-day test leaves its rendered slides, contact sheet and ticks.json for visual review:
 * `DNESKAI_DRY_DAY_OUT` when set, otherwise `dneskai-dry-day` in the OS temporary directory.
 */
export function dneskaiDryDayOutDir(env: Readonly<Record<string, string | undefined>> = process.env, temporary: string = tmpdir()): string {
  const configured = env.DNESKAI_DRY_DAY_OUT?.trim();
  return path.resolve(configured ? configured : path.join(temporary, 'dneskai-dry-day'));
}
