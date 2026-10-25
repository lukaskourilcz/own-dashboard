import { z } from "zod";
import { MAX_GITHUB_FILE_BYTES, normalizeRepoPath } from "@/lib/github-path";
export { MAX_GITHUB_FILE_BYTES, normalizeRepoPath };

export const gitSha = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
export const githubWebUrl = z.url().refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && url.hostname === "github.com" && !url.port && !url.username && !url.password;
});

export const githubRepositoryName = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/).refine(value => value !== "." && value !== "..");
const commonInput = z.object({
  owner: githubRepositoryName, repo: githubRepositoryName, path: z.string().transform(normalizeRepoPath).pipe(z.string()),
  content: z.string().max(MAX_GITHUB_FILE_BYTES), message: z.string().trim().min(1).max(2000),
  branch: z.string().trim().min(1).max(255).regex(/^[^\x00-\x1f\x7f]+$/).optional(),
});
export const githubCommitInput = z.discriminatedUnion("intent", [
  commonInput.extend({ intent: z.literal("replace") }).strict(),
  commonInput.extend({ intent: z.literal("edit"), expectedSha: gitSha, expectedRepositoryId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional() }).strict(),
]);
export type CommitInput = z.input<typeof githubCommitInput>;
export const githubFileResponse = z.object({ content: z.string().max(MAX_GITHUB_FILE_BYTES), html_url: githubWebUrl.nullable(), sha: gitSha });
export const githubCommitResult = z.object({
  path: z.string().min(1).max(1024), updated: z.boolean(), unchanged: z.boolean(),
  commit: z.object({ sha: gitSha, html_url: githubWebUrl }).nullable(),
  content: z.object({ sha: gitSha, html_url: githubWebUrl }),
}).refine(result => result.unchanged ? result.updated && result.commit === null : result.commit !== null);
export type GithubCommitResult = z.infer<typeof githubCommitResult>;
