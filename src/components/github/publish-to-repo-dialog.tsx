"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ExternalLink, RefreshCw, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useDict } from "@/lib/i18n";
import { GithubIcon } from "@/components/icons/github";
import { connectGitHub } from "@/lib/github-auth";
import {
  commitFile,
  loadReposResult,
  normalizeRepoPath,
  type GithubCommitResult,
  type GithubRepo,
  type LoadReposResult,
} from "@/lib/github";

type RepoState =
  | { kind: "loading" }
  | { kind: "ready"; repos: GithubRepo[] }
  | { kind: "disconnected" }
  | { kind: "error" };

/**
 * Repo-picker + commit dialog. Unlike the Repos panel's WriteFileDialog (which
 * targets a known repo and has a content textarea), this fetches the repo list
 * for a picker and pulls its content lazily from `getMarkdown` at commit time —
 * so it can publish a live BlockNote note as a .md file. Mount it only while
 * open (parent gates on a boolean) so each open starts clean.
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
  const [repoState, setRepoState] = useState<RepoState>({ kind: "loading" });
  const [selected, setSelected] = useState("");
  const [path, setPath] = useState(`notes/${defaultFileName || "note"}.md`);
  const [branch, setBranch] = useState("");
  const [message, setMessage] = useState(defaultMessage);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GithubCommitResult | null>(null);

  // Fetch repos on mount. setState lives in the deferred .then callback, never
  // synchronously in the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    let active = true;
    const apply = (r: LoadReposResult) => {
      if (!active) return;
      if (r.kind === "ok") {
        setRepoState({ kind: "ready", repos: r.repos });
        if (r.repos[0]) setSelected(r.repos[0].full_name);
      } else {
        setRepoState(r);
      }
    };
    void loadReposResult().then(apply);
    return () => {
      active = false;
    };
  }, []);

  async function onConnect() {
    const { error } = await connectGitHub();
    if (error) toast.err(error);
  }

  async function submit() {
    if (repoState.kind !== "ready") return;
    const repo = repoState.repos.find((r) => r.full_name === selected);
    if (!repo) return;
    const normalized = normalizeRepoPath(path);
    if (!normalized) {
      toast.err(t.github.needPath);
      return;
    }
    setBusy(true);
    try {
      const markdown = await getMarkdown();
      if (!markdown.trim()) {
        toast.err(t.github.needContent);
        return;
      }
      const outcome = await commitFile({
        owner: repo.owner,
        repo: repo.name,
        path: normalized,
        content: markdown,
        message: message.trim() || defaultMessage,
        branch: branch.trim() || undefined,
      });
      if (!outcome.ok) {
        toast.err(
          outcome.status === 401 ? t.github.reconnect : outcome.error,
        );
        return;
      }
      setResult(outcome.result);
      toast.ok(
        outcome.result.updated
          ? t.github.committedUpdate
          : t.github.committedNew,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="anim-fade fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="anim-dialog fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-5 shadow-elevated">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className="flex items-center gap-1.5 text-sm font-semibold">
                <GithubIcon className="h-4 w-4" />
                {t.github.publishNote}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-foreground-muted">
                {t.github.writeHint}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t.github.cancel}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </Dialog.Close>
          </div>

          {repoState.kind === "loading" && (
            <p className="mt-6 mb-2 text-center text-sm text-foreground-muted">
              {t.github.loadingRepos}
            </p>
          )}

          {(repoState.kind === "disconnected" ||
            repoState.kind === "error") && (
            <div className="mt-4 space-y-3">
              <p className="text-sm text-foreground-muted">
                {repoState.kind === "disconnected"
                  ? t.github.connectFirst
                  : t.github.loadErr}
              </p>
              {repoState.kind === "disconnected" && (
                <Button size="sm" onClick={onConnect}>
                  <GithubIcon className="h-4 w-4" />
                  {t.github.connect}
                </Button>
              )}
            </div>
          )}

          {repoState.kind === "ready" &&
            (result ? (
              <div className="mt-4 space-y-3">
                <p className="text-sm font-medium">
                  {result.updated
                    ? t.github.committedUpdate
                    : t.github.committedNew}
                </p>
                <p className="break-all rounded-md bg-surface-muted px-2.5 py-1.5 text-xs text-foreground-muted">
                  {result.path}
                </p>
                <div className="flex items-center gap-2">
                  <Button asChild variant="outline" size="sm">
                    <a
                      href={result.commit.html_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {t.github.viewCommit}
                    </a>
                  </Button>
                  <Dialog.Close asChild>
                    <Button size="sm" className="ml-auto">
                      {t.github.done}
                    </Button>
                  </Dialog.Close>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <PublishField label={t.github.repository}>
                  <Select
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    {repoState.repos.map((r) => (
                      <option key={r.id} value={r.full_name}>
                        {r.full_name}
                        {r.private ? " · private" : ""}
                      </option>
                    ))}
                  </Select>
                </PublishField>
                <PublishField label={t.github.pathLabel}>
                  <Input
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    placeholder={t.github.pathPlaceholder}
                  />
                </PublishField>
                <PublishField label={t.github.branchLabel}>
                  <Input
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder={t.github.branchPlaceholder}
                  />
                </PublishField>
                <PublishField label={t.github.messageLabel}>
                  <Input
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={t.github.messagePlaceholder}
                  />
                </PublishField>
                <div className="flex justify-end gap-2 pt-1">
                  <Dialog.Close asChild>
                    <Button variant="ghost" size="sm">
                      {t.github.cancel}
                    </Button>
                  </Dialog.Close>
                  <Button size="sm" onClick={submit} disabled={busy}>
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
