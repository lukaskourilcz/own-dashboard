"use client";

import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { formatDistanceToNow } from "date-fns";
import {
  Archive,
  Check,
  ExternalLink,
  Eye,
  GitFork,
  Globe,
  ListFilter,
  Lock,
  Plus,
  RefreshCw,
  Star,
  Unlink,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { useDict, useDateLocale } from "@/lib/i18n";
import { GithubIcon } from "@/components/icons/github";
import { connectGitHub } from "@/lib/github-auth";
import {
  commitFile,
  normalizeRepoPath,
  type GithubCommitResult,
  type GithubRepo,
} from "@/lib/github";
import {
  bumpRepoInCache,
  setReposDisconnected,
  useReposQuery,
} from "@/lib/github-queries";
import { useMutation, useQueryClient } from "@tanstack/react-query";

type Status = "loading" | "connected" | "disconnected" | "error";

// Stable empty reference so the filter useMemo doesn't rerun every render.
const EMPTY_REPOS: GithubRepo[] = [];

export function ReposPanel({
  initialVisibleIds,
}: {
  /** Saved repo allow-list (GitHub repo ids as strings). Empty = show all. */
  initialVisibleIds: string[];
}) {
  const t = useDict();
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isPending, isFetching, refetch } = useReposQuery();
  const [query, setQuery] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [writeTarget, setWriteTarget] = useState<GithubRepo | null>(null);
  const [visibleIds, setVisibleIds] = useState<string[]>(initialVisibleIds);
  const [filterOpen, setFilterOpen] = useState(false);

  const repos = data?.kind === "ok" ? data.repos : EMPTY_REPOS;
  const status: Status = isPending
    ? "loading"
    : data
      ? data.kind === "ok"
        ? "connected"
        : data.kind
      : "error";

  async function onConnect() {
    setConnecting(true);
    const { error } = await connectGitHub();
    if (error) {
      toast.err(error);
      setConnecting(false);
    }
    // On success the browser navigates to GitHub, so no further work here.
  }

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/github/disconnect", { method: "POST" });
      if (!res.ok) throw new Error("server");
    },
    onSuccess: () => {
      toast.ok(t.github.disconnectOk);
      setReposDisconnected(qc);
    },
    onError: (e) =>
      toast.err(
        (e as Error).message === "server"
          ? t.github.disconnectErr
          : t.github.networkErr,
      ),
  });

  function onDisconnect() {
    if (window.confirm(t.github.disconnectConfirm)) disconnectMutation.mutate();
  }

  // Persist the chosen repo allow-list. An empty array clears the filter.
  const filterMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch("/api/user/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visible_repo_ids: ids }),
      });
      if (!res.ok) throw new Error("save failed");
      return ids;
    },
    onSuccess: (ids) => {
      setVisibleIds(ids);
      setFilterOpen(false);
      toast.ok(t.github.filterSaved);
    },
    onError: () => toast.err(t.github.filterErr),
  });

  // Saved allow-list applied to the live repo list. Empty list = no filter, so
  // everything the API returned is shown (the default, backward-compatible).
  const filterActive = visibleIds.length > 0;
  const visibleSet = useMemo(() => new Set(visibleIds), [visibleIds]);
  const scoped = useMemo(
    () =>
      filterActive
        ? repos.filter((r) => visibleSet.has(String(r.id)))
        : repos,
    [repos, filterActive, visibleSet],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter(
      (r) =>
        r.full_name.toLowerCase().includes(q) ||
        (r.description?.toLowerCase().includes(q) ?? false) ||
        (r.language?.toLowerCase().includes(q) ?? false),
    );
  }, [scoped, query]);

  return (
    <div>
      <PageHeader
        title={t.github.title}
        description={t.github.subtitle}
        action={
          status === "connected" ? (
            <div className="flex items-center gap-1.5">
              <Tooltip content={t.github.refresh}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => refetch()}
                  disabled={isFetching}
                  aria-label={t.github.refresh}
                >
                  <RefreshCw
                    className={"h-3.5 w-3.5" + (isFetching ? " animate-spin" : "")}
                  />
                </Button>
              </Tooltip>
              {repos.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setFilterOpen(true)}
                >
                  <ListFilter className="h-3.5 w-3.5" />
                  {t.github.filter}
                  {filterActive && (
                    <span className="ml-0.5 rounded-full bg-primary px-1.5 text-[10px] font-semibold tabular text-primary-foreground">
                      {scoped.length}
                    </span>
                  )}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={onDisconnect}
                disabled={disconnectMutation.isPending}
              >
                <Unlink className="h-3.5 w-3.5" />
                {t.github.disconnect}
              </Button>
            </div>
          ) : null
        }
      />

      {status === "loading" && (
        <div className="space-y-2.5">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[72px] w-full" />
          ))}
        </div>
      )}

      {status === "error" && (
        <EmptyState
          icon={GithubIcon}
          title={t.github.loadErr}
          action={
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-3.5 w-3.5" />
              {t.github.refresh}
            </Button>
          }
        />
      )}

      {status === "disconnected" && (
        <EmptyState
          icon={GithubIcon}
          title={t.github.connectTitle}
          description={t.github.connectBody}
          action={
            <Button onClick={onConnect} disabled={connecting}>
              <GithubIcon className="h-4 w-4" />
              {connecting ? t.common.redirecting : t.github.connect}
            </Button>
          }
        />
      )}

      {status === "connected" && (
        <>
          {repos.length > 0 && (
            <div className="mb-4 space-y-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.github.search}
              />
              {filterActive && (
                <div className="flex items-center justify-between px-0.5 text-xs text-foreground-muted">
                  <span>{t.github.showingCount(scoped.length, repos.length)}</span>
                  <button
                    type="button"
                    onClick={() => filterMutation.mutate([])}
                    disabled={filterMutation.isPending}
                    className="inline-flex items-center gap-1 font-medium text-foreground-muted hover:text-foreground transition-colors disabled:opacity-50 focus-ring rounded"
                  >
                    <Eye className="h-3 w-3" />
                    {t.github.showAll}
                  </button>
                </div>
              )}
            </div>
          )}

          {repos.length === 0 ? (
            <EmptyState icon={GithubIcon} title={t.github.empty} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={GithubIcon}
              title={
                filterActive && scoped.length === 0
                  ? t.github.filterHidesAll
                  : t.github.emptyHint
              }
              action={
                filterActive ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => filterMutation.mutate([])}
                    disabled={filterMutation.isPending}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    {t.github.showAll}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="space-y-2.5">
              {filtered.map((repo) => (
                <RepoRow
                  key={repo.id}
                  repo={repo}
                  onWrite={() => setWriteTarget(repo)}
                />
              ))}
            </div>
          )}
        </>
      )}

      <WriteFileDialog
        // Remount per repo so the form resets to a clean state (no reset effect).
        key={writeTarget?.id ?? "none"}
        repo={writeTarget}
        onClose={() => setWriteTarget(null)}
        onCommitted={(repoId) => bumpRepoInCache(qc, repoId)}
        onAuthLost={() => setReposDisconnected(qc)}
      />

      {filterOpen && (
        <RepoFilterDialog
          repos={repos}
          initialVisibleIds={visibleIds}
          saving={filterMutation.isPending}
          onSave={(ids) => filterMutation.mutate(ids)}
          onClose={() => setFilterOpen(false)}
        />
      )}
    </div>
  );
}

function RepoFilterDialog({
  repos,
  initialVisibleIds,
  saving,
  onSave,
  onClose,
}: {
  repos: GithubRepo[];
  initialVisibleIds: string[];
  saving: boolean;
  onSave: (ids: string[]) => void;
  onClose: () => void;
}) {
  const t = useDict();
  const allIds = useMemo(() => repos.map((r) => String(r.id)), [repos]);
  // No saved filter yet means every repo is currently visible, so start with
  // all of them checked; otherwise restore the saved selection.
  const [selected, setSelected] = useState<Set<string>>(() =>
    initialVisibleIds.length > 0 ? new Set(initialVisibleIds) : new Set(allIds),
  );
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((r) => r.full_name.toLowerCase().includes(q));
  }, [repos, query]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Save only ids that still exist, in list order — drops any stale entries.
  const chosen = useMemo(
    () => allIds.filter((id) => selected.has(id)),
    [allIds, selected],
  );
  const canSave = chosen.length > 0 && !saving;

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="anim-fade fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="anim-dialog fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-surface p-5 shadow-elevated">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className="text-sm font-semibold">
                {t.github.filterTitle}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-foreground-muted">
                {t.github.filterDesc}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t.github.cancel}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </Dialog.Close>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.github.filterSearch}
              autoFocus
            />
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => setSelected(new Set(allIds))}
            >
              {t.github.selectAll}
            </Button>
          </div>

          <div className="mt-3 -mx-1 flex-1 overflow-y-auto px-1">
            {shown.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-foreground-subtle">
                {t.github.emptyHint}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {shown.map((repo) => {
                  const id = String(repo.id);
                  const on = selected.has(id);
                  return (
                    <li key={repo.id}>
                      <button
                        type="button"
                        onClick={() => toggle(id)}
                        aria-pressed={on}
                        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-surface-hover focus-ring"
                      >
                        <span
                          className={
                            "grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors " +
                            (on
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border-strong")
                          }
                        >
                          {on && <Check className="h-3 w-3" />}
                        </span>
                        <span className="flex-1 truncate text-foreground">
                          {repo.full_name}
                        </span>
                        {repo.private ? (
                          <Lock className="h-3 w-3 shrink-0 text-foreground-subtle" />
                        ) : (
                          <Globe className="h-3 w-3 shrink-0 text-foreground-subtle" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSave([])}
              disabled={saving}
            >
              <Eye className="h-3.5 w-3.5" />
              {t.github.showAll}
            </Button>
            <div className="flex items-center gap-2">
              {chosen.length === 0 && (
                <span className="text-[11px] text-foreground-subtle">
                  {t.github.pickAtLeastOne}
                </span>
              )}
              <Dialog.Close asChild>
                <Button variant="ghost" size="sm">
                  {t.github.cancel}
                </Button>
              </Dialog.Close>
              <Button size="sm" onClick={() => onSave(chosen)} disabled={!canSave}>
                {saving ? t.github.saving : t.github.save}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RepoRow({
  repo,
  onWrite,
}: {
  repo: GithubRepo;
  onWrite: () => void;
}) {
  const t = useDict();
  const locale = useDateLocale();

  const updated = repo.pushed_at
    ? formatDistanceToNow(new Date(repo.pushed_at), {
        addSuffix: true,
        locale,
      })
    : t.github.never;

  return (
    <Card className="flex items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <a
            href={repo.html_url}
            target="_blank"
            rel="noreferrer"
            className="truncate text-sm font-medium text-foreground hover:underline"
          >
            {repo.full_name}
          </a>
          <Badge
            icon={repo.private ? Lock : Globe}
            label={repo.private ? t.github.privateLabel : t.github.publicLabel}
          />
          {repo.fork && <Badge icon={GitFork} label={t.github.fork} />}
          {repo.archived && <Badge icon={Archive} label={t.github.archived} />}
        </div>
        {repo.description && (
          <p className="mt-1 line-clamp-2 text-xs text-foreground-muted">
            {repo.description}
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-foreground-subtle">
          {repo.language && (
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-foreground-subtle" />
              {repo.language}
            </span>
          )}
          {repo.stargazers_count > 0 && (
            <span className="inline-flex items-center gap-1 tabular">
              <Star className="h-3 w-3" />
              {repo.stargazers_count}
            </span>
          )}
          <span>
            {t.github.updatedPrefix} {updated}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button variant="outline" size="sm" onClick={onWrite}>
          <Upload className="h-3.5 w-3.5" />
          {t.github.writeFile}
        </Button>
        <Tooltip content={t.github.open}>
          <Button asChild variant="ghost" size="icon-sm" aria-label={t.github.open}>
            <a href={repo.html_url} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        </Tooltip>
      </div>
    </Card>
  );
}

function Badge({
  icon: Icon,
  label,
}: {
  icon: typeof Lock;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground-muted">
      <Icon className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

function WriteFileDialog({
  repo,
  onClose,
  onCommitted,
  onAuthLost,
}: {
  repo: GithubRepo | null;
  onClose: () => void;
  onCommitted: (repoId: number) => void;
  onAuthLost: () => void;
}) {
  const t = useDict();
  const toast = useToast();
  const [path, setPath] = useState("");
  const [branch, setBranch] = useState("");
  // Prefilled commit message; the parent remounts this component per repo
  // (via `key`), so the initializer runs fresh each time the dialog opens.
  const [message, setMessage] = useState(() => t.github.messagePlaceholder);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GithubCommitResult | null>(null);

  if (!repo) return null;

  async function submit() {
    if (!repo) return;
    const normalized = normalizeRepoPath(path);
    if (!normalized) {
      toast.err(t.github.needPath);
      return;
    }
    if (!content.trim()) {
      toast.err(t.github.needContent);
      return;
    }
    setBusy(true);
    try {
      const outcome = await commitFile({
        owner: repo.owner,
        repo: repo.name,
        path: normalized,
        content,
        message: message.trim() || t.github.messagePlaceholder,
        branch: branch.trim() || undefined,
      });
      if (!outcome.ok) {
        if (outcome.status === 401) {
          onAuthLost();
          onClose();
          toast.err(t.github.reconnect);
        } else {
          toast.err(outcome.error || t.github.networkErr);
        }
        return;
      }
      setResult(outcome.result);
      onCommitted(repo.id);
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
              <Dialog.Title className="truncate text-sm font-semibold">
                {t.github.writeTitle} {repo.full_name}
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

          {result ? (
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setResult(null)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t.github.writeFile}
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
              <FormRow label={t.github.pathLabel}>
                <Input
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder={t.github.pathPlaceholder}
                  autoFocus
                />
              </FormRow>
              <FormRow label={t.github.branchLabel}>
                <Input
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder={repo.default_branch || t.github.branchPlaceholder}
                />
              </FormRow>
              <FormRow label={t.github.messageLabel}>
                <Input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={t.github.messagePlaceholder}
                />
              </FormRow>
              <FormRow label={t.github.contentLabel}>
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={t.github.contentPlaceholder}
                  className="min-h-[160px] font-mono text-xs"
                />
              </FormRow>
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
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FormRow({
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
