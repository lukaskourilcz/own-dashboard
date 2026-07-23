"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ExternalLink,
  Pencil,
  Plus,
  Search,
  Link2,
  ScanText,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SimpleSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import { qk } from "@/lib/queries/keys";
import { useDict } from "@/lib/i18n";
import type { AiCategory, AiLink, AiPricing, Updater } from "@/lib/types";

const UNCATEGORIZED = "__uncategorized__";

/** Normalize a user-typed link: add https:// when no scheme is present, then
 * validate. Returns the canonical href, or null when it isn't a valid URL. */
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

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** A favicon URL for the link's host, served by Google's favicon proxy so we
 * get a normalized 64px icon for almost any site. Null when the URL can't be
 * parsed, in which case the avatar falls back to a colored letter tile. */
function faviconUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
  } catch {
    return null;
  }
}

/** Stable hue in [0, 360) derived from a seed string, so a given site always
 * gets the same fallback color. */
function hueFrom(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) % 360;
  }
  return h;
}

/** Link icon: the site's favicon when it loads, otherwise a colored circle
 * seeded from the host with the title's initial. */
function LinkAvatar({ url, title }: { url: string; title: string }) {
  const [failed, setFailed] = useState(false);
  const src = failed ? null : faviconUrl(url);

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={() => setFailed(true)}
        className="mt-0.5 h-6 w-6 shrink-0 rounded-md bg-surface-muted object-contain p-0.5"
      />
    );
  }

  const hue = hueFrom(hostOf(url) || title);
  const letter = (title.trim()[0] ?? "?").toUpperCase();
  return (
    <div
      aria-hidden
      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
      style={{ backgroundColor: `hsl(${hue} 55% 45%)` }}
    >
      {letter}
    </div>
  );
}

/** Colored cost-tier pill: free = green, freemium = yellow, paid = red. */
const PRICING_TONE: Record<AiPricing, string> = {
  free: "bg-success/10 text-success border-success/30",
  freemium: "bg-warning/10 text-warning border-warning/30",
  paid: "bg-destructive/10 text-destructive border-destructive/30",
};

function PricingBadge({ pricing }: { pricing: AiPricing }) {
  const t = useDict();
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-[10px] font-medium whitespace-nowrap ${PRICING_TONE[pricing]}`}
    >
      {t.ai.pricingLabel[pricing]}
    </span>
  );
}

type Props = {
  aiLinks: AiLink[];
  setAiLinks: Updater<AiLink[]>;
  aiCategories: AiCategory[];
  setAiCategories: Updater<AiCategory[]>;
};

type LinkForm = {
  title: string;
  url: string;
  description: string;
  categoryId: string; // "" === Uncategorized
  pricing: "" | AiPricing; // "" === not set
};

const emptyForm: LinkForm = {
  title: "",
  url: "",
  description: "",
  categoryId: "",
  pricing: "",
};

export function AiPanel({
  aiLinks,
  setAiLinks,
  aiCategories,
  setAiCategories,
}: Props) {
  const supabase = createClient();
  const qc = useQueryClient();
  const t = useDict();
  const toast = useToast();
  const confirm = useConfirmation();

  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AiLink | null>(null);
  const [form, setForm] = useState<LinkForm>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const categoryIds = useMemo(
    () => new Set(aiCategories.map((c) => c.id)),
    [aiCategories],
  );

  // Filter first, then bucket the survivors by category so search collapses
  // empty sections automatically.
  const visibleLinks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return aiLinks;
    return aiLinks.filter((l) =>
      `${l.title}\n${l.url}\n${l.description ?? ""}`.toLowerCase().includes(q),
    );
  }, [aiLinks, query]);

  const byCategory = useMemo(() => {
    const map = new Map<string, AiLink[]>();
    for (const l of visibleLinks) {
      const key =
        l.category_id && categoryIds.has(l.category_id)
          ? l.category_id
          : UNCATEGORIZED;
      const list = map.get(key);
      if (list) list.push(l);
      else map.set(key, [l]);
    }
    return map;
  }, [visibleLinks, categoryIds]);

  const searching = query.trim().length > 0;
  const uncategorized = byCategory.get(UNCATEGORIZED) ?? [];
  const isEmpty = aiLinks.length === 0 && aiCategories.length === 0;
  const noResults =
    searching && visibleLinks.length === 0 && aiLinks.length > 0;

  /* ---- link mutations ------------------------------------------------ */

  const createLink = useMutation({
    mutationFn: async (vars: Omit<AiLink, "id" | "user_id" | "created_at" | "updated_at">) => {
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error("no-user");
      const { data, error } = await supabase
        .from("ai_links")
        .insert({ user_id: userId, ...vars })
        .select()
        .single();
      if (error || !data) throw error ?? new Error("no-data");
      return data as AiLink;
    },
    onSuccess: (l) => {
      setAiLinks((prev) => [l, ...prev]);
      toast.ok(t.ai.linkCreated);
      void qc.invalidateQueries({ queryKey: qk.aiLinks });
    },
    onError: (e) =>
      toast.err(
        (e as Error)?.message === "no-user"
          ? t.ai.signInFirst
          : t.ai.couldNotSave,
      ),
  });

  const updateLink = useMutation({
    mutationFn: async (vars: {
      id: string;
      title: string;
      url: string;
      description: string | null;
      category_id: string | null;
      pricing: AiPricing | null;
    }) => {
      const { data, error } = await supabase
        .from("ai_links")
        .update({
          title: vars.title,
          url: vars.url,
          description: vars.description,
          category_id: vars.category_id,
          pricing: vars.pricing,
          updated_at: new Date().toISOString(),
        })
        .eq("id", vars.id)
        .select()
        .single();
      if (error || !data) throw error ?? new Error("no-data");
      return data as AiLink;
    },
    onSuccess: (l) => {
      setAiLinks((prev) => prev.map((x) => (x.id === l.id ? l : x)));
      toast.ok(t.ai.linkSaved);
      void qc.invalidateQueries({ queryKey: qk.aiLinks });
    },
    onError: (e) =>
      toast.err(
        (e as Error)?.message === "no-user"
          ? t.ai.signInFirst
          : t.ai.couldNotSave,
      ),
  });

  const deleteLink = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("ai_links").delete().eq("id", id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.aiLinks });
      const prev = qc.getQueryData<AiLink[]>(qk.aiLinks);
      setAiLinks((old) => old.filter((l) => l.id !== id));
      return { prev };
    },
    onSuccess: () => toast.ok(t.ai.linkDeleted),
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) setAiLinks(ctx.prev);
      toast.err(t.ai.couldNotDelete);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.aiLinks }),
  });

  /* ---- category mutations -------------------------------------------- */

  const createCategory = useMutation({
    mutationFn: async (name: string) => {
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error("no-user");
      const sortOrder =
        Math.max(0, ...aiCategories.map((c) => c.sort_order)) + 1;
      const { data, error } = await supabase
        .from("ai_categories")
        .insert({ user_id: userId, name, sort_order: sortOrder })
        .select()
        .single();
      if (error || !data) throw error ?? new Error("no-data");
      return data as AiCategory;
    },
    onSuccess: (c) => {
      setAiCategories((prev) => [...prev, c]);
      toast.ok(t.ai.categoryCreated);
      void qc.invalidateQueries({ queryKey: qk.aiCategories });
    },
    onError: (e) =>
      toast.err(
        (e as Error)?.message === "no-user"
          ? t.ai.signInFirst
          : t.ai.couldNotSave,
      ),
  });

  const renameCategory = useMutation({
    mutationFn: async (vars: { id: string; name: string }) => {
      const { error } = await supabase
        .from("ai_categories")
        .update({ name: vars.name })
        .eq("id", vars.id);
      if (error) throw error;
    },
    onMutate: async ({ id, name }) => {
      await qc.cancelQueries({ queryKey: qk.aiCategories });
      const prev = qc.getQueryData<AiCategory[]>(qk.aiCategories);
      setAiCategories((old) =>
        old.map((c) => (c.id === id ? { ...c, name } : c)),
      );
      return { prev };
    },
    onSuccess: () => toast.ok(t.ai.categoryRenamed),
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev) setAiCategories(ctx.prev);
      toast.err(t.ai.couldNotSave);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.aiCategories }),
  });

  const deleteCategory = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("ai_categories")
        .delete()
        .eq("id", id);
      if (error) throw error;
      return id;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.aiCategories });
      await qc.cancelQueries({ queryKey: qk.aiLinks });
      const prevCats = qc.getQueryData<AiCategory[]>(qk.aiCategories);
      const prevLinks = qc.getQueryData<AiLink[]>(qk.aiLinks);
      setAiCategories((old) => old.filter((c) => c.id !== id));
      // The FK nulls these server-side (on delete set null); mirror it locally
      // so the rows fall into Uncategorized rather than vanishing.
      setAiLinks((old) =>
        old.map((l) => (l.category_id === id ? { ...l, category_id: null } : l)),
      );
      return { prevCats, prevLinks };
    },
    onSuccess: () => toast.ok(t.ai.categoryDeleted),
    onError: (_e, _id, ctx) => {
      if (ctx?.prevCats) setAiCategories(ctx.prevCats);
      if (ctx?.prevLinks) setAiLinks(ctx.prevLinks);
      toast.err(t.ai.couldNotDelete);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.aiCategories });
      void qc.invalidateQueries({ queryKey: qk.aiLinks });
    },
  });

  /* ---- handlers ------------------------------------------------------ */

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(l: AiLink) {
    setEditing(l);
    setForm({
      title: l.title,
      url: l.url,
      description: l.description ?? "",
      categoryId: l.category_id ?? "",
      pricing: l.pricing ?? "",
    });
    setFormError(null);
    setDialogOpen(true);
  }

  const saving = createLink.isPending || updateLink.isPending;

  function submitForm(e: React.FormEvent) {
    e.preventDefault();
    const title = form.title.trim();
    if (!title) {
      setFormError(t.ai.nameRequired);
      return;
    }
    if (!form.url.trim()) {
      setFormError(t.ai.urlRequired);
      return;
    }
    const url = normalizeUrl(form.url);
    if (!url) {
      setFormError(t.ai.urlInvalid);
      return;
    }
    const description = form.description.trim() || null;
    const category_id = form.categoryId || null;
    const pricing = form.pricing || null;
    if (editing) {
      updateLink.mutate(
        { id: editing.id, title, url, description, category_id, pricing },
        { onSuccess: () => setDialogOpen(false) },
      );
    } else {
      createLink.mutate(
        { title, url, description, category_id, pricing },
        { onSuccess: () => setDialogOpen(false) },
      );
    }
  }

  function addCategory(e: React.FormEvent) {
    e.preventDefault();
    const name = newCategory.trim();
    if (!name) return;
    createCategory.mutate(name, { onSuccess: () => setNewCategory("") });
  }

  function commitRename() {
    if (!renamingId) return;
    const name = renameValue.trim();
    const cat = aiCategories.find((c) => c.id === renamingId);
    if (name && cat && name !== cat.name) {
      renameCategory.mutate({ id: renamingId, name });
    }
    setRenamingId(null);
    setRenameValue("");
  }

  async function removeCategory(c: AiCategory) {
    if (await confirm({
      title: t.ai.deleteCategory,
      description: t.ai.deleteCategoryConfirm(c.name),
      confirmLabel: t.common.delete,
      cancelLabel: t.common.cancel,
      destructive: true,
    })) deleteCategory.mutate(c.id);
  }

  async function removeLink(l: AiLink) {
    if (await confirm({
      title: t.common.delete,
      description: t.ai.deleteLinkConfirm,
      confirmLabel: t.common.delete,
      cancelLabel: t.common.cancel,
      destructive: true,
    })) deleteLink.mutate(l.id);
  }

  /* ---- render -------------------------------------------------------- */

  return (
    <div>
      <PageHeader
        title={t.ai.title}
        description={t.ai.description}
        action={
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />
            {t.ai.addLink}
          </Button>
        }
      />

      {isEmpty ? (
        <Card className="p-0">
          <EmptyState
            icon={Link2}
            title={t.ai.noLinksYet}
            description={t.ai.noLinksDescription}
            action={
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5" />
                {t.ai.addLink}
              </Button>
            }
            className="py-16"
          />
        </Card>
      ) : (
        <>
          {/* Toolbar: search + add-category */}
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            {aiLinks.length > 0 ? (
              <div className="relative max-w-xs flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground-subtle" />
                <Input
                  placeholder={t.ai.searchPlaceholder}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="h-9 pl-8 text-sm"
                />
              </div>
            ) : (
              <p className="text-xs text-foreground-subtle">{t.ai.manageHint}</p>
            )}
            <form onSubmit={addCategory} className="flex items-center gap-1.5">
              <Input
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder={t.ai.addCategoryPlaceholder}
                className="h-9 w-48 text-sm"
                maxLength={40}
              />
              <Button
                type="submit"
                variant="outline"
                size="sm"
                disabled={!newCategory.trim() || createCategory.isPending}
              >
                <Plus className="h-3.5 w-3.5" />
                {t.ai.add}
              </Button>
            </form>
          </div>

          {noResults ? (
            <EmptyState
              icon={Search}
              title={t.ai.noMatches}
              description={t.ai.noMatchesDescription}
              className="py-16"
            />
          ) : (
            <div className="columns-1 gap-4 md:columns-2 lg:columns-3">
              {aiCategories.map((cat) => {
                  const links = byCategory.get(cat.id) ?? [];
                  // While searching, hide categories that have no matches.
                  if (searching && links.length === 0) return null;
                  return (
                    <CategoryGroup
                      key={cat.id}
                      name={cat.name}
                      count={links.length}
                      renaming={renamingId === cat.id}
                      renameValue={renameValue}
                      onRenameChange={setRenameValue}
                      onStartRename={() => {
                        setRenamingId(cat.id);
                        setRenameValue(cat.name);
                      }}
                      onCommitRename={commitRename}
                      onCancelRename={() => {
                        setRenamingId(null);
                        setRenameValue("");
                      }}
                      onDelete={() => removeCategory(cat)}
                    >
                      {links.length === 0 ? (
                        <EmptyRow text={t.ai.categoryEmpty} />
                      ) : (
                        links.map((l) => (
                          <LinkRow
                            key={l.id}
                            link={l}
                            onEdit={() => openEdit(l)}
                            onDelete={() => removeLink(l)}
                          />
                        ))
                      )}
                    </CategoryGroup>
                  );
                })}

                {uncategorized.length > 0 && (
                  <CategoryGroup name={t.ai.uncategorized} count={uncategorized.length} muted>
                    {uncategorized.map((l) => (
                      <LinkRow
                        key={l.id}
                        link={l}
                        onEdit={() => openEdit(l)}
                        onDelete={() => removeLink(l)}
                      />
                    ))}
                  </CategoryGroup>
                )}
            </div>
          )}
        </>
      )}

      <LinkDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing !== null}
        form={form}
        setForm={setForm}
        categories={aiCategories}
        error={formError}
        saving={saving}
        onSubmit={submitForm}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------- */

function CategoryGroup({
  name,
  count,
  muted,
  renaming,
  renameValue,
  onRenameChange,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDelete,
  children,
}: {
  name: string;
  count: number;
  muted?: boolean;
  renaming?: boolean;
  renameValue?: string;
  onRenameChange?: (v: string) => void;
  onStartRename?: () => void;
  onCommitRename?: () => void;
  onCancelRename?: () => void;
  onDelete?: () => void;
  children: React.ReactNode;
}) {
  const t = useDict();
  return (
    <Card className="mb-4 inline-flex w-full break-inside-avoid flex-col overflow-hidden p-0 align-top">
      <div className="flex items-center gap-2 border-b border-border bg-surface-muted/40 px-3 py-2">
        {renaming ? (
          <input
            autoFocus
            aria-label={t.ai.renameCategory}
            value={renameValue}
            onChange={(e) => onRenameChange?.(e.target.value)}
            onBlur={onCommitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onCommitRename?.();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onCancelRename?.();
              }
            }}
            maxLength={40}
            className="h-6 rounded border border-border bg-surface px-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        ) : (
          <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">
            {name}
          </span>
        )}
        <span className="text-[10px] tabular text-foreground-subtle">
          {count}
        </span>
        {!muted && !renaming && (
          <div className="ml-auto flex items-center gap-0.5">
            <Tooltip content={t.ai.renameCategory}>
              <button
                type="button"
                onClick={onStartRename}
                aria-label={t.ai.renameCategory}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-foreground focus-ring"
              >
                <Pencil className="h-3 w-3" />
              </button>
            </Tooltip>
            <Tooltip content={t.ai.deleteCategory}>
              <button
                type="button"
                onClick={onDelete}
                aria-label={t.ai.deleteCategory}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-destructive focus-ring"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </Tooltip>
          </div>
        )}
      </div>
      <div className="divide-y divide-border/60">{children}</div>
    </Card>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <p className="px-3 py-2.5 text-xs italic text-foreground-subtle">{text}</p>
  );
}

function LinkRow({
  link,
  onEdit,
  onDelete,
}: {
  link: AiLink;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useDict();
  return (
    <div className="group flex items-start justify-between gap-2 px-3 py-2.5 transition-colors hover:bg-surface-hover/50">
      <div className="flex min-w-0 items-start gap-2.5">
        <LinkAvatar url={link.url} title={link.title} />
        <div className="min-w-0">
          <a
            href={link.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
          >
            {link.title}
            <ExternalLink className="h-3 w-3 shrink-0 text-foreground-subtle" />
          </a>
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="truncate text-[11px] text-foreground-subtle">
              {hostOf(link.url)}
            </p>
            {link.pricing && <PricingBadge pricing={link.pricing} />}
          </div>
          {link.description && (
            <p className="mt-1 text-xs text-foreground-muted">
              {link.description}
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
        <Tooltip content={t.ai.edit}>
          <button
            type="button"
            onClick={onEdit}
            aria-label={t.ai.edit}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground focus-ring"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        <Tooltip content={t.ai.deleteLink}>
          <button
            type="button"
            onClick={onDelete}
            aria-label={t.ai.deleteLink}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-surface-hover hover:text-destructive focus-ring"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */

function LinkDialog({
  open,
  onOpenChange,
  editing,
  form,
  setForm,
  categories,
  error,
  saving,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: boolean;
  form: LinkForm;
  setForm: React.Dispatch<React.SetStateAction<LinkForm>>;
  categories: AiCategory[];
  error: string | null;
  saving: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const t = useDict();
  const [enriching, setEnriching] = useState(false);
  const [enrichMsg, setEnrichMsg] = useState<string | null>(null);

  // "Auto-fill": read the pasted URL via /api/ai-links/enrich (Jina + optional
  // Claude) and populate the form. Fills empty fields; always refreshes the
  // description (that's the point), but never clobbers a category/pricing the
  // user already chose.
  async function autoFill() {
    const url = form.url.trim();
    if (!url) {
      setEnrichMsg(t.ai.enrichNeedsUrl);
      return;
    }
    setEnriching(true);
    setEnrichMsg(null);
    try {
      const res = await fetch("/api/ai-links/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          categories: categories.map((c) => ({ id: c.id, name: c.name })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEnrichMsg(data?.error ?? t.ai.enrichFailed);
        return;
      }
      setForm((f) => ({
        ...f,
        title: f.title.trim() || data.title || f.title,
        description: data.description || f.description,
        categoryId: f.categoryId || data.category_id || f.categoryId,
        pricing: f.pricing || data.pricing || f.pricing,
      }));
    } catch {
      setEnrichMsg(t.ai.enrichFailed);
    } finally {
      setEnriching(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing ? t.ai.editLinkTitle : t.ai.newLinkTitle}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="mt-3 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ai-name">{t.ai.name}</Label>
              <Input
                id="ai-name"
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
                placeholder={t.ai.namePlaceholder}
                autoFocus
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-url">{t.ai.url}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="ai-url"
                  value={form.url}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, url: e.target.value }));
                    if (enrichMsg) setEnrichMsg(null);
                  }}
                  placeholder={t.ai.urlPlaceholder}
                  inputMode="url"
                  className="flex-1"
                />
                <Tooltip content={t.ai.autoFillHint}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={autoFill}
                    disabled={enriching || !form.url.trim()}
                    className="shrink-0"
                  >
                    <ScanText className="h-3.5 w-3.5" />
                    {enriching ? t.ai.enriching : t.ai.autoFill}
                  </Button>
                </Tooltip>
              </div>
              {enrichMsg && (
                <p className="text-xs text-foreground-subtle">{enrichMsg}</p>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ai-category">{t.ai.category}</Label>
                <SimpleSelect
                  id="ai-category"
                  value={form.categoryId}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, categoryId: v }))
                  }
                  options={[
                    { value: "", label: t.ai.uncategorized },
                    ...categories.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ai-pricing">{t.ai.pricing}</Label>
                <SimpleSelect
                  id="ai-pricing"
                  value={form.pricing}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      pricing: v as LinkForm["pricing"],
                    }))
                  }
                  options={[
                    { value: "", label: t.ai.pricingNone },
                    { value: "free", label: t.ai.pricingLabel.free },
                    { value: "freemium", label: t.ai.pricingLabel.freemium },
                    { value: "paid", label: t.ai.pricingLabel.paid },
                  ]}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-description">{t.ai.descriptionLabel}</Label>
              <Textarea
                id="ai-description"
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder={t.ai.descriptionPlaceholder}
                rows={3}
              />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex items-center justify-end gap-2 pt-1">
              <DialogClose asChild>
                <Button type="button" variant="ghost" size="sm">
                  {t.ai.cancel}
                </Button>
              </DialogClose>
              <Button type="submit" size="sm" disabled={saving}>
                <Check className="h-3.5 w-3.5" />
                {saving ? t.ai.saving : editing ? t.ai.save : t.ai.create}
              </Button>
            </div>
          </form>
        </DialogContent>
    </Dialog>
  );
}
