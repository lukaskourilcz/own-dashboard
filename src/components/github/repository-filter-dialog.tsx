"use client";
import { useMemo, useState } from "react";
import { Check, Eye, Globe, Lock } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDict } from "@/lib/i18n";
import type { GithubRepo } from "@/lib/github";
import { useUnsavedDraft } from "@/components/navigation-guard";

export function RepositoryFilterDialog({
  repos,
  initialVisibleIds,
  saving,
  onSave,
  onClose,
}: {
  repos: GithubRepo[];
  initialVisibleIds: readonly string[];
  saving: boolean;
  onSave: (ids: string[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const t = useDict();
  const [capturedIds, setCapturedIds] = useState(() => [...initialVisibleIds]);
  const changed = !saving && (capturedIds.length !== initialVisibleIds.length || capturedIds.some(id => !initialVisibleIds.includes(id)));
  const allIds = useMemo(() => repos.map((r) => String(r.id)), [repos]);
  const [initialDraft, setInitialDraft] = useState(() => initialVisibleIds.length ? [...initialVisibleIds] : allIds);
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
    if (saving) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const knownIds = useMemo(() => new Set(allIds), [allIds]);
  const unlisted = useMemo(() => [...selected].filter(id => !knownIds.has(id)), [selected, knownIds]);
  // A missing page entry is not proof that a pinned repository was removed.
  const chosen = useMemo(
    () => [...allIds.filter((id) => selected.has(id)), ...unlisted],
    [allIds, selected, unlisted],
  );
  const canSave = chosen.length > 0 && chosen.length <= 500 && !saving && !changed;
  useUnsavedDraft({
    pending: saving,
    dirty: saving || chosen.length !== initialDraft.length || chosen.some(id => !initialDraft.includes(id)),
    canSave,
    save: () => onSave(chosen),
    discard: onClose,
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="flex max-w-lg flex-col overflow-hidden" showClose={!saving} onEscapeKeyDown={event => { if (saving) event.preventDefault(); }} onPointerDownOutside={event => { if (saving) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>{t.github.filterTitle}</DialogTitle>
          <DialogDescription>{t.github.filterDesc}</DialogDescription>
        </DialogHeader>

          <div className="mt-4 flex items-center gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.github.filterSearch}
              aria-label={t.github.filterSearch}
              disabled={saving}
              autoFocus
            />
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              disabled={saving}
              onClick={() => setSelected(new Set([...allIds, ...unlisted]))}
            >
              {t.github.selectAll}
            </Button>
          </div>

          {unlisted.length > 0 && <p className="mt-2 text-xs text-foreground-muted" role="status">{t.github.filterUnlisted(unlisted.length)}</p>}
          {changed && <div role="alert" className="mt-2 space-y-2 text-xs text-foreground-muted"><p>{t.github.filterChanged}</p><Button variant="outline" size="sm" onClick={() => { const next = initialVisibleIds.length ? [...initialVisibleIds] : allIds; setCapturedIds([...initialVisibleIds]); setSelected(new Set(next)); setInitialDraft(next); }}>{t.github.filterReload}</Button></div>}
          {chosen.length > 500 && <p role="alert" className="mt-2 text-xs text-risk">{t.github.filterLimit}</p>}
          <div className="mt-3 -mx-1 min-h-0 flex-1 overflow-y-auto px-1" role="region" aria-label={t.github.filterTitle} tabIndex={0}>
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
                        disabled={saving}
                        aria-pressed={on}
                        className="flex min-h-11 md:min-h-8 w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-surface-hover focus-ring disabled:opacity-60"
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

          <div className="mt-4 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void onSave([])}
              disabled={saving || changed}
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
                <Button variant="ghost" size="sm" disabled={saving}>
                  {t.github.cancel}
                </Button>
              </DialogClose>
              <Button size="sm" onClick={() => void onSave(chosen)} disabled={!canSave}>
                {saving ? t.github.saving : t.github.save}
              </Button>
            </div>
          </div>
      </DialogContent>
    </Dialog>
  );
}

