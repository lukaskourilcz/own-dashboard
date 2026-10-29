import { expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { setReposDisconnected } from "@/lib/github-queries";
import { qk } from "@/lib/queries/keys";
it("cancels late remote results without clearing local/imported owner records", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    client.setQueryData(qk.repos, { kind: "ok", repos: [] }); client.setQueryData(qk.repoNotes, [{ id: "retained-local-note" }]);
    client.setQueryData(["github", "project-doc", "owner", "fixture", "README.md"], { kind: "ok", content: "Old remote document" });
    client.setQueryData(qk.marketingCalendars, { kind: "ok", data: { checkedAt: "2026-10-24T00:00:00Z", sources: [{ id: "fixture", status: "ok", calendar: { entries: [{ title: "Old remote entry" }] }, detail: null }] } });
    let settle!: (value: unknown) => void;
    const pending = client.fetchQuery({ queryKey: ["github", "commits", "owner/fixture"], queryFn: () => new Promise(resolve => { settle = resolve; }) }).catch(() => undefined);
    await setReposDisconnected(client); settle({ kind: "ok", commits: [{ message: "Late remote result" }] }); await pending; await Promise.resolve();
    expect(client.getQueryData(["github", "commits", "owner/fixture"])).toEqual({ kind: "disconnected" });
    expect(client.getQueryData(["github", "project-doc", "owner", "fixture", "README.md"])).toEqual({ kind: "disconnected" });
    expect(client.getQueryData(qk.repoNotes)).toEqual([{ id: "retained-local-note" }]);
    expect(client.getQueryData(qk.marketingCalendars)).toMatchObject({ kind: "ok", data: { sources: [{ status: "disconnected", calendar: null, detail: null }] } });
  } finally { client.clear(); }
});
