export const MAX_GITHUB_FILE_BYTES = 1_000_000;

/** Accept a convenient leading slash, but never traversal/control segments. */
export function normalizeRepoPath(raw: string): string | null {
  const path = raw.trim().replace(/^\/+/, "");
  if (!path || path.length > 1024 || /[\x00-\x1f\x7f\\]/.test(path)) return null;
  return path.split("/").some(part => !part || part === "." || part === "..") ? null : path;
}
