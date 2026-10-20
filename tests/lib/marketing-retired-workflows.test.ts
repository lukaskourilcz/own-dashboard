import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const retired = {
  'dneskai-collection-pilot-worker.json': '1hB4ROPAlWm3YSXn',
  'dneskai-production-verification.json': 'MK0xn98gIXofmZSn',
  'staging-source-check.json': 'pGCnlrtARffkMdw7',
  'daily-preparation.json': 'nyFAwH7lBpqK3tTR',
  'source-reconciliation.json': 'lB4tFoj9y0sTY08f',
} as const;
const companions = ['dneskai-collection-pilot-worker.md', 'staging-source-check.md'];
const followUps = { 'dneskai-source-collection.json': 'JyX8hAYI8sKMDPIc', 'approved-publisher.json': '8SOaq5tjMgnMQqEF' } as const;

describe('retired October staging exports (#113)', () => {
  it('keeps every retired export and companion in retired/ and none of them in the active directory', async () => {
    const active = await readdir('workflows/marketing');
    const archived = await readdir('workflows/marketing/retired');
    expect(archived.sort()).toEqual([...Object.keys(retired), ...companions, 'README.md'].sort());
    for (const file of [...Object.keys(retired), ...companions]) expect(active).not.toContain(file);
    for (const file of Object.keys(followUps)) expect(active).toContain(file);
    for (const file of Object.keys(retired)) expect(JSON.parse(await readFile(`workflows/marketing/retired/${file}`, 'utf8')).active).toBe(false);
  });

  it('records what each export was, its n8n id, the retirement date and the #120 follow-ups', async () => {
    const readme = await readFile('workflows/marketing/retired/README.md', 'utf8');
    expect(readme).toContain('2026-10-20');
    for (const [file, id] of Object.entries(retired)) { expect(readme).toContain(`\`${file}\``); expect(readme).toContain(id); }
    for (const [file, id] of Object.entries(followUps)) { expect(readme).toContain(`\`${file}\``); expect(readme).toContain(id); }
    expect(readme).toContain('#120');
    expect(readme).toContain('R3Za5yJAZOd8gFFK');
  });
});
