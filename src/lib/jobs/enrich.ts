export function normalizeJobUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function jobPageTitleFields(pageTitle: string) {
  const clean = pageTitle.replace(/\s+/g, " ").trim();
  const parts = clean.split(/\s+(?:\||–|—|at)\s+/i).map((part) => part.trim()).filter(Boolean);
  if (/linkedin/i.test(parts.at(-1) ?? "")) parts.pop();
  return { title: parts[0] ?? clean, company: parts[1] ?? "" };
}
