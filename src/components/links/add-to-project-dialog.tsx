"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useDict } from "@/lib/i18n";
import { useReturnFocus } from "@/lib/use-return-focus";
import { PROJECT_LINK_ROLES } from "@/lib/project-links";
import type { Project, ProjectLinkRole } from "@/lib/types";

/**
 * Records that a project uses one library link: project, role and a note on
 * how the link helps it. Used from a Links card and from the Tools section
 * (which fixes the role to "tool").
 */
export function AddToProjectDialog({
  open,
  onOpenChange,
  linkTitle,
  projects,
  fixedRole,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linkTitle: string;
  /** Projects that do not use the link yet. */
  projects: Pick<Project, "id" | "name">[];
  fixedRole?: ProjectLinkRole;
  onSave: (value: { projectId: string; role: ProjectLinkRole; note: string }) => Promise<boolean>;
}) {
  const t = useDict();
  const [projectId, setProjectId] = useState("");
  const [role, setRole] = useState<ProjectLinkRole>(fixedRole ?? "uses");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const busyRef = useRef(false);
  const returnFocus = useReturnFocus(open);
  const selectedProject = projects.some((project) => project.id === projectId)
    ? projectId
    : projects[0]?.id ?? "";

  function close(next: boolean) {
    if (busyRef.current) return;
    onOpenChange(next);
    if (!next) {
      setProjectId("");
      setRole(fixedRole ?? "uses");
      setNote("");
      setFailed(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedProject || busyRef.current) return;
    busyRef.current = true; setBusy(true); setFailed(false);
    try {
      const ok = await onSave({ projectId: selectedProject, role: fixedRole ?? role, note: note.trim() });
      if (ok) {
        busyRef.current = false;
        close(false);
      } else setFailed(true);
    } catch { setFailed(true); }
    finally { busyRef.current = false; setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent showClose={!busy} className="sm:max-w-md" onCloseAutoFocus={returnFocus}>
        <DialogHeader>
          <DialogTitle>{`${t.ai.addToProject}: ${linkTitle}`}</DialogTitle>
          <DialogDescription>{t.ai.addToProjectDescription}</DialogDescription>
        </DialogHeader>
        {projects.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t.ai.allProjectsLinked}</p>
        ) : (
          <form onSubmit={submit}>
            <fieldset disabled={busy} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="add-to-project-project">{t.ai.project}</Label>
              <SimpleSelect
                id="add-to-project-project"
                value={selectedProject}
                onValueChange={setProjectId}
                options={projects.map((project) => ({ value: project.id, label: project.name }))}
              />
            </div>
            {!fixedRole && (
              <div className="space-y-1.5">
                <Label htmlFor="add-to-project-role">{t.ai.relationRole}</Label>
                <SimpleSelect
                  id="add-to-project-role"
                  value={role}
                  onValueChange={(value) => setRole(value as ProjectLinkRole)}
                  options={PROJECT_LINK_ROLES.map((value) => ({ value, label: t.ai.roleLabel[value] }))}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="add-to-project-note">{t.ai.relationNote}</Label>
              <Textarea
                id="add-to-project-note"
                value={note}
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t.ai.relationNotePlaceholder}
                rows={3}
              />
            </div>
            {failed && <p role="alert" className="text-sm text-risk">{t.ai.relationFailed}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={busy || !selectedProject}>
                {t.ai.addToProject}
              </Button>
            </DialogFooter>
            </fieldset>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
