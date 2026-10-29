import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { readRepositoryFileSnapshot, commitRepositoryFile, RepositoryFileConflict } from '@/lib/github-repository-file-server';
import { gitBlobSha } from '@/lib/github-file-server';
const head = 'a'.repeat(40), savedHead = 'b'.repeat(40), path = 'NEEDED.md', text = '# Tasks\n', previous = '# Tasks\n- [ ] Done\n';
const source = (content = previous) => ({ path, oid: gitBlobSha(content), size: Buffer.byteLength(content), type: 'blob', mode: 33188 });
const snapshot = () => ({ databaseId: 42, nameWithOwner: 'owner/renamed', isArchived: false, branch: { id: 'REF_FIXTURE_42', prefix: 'refs/heads/', name: 'main', target: { __typename: 'Commit', oid: head, primary: source(), secondary: source() } } });
const saved = () => ({ commit: { oid: savedHead, url: `https://github.com/owner/renamed/commit/${savedHead}`, repository: { databaseId: 42 }, parents: { nodes: [{ oid: head }] }, file: source(text) }, ref: { id: 'REF_FIXTURE_42', prefix: 'refs/heads/', repository: { databaseId: 42 }, target: { oid: savedHead } } });
const input = { intent: 'edit' as const, owner: 'owner', repo: 'old-name', path, expectedSha: gitBlobSha(previous), expectedRepositoryId: 42, content: text, message: 'Clean finished tasks\n\nKeep the other lines.' };
type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;
let fetcher: ReturnType<typeof vi.fn<Fetcher>>, signal: AbortSignal;
beforeEach(() => { signal = new AbortController().signal; fetcher = vi.fn(async (_url, init) => { const request = JSON.parse(String(init?.body)); return Response.json({ data: request.query.startsWith('mutation') ? { createCommitOnBranch: saved() } : { repository: snapshot() } }); }); });
afterEach(() => vi.restoreAllMocks());

it('binds the commit to a permanent branch node and expected head, not the reusable repository name', async () => {
  expect(await commitRepositoryFile(fetcher, input, signal)).toMatchObject({ path, updated: true, unchanged: false, content: { sha: gitBlobSha(text) } });
  expect(fetcher).toHaveBeenCalledTimes(2); const write = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
  expect(write.variables.input.branch).toEqual({ id: 'REF_FIXTURE_42' }); expect(write.variables.input.expectedHeadOid).toBe(head);
  expect(write.variables.input.message).toEqual({ headline: 'Clean finished tasks', body: '\nKeep the other lines.' }); expect(write.variables.input.fileChanges).toEqual({ additions: [{ path, contents: Buffer.from(text).toString('base64') }] });
  expect(fetcher.mock.calls.every(call => call[0] === '/graphql' && call[1]?.signal === signal)).toBe(true);
});
it('reads file identities from the captured commit without requesting a tree or file bodies', async () => {
  const result = await readRepositoryFileSnapshot(fetcher, input, signal); expect(result.databaseId).toBe(42);
  const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body)); expect(request.query).toContain('file(path:$path)'); expect(request.query).not.toContain('text'); expect(request.variables).toEqual({ owner: 'owner', repo: 'old-name', path, fallback: path });
});
it('uses an explicit branch as a variable rather than interpolating it into the query', async () => {
  await readRepositoryFileSnapshot(fetcher, { ...input, branch: 'feature/test' }, signal); const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body)); expect(request.variables.branch).toBe('refs/heads/feature/test'); expect(request.query).not.toContain('feature/test');
});
it.each(['reused name', 'archive', 'missing file', 'changed file'] as const)('refuses %s before any mutation', async reason => {
  const data = snapshot(); if (reason === 'reused name') data.databaseId = 99; if (reason === 'archive') data.isArchived = true; if (reason === 'missing file') (data.branch.target as { primary: unknown }).primary = null; if (reason === 'changed file') data.branch.target.primary.oid = 'c'.repeat(40);
  fetcher.mockResolvedValue(Response.json({ data: { repository: data } })); await expect(commitRepositoryFile(fetcher, input, signal)).rejects.toBeInstanceOf(RepositoryFileConflict); expect(fetcher).toHaveBeenCalledOnce();
});
it('acknowledges an identical reviewed blob without making another commit', async () => {
  const result = await commitRepositoryFile(fetcher, { ...input, content: previous }, signal); expect(result).toMatchObject({ unchanged: true, commit: null, content: { sha: input.expectedSha } }); expect(fetcher).toHaveBeenCalledOnce();
});
it.each(['repository', 'branch', 'head', 'parent', 'blob', 'path', 'size', 'url'] as const)('rejects a mismatched %s in the write receipt', async kind => {
  const result = saved(); if (kind === 'repository') result.commit.repository.databaseId = 99; if (kind === 'branch') result.ref.id = 'FOREIGN_REF'; if (kind === 'head') result.ref.target.oid = 'c'.repeat(40); if (kind === 'parent') result.commit.parents.nodes[0].oid = 'c'.repeat(40); if (kind === 'blob') result.commit.file.oid = 'c'.repeat(40); if (kind === 'path') result.commit.file.path = 'OTHER.md'; if (kind === 'size') result.commit.file.size++; if (kind === 'url') result.commit.url = 'https://github.com/owner/foreign/commit/'+savedHead;
  fetcher.mockImplementation(async (_url, init) => Response.json({ data: JSON.parse(String(init?.body)).query.startsWith('mutation') ? { createCommitOnBranch: result } : { repository: snapshot() } }));
  await expect(commitRepositoryFile(fetcher, input, signal)).rejects.toThrow('Repository commit unconfirmed');
});
it('refuses partial GraphQL data with errors and exposes no provider error detail', async () => {
  fetcher.mockResolvedValue(Response.json({ data: { repository: snapshot() }, errors: [{ message: 'TEST_ONLY_PRIVATE' }] })); await expect(readRepositoryFileSnapshot(fetcher, input, signal)).rejects.toThrow(); expect(fetcher).toHaveBeenCalledOnce();
});
it('cancels a hanging provider and starts no follow-up mutation', async () => {
  const controller = new AbortController(); fetcher.mockImplementation(() => new Promise(() => undefined)); const pending = commitRepositoryFile(fetcher, input, controller.signal); controller.abort(); await expect(pending).rejects.toThrow(); expect(fetcher).toHaveBeenCalledOnce();
});
it('refuses already-cancelled work before provider access', async () => {
  const controller = new AbortController(); controller.abort(); await expect(commitRepositoryFile(fetcher, input, controller.signal)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
});
