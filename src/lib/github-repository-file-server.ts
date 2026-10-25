import 'server-only';
import { z } from 'zod';
import { awaitWithSignal } from '@/lib/abortable';
import { gitSha, githubCommitResult, type CommitInput, type GithubCommitResult, MAX_GITHUB_FILE_BYTES } from '@/lib/github-file-contract';
import { githubRepositoryFullName } from '@/lib/github-repository-contract';
import { gitBlobSha, readGithubJson } from '@/lib/github-file-server';

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;
const repositoryId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const nodeId = z.string().min(1).max(1024);
const entry = z.object({ path: z.string(), oid: gitSha, size: z.number().int().nonnegative().max(MAX_GITHUB_FILE_BYTES), type: z.literal('blob'), mode: z.union([z.literal(33188), z.literal(33261)]) });
const fields = 'path oid size type mode';
const branchSchema = z.object({ id: nodeId, prefix: z.literal('refs/heads/'), name: z.string().min(1).max(255), target: z.object({ __typename: z.literal('Commit'), oid: gitSha, primary: entry.nullable(), secondary: entry.nullable() }) });
const snapshotSchema = z.object({ databaseId: repositoryId, nameWithOwner: githubRepositoryFullName, isArchived: z.boolean(), branch: branchSchema });
export type RepositoryFileSnapshot = z.infer<typeof snapshotSchema>;
export class RepositoryFileConflict extends Error {}

async function graphql(fetcher: Fetcher, query: string, variables: Record<string, unknown>, signal: AbortSignal) {
  signal.throwIfAborted();
  const response = await awaitWithSignal(fetcher('/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }), signal }), signal);
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    if (response.status === 401) throw new Error('disconnected');
    throw new Error('Repository result unavailable');
  }
  const result = z.object({ data: z.record(z.string(), z.unknown()), errors: z.array(z.unknown()).max(0).optional() }).parse(await readGithubJson(response, 65_536, signal));
  signal.throwIfAborted(); return result.data;
}

/** One immutable commit snapshot binds names to the captured numeric repository identity. */
export async function readRepositoryFileSnapshot(fetcher: Fetcher, input: { owner: string; repo: string; expectedRepositoryId: number; path: string; fallback?: string; branch?: string }, signal: AbortSignal): Promise<RepositoryFileSnapshot> {
  const ref = input.branch ? 'ref(qualifiedName:$branch)' : 'defaultBranchRef';
  const query = `query RepositoryFileSnapshot($owner:String!,$repo:String!,$path:String!,$fallback:String!${input.branch ? ',$branch:String!' : ''}){repository(owner:$owner,name:$repo){databaseId nameWithOwner isArchived branch:${ref}{id prefix name target{__typename oid ... on Commit{primary:file(path:$path){${fields}} secondary:file(path:$fallback){${fields}}}}}}}`;
  const data = await graphql(fetcher, query, { owner: input.owner, repo: input.repo, path: input.path, fallback: input.fallback ?? input.path, ...(input.branch ? { branch: input.branch.startsWith('refs/heads/') ? input.branch : `refs/heads/${input.branch}` } : {}) }, signal);
  const snapshot = snapshotSchema.parse(data.repository);
  if (snapshot.databaseId !== input.expectedRepositoryId) throw new RepositoryFileConflict('Repository identity changed');
  for (const [file, path] of [[snapshot.branch.target.primary, input.path], [snapshot.branch.target.secondary, input.fallback ?? input.path]] as const) {
    if (file && file.path !== path) throw new Error('Repository file identity unavailable');
  }
  return snapshot;
}

/** The branch node id and expected head make namespace changes and concurrent commits nonwriting conflicts. */
export async function commitRepositoryFile(fetcher: Fetcher, input: Extract<CommitInput, { intent: 'edit' }> & { expectedRepositoryId: number }, signal: AbortSignal): Promise<GithubCommitResult> {
  const snapshot = await readRepositoryFileSnapshot(fetcher, input, signal);
  const source = snapshot.branch.target.primary;
  if (snapshot.isArchived || !source || source.oid !== input.expectedSha) throw new RepositoryFileConflict('Repository file changed');
  const nextSha = gitBlobSha(input.content, source.oid.length), size = Buffer.byteLength(input.content, 'utf8');
  const fileUrl = (commit: string) => `https://github.com/${snapshot.nameWithOwner}/blob/${commit}/${input.path.split('/').map(encodeURIComponent).join('/')}`;
  if (nextSha === source.oid) return githubCommitResult.parse({ path: input.path, updated: true, unchanged: true, commit: null, content: { sha: nextSha, html_url: fileUrl(snapshot.branch.target.oid) } });
  const [headline, ...body] = input.message.split('\n');
  const query = `mutation RepositoryFileCommit($input:CreateCommitOnBranchInput!,$path:String!){createCommitOnBranch(input:$input){commit{oid url repository{databaseId} parents(first:1){nodes{oid}} file(path:$path){${fields}}} ref{id prefix repository{databaseId} target{oid}}}}`;
  const data = await graphql(fetcher, query, { path: input.path, input: { branch: { id: snapshot.branch.id }, expectedHeadOid: snapshot.branch.target.oid, message: { headline, ...(body.length ? { body: body.join('\n') } : {}) }, fileChanges: { additions: [{ path: input.path, contents: Buffer.from(input.content, 'utf8').toString('base64') }] } } }, signal);
  const saved = z.object({ commit: z.object({ oid: gitSha, url: z.string(), repository: z.object({ databaseId: repositoryId }), parents: z.object({ nodes: z.array(z.object({ oid: gitSha })).length(1) }), file: entry }), ref: z.object({ id: nodeId, prefix: z.literal('refs/heads/'), repository: z.object({ databaseId: repositoryId }), target: z.object({ oid: gitSha }) }) }).parse(data.createCommitOnBranch);
  if (saved.commit.repository.databaseId !== input.expectedRepositoryId || saved.ref.repository.databaseId !== input.expectedRepositoryId || saved.ref.id !== snapshot.branch.id || saved.ref.target.oid !== saved.commit.oid || saved.commit.parents.nodes[0].oid !== snapshot.branch.target.oid || saved.commit.file.path !== input.path || saved.commit.file.oid !== nextSha || saved.commit.file.size !== size || saved.commit.url !== `https://github.com/${snapshot.nameWithOwner}/commit/${saved.commit.oid}`) throw new Error('Repository commit unconfirmed');
  return githubCommitResult.parse({ path: input.path, updated: true, unchanged: false, commit: { sha: saved.commit.oid, html_url: saved.commit.url }, content: { sha: nextSha, html_url: fileUrl(saved.commit.oid) } });
}
