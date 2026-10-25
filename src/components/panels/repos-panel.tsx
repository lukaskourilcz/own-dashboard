"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import { formatDistanceToNow } from "date-fns";
import {
  Archive,
  Check,
  ExternalLink,
  Eye,
  GitFork,
  Globe,
  Link2,
  ListChecks,
  ListFilter,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  Unlink,
  Upload,
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
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { useDict, useDateLocale } from "@/lib/i18n";
import { GithubIcon } from "@/components/icons/github";
import { connectGitHub } from "@/lib/github-auth";
import { useGuardedNavigation, useUnsavedDraft } from "@/components/navigation-guard";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import { useOwnerPreferences } from "@/lib/owner-preferences";
import { useRepositoryFilter } from "@/lib/use-prefs";
import { qk } from "@/lib/queries/keys";
import {
  commitFile,
  normalizeRepoPath,
  type GithubCommitResult,
  type GithubRepo,
} from "@/lib/github";
import {
  bumpRepoInCache,
  setReposDisconnected,
  touchRepoInCache,
  useWorkspaceRepositories,
} from "@/lib/github-queries";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { NeededChecklist } from "@/components/panels/needed-checklist";
import type { RepoLink, RepoNote, Updater } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useRepositoryNoteAutosave } from "@/components/github/use-repository-note-autosave";
import { consumeRepositoryRecords, createRepositoryNote, repositoryNoteSchema, type NewRepositoryNote } from "@/lib/repository-records";
import { readOwnedCollection } from "@/lib/owned-records";
import { RepositoryLinkControl } from "@/components/github/repository-link-control";
import { awaitWithSignal } from "@/lib/abortable";
import { readTextPrefix } from "@/lib/bounded-text";
import { safeWebUrl } from "@/lib/web-url";
import { RepositoryFilterDialog } from "@/components/github/repository-filter-dialog";
import { useRepositoryFilterSave } from "@/components/github/use-repository-filter-save";

type Status = "loading" | "connected" | "disconnected" | "not-found" | "error";

// Stable empty references so the per-repo lookups never hand a card a fresh
// array each render.
const EMPTY_REPOS: GithubRepo[] = [];
const EMPTY_NOTES: RepoNote[] = [];
const EMPTY_NAMES: string[] = [];
type RepositoryCardSource = { id: string; fullName: string; repo: GithubRepo | null };

// The single markdown file each repo's notes are written to. A stable path so
// "the latest .md" is always the same file — re-saving updates it in place.
const NOTES_PATH = "dashboard-notes.md";

/** Wrap a repo's notes in a titled markdown document. */
function compileMarkdown(fullName: string, body: string): string {
  return `# Notes — ${fullName}\n\n${body.trim()}\n`;
}

/** Strip the scheme and a leading "www." for display:
 * https://www.umyjemefasadu.cz → umyjemefasadu.cz */
function displayUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname === "/" ? "" : u.pathname.replace(/\/+$/, "");
    return `${host}${path}${u.search}`;
  } catch {
    return raw
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./, "")
      .replace(/\/+$/, "");
  }
}

export function ReposPanel({
  initialVisibleIds,
  repoFullName,
  repoId,
  previousRepoNames = EMPTY_NAMES,
  repoNotes,
  setRepoNotes,
  repoLinks,
  setRepoLinks,
}: {
  /** Saved repo allow-list (GitHub repo ids as strings). Empty = show all. */
  initialVisibleIds: string[];
  /** When set, embed only this repository in its owning project workspace. */
  repoFullName?: string;
  repoId?: number | null;
  previousRepoNames?: string[];
  repoNotes: RepoNote[];
  setRepoNotes: Updater<RepoNote[]>;
  repoLinks: RepoLink[];
  setRepoLinks: Updater<RepoLink[]>;
}) {
  const t = useDict();
  const toast = useToast();
  const confirm = useConfirmation();
  const qc = useQueryClient();
  const { data, isPending, isFetching, isError, refetch } = useWorkspaceRepositories(repoFullName, repoId ?? undefined);
  const guardNavigation = useGuardedNavigation();
  const autosave = useRepositoryNoteAutosave(setRepoNotes, () => toast.err(t.github.noteSaveErr), () => { void qc.invalidateQueries({ queryKey: qk.repoNotes }); });
  const [query, setQuery] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [writeTarget, setWriteTarget] = useState<GithubRepo | null>(null);
  const [showNeeded, setShowNeeded] = useState(false);
  // Prefer the device-local copy (survives reloads even if the server prefs
  // round-trip isn't available); fall back to the server-provided value.
  const { ids: visibleIds } = useRepositoryFilter(initialVisibleIds);
  const [filterOpen, setFilterOpen] = useState(false);

  const repos = data?.kind === "ok" ? data.repos : EMPTY_REPOS;
  const status: Status = isPending
    ? "loading"
    : data
      ? data.kind === "ok"
        ? "connected"
        : data.kind
      : "error";

  // Group note entries by repo (sorted) and index links by repo for O(1) lookup.
  const entriesByRepo = useMemo(() => {
    const map = new Map<string, RepoNote[]>();
    for (const n of repoNotes) {
      const arr = map.get(n.repo_id);
      if (arr) arr.push(n);
      else map.set(n.repo_id, [n]);
    }
    for (const arr of map.values()) {
      arr.sort(
        (a, b) =>
          a.sort_order - b.sort_order ||
          a.created_at.localeCompare(b.created_at),
      );
    }
    return map;
  }, [repoNotes]);

  const linksByRepo = useMemo(() => {
    const map = new Map<string, RepoLink>();
    for (const l of repoLinks) map.set(l.repo_id, l);
    return map;
  }, [repoLinks]);

  function onConnect() { guardNavigation(() => { void startConnecting(); }); }

  async function startConnecting() {
    if (connecting) return;
    setConnecting(true);
    try { if ((await connectGitHub()).error) throw Error(); }
    catch { toast.err(t.github.connectErr); setConnecting(false); }
  }

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const signal = AbortSignal.timeout(20_000);
      const res = await awaitWithSignal(fetch("/api/github/disconnect", { method: "POST", signal }), signal);
      if (!res.ok) { void res.body?.cancel().catch(() => undefined); throw new Error("server"); }
      const body = await awaitWithSignal(readTextPrefix(res, 4096, signal), signal);
      if (body.truncated) throw new Error("server");
      const receipt = JSON.parse(body.text);
      if (receipt?.ok !== true || typeof receipt.upstreamRevoked !== "boolean") throw new Error("server");
      return receipt as { upstreamRevoked: boolean };
    },
    onSuccess: receipt => {
      if (receipt.upstreamRevoked) toast.ok(t.github.disconnectOk);
      else toast.info(t.github.disconnectLocalOnly);
      return setReposDisconnected(qc);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.integrationStatus }),
    onError: () => toast.err(t.github.disconnectErr),
  });

  async function onDisconnect() {
    if (await confirm({
      title: t.github.disconnect,
      description: t.github.disconnectConfirm,
      confirmLabel: t.github.disconnect,
      cancelLabel: t.common.cancel,
      destructive: true,
    })) disconnectMutation.mutate();
  }

  const filterMutation = useRepositoryFilterSave(() => setFilterOpen(false));

  // Saved allow-list applied to the live repo list. Empty list = no filter, so
  // everything the API returned is shown (the default, backward-compatible).
  const filterActive = !repoFullName && visibleIds.length > 0;
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

  // Local records remain real owned data when provider metadata is absent.
  // Keep one keyed card tree, so disconnect/reconnect cannot remount a draft.
  const cards = useMemo(() => {
    const sources = new Map<string, RepositoryCardSource>();
    for (const repo of filtered) sources.set(String(repo.id), { id: String(repo.id), fullName: repo.full_name, repo });
    const names = new Set([repoFullName, ...previousRepoNames].filter((name): name is string => !!name).map(name => name.trim().toLowerCase()));
    for (const row of [...repoNotes, ...repoLinks]) {
      if (repoFullName && (repoId != null ? row.repo_id !== String(repoId) : !names.has(row.repo_full_name.trim().toLowerCase()))) continue;
      if (!repoFullName && filterActive && !visibleSet.has(row.repo_id)) continue;
      if (query.trim() && !row.repo_full_name.toLowerCase().includes(query.trim().toLowerCase())) continue;
      if (!sources.has(row.repo_id)) sources.set(row.repo_id, { id: row.repo_id, fullName: repoFullName ?? row.repo_full_name, repo: null });
    }
    return [...sources.values()];
  }, [filtered, repoFullName, repoId, previousRepoNames, repoNotes, repoLinks, filterActive, visibleSet, query]);

  return (
    <div className={repoFullName ? "mx-auto max-w-3xl" : undefined}>
      <PageHeader
        title={repoFullName ? repos[0]?.full_name ?? repoFullName : t.github.title}
        description={repoFullName ? undefined : t.github.subtitle}
        density={repoFullName ? "compact" : "regular"}
        action={
          status === "connected" ? (
            <div className="flex flex-wrap items-center justify-end gap-1.5">
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
                  variant={showNeeded ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowNeeded((v) => !v)}
                  aria-label={t.github.needed.button}
                >
                  <ListChecks className="h-3.5 w-3.5" />
                  NEEDED
                </Button>
              )}
              {repos.length > 0 && !repoFullName && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setFilterOpen(true)}
                >
                  <ListFilter className="h-3.5 w-3.5" />
                  {t.github.filter}
                  {filterActive && (
                    <span className="ml-0.5 rounded-full bg-primary px-[7px] py-[3px] text-[10px] font-semibold tabular text-primary-foreground">
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

      {status === "loading" && cards.length === 0 &&
        (repoFullName ? (
          // Project workspace shows a single repo card — match it.
          <Skeleton className="h-[260px] w-full" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-[260px] w-full" />
            ))}
          </div>
        ))}

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

      {status === "not-found" && <EmptyState icon={GithubIcon} title={t.github.repositoryUnavailable} action={<Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>{t.github.refresh}</Button>} />}
      {status === "connected" && isError && <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/30 p-3 text-sm text-foreground-muted"><p>{t.github.cachedReadFailed}</p><Button size="sm" variant="outline" onClick={() => void refetch()} disabled={isFetching}>{t.github.refresh}</Button></div>}
      {status === "connected" && data?.kind === "ok" && data.hasMore && <p role="status" className="mb-3 text-xs text-foreground-muted">{t.github.recentPageLimit(data.repos.length)}</p>}

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
          {showNeeded && scoped.length > 0 && (
            <NeededChecklist repos={scoped} />
          )}

          {repos.length > 0 && !repoFullName && (
            <div className="mb-4 space-y-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label={t.github.search}
                placeholder={t.github.search}
              />
              {filterActive && (
                <div className="flex items-center justify-between px-0.5 text-xs text-foreground-muted">
                  <span>{t.github.showingCount(scoped.length, repos.length)}</span>
                  <button
                    type="button"
                    onClick={() => void filterMutation.save([])}
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

          {repos.length === 0 && cards.length === 0 ? (
            <EmptyState icon={GithubIcon} title={t.github.empty} />
          ) : cards.length === 0 ? (
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
                    onClick={() => void filterMutation.save([])}
                    disabled={filterMutation.isPending}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    {t.github.showAll}
                  </Button>
                ) : undefined
              }
            />
          ) : null}
        </>
      )}

      {cards.some(source => !source.repo) && <p role="status" className="mb-3 text-xs text-foreground-muted">{t.github.localRecordsAvailable}</p>}
      {cards.length > 0 && <div className={cn("grid items-start gap-3", !repoFullName && "sm:grid-cols-2 lg:grid-cols-3")}>
        {cards.map(source => <RepoNotesCard key={source.id} autosave={autosave} source={source}
          notes={entriesByRepo.get(source.id) ?? EMPTY_NOTES} link={linksByRepo.get(source.id)} setRepoNotes={setRepoNotes} setRepoLinks={setRepoLinks}
          onWrite={() => { if (source.repo) setWriteTarget(source.repo); }} />)}
      </div>}

      <WriteFileDialog
        // Remount per repo so the form resets to a clean state (no reset effect).
        key={writeTarget?.id ?? "none"}
        repo={writeTarget}
        onClose={() => setWriteTarget(null)}
        onCommitted={(repoId) => bumpRepoInCache(qc, repoId)}
        onAuthLost={() => setReposDisconnected(qc)}
      />

      {filterOpen && !repoFullName && (
        <RepositoryFilterDialog
          repos={repos}
          initialVisibleIds={visibleIds}
          saving={filterMutation.isPending}
          onSave={filterMutation.save}
          onClose={() => setFilterOpen(false)}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */

function RepoNotesCard({
  autosave,
  source,
  notes,
  link,
  setRepoNotes,
  setRepoLinks,
  onWrite,
}: {
  autosave: ReturnType<typeof useRepositoryNoteAutosave>;
  source: RepositoryCardSource;
  notes: RepoNote[];
  link: RepoLink | undefined;
  setRepoNotes: Updater<RepoNote[]>;
  setRepoLinks: Updater<RepoLink[]>;
  onWrite: () => void;
}) {
  const ownerScope = useOwnerPreferences();
  const t = useDict();
  const locale = useDateLocale();
  const toast = useToast();
  const confirm = useConfirmation();
  const qc = useQueryClient();
  const supabase = createClient();
  const { repo } = source;
  const repoId = source.id;
  const numericId = Number(repoId);
  const validIdentity = Number.isSafeInteger(numericId) && numericId > 0 && String(numericId) === repoId;
  const customUrl = safeWebUrl(link?.url);

  const [pushing, setPushing] = useState(false);
  const [autoFocusId, setAutoFocusId] = useState<string | null>(null);

  const updated = repo?.pushed_at
    ? formatDistanceToNow(new Date(repo.pushed_at), { addSuffix: true, locale })
    : t.github.never;

  const newNote = useRef<NewRepositoryNote | null>(null);
  const addMutation = useMutation({
    mutationFn: async () => {
      if (!validIdentity) throw Error("Repository identity unavailable");
      if (!newNote.current) {
        const userId = await awaitWithSignal(currentUserId(supabase, ownerScope?.capture()), AbortSignal.timeout(15_000));
        if (!userId) throw new Error("no-user");
        newNote.current = { id: crypto.randomUUID(), user_id: userId, repo_id: repoId,
          repo_full_name: source.fullName, sort_order: Math.max(0, ...notes.map(note => note.sort_order)) + 1 };
      }
      return createRepositoryNote(supabase, newNote.current);
    },
    onSuccess: (row) => {
      newNote.current = null;
      setRepoNotes(current => current.some(note => note.id === row.id) ? current : [...current, row]);
      setAutoFocusId(row.id);
    },
    onError: () => toast.err(t.github.noteSaveErr),
  });

  const deleteMutation = useMutation({
    mutationFn: async (note: RepoNote) => {
      if (autosave.drafts[note.id] !== undefined || autosave.pending.has(note.id)) throw Error("Unsaved repository note");
      const { deleted } = await consumeRepositoryRecords(supabase, "repo_notes", [note]);
      if (!deleted.has(note.id)) throw Error("Repository note changed");
      return note.id;
    },
    onSuccess: (id) => { setRepoNotes(current => current.filter(note => note.id !== id)); toast.ok(t.github.noteDeleted); },
    onError: () => toast.err(t.github.noteDeleteErr),
    onSettled: () => { void qc.invalidateQueries({ queryKey: qk.repoNotes }); },
  });

  async function deleteEntry(note: RepoNote) {
    if (await confirm({
      title: t.common.delete,
      description: t.github.deleteNoteConfirm,
      confirmLabel: t.common.delete,
      cancelLabel: t.common.cancel,
      destructive: true,
    })) deleteMutation.mutate(note);
  }

  async function saveToGithub() {
    if (!repo) return;
    if (repo.archived) { toast.err(t.github.archivedReadOnly); return; }
    if (pushing) return;
    setPushing(true);
    try {
      if (!await autosave.saveAll()) return;
      // A fresh complete statement snapshot, rather than a potentially capped
      // or stale card cache, defines exactly what the publication contains.
      const { data } = await readOwnedCollection(supabase, "repo_notes", undefined, AbortSignal.timeout(15_000));
      const snapshot = data.map(row => repositoryNoteSchema.parse(row)).filter(row => row.repo_id === repoId && row.body.trim());
      const text = snapshot.map(row => row.body.trim()).join("\n\n---\n\n");
      if (!text) { toast.err(t.github.notesNothing); return; }
      const outcome = await commitFile({
        intent: "replace",
        owner: repo.owner,
        repo: repo.name,
        path: NOTES_PATH,
        content: compileMarkdown(repo.full_name, text),
        message: t.github.notesCommitMessage,
      });
      if (!outcome.ok) {
        if (outcome.status === 401) {
          setReposDisconnected(qc);
          toast.err(t.github.reconnect);
        } else {
          toast.err(outcome.status === 409 ? t.github.fileChanged : t.github.commitUnconfirmed);
        }
        return;
      }
      // Reflect the push, but keep the board order stable — don't bump this
      // repo to the top just because notes were saved.
      if (!outcome.result.unchanged) touchRepoInCache(qc, repo.id);
      // Consume only the captured unchanged versions. New/edited notes stay.
      try {
        const { deleted, retained } = await consumeRepositoryRecords(supabase, "repo_notes", snapshot);
        setRepoNotes(current => current.filter(note => !deleted.has(note.id)));
        toast.ok(retained.size ? t.github.notesSavedFile(outcome.result.path) : t.github.notesSavedCleared(outcome.result.path));
      } catch { toast.ok(t.github.notesSavedFile(outcome.result.path)); }
    } catch { toast.err(t.github.notesPushErr);
    } finally {
      setPushing(false);
      void qc.invalidateQueries({ queryKey: qk.repoNotes });
    }
  }

  const saving = notes.some(note => autosave.pending.has(note.id)) || addMutation.isPending;

  return (
    <Card className="flex flex-col p-0">
      <div className="flex items-start justify-between gap-2 border-b border-border p-3">
        <div className="min-w-0">
          {repo ? <a
            href={repo.html_url}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-sm font-semibold text-foreground hover:underline"
            title={repo.full_name}
          >
            {repo.name}
          </a> : <p className="break-words text-sm font-semibold" title={source.fullName}>{source.fullName.split("/").at(-1) || source.fullName}</p>}
          {repo ? <div className="mt-1 flex flex-wrap items-center gap-1">
            <Badge
              icon={repo.private ? Lock : Globe}
              label={repo.private ? t.github.privateLabel : t.github.publicLabel}
            />
            {repo.fork && <Badge icon={GitFork} label={t.github.fork} />}
            {repo.archived && <Badge icon={Archive} label={t.github.archived} />}
          </div> : <p className="mt-1 text-xs text-foreground-muted">{t.github.localRecords}</p>}
          {customUrl && (
            <a
              href={customUrl}
              target="_blank"
              rel="noreferrer"
              title={customUrl}
              className="mt-1.5 inline-flex max-w-full items-center gap-1 truncate text-[11px] font-medium text-foreground hover:underline"
            >
              <Link2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{displayUrl(customUrl)}</span>
            </a>
          )}
          {repo && <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-foreground-subtle">
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
          </div>}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {validIdentity && <RepositoryLinkControl repo={{ id: numericId, full_name: source.fullName }} link={link} setRepoLinks={setRepoLinks} />}
          {repo && <><Tooltip content={t.github.writeFileHint}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onWrite}
              disabled={repo.archived}
              aria-label={t.github.writeFile}
            >
              <Upload className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content={t.github.open}>
            <Button asChild variant="ghost" size="icon-sm" aria-label={t.github.open}>
              <a href={repo.html_url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          </Tooltip></>}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        {notes.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-foreground-subtle">
            {t.github.notesEmpty}
          </p>
        ) : (
          <div className="space-y-2">
            {notes.map((n) => (
              <RepoNoteEntry
                key={`${n.id}:${autosave.generation}`}
                note={n}
                body={autosave.drafts[n.id] ?? n.body}
                failed={autosave.errors.has(n.id)}
                pending={autosave.pending.has(n.id) || deleteMutation.isPending}
                onChange={(body) => autosave.change(n, body)}
                autoFocus={n.id === autoFocusId}
                onSave={() => autosave.save(n.id)}
                onDiscard={() => autosave.discard(n.id)}
                onDelete={() => deleteEntry(n)}
              />
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-1.5 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => addMutation.mutate()}
            disabled={addMutation.isPending || !validIdentity}
          >
            {saving ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            {t.github.addNote}
          </Button>
          <Tooltip content={t.github.saveNotesHint}>
            <Button size="sm" onClick={saveToGithub} disabled={pushing || !repo || repo.archived}>
              {pushing ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <GithubIcon className="h-3.5 w-3.5" />
              )}
              {pushing ? t.github.savingNotes : t.github.saveNotes}
            </Button>
          </Tooltip>
        </div>
        {repo?.archived && <p className="text-xs text-foreground-muted">{t.github.archivedReadOnly}</p>}
      </div>
    </Card>
  );
}

/** Confirmed rows stay compact; failed drafts remain editable and visible. */
function RepoNoteEntry({ note, body, failed, pending, autoFocus, onChange, onSave, onDiscard, onDelete }: {
  note: RepoNote; body: string; failed: boolean; pending: boolean; autoFocus: boolean;
  onChange: (body: string) => void; onSave: () => Promise<boolean>; onDiscard: () => boolean; onDelete: () => void;
}) {
  const t = useDict();
  const [editing, setEditing] = useState(autoFocus || note.body.trim() === "");
  const ref = useRef<HTMLTextAreaElement | null>(null);
  async function finish() { if (await onSave()) setEditing(false); }
  // Focus the textarea whenever we enter edit mode (initial autofocus included).
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  if (!editing) {
    const isEmpty = body.trim() === "";
    return (
      <div className="group/entry relative min-h-14 rounded-md border border-border bg-surface-muted/40 px-2.5 py-2 pr-24 md:min-h-0 md:pr-14">
        <p
          className={cn(
            "whitespace-pre-wrap break-words text-xs leading-relaxed line-clamp-6",
            isEmpty && "italic text-foreground-subtle",
          )}
        >
          {isEmpty ? t.github.emptyNote : body}
        </p>
        <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5">
          <Tooltip content={t.github.editNote}>
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label={t.github.editNote}
              disabled={pending}
              className="inline-flex size-11 md:size-6 items-center justify-center rounded text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-foreground focus-ring"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <Tooltip content={t.github.deleteNote}>
            <button
              type="button"
              onClick={onDelete}
              aria-label={t.github.deleteNote}
              disabled={pending}
              className="inline-flex size-11 md:size-6 items-center justify-center rounded text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-destructive focus-ring"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>
    );
  }

  return (
    <div className="group/entry relative">
      <Textarea
        aria-label={t.github.editNote}
        aria-invalid={failed || undefined}
        ref={ref}
        value={body}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(event) => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) void onSave(); }}
        placeholder={t.github.notePlaceholder}
        className="min-h-[64px] resize-y pr-8 text-xs leading-relaxed"
      />
      {failed && <p role="alert" className="mt-1 text-xs text-risk">{t.github.noteSaveErr}</p>}
      <div className="mt-1.5 flex flex-wrap items-center justify-end gap-1.5">
        {failed && <Button variant="ghost" size="sm" disabled={pending} onClick={() => { if (onDiscard()) setEditing(false); }}>{t.common.unsaved.discard}</Button>}
        <Button type="button" variant="ghost" size="sm" disabled={pending || body !== note.body} onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
          {t.github.deleteNote}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() => { void finish(); }}
        >
          <Check className="h-3.5 w-3.5" />
          {t.github.doneEditing}
        </Button>
      </div>
    </div>
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
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-muted px-[7px] py-[3px] text-[10px] font-medium text-foreground-muted">
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
  const [initialMessage] = useState(() => t.github.messagePlaceholder);
  const [message, setMessage] = useState(initialMessage);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GithubCommitResult | null>(null);
  const pending = useRef(false);
  useUnsavedDraft({
    dirty: !!repo && !result && (!!path || !!branch || !!content || message !== initialMessage),
    pending: busy,
    canSave: !!repo && !repo.archived && !busy && !!normalizeRepoPath(path) && !!content.trim(),
    save: submit,
    discard: onClose,
  });

  if (!repo) return null;

  async function submit(): Promise<boolean> {
    if (!repo || repo.archived || pending.current) return false;
    const normalized = normalizeRepoPath(path);
    if (!normalized) {
      toast.err(t.github.needPath);
      return false;
    }
    if (!content.trim()) {
      toast.err(t.github.needContent);
      return false;
    }
    pending.current = true;
    setBusy(true);
    try {
      const outcome = await commitFile({
        intent: "replace",
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
          toast.err(t.github.reconnect);
        } else {
          toast.err(outcome.status === 409 ? t.github.fileChanged : t.github.commitUnconfirmed);
        }
        return false;
      }
      setResult(outcome.result);
      if (!outcome.result.unchanged) onCommitted(repo.id);
      toast.ok(
        outcome.result.unchanged ? t.github.alreadySaved : outcome.result.updated
          ? t.github.committedUpdate
          : t.github.committedNew,
      );
      return true;
    } catch {
      toast.err(t.github.commitUnconfirmed);
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-w-lg" aria-busy={busy} showClose={!busy}>
        <DialogHeader>
          <DialogTitle className="truncate">
            {t.github.writeTitle} {repo.full_name}
          </DialogTitle>
          <DialogDescription>{t.github.writeHint}</DialogDescription>
        </DialogHeader>

          {result ? (
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setResult(null)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t.github.writeFile}
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
              <FormRow label={t.github.pathLabel}>
                <Input
                  disabled={busy}
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder={t.github.pathPlaceholder}
                  autoFocus
                />
              </FormRow>
              <FormRow label={t.github.branchLabel}>
                <Input
                  disabled={busy}
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder={repo.default_branch || t.github.branchPlaceholder}
                />
              </FormRow>
              <FormRow label={t.github.messageLabel}>
                <Input
                  disabled={busy}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={t.github.messagePlaceholder}
                />
              </FormRow>
              <FormRow label={t.github.contentLabel}>
                <Textarea
                  disabled={busy}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={t.github.contentPlaceholder}
                  className="min-h-[160px] font-mono text-xs"
                />
              </FormRow>
              <div className="flex justify-end gap-2 pt-1">
                <DialogClose asChild>
                  <Button variant="ghost" size="sm" disabled={busy}>
                    {t.github.cancel}
                  </Button>
                </DialogClose>
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
      </DialogContent>
    </Dialog>
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
