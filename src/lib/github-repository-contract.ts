import { z } from "zod";
import { githubRepositoryName, githubWebUrl } from "@/lib/github-file-contract";

export const githubRepositoryFullName = z.string().max(205).refine(value => !/\p{Cc}/u.test(value)).transform(value => value.trim())
  .pipe(z.string().max(201).regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/))
  .refine(value => value.split("/").every(part => part !== "." && part !== ".."));
const date = z.iso.datetime({ offset: true }).nullable();
const repositoryFields = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), name: githubRepositoryName,
  full_name: githubRepositoryFullName, owner: githubRepositoryName,
  description: z.string().max(4096).nullable(), private: z.boolean(), fork: z.boolean(), archived: z.boolean(),
  html_url: githubWebUrl.refine(value => value.length <= 2048 && !/\p{Cc}/u.test(value)), default_branch: z.string().min(1).max(255).regex(/^[^\x00-\x1f\x7f]+$/),
  language: z.string().max(100).nullable(), stargazers_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  pushed_at: date, updated_at: date,
});
export const githubRepositorySchema = repositoryFields.refine(repo => {
  const [owner, name] = repo.full_name.split("/");
  const url = new URL(repo.html_url);
  return owner.toLowerCase() === repo.owner.toLowerCase() && name.toLowerCase() === repo.name.toLowerCase()
    && url.pathname.toLowerCase() === `/${repo.full_name}`.toLowerCase() && !url.search && !url.hash;
});

/** Only the metadata needed by the app leaves the server. Derive the web link
 * from the validated identity rather than forwarding arbitrary provider URLs. */
export const githubRawRepositorySchema = repositoryFields.omit({ owner: true, html_url: true })
  .extend({ owner: z.object({ login: githubRepositoryName }) })
  .transform(raw => githubRepositorySchema.parse({ ...raw, owner: raw.owner.login, html_url: `https://github.com/${raw.full_name}` }));
export const githubRawRepositoryPage = z.array(githubRawRepositorySchema).max(100)
  .refine(repos => new Set(repos.map(repo => repo.id)).size === repos.length);
export const githubRepositoriesResponse = z.object({ repos: z.array(githubRepositorySchema).max(100), hasMore: z.boolean().optional() })
  .refine(value => new Set(value.repos.map(repo => repo.id)).size === value.repos.length);
export const githubRepositoryLookupResponse = z.object({ id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), full_name: githubRepositoryFullName, repo: githubRepositorySchema })
  .refine(value => value.id === value.repo.id && value.full_name === value.repo.full_name);

export function githubHasNextPage(link: string | null): boolean {
  if (!link) return false;
  if (link.length > 16_384) throw Error("Repository pagination unavailable");
  const relations = link.matchAll(/;\s*rel\s*=\s*(?:"([^"]+)"|([^;\s,]+))/gi);
  return [...relations].some(match => (match[1] ?? match[2]).toLowerCase().split(/\s+/).includes("next"));
}
