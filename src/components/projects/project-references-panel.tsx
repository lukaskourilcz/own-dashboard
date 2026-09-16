"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Lightbulb, Link2, Link2Off, Plus } from "lucide-react";
import { ReferenceStatusToggle } from "@/components/panels/link-reference-controls";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EntityBadge } from "@/components/ui/status-badge";
import { SimpleSelect } from "@/components/ui/select";
import { useDict } from "@/lib/i18n";
import { referencesForProject, type ReferenceStatus } from "@/lib/link-references";
import { resourceKey } from "@/lib/link-library";
import { useLinkReferences } from "@/lib/use-link-references";
import type { AiLink, AiLinkProject, Project, Updater } from "@/lib/types";

/**
 * The References tab of a project workspace: every link and idea from the
 * library the project used or plans to use, and a control to connect more.
 * Reads the same `ai_link_projects` rows the library cards write.
 */
export function ProjectReferencesPanel({ project, aiLinks, references, setReferences }: {
  project: Project;
  aiLinks: AiLink[];
  references: AiLinkProject[];
  setReferences: Updater<AiLinkProject[]>;
}) {
  const t = useDict();
  const p = t.professional;
  const { connect, disconnect, setStatus } = useLinkReferences(references, setReferences);
  const rows = useMemo(() => referencesForProject(project.id, references, aiLinks), [project.id, references, aiLinks]);
  const connectedIds = useMemo(() => new Set(rows.map((row) => row.link_id)), [rows]);
  const available = useMemo(() => aiLinks
    .filter((link) => !connectedIds.has(link.id))
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title)), [aiLinks, connectedIds]);
  const [linkId, setLinkId] = useState("");
  const [status, setStatusDraft] = useState<ReferenceStatus>("used");

  return <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2"><Link2 className="h-4 w-4" />{p.projectReferences}</CardTitle>
      <p className="text-xs text-foreground-muted">{p.projectReferencesDescription}</p>
    </CardHeader>
    <CardContent className="space-y-4">
      {rows.length === 0
        ? <p className="text-sm text-foreground-muted">{p.noReferences}</p>
        : <ul className="divide-y divide-border">
          {rows.map((row) => {
            const isIdea = row.link.record_type === "idea";
            const href = !isIdea && resourceKey(row.link.url) ? row.link.url : null;
            return <li key={row.id} className="flex flex-wrap items-center gap-2 py-2.5">
              <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${isIdea ? "bg-information-soft text-information" : "bg-surface-muted text-foreground-muted"}`}>{isIdea ? <Lightbulb className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}</span>
              <span className="min-w-0 flex-1">
                {href
                  ? <a href={href} target="_blank" rel="noreferrer" className="focus-ring inline-flex max-w-full items-center gap-1 rounded text-sm font-medium hover:underline"><span className="truncate">{row.link.title}</span><ExternalLink aria-hidden="true" className="h-3 w-3 shrink-0" /></a>
                  : <span className="block truncate text-sm font-medium">{row.link.title}</span>}
                {row.note && <span className="block text-xs text-foreground-muted">{row.note}</span>}
              </span>
              <EntityBadge>{isIdea ? p.referenceIdea : p.referenceLink}</EntityBadge>
              <ReferenceStatusToggle status={row.status} onChange={(next) => void setStatus(row.id, next)} label={`${p.referenceStatus}: ${row.link.title}`} />
              <button type="button" onClick={() => void disconnect(row.id)} aria-label={`${p.removeReference}: ${row.link.title}`} title={p.removeReference} className="focus-ring inline-flex h-11 w-11 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-hover hover:text-destructive sm:h-8 sm:w-8"><Link2Off aria-hidden="true" className="h-3.5 w-3.5" /></button>
            </li>;
          })}
        </ul>}
      <form className="flex flex-wrap items-end gap-2 border-t border-border pt-3" onSubmit={(event) => { event.preventDefault(); if (!linkId) return; void connect(linkId, project.id, status); setLinkId(""); }}>
        <div className="min-w-0 flex-1 space-y-1.5">
          <span className="text-xs font-medium">{p.connectReference}</span>
          {available.length === 0
            ? <p className="text-xs text-foreground-subtle">{aiLinks.length === 0 ? t.ai.noLinksYet : p.allReferencesConnected}</p>
            : <SimpleSelect aria-label={p.chooseReference} value={linkId} onValueChange={setLinkId} options={[{ value: "", label: p.chooseReference }, ...available.map((link) => ({ value: link.id, label: `${link.record_type === "idea" ? p.referenceIdea : p.referenceLink} · ${link.title}` }))]} className="h-9 text-sm" />}
        </div>
        {available.length > 0 && <>
          <SimpleSelect aria-label={p.referenceStatus} value={status} onValueChange={(value) => setStatusDraft(value as ReferenceStatus)} options={[{ value: "used", label: p.referenceUsed }, { value: "planned", label: p.referencePlanned }]} className="h-9 w-auto text-sm" />
          <Button type="submit" size="sm" variant="outline" disabled={!linkId}><Plus className="h-3.5 w-3.5" />{p.connectReferenceAction}</Button>
        </>}
      </form>
    </CardContent>
  </Card>;
}
