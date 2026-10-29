import { expect, it } from 'vitest';
import { normalizeEmployerJob } from '@/lib/jobs/employer-sources';
const row = (workplaceType: string | undefined, location = 'Oslo, Norway') => ({ id: 'synthetic', title: 'Frontend Engineer React', descriptionPlain: 'React TypeScript frontend', location, jobUrl: 'https://jobs.ashbyhq.com/sanity/synthetic', isRemote: true, workplaceType });
it.each(['Hybrid', 'OnSite', 'hybrid', 'on-site', 'unspecified', undefined])('does not equate a broad isRemote Boolean with fully remote work (%s)', workplace => {
 expect(normalizeEmployerJob(row(workplace), { id: 'ashby-sanity', name: 'Synthetic employer' })?.remote).toBe(false);
});
it.each(['Remote', 'remote'])('retains explicit fully remote work (%s)', workplace => { expect(normalizeEmployerJob(row(workplace, 'Europe'), { id: 'ashby-sanity', name: 'Synthetic employer' })?.remote).toBe(true); });
it('does not infer Norway-compatible remote employment from a Europe-wide hybrid location', () => { expect(normalizeEmployerJob(row('Hybrid', 'Europe'), { id: 'ashby-sanity', name: 'Synthetic employer' })).toBeNull(); });
