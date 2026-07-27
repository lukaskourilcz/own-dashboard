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
import * as Popover from "@radix-ui/react-popover";
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
import { saveUserPreferences } from "@/lib/preference-client";
import { useDict, useDateLocale } from "@/lib/i18n";
import { GithubIcon } from "@/components/icons/github";
import { connectGitHub } from "@/lib/github-auth";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import { readRepoFilter, writeRepoFilter } from "@/lib/use-prefs";
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
  useReposQuery,
} from "@/lib/github-queries";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { NeededChecklist } from "@/components/panels/needed-checklist";
import type { RepoLink, RepoNote, Updater } from "@/lib/types";
import { cn } from "@/lib/utils";

type Status = "loading" | "connected" | "disconnected" | "error";

// Stable empty references so the per-repo lookups never hand a card a fresh
// array each render.
const EMPTY_REPOS: GithubRepo[] = [];
const EMPTY_NOTES: RepoNote[] = [];

// The single markdown file each repo's notes are written to. A stable path so
// "the latest .md" is always the same file — re-saving updates it in place.
const NOTES_PATH = "dashboard-notes.md";

/** Wrap a repo's notes in a titled markdown document. */
function compileMarkdown(fullName: string, body: string): string {
  return `# Notes — ${fullName}\n\n${body.trim()}\n`;
}

/** Add https:// when no scheme is present, then validate. Returns the
 * canonical href or null when it isn't a valid http(s) URL. */
function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
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
  repoNotes,
  setRepoNotes,
  repoLinks,
  setRepoLinks,
}: {
  /** Saved repo allow-list (GitHub repo ids as strings). Empty = show all. */
  initialVisibleIds: string[];
  /** When set, embed only this repository in its owning project workspace. */
  repoFullName?: string;
  repoNotes: RepoNote[];
  setRepoNotes: Updater<RepoNote[]>;
  repoLinks: RepoLink[];
  setRepoLinks: Updater<RepoLink[]>;
}) {
  const t = useDict();
  const toast = useToast();
  const confirm = useConfirmation();
  const qc = useQueryClient();
  const { data, isPending, isFetching, refetch } = useReposQuery();
  const [query, setQuery] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [writeTarget, setWriteTarget] = useState<GithubRepo | null>(null);
  const [showNeeded, setShowNeeded] = useState(false);
  // Prefer the device-local copy (survives reloads even if the server prefs
  // round-trip isn't available); fall back to the server-provided value.
  const [visibleIds, setVisibleIds] = useState<string[]>(
    () => readRepoFilter() ?? initialVisibleIds,
  );
  const [filterOpen, setFilterOpen] = useState(false);

  const allRepos = data?.kind === "ok" ? data.repos : EMPTY_REPOS;
  const repos = useMemo(
    () => repoFullName
      ? allRepos.filter((repo) => repo.full_name.toLowerCase() === repoFullName.toLowerCase())
      : allRepos,
    [allRepos, repoFullName],
  );
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

  async function onDisconnect() {
    if (await confirm({
      title: t.github.disconnect,
      description: t.github.disconnectConfirm,
      confirmLabel: t.github.disconnect,
      cancelLabel: t.common.cancel,
      destructive: true,
    })) disconnectMutation.mutate();
  }

  // Persist the chosen repo allow-list. An empty array clears the filter.
  // The device-local copy is the source of truth that makes the selection
  // stick across reloads; the server PATCH is a best-effort cross-device sync
  // whose failure must not block the save (the server prefs row may not exist).
  const filterMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      writeRepoFilter(ids);
      try {
        await saveUserPreferences({ visible_repo_ids: ids });
      } catch {
        // Offline or server prefs unavailable — the local copy is saved.
      }
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

  return (
    <div>
      <PageHeader
        title={repoFullName ?? t.github.title}
        description={repoFullName ? t.professional.projectRepository : t.github.subtitle}
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
                  variant={showNeeded ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowNeeded((v) => !v)}
                >
                  <ListChecks className="h-3.5 w-3.5" />
                  {t.github.needed.button}
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

      {status === "loading" && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-[260px] w-full" />
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
          {showNeeded && scoped.length > 0 && (
            <NeededChecklist repos={scoped} />
          )}

          {repos.length > 0 && !repoFullName && (
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
            <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((repo) => (
                <RepoNotesCard
                  key={repo.id}
                  repo={repo}
                  notes={entriesByRepo.get(String(repo.id)) ?? EMPTY_NOTES}
                  link={linksByRepo.get(String(repo.id))}
                  setRepoNotes={setRepoNotes}
                  setRepoLinks={setRepoLinks}
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

      {filterOpen && !repoFullName && (
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

/* ---------------------------------------------------------------------- */

function RepoNotesCard({
  repo,
  notes,
  link,
  setRepoNotes,
  setRepoLinks,
  onWrite,
}: {
  repo: GithubRepo;
  notes: RepoNote[];
  link: RepoLink | undefined;
  setRepoNotes: Updater<RepoNote[]>;
  setRepoLinks: Updater<RepoLink[]>;
  onWrite: () => void;
}) {
  const t = useDict();
  const locale = useDateLocale();
  const toast = useToast();
  const confirm = useConfirmation();
  const qc = useQueryClient();
  const supabase = createClient();
  const repoId = String(repo.id);

  const [pushing, setPushing] = useState(false);
  const [autoFocusId, setAutoFocusId] = useState<string | null>(null);

  const updated = repo.pushed_at
    ? formatDistanceToNow(new Date(repo.pushed_at), { addSuffix: true, locale })
    : t.github.never;

  // UPDATE a single entry's body. Called from each entry on debounce/blur.
  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: string }) => {
      const { error } = await supabase
        .from("repo_notes")
        .update({ body, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onError: () => toast.err(t.github.noteSaveErr),
  });

  // Optimistic cache write + debounced DB write. Updating the cache here (not
  // on every keystroke) keeps the shared store current for Save / remount
  // without re-rendering the whole panel as you type.
  function persistEntry(id: string, body: string) {
    setRepoNotes((prev) => prev.map((n) => (n.id === id ? { ...n, body } : n)));
    updateMutation.mutate({ id, body });
  }

  const addMutation = useMutation({
    mutationFn: async () => {
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error("no-user");
      const sortOrder = Math.max(0, ...notes.map((n) => n.sort_order)) + 1;
      const { data, error } = await supabase
        .from("repo_notes")
        .insert({
          user_id: userId,
          repo_id: repoId,
          repo_full_name: repo.full_name,
          body: "",
          sort_order: sortOrder,
        })
        .select()
        .single();
      if (error || !data) throw error ?? new Error("no-data");
      return data as RepoNote;
    },
    onSuccess: (row) => {
      setRepoNotes((prev) => [...prev, row]);
      setAutoFocusId(row.id);
    },
    onError: () => toast.err(t.github.noteSaveErr),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("repo_notes").delete().eq("id", id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.repoNotes });
      const prev = qc.getQueryData<RepoNote[]>(qk.repoNotes);
      setRepoNotes((old) => old.filter((n) => n.id !== id));
      return { prev };
    },
    onSuccess: () => toast.ok(t.github.noteDeleted),
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) setRepoNotes(ctx.prev);
      toast.err(t.github.noteDeleteErr);
    },
  });

  async function deleteEntry(note: RepoNote) {
    if (await confirm({
      title: t.common.delete,
      description: t.github.deleteNoteConfirm,
      confirmLabel: t.common.delete,
      cancelLabel: t.common.cancel,
      destructive: true,
    })) deleteMutation.mutate(note.id);
  }

  async function saveToGithub() {
    // Read the freshest entries straight from the cache (entries flush to it on
    // blur, which fires when the Save button takes focus).
    const all = qc.getQueryData<RepoNote[]>(qk.repoNotes) ?? notes;
    const text = all
      .filter((n) => n.repo_id === repoId)
      .sort(
        (a, b) =>
          a.sort_order - b.sort_order ||
          a.created_at.localeCompare(b.created_at),
      )
      .map((n) => n.body.trim())
      .filter(Boolean)
      .join("\n\n---\n\n");
    if (!text) {
      toast.err(t.github.notesNothing);
      return;
    }
    setPushing(true);
    try {
      const outcome = await commitFile({
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
          toast.err(outcome.error || t.github.notesPushErr);
        }
        return;
      }
      // Reflect the push, but keep the board order stable — don't bump this
      // repo to the top just because notes were saved.
      touchRepoInCache(qc, repo.id);
      // The notes now live in the committed file, so clear them from the
      // dashboard. If the delete fails the push still succeeded, so fall back
      // to the plain "saved" confirmation and leave the notes in place.
      const { error: clearErr } = await supabase
        .from("repo_notes")
        .delete()
        .eq("repo_id", repoId);
      if (clearErr) {
        toast.ok(t.github.notesSavedFile(outcome.result.path));
      } else {
        setRepoNotes((prev) => prev.filter((n) => n.repo_id !== repoId));
        void qc.invalidateQueries({ queryKey: qk.repoNotes });
        toast.ok(t.github.notesSavedCleared(outcome.result.path));
      }
    } finally {
      setPushing(false);
    }
  }

  const saving = updateMutation.isPending || addMutation.isPending;

  return (
    <Card className="flex flex-col p-0">
      <div className="flex items-start justify-between gap-2 border-b border-border p-3">
        <div className="min-w-0">
          <a
            href={repo.html_url}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-sm font-semibold text-foreground hover:underline"
            title={repo.full_name}
          >
            {repo.name}
          </a>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Badge
              icon={repo.private ? Lock : Globe}
              label={repo.private ? t.github.privateLabel : t.github.publicLabel}
            />
            {repo.fork && <Badge icon={GitFork} label={t.github.fork} />}
            {repo.archived && <Badge icon={Archive} label={t.github.archived} />}
          </div>
          {link && (
            <a
              href={link.url}
              target="_blank"
              rel="noreferrer"
              title={link.url}
              className="mt-1.5 inline-flex max-w-full items-center gap-1 truncate text-[11px] font-medium text-foreground hover:underline"
            >
              <Link2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{displayUrl(link.url)}</span>
            </a>
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
        <div className="flex shrink-0 items-center gap-0.5">
          <RepoLinkControl repo={repo} link={link} setRepoLinks={setRepoLinks} />
          <Tooltip content={t.github.writeFileHint}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onWrite}
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
          </Tooltip>
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
                key={n.id}
                note={n}
                autoFocus={n.id === autoFocusId}
                onPersist={persistEntry}
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
            disabled={addMutation.isPending}
          >
            {saving ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            {t.github.addNote}
          </Button>
          <Tooltip content={t.github.saveNotesHint}>
            <Button size="sm" onClick={saveToGithub} disabled={pushing}>
              {pushing ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <GithubIcon className="h-3.5 w-3.5" />
              )}
              {pushing ? t.github.savingNotes : t.github.saveNotes}
            </Button>
          </Tooltip>
        </div>
      </div>
    </Card>
  );
}

/** A single note entry. A saved note renders as a compact card (truncated to a
 * max height) with edit + delete actions — so it reads as "saved", not a live
 * input. Clicking edit (or a freshly added empty note) opens the autosaving
 * textarea; keystrokes stay local and the debounce/blur/unmount flush hands the
 * latest body up to the card, which writes it to the cache + DB. */
function RepoNoteEntry({
  note,
  autoFocus,
  onPersist,
  onDelete,
}: {
  note: RepoNote;
  autoFocus: boolean;
  onPersist: (id: string, body: string) => void;
  onDelete: () => void;
}) {
  const t = useDict();
  const [body, setBody] = useState(note.body);
  // Brand-new / empty notes open straight into edit mode; saved ones show the
  // card. (autoFocus is set by the parent for the entry it just created.)
  const [editing, setEditing] = useState(autoFocus || note.body.trim() === "");
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const timer = useRef<number | null>(null);

  function clearTimer() {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }

  // Debounce the write; each keystroke reschedules with its own value, so the
  // pending save always carries the latest text (no stale-closure refs needed).
  function handleChange(v: string) {
    setBody(v);
    clearTimer();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      onPersist(note.id, v);
    }, 700);
  }

  // Flush any pending edit and collapse back to the card. Blur fires when the
  // textarea loses focus (including a tab switch that unmounts the panel) and
  // when the Done button is pressed.
  function handleBlur() {
    clearTimer();
    onPersist(note.id, body);
    setEditing(false);
  }

  // Focus the textarea whenever we enter edit mode (initial autofocus included).
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  useEffect(() => () => clearTimer(), []);

  if (!editing) {
    const isEmpty = body.trim() === "";
    return (
      <div className="group/entry relative rounded-md border border-border bg-surface-muted/40 px-2.5 py-2 pr-14">
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
              className="inline-flex h-6 w-6 items-center justify-center rounded text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-foreground focus-ring"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <Tooltip content={t.github.deleteNote}>
            <button
              type="button"
              onClick={onDelete}
              aria-label={t.github.deleteNote}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-destructive focus-ring"
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
        ref={ref}
        value={body}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        placeholder={t.github.notePlaceholder}
        className="min-h-[64px] resize-y pr-8 text-xs leading-relaxed"
      />
      <div className="mt-1.5 flex items-center justify-end gap-1.5">
        <Button type="button" variant="ghost" size="sm" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
          {t.github.deleteNote}
        </Button>
        <Button
          type="button"
          size="sm"
          // onMouseDown so it fires before the textarea's blur collapses us.
          onMouseDown={(e) => {
            e.preventDefault();
            handleBlur();
          }}
        >
          <Check className="h-3.5 w-3.5" />
          {t.github.doneEditing}
        </Button>
      </div>
    </div>
  );
}

/** The Link icon + popover editor for a repo's custom URL. */
function RepoLinkControl({
  repo,
  link,
  setRepoLinks,
}: {
  repo: GithubRepo;
  link: RepoLink | undefined;
  setRepoLinks: Updater<RepoLink[]>;
}) {
  const t = useDict();
  const toast = useToast();
  const qc = useQueryClient();
  const supabase = createClient();
  const repoId = String(repo.id);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(link?.url ?? "");
  const [error, setError] = useState<string | null>(null);
  const hasLink = Boolean(link);

  const saveMutation = useMutation({
    mutationFn: async (url: string) => {
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error("no-user");
      const { data, error } = await supabase
        .from("repo_links")
        .upsert(
          {
            user_id: userId,
            repo_id: repoId,
            repo_full_name: repo.full_name,
            url,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,repo_id" },
        )
        .select()
        .single();
      if (error || !data) throw error ?? new Error("no-data");
      return data as RepoLink;
    },
    onSuccess: (row) => {
      setRepoLinks((prev) => {
        const idx = prev.findIndex((l) => l.repo_id === repoId);
        if (idx === -1) return [row, ...prev];
        const next = prev.slice();
        next[idx] = row;
        return next;
      });
      toast.ok(t.github.linkSavedToast);
      setOpen(false);
    },
    onError: () => toast.err(t.github.linkErr),
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("repo_links")
        .delete()
        .eq("repo_id", repoId);
      if (error) throw error;
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: qk.repoLinks });
      const prev = qc.getQueryData<RepoLink[]>(qk.repoLinks);
      setRepoLinks((old) => old.filter((l) => l.repo_id !== repoId));
      return { prev };
    },
    onSuccess: () => toast.ok(t.github.linkRemovedToast),
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) setRepoLinks(ctx.prev);
      toast.err(t.github.linkErr);
    },
    onSettled: () => setOpen(false),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const url = normalizeUrl(value);
    if (!url) {
      setError(t.github.linkInvalid);
      return;
    }
    saveMutation.mutate(url);
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setValue(link?.url ?? "");
          setError(null);
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={hasLink ? t.github.linkEdit : t.github.linkAdd}
          title={hasLink ? t.github.linkEdit : t.github.linkAdd}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-ring",
            hasLink
              ? "text-foreground hover:bg-surface-hover"
              : "text-foreground-muted hover:bg-surface-hover hover:text-foreground",
          )}
        >
          <Link2 className="h-3.5 w-3.5" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="anim-pop z-40 w-64 rounded-lg border border-border bg-surface p-2 shadow-elevated"
        >
          <form onSubmit={submit} className="space-y-1.5">
            <Input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t.github.linkPlaceholder}
              className="h-8 text-xs"
              inputMode="url"
            />
            {error && <p className="text-[11px] text-destructive">{error}</p>}
            <div className="flex items-center justify-between gap-2">
              {hasLink ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeMutation.mutate()}
                  disabled={removeMutation.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t.github.linkRemove}
                </Button>
              ) : (
                <span />
              )}
              <Button
                type="submit"
                size="sm"
                disabled={saveMutation.isPending || !value.trim()}
              >
                {t.github.save}
              </Button>
            </div>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>{t.github.filterTitle}</DialogTitle>
          <DialogDescription>{t.github.filterDesc}</DialogDescription>
        </DialogHeader>

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
              <DialogClose asChild>
                <Button variant="ghost" size="sm">
                  {t.github.cancel}
                </Button>
              </DialogClose>
              <Button size="sm" onClick={() => onSave(chosen)} disabled={!canSave}>
                {saving ? t.github.saving : t.github.save}
              </Button>
            </div>
          </div>
      </DialogContent>
    </Dialog>
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="truncate">
            {t.github.writeTitle} {repo.full_name}
          </DialogTitle>
          <DialogDescription>{t.github.writeHint}</DialogDescription>
        </DialogHeader>

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
                <DialogClose asChild>
                  <Button variant="ghost" size="sm">
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
