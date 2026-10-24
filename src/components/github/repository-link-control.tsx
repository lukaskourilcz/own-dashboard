"use client";

import { useId, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useQueryClient } from "@tanstack/react-query";
import { Link2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { useUnsavedDraft } from "@/components/navigation-guard";
import { useDict } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import { qk } from "@/lib/queries/keys";
import { applyRemovedRepositoryLink, applySavedRepositoryLink, normalizeRepositoryUrl, removeRepositoryLink, saveRepositoryLink } from "@/lib/repository-links";
import type { GithubRepo } from "@/lib/github";
import type { RepoLink, Updater } from "@/lib/types";

export function RepositoryLinkControl({ repo, link, setRepoLinks }: { repo: Pick<GithubRepo, "id" | "full_name">; link: RepoLink | undefined; setRepoLinks: Updater<RepoLink[]> }) {
  const t = useDict();
  const toast = useToast();
  const qc = useQueryClient();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [captured, setCaptured] = useState<RepoLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<"save" | "remove" | null>(null);
  const pending = useRef(false);
  const changed = open && (link?.id !== captured?.id || link?.updated_at !== captured?.updated_at);

  async function persist(remove = false): Promise<boolean> {
    if (pending.current || changed || (remove && !captured)) return false;
    if (!remove && !normalizeRepositoryUrl(value)) { setError(t.github.linkInvalid); return false; }
    pending.current = true;
    setAction(remove ? "remove" : "save");
    setError(null);
    try {
      await qc.cancelQueries({ queryKey: qk.repoLinks });
      const client = createClient();
      if (remove && captured) {
        await removeRepositoryLink(client, captured);
        await qc.cancelQueries({ queryKey: qk.repoLinks });
        setRepoLinks(rows => applyRemovedRepositoryLink(rows, captured));
        toast.ok(t.github.linkRemovedToast);
      } else {
        const saved = await saveRepositoryLink(client, repo, captured, value);
        await qc.cancelQueries({ queryKey: qk.repoLinks });
        setRepoLinks(rows => applySavedRepositoryLink(rows, captured, saved));
        toast.ok(t.github.linkSavedToast);
      }
      setOpen(false);
      return true;
    } catch {
      setError(t.github.linkErr);
      return false;
    } finally {
      pending.current = false;
      setAction(null);
      void qc.invalidateQueries({ queryKey: qk.repoLinks });
    }
  }
  useUnsavedDraft({
    pending: action !== null,
    dirty: action !== null || (open && value !== (captured?.url ?? "")),
    canSave: !action && !changed && !!normalizeRepositoryUrl(value),
    save: () => persist(),
    discard: () => setOpen(false),
  });

  return <Popover.Root open={open} onOpenChange={next => {
    if (pending.current) return;
    if (next) {
      setCaptured(link ?? null);
      setValue(link?.url ?? "");
      setError(null);
    }
    setOpen(next);
  }}>
    <Popover.Trigger asChild>
      <Button variant="ghost" size="icon-sm" aria-label={link ? t.github.linkEdit : t.github.linkAdd} title={link ? t.github.linkEdit : t.github.linkAdd}>
        <Link2 className="h-3.5 w-3.5" />
      </Button>
    </Popover.Trigger>
    <Popover.Portal><Popover.Content
      align="end" sideOffset={6}
      aria-label={`${repo.full_name}: ${captured ? t.github.linkEdit : t.github.linkAdd}`}
      className="anim-pop z-40 w-72 max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-surface p-3 shadow-elevated"
      onEscapeKeyDown={event => { if (pending.current) event.preventDefault(); }}
      onInteractOutside={event => { if (pending.current) event.preventDefault(); }}
    >
      <form onSubmit={event => { event.preventDefault(); void persist(); }} className="space-y-2">
        <Label htmlFor={id}>{t.github.linkLabel}</Label>
        <Input
          id={id} autoFocus value={value} maxLength={2000} disabled={!!action}
          aria-invalid={!!error || changed} aria-describedby={error || changed ? `${id}-message` : undefined}
          onChange={event => { setValue(event.target.value); setError(null); }}
          placeholder={t.github.linkPlaceholder} className="text-xs" inputMode="url"
        />
        {changed ? (
          <div id={`${id}-message`} role="alert" className="space-y-2 text-xs text-foreground-muted">
            <p>{t.github.linkChanged}</p>
            <Button variant="outline" size="sm" disabled={!!action} onClick={() => { setCaptured(link ?? null); setError(null); }}>
              {t.github.linkReviewCurrent}
            </Button>
            {link && <p className="break-all">{link.url.length <= 2000 ? link.url : t.github.linkInvalid}</p>}
          </div>
        ) : error && <p id={`${id}-message`} role="alert" className="text-xs text-destructive">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {captured ? (
            <Button type="button" size="sm" variant="ghost" disabled={!!action || changed} onClick={() => void persist(true)}>
              <Trash2 className="h-3.5 w-3.5" />{action === "remove" ? t.github.saving : t.github.linkRemove}
            </Button>
          ) : <span />}
          <Button type="submit" size="sm" disabled={!!action || changed || !value.trim()} aria-busy={action === "save"}>
            {action === "save" ? t.github.saving : t.github.save}
          </Button>
        </div>
      </form>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
