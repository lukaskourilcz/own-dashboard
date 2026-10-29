import { z } from 'zod';

export function normalizeJobUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.href.length <= 2048 ? url.href : null;
  } catch {
    return null;
  }
}

const normalizedUrl = z.string().max(2048).refine(value => normalizeJobUrl(value) === value);
export const careerEnrichmentReceiptSchema = z.strictObject({
  ownerId: z.uuid(), inputUrl: normalizedUrl, url: normalizedUrl,
  title: z.string().trim().min(1).max(300), company: z.string().max(500),
  description: z.string().max(30_000),
});

export function jobPageTitleFields(pageTitle: string) {
  const clean = pageTitle.replace(/\s+/g, " ").trim();
  const parts = clean.split(/\s+(?:\||–|—|at)\s+/i).map((part) => part.trim()).filter(Boolean);
  if (/linkedin/i.test(parts.at(-1) ?? "")) parts.pop();
  return { title: parts[0] ?? clean, company: parts[1] ?? "" };
}
