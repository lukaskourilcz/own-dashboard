import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The editor draws with the same font and brand files the renderer verifies, byte for byte. */
const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
describe('Design Studio browser assets', () => {
  it('match the pinned renderer fonts and devShark pictures', () => {
    for (const [copy, source] of [
      ['public/design-studio/fonts/manrope-700.ttf', 'templates/marketing/fonts/manrope/manrope-700.ttf'],
      ['public/design-studio/fonts/manrope-800.ttf', 'templates/marketing/fonts/manrope/manrope-800.ttf'],
      ['public/design-studio/fonts/jetbrains-mono-400.ttf', 'templates/marketing/fonts/jetbrains-mono/jetbrains-mono-400.ttf'],
      ['public/design-studio/devshark/devshark-fin-clean-green.svg', 'templates/marketing/devshark/devshark-fin-clean-green.svg'],
      ['public/design-studio/devshark/devshark-fin-clean-ink.svg', 'templates/marketing/devshark/devshark-fin-clean-ink.svg'],
      ['public/design-studio/devshark/devshark-logo-horizontal-white.svg', 'templates/marketing/devshark/devshark-logo-horizontal-white.svg'],
    ]) expect(sha(copy!), copy).toBe(sha(source!));
  });
});
