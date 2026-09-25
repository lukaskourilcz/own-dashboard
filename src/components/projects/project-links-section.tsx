"use client";

import { useState } from "react";
import { Copy, ExternalLink, Info, Link2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EntityBadge } from "@/components/ui/status-badge";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { LinkPickerDialog } from "@/components/links/link-picker-dialog";
import { useProjectLinkMutations } from "@/components/links/use-project-links";
import { PricingDot } from "@/components/panels/link-library-card";
import { useDict } from "@/lib/i18n";
import { resourceKey } from "@/lib/link-library";
import { linkIdsForProject, linksForProject, nextProjectLinkOrder } from "@/lib/project-links";
import type { AiCategory, AiLink, Project, ProjectLink, Updater } from "@/lib/types";

/**
 * The links a project really uses (`project_links`), on the workspace
 * Overview: title, pricing, role, the note on how each helps, open/copy, an
 * inline note editor and removal. "Add link" opens the shared library picker.
 */
export function ProjectLinksSection({
  project,
  aiLinks,
  aiCategories,
  projectLinks,
  setProjectLinks,
  readOnly = false,
}: {
  project: Pick<Project, "id" | "name">;
  aiLinks: AiLink[];
  aiCategories: AiCategory[];
  projectLinks: ProjectLink[];
  setProjectLinks: Updater<ProjectLink[]>;
  readOnly?: boolean;
}) {
  const t = useDict();
  const p = t.professional;
  const toast = useToast();
  const { upsert, update, remove } = useProjectLinkMutations(setProjectLinks);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const entries = linksForProject(project.id, projectLinks, aiLinks);

  async function addLinks(ids: string[]) {
    const start = nextProjectLinkOrder(project.id, projectLinks);
    await upsert(
      ids.map((id, index) => ({
        project_id: project.id,
        ai_link_id: id,
        role: "uses",
        sort_order: start + index,
      })),
    );
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.ok(p.linkUrlCopied);
    } catch {
      toast.err(p.linkCopyFailed);
    }
  }

  async function saveNote(relation: ProjectLink) {
    const note = draft.trim();
    setEditingId(null);
    if (note !== relation.note) await update(relation.id, { note });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-4 w-4" />
          {p.projectLinks}
          <Tooltip content={p.projectLinksInfo}>
            <span className="ml-0.5 inline-flex cursor-help text-foreground-subtle hover:text-foreground">
              <Info className="h-3.5 w-3.5" />
            </span>
          </Tooltip>
        </CardTitle>
        {!readOnly && (
          <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            {p.addProjectLink}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-foreground-muted">{p.noProjectLinks}</p>
        ) : (
          <ul className="divide-y divide-border" aria-label={p.projectLinks}>
            {entries.map(({ relation, link }) => {
              const safeUrl = resourceKey(link.url) ? link.url : undefined;
              const editing = editingId === relation.id;
              return (
                <li key={relation.id} className="py-2.5" data-project-link={link.id}>
                  <div className="flex items-start gap-2">
                    <span className="mt-1.5"><PricingDot pricing={link.pricing} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <a
                          href={safeUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="min-w-0 truncate text-sm font-medium hover:underline focus-ring rounded"
                          title={link.url}
                        >
                          {link.title}
                        </a>
                        <EntityBadge>{t.ai.roleLabel[relation.role]}</EntityBadge>
                      </div>
                      {editing ? (
                        <form
                          className="mt-1.5 flex gap-1.5"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void saveNote(relation);
                          }}
                        >
                          <Input
                            autoFocus
                            aria-label={`${p.linkNoteLabel}: ${link.title}`}
                            value={draft}
                            maxLength={500}
                            onChange={(event) => setDraft(event.target.value)}
                            onBlur={() => void saveNote(relation)}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                event.preventDefault();
                                setEditingId(null);
                              }
                            }}
                            className="h-8 text-xs"
                          />
                        </form>
                      ) : (
                        <p className="mt-1 text-xs text-foreground-muted [overflow-wrap:anywhere]">
                          {relation.note || (readOnly ? "" : p.addLinkNote)}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0">
                      <Tooltip content={p.openLinkUrl}>
                        <Button asChild size="icon-sm" variant="ghost">
                          <a href={safeUrl} target="_blank" rel="noreferrer" aria-label={`${p.openLinkUrl}: ${link.title}`}>
                            <ExternalLink />
                          </a>
                        </Button>
                      </Tooltip>
                      <Tooltip content={p.copyLinkUrl}>
                        <Button size="icon-sm" variant="ghost" onClick={() => void copy(link.url)} aria-label={`${p.copyLinkUrl}: ${link.title}`}>
                          <Copy />
                        </Button>
                      </Tooltip>
                      {!readOnly && (
                        <>
                          <Tooltip content={p.editLinkNote}>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => {
                                setDraft(relation.note);
                                setEditingId(relation.id);
                              }}
                              aria-label={`${p.editLinkNote}: ${link.title}`}
                            >
                              <Pencil />
                            </Button>
                          </Tooltip>
                          <Tooltip content={p.removeProjectLink}>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => void remove([relation.id])}
                              aria-label={`${p.removeProjectLink}: ${link.title}`}
                            >
                              <Trash2 className="text-destructive" />
                            </Button>
                          </Tooltip>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      <LinkPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        links={aiLinks}
        categories={aiCategories}
        excludeIds={linkIdsForProject(project.id, projectLinks)}
        title={`${p.addProjectLink}: ${project.name}`}
        onConfirm={addLinks}
      />
    </Card>
  );
}
