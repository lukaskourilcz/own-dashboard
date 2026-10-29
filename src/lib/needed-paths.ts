/** Root first, then the repository's documentation directory. */
export const NEEDED_FILE_PATHS = ["NEEDED.md", "docs/NEEDED.md"] as const;
export type NeededFilePath = (typeof NEEDED_FILE_PATHS)[number];
