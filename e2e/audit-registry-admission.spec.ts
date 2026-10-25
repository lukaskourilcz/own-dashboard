import { expect, test } from '@playwright/test';
for (const kind of ['ares', 'vies'] as const) test(`${kind}: native route refuses malformed registry requests before provider admission`, async ({ request, baseURL }) => {
 const field = kind === 'ares' ? 'ico' : 'vatId', endpoint = `/api/registry/${kind}`, origin = new URL(baseURL!).origin;
 for (const data of [null, { [field]: 123 }, { [field]: [] }, { [field]: 'x'.repeat(1025) }, { [field]: 'invalid', extra: true }]) {
  const response = await request.post(endpoint, { headers: { origin }, data });
  expect(response.status()).toBe(400); expect(response.headers()['cache-control']).toBe('private, no-store');
  expect(await response.json()).toHaveProperty('error');
 }
 const csrf = await request.post(endpoint, { headers: { origin: 'https://foreign.example' }, data: { [field]: 'invalid' } });
 expect(csrf.status()).toBe(403); expect(csrf.headers()['cache-control']).toBe('private, no-store');
 const utf8 = await request.post(endpoint, { headers: { origin, 'content-type': 'application/json' }, data: Buffer.from([0xc3, 0x28]) }); expect(utf8.status()).toBe(400);
});
