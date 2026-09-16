"use client";

import { useState } from "react";
import { Link2Off, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SimpleSelect } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { useDict } from "@/lib/i18n";
import type { ProjectReference, ReferenceStatus } from "@/lib/link-references";
import type { Project } from "@/lib/types";

/**
 * The project side of a library record: which projects use or plan to use it,
 * a status toggle per row, and a connect control for the projects not yet on
 * the list. Rendered inside the expanded library card; the workspace tab uses
 * the same rows from the other direction.
 */
export function LinkReferenceControls({ linkTitle, references, projects, onConnect, onDisconnect, onSetStatus }: {
  linkTitle: string;
  references: ProjectReference[];
  projects: Project[];
  onConnect: (projectId: string, status: ReferenceStatus) => void;
  onDisconnect: (referenceId: string) => void;
  onSetStatus: (referenceId: string, status: ReferenceStatus) => void;
}) {
  const t = useDict();
  const p = t.professional;
  const [projectId, setProjectId] = useState("");
  const [status, setStatus] = useState<ReferenceStatus>("used");
  const connected = new Set(references.map((reference) => reference.project_id));
  const available = projects.filter((project) => !connected.has(project.id));

  return <div className="mt-2 space-y-2 text-xs" data-link-references>
    <p className="font-medium text-foreground">{t.nav.sections.projects}</p>
    {references.length > 0 && <ul className="divide-y divide-border/60 rounded-md border border-border/60 bg-surface">
      {references.map((reference) => <li key={reference.id} className="flex flex-wrap items-center gap-2 px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{reference.project.name}</span>
        <ReferenceStatusToggle status={reference.status} onChange={(next) => onSetStatus(reference.id, next)} label={`${p.referenceStatus}: ${reference.project.name}`} />
        <button type="button" onClick={() => onDisconnect(reference.id)} aria-label={`${p.removeReference}: ${reference.project.name}`} title={p.removeReference} className="focus-ring inline-flex h-11 w-11 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-hover hover:text-destructive sm:h-8 sm:w-8"><Link2Off aria-hidden="true" className="h-3.5 w-3.5" /></button>
      </li>)}
    </ul>}
    {available.length === 0
      ? <p className="text-foreground-subtle">{projects.length === 0 ? p.noRelatedRecords : t.ai.noProjectsToConnect}</p>
      : <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); if (!projectId) return; onConnect(projectId, status); setProjectId(""); }}>
        <SimpleSelect aria-label={`${t.ai.connectToProject}: ${linkTitle}`} value={projectId} onValueChange={setProjectId} options={[{ value: "", label: t.ai.chooseProject }, ...available.map((project) => ({ value: project.id, label: project.name }))]} className="h-8 min-w-[10rem] flex-1 text-xs" />
        <SimpleSelect aria-label={p.referenceStatus} value={status} onValueChange={(value) => setStatus(value as ReferenceStatus)} options={[{ value: "used", label: p.referenceUsed }, { value: "planned", label: p.referencePlanned }]} className="h-8 w-auto text-xs" />
        <Button type="submit" size="sm" variant="outline" disabled={!projectId}><Plus className="h-3.5 w-3.5" />{p.connectReferenceAction}</Button>
      </form>}
  </div>;
}

/** Planned ↔ used, as one button so the row stays a single line on phones. */
export function ReferenceStatusToggle({ status, onChange, label }: { status: ReferenceStatus; onChange: (next: ReferenceStatus) => void; label: string }) {
  const p = useDict().professional;
  const next: ReferenceStatus = status === "used" ? "planned" : "used";
  return <button type="button" onClick={() => onChange(next)} aria-label={`${label} · ${status === "used" ? p.referenceUsed : p.referencePlanned}`} title={`${p.referenceStatus}: ${next === "used" ? p.referenceUsed : p.referencePlanned}`} className="focus-ring rounded-full">
    <StatusBadge value={status} label={status === "used" ? p.referenceUsed : p.referencePlanned} tone={status === "used" ? "success" : "information"} />
  </button>;
}
