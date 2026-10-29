"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useDict } from "@/lib/i18n";
import { GithubIcon } from "@/components/icons/github";
import { awaitWithSignal } from "@/lib/abortable";
import { connectGitHub } from "@/lib/github-auth";
import { useGuardedNavigation } from "@/components/navigation-guard";
import {
  commitFile,
  normalizeRepoPath,
  type GithubCommitResult,
  type GithubRepo,
} from "@/lib/github";
import { bumpRepoInCache, useReposQuery } from "@/lib/github-queries";

const EMPTY_REPOS: GithubRepo[] = [];

/**
 * Repo-picker + commit dialog. Unlike the Repos panel's WriteFileDialog (which
 * targets a known repo and has a content textarea), this picks from the repo
 * list and pulls its content lazily from `getMarkdown` at commit time — so it
 * can publish a live BlockNote note as a .md file. Repos come from the shared
 * TanStack query, so opening this dialog reuses the panel's cached list.
 */
export function PublishToRepoDialog({
  getMarkdown,
  defaultFileName,
  defaultMessage,
  onClose,
}: {
  /** Resolves the markdown body to commit (called at submit time). */
  getMarkdown: () => Promise<string>;
  /** Safe base filename without extension, e.g. "meeting-notes". */
  defaultFileName: string;
  defaultMessage: string;
  onClose: () => void;
}) {
  const t = useDict();
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isPending, isError, isFetching, refetch } = useReposQuery();
  const repos = data?.kind === "ok" ? data.repos : EMPTY_REPOS;

  const guardNavigation = useGuardedNavigation();
  const [selected, setSelected] = useState("");
  const selectedFullName = selected || repos.find(repo => !repo.archived)?.full_name || repos[0]?.full_name || "";
  const selectedRepo = repos.find(repo => repo.full_name === selectedFullName);
  const [path, setPath] = useState(`notes/${defaultFileName || "note"}.md`);
  const [branch, setBranch] = useState("");
  const [message, setMessage] = useState(defaultMessage);
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [result, setResult] = useState<GithubCommitResult | null>(null);

  function onConnect() { guardNavigation(() => { void startConnecting(); }); }

  async function startConnecting() {
    if (connecting || busy) return;
    setConnecting(true);
    try { if ((await connectGitHub()).error) throw Error(); }
    catch { toast.err(t.github.connectErr); setConnecting(false); }
  }

  async function submit() {
    const repo = repos.find((r) => r.full_name === selectedFullName);
    if (!repo) return;
    if (repo.archived) { toast.err(t.github.archivedReadOnly); return; }
    const normalized = normalizeRepoPath(path);
    if (!normalized) {
      toast.err(t.github.needPath);
      return;
    }
    setBusy(true);
    try {
      const markdown = await awaitWithSignal(getMarkdown(), AbortSignal.timeout(15_000));
      if (!markdown.trim()) {
        toast.err(t.github.needContent);
        return;
      }
      const outcome = await commitFile({
        intent: "replace",
        owner: repo.owner,
        repo: repo.name,
        path: normalized,
        content: markdown,
        message: message.trim() || defaultMessage,
        branch: branch.trim() || undefined,
      });
      if (!outcome.ok) {
        toast.err(outcome.status === 401 ? t.github.reconnect : outcome.status === 409 ? t.github.fileChanged : t.github.commitUnconfirmed);
        return;
      }
      setResult(outcome.result);
      if (!outcome.result.unchanged) bumpRepoInCache(qc, repo.id);
      toast.ok(
        outcome.result.unchanged ? t.github.alreadySaved : outcome.result.updated
          ? t.github.committedUpdate
          : t.github.committedNew,
      );
    } catch { toast.err(t.github.notesPushErr); } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy && !connecting) onClose(); }}>
      <DialogContent className="max-w-lg" aria-busy={busy || connecting} showClose={!busy && !connecting}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <GithubIcon className="h-4 w-4" />
              {t.github.publishNote}
            </DialogTitle>
            <DialogDescription>
              {t.github.writeHint}
            </DialogDescription>
          </DialogHeader>

          {!result && isPending && (
            <p className="mt-6 mb-2 text-center text-sm text-foreground-muted">
              {t.github.loadingRepos}
            </p>
          )}

          {!result && !isPending &&
            data?.kind === "disconnected" && (
              <div className="mt-4 space-y-3">
                <p className="text-sm text-foreground-muted">
                  {t.github.connectFirst}
                </p>
                {data?.kind === "disconnected" && (
                  <Button size="sm" onClick={onConnect} disabled={connecting || busy}>
                    <GithubIcon className="h-4 w-4" />
                    {t.github.connect}
                  </Button>
                )}
              </div>
            )}

          {!result && isError && data?.kind !== "disconnected" && <div role="alert" className="mt-3 space-y-2"><p className="text-sm text-foreground-muted">{data?.kind === "ok" ? t.github.cachedReadFailed : t.github.loadErr}</p><Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching || busy}>{t.github.refresh}</Button></div>}
          {!result && data?.kind === "ok" && data.hasMore && <p role="status" className="mt-3 text-xs text-foreground-muted">{t.github.recentPageLimit(data.repos.length)}</p>}
          {!result && data?.kind === "ok" && repos.length === 0 && <p className="mt-3 text-sm text-foreground-muted">{t.github.empty}</p>}
          {(result || (data?.kind === "ok" && repos.length > 0)) &&
            (result ? (
              <div className="mt-4 space-y-3">
                <p className="text-sm font-medium">
                  {result.unchanged ? t.github.alreadySaved : result.updated
                    ? t.github.committedUpdate
                    : t.github.committedNew}
                </p>
                <p className="break-all rounded-md bg-surface-muted px-2.5 py-1.5 text-xs text-foreground-muted">
                  {result.path}
                </p>
                <div className="flex items-center gap-2">
                  <Button asChild variant="outline" size="sm">
                    <a
                      href={result.commit?.html_url ?? result.content.html_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {result.unchanged ? t.github.open : t.github.viewCommit}
                    </a>
                  </Button>
                  <DialogClose asChild>
                    <Button size="sm" className="ml-auto">
                      {t.github.done}
                    </Button>
                  </DialogClose>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {selectedRepo?.archived && <p role="status" className="text-sm text-foreground-muted">{t.github.archivedReadOnly}</p>}
                <PublishField label={t.github.repository}>
                  <SimpleSelect
                    disabled={busy}
                    aria-label={t.github.repository}
                    value={selectedFullName}
                    onValueChange={setSelected}
                    options={repos.map((r) => ({
                      value: r.full_name,
                      disabled: r.archived,
                      label: (
                        <>
                          {r.full_name}
                          {r.private ? ` · ${t.github.privateLabel}` : ""}
                        </>
                      ),
                    }))}
                  />
                </PublishField>
                <PublishField label={t.github.pathLabel}>
                  <Input
                    disabled={busy}
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    placeholder={t.github.pathPlaceholder}
                  />
                </PublishField>
                <PublishField label={t.github.branchLabel}>
                  <Input
                    disabled={busy}
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder={t.github.branchPlaceholder}
                  />
                </PublishField>
                <PublishField label={t.github.messageLabel}>
                  <Input
                    disabled={busy}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={t.github.messagePlaceholder}
                  />
                </PublishField>
                <div className="flex justify-end gap-2 pt-1">
                  <DialogClose asChild>
                    <Button variant="ghost" size="sm" disabled={busy}>
                      {t.github.cancel}
                    </Button>
                  </DialogClose>
                  <Button size="sm" onClick={submit} disabled={busy || !selectedRepo || selectedRepo.archived}>
                    {busy ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        {t.github.committing}
                      </>
                    ) : (
                      <>
                        <Upload className="h-3.5 w-3.5" />
                        {t.github.commit}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ))}
      </DialogContent>
    </Dialog>
  );
}

function PublishField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-foreground-muted">
        {label}
      </span>
      {children}
    </label>
  );
}
