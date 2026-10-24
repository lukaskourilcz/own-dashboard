import { z } from "zod";
import { gitSha, githubWebUrl } from "@/lib/github-file-contract";
import { githubRepositoryFullName } from "@/lib/github-repository-contract";

const date = z.iso.datetime({ offset: true });
const commitUrl = githubWebUrl.refine(value => value.length <= 2048 && !/\p{Cc}/u.test(value));
export const githubHistoryCommit = z.object({
  sha: gitSha, shortSha: z.string(), message: z.string().max(120), author: z.string().max(1024),
  date: z.union([date, z.literal("")]), url: commitUrl,
}).refine(commit => {
  const url = new URL(commit.url);
  const match = url.pathname.match(/^\/([^/]+\/[^/]+)\/commit\/([a-f0-9]+)$/);
  return commit.shortSha === commit.sha.slice(0, 7) && !!match && match[2] === commit.sha
    && githubRepositoryFullName.safeParse(match[1]).success && !url.search && !url.hash;
});
export type GithubHistoryCommit = z.infer<typeof githubHistoryCommit>;

const rawAuthor = z.object({ name: z.string().max(1024).nullable().optional(), date: date.nullable().optional() }).nullable();
const rawCommit = z.object({
  sha: gitSha, html_url: commitUrl,
  commit: z.object({ message: z.string().max(262_144), author: rawAuthor, committer: rawAuthor.optional() }),
  author: z.object({ login: z.string().max(100) }).nullable(),
}).transform(raw => githubHistoryCommit.parse({
  sha: raw.sha, shortSha: raw.sha.slice(0, 7), message: raw.commit.message.split("\n", 1)[0].replace(/\r$/, "").slice(0, 120),
  author: raw.author?.login ?? raw.commit.author?.name ?? "", date: raw.commit.author?.date ?? raw.commit.committer?.date ?? "", url: raw.html_url,
}));
export const githubRawCommitPage = (maximum: number) => z.array(rawCommit).max(maximum)
  .refine(commits => new Set(commits.map(commit => commit.sha)).size === commits.length);
export const githubCodeVolume = z.object({
  additions: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), deletions: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), weeks: z.number().int().min(1).max(4),
});
export const githubCommitsResponse = z.object({ commits: z.array(githubHistoryCommit).max(15), codeVolume: githubCodeVolume.nullable() })
  .refine(result => new Set(result.commits.map(commit => commit.sha)).size === result.commits.length);

const projectFields = { projectId: z.uuid(), projectName: z.string().min(1).max(500), projectSlug: z.string().min(1).max(500), repo: githubRepositoryFullName };
export const githubActivityCommit = z.object({ ...githubHistoryCommit.shape, ...projectFields }).refine(commit => githubHistoryCommit.safeParse(commit).success);
export const githubActivityScope = z.object({
  projects: z.number().int().min(0).max(10), totalProjects: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  repositories: z.number().int().min(0).max(10), unavailableRepositories: z.number().int().min(0).max(10),
}).refine(scope => scope.projects <= scope.totalProjects && scope.repositories <= scope.projects && scope.unavailableRepositories <= scope.repositories);
export const githubActivityResponse = z.discriminatedUnion("connected", [
  z.object({ connected: z.literal(true), items: z.array(githubActivityCommit).max(30), scope: githubActivityScope }).refine(result =>
    new Set(result.items.map(item => `${item.repo.toLowerCase()}:${item.sha}`)).size === result.items.length
    && (result.scope.repositories === 0 || result.scope.unavailableRepositories < result.scope.repositories)
    && result.items.length <= Math.min(30, (result.scope.repositories - result.scope.unavailableRepositories) * 5)
    && new Set(result.items.map(item => item.repo.toLowerCase())).size <= result.scope.repositories - result.scope.unavailableRepositories),
  z.object({ connected: z.literal(false), items: z.array(githubActivityCommit).max(0) }),
]);
export const githubActivityProject = z.object({
  id: projectFields.projectId, name: projectFields.projectName, slug: projectFields.projectSlug, repo_full_name: githubRepositoryFullName,
  parent_id: z.uuid().nullable(), repo_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(), updated_at: date,
});
export type GithubActivityProject = z.infer<typeof githubActivityProject>;

const week = z.tuple([z.number().int().nonnegative().max(8_640_000_000_000), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), z.number().int().nonpositive().min(-Number.MAX_SAFE_INTEGER)]);
export function summarizeGithubCodeVolume(value: unknown) {
  const weeks = z.array(week).max(10_000).parse(value);
  if (!weeks.length) return null;
  if (new Set(weeks.map(row => row[0])).size !== weeks.length) throw Error("Statistics unavailable");
  const recent = weeks.sort((a, b) => a[0] - b[0]).slice(-4);
  return githubCodeVolume.parse({ additions: recent.reduce((sum, row) => sum + row[1], 0), deletions: -recent.reduce((sum, row) => sum + row[2], 0), weeks: recent.length });
}

export type GithubActivityCommit = z.infer<typeof githubActivityCommit>;
export type GithubActivityScope = z.infer<typeof githubActivityScope>;
