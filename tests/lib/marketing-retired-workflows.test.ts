import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const retired = {
  'dneskai-collection-pilot-worker.json': '1hB4ROPAlWm3YSXn',
  'dneskai-production-verification.json': 'MK0xn98gIXofmZSn',
  'staging-source-check.json': 'pGCnlrtARffkMdw7',
  'daily-preparation.json': 'nyFAwH7lBpqK3tTR',
  'source-reconciliation.json': 'lB4tFoj9y0sTY08f',
  // The last two DNESKAi timers, replaced by the pg_cron tick (#120).
  'dneskai-source-collection.json': 'JyX8hAYI8sKMDPIc',
  'approved-publisher.json': '8SOaq5tjMgnMQqEF',
} as const;
const companions = ['dneskai-collection-pilot-worker.md', 'staging-source-check.md'];
// What stays active belongs to devShark and the knowledge import, not to the DNESKAi chain.
const active = ['devshark-weekly-preparation.json', 'knowledge-processing.json', 'weekly-review.json'];

describe('retired October staging exports (#113) and n8n timers (#120)', () => {
  it('keeps every retired export and companion in retired/ and none of them in the active directory', async () => {
    const current = await readdir('workflows/marketing');
    const archived = await readdir('workflows/marketing/retired');
    expect(archived.sort()).toEqual([...Object.keys(retired), ...companions, 'README.md'].sort());
    for (const file of [...Object.keys(retired), ...companions]) expect(current).not.toContain(file);
    expect(current.filter((file) => file.endsWith('.json')).sort()).toEqual(active);
    for (const file of Object.keys(retired)) expect(JSON.parse(await readFile(`workflows/marketing/retired/${file}`, 'utf8')).active).toBe(false);
  });

  it('records what each export was, its n8n id, the retirement date and where scheduling went', async () => {
    const readme = await readFile('workflows/marketing/retired/README.md', 'utf8');
    expect(readme).toContain('2026-10-20');
    for (const [file, id] of Object.entries(retired)) { expect(readme).toContain(`\`${file}\``); expect(readme).toContain(id); }
    expect(readme).toContain('#120');
    expect(readme).toContain('docs/marketing-scheduling.md');
    expect(readme).toContain('R3Za5yJAZOd8gFFK');
  });

  it('leaves no DNESKAi collection or publish call in the exports that stay active', async () => {
    for (const file of active) {
      const workflow = JSON.parse(await readFile(`workflows/marketing/${file}`, 'utf8'));
      expect(JSON.stringify(workflow)).not.toMatch(/dneskai\/collect|operation:'publish'|"publish"/);
    }
  });
});
