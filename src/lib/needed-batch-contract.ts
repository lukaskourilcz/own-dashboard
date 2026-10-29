import { z } from "zod";
import { githubRepositoryName, gitSha, githubWebUrl, MAX_GITHUB_FILE_BYTES } from "@/lib/github-file-contract";
import { NEEDED_FILE_PATHS } from "@/lib/needed-paths";
export const neededBatchInput = z.object({ repos: z.array(z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), owner: githubRepositoryName, name: githubRepositoryName,
}).strict()).max(100) }).strict().refine(input => new Set(input.repos.map(repo => repo.id)).size === input.repos.length);
export const neededFileResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ok"), path: z.enum(NEEDED_FILE_PATHS), content: z.string().max(MAX_GITHUB_FILE_BYTES), sha: gitSha, htmlUrl: githubWebUrl.nullable() }),
  z.object({ kind: z.literal("not-found") }), z.object({ kind: z.literal("error") }), z.object({ kind: z.literal("disconnected") }),
]);
export const neededBatchResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ok"), files: z.array(z.object({ repoId: z.string().regex(/^[0-9]{1,100}$/), result: neededFileResultSchema })).max(100) }),
  z.object({ kind: z.literal("disconnected") }),
]);
export type NeededBatchResult = z.infer<typeof neededBatchResultSchema>;
export type NeededBatchRepository = z.infer<typeof neededBatchInput>["repos"][number];
