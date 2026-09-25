"use client";

import { useMemo, useState } from "react";
import { Copy } from "lucide-react";
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
import { useToast } from "@/components/ui/toast";
import { useDict } from "@/lib/i18n";
import { useReturnFocus } from "@/lib/use-return-focus";
import { composePromptCopy } from "@/lib/prompt-composer";
import { promptKind } from "@/lib/prompt-kinds";
import { projectComposerLinks, promptComposerLinks } from "@/lib/prompt-links";
import type { AiCategory, AiLink, Project, ProjectLink, Prompt, PromptLink } from "@/lib/types";

const SESSION_KEY = (promptId: string) => `prompt-copy-project:${promptId}`;

function rememberedProject(promptId: string): string | null {
  try {
    return window.sessionStorage.getItem(SESSION_KEY(promptId));
  } catch {
    return null;
  }
}

function rememberProject(promptId: string, projectId: string) {
  try {
    window.sessionStorage.setItem(SESSION_KEY(promptId), projectId);
  } catch {
    // Private mode or storage disabled: the choice simply is not remembered.
  }
}

/**
 * Preview-then-copy for one prompt. The project chooser defaults to the
 * prompt's default project (or a fixed project in a workspace) and remembers
 * the last choice per prompt for the browser session. The preview is the
 * exact clipboard text built by `composePromptCopy`.
 */
export function PromptCopyDialog({
  prompt,
  open,
  onOpenChange,
  projects,
  promptLinks,
  projectLinks,
  aiLinks,
  aiCategories,
  fixedProjectId,
}: {
  prompt: Prompt | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Pick<Project, "id" | "name" | "repo_full_name" | "url" | "dev_url">[];
  promptLinks: PromptLink[];
  projectLinks: ProjectLink[];
  aiLinks: AiLink[];
  aiCategories: AiCategory[];
  /** Workspace use: the project is preselected and cannot be cleared. */
  fixedProjectId?: string;
}) {
  const t = useDict().prompts;
  const toast = useToast();
  const [choice, setChoice] = useState<{ promptId: string; projectId: string } | null>(null);
  const [status, setStatus] = useState("");
  const returnFocus = useReturnFocus(open && prompt !== null);

  const projectId = useMemo(() => {
    if (!prompt) return "";
    if (fixedProjectId) return fixedProjectId;
    if (choice?.promptId === prompt.id) return choice.projectId;
    const remembered = typeof window === "undefined" ? null : rememberedProject(prompt.id);
    if (remembered !== null && (remembered === "" || projects.some((project) => project.id === remembered))) return remembered;
    return prompt.project_id && projects.some((project) => project.id === prompt.project_id) ? prompt.project_id : "";
  }, [prompt, fixedProjectId, choice, projects]);

  const project = projects.find((item) => item.id === projectId) ?? null;
  const text = useMemo(() => {
    if (!prompt) return "";
    return composePromptCopy({
      body: prompt.body,
      kind: promptKind(prompt),
      project,
      promptLinks: promptComposerLinks(prompt.id, promptLinks, aiLinks, aiCategories),
      projectLinks: project ? projectComposerLinks(project.id, projectLinks, aiLinks, aiCategories) : [],
    });
  }, [prompt, project, promptLinks, projectLinks, aiLinks, aiCategories]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.ok(t.copied);
      setStatus(t.copied);
      onOpenChange(false);
    } catch {
      setStatus(t.couldNotCopyManual);
    }
  }

  return (
    <Dialog
      open={open && prompt !== null}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setStatus("");
      }}
    >
      <DialogContent className="flex max-h-[90vh] flex-col gap-3 sm:max-w-2xl" onCloseAutoFocus={returnFocus}>
        <DialogHeader>
          <DialogTitle>{prompt ? t.copyTitle(prompt.name) : t.copy}</DialogTitle>
          <DialogDescription>{t.copyDescription}</DialogDescription>
        </DialogHeader>
        {!fixedProjectId && (
          <div className="space-y-1.5">
            <Label htmlFor="prompt-copy-project">{t.copyProject}</Label>
            <SimpleSelect
              id="prompt-copy-project"
              value={projectId}
              onValueChange={(value) => {
                if (!prompt) return;
                setChoice({ promptId: prompt.id, projectId: value });
                rememberProject(prompt.id, value);
                setStatus("");
              }}
              options={[
                { value: "", label: t.copyNoProject },
                ...projects.map((item) => ({ value: item.id, label: item.name })),
              ]}
            />
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col space-y-1.5">
          <Label htmlFor="prompt-copy-preview">{t.copyPreview}</Label>
          <Textarea
            id="prompt-copy-preview"
            readOnly
            value={text}
            rows={14}
            className="min-h-40 flex-1 font-mono text-xs"
          />
        </div>
        <p role="status" className="min-h-4 text-xs text-foreground-muted">{status}</p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t.cancel}
          </Button>
          <Button type="button" onClick={() => void copy()}>
            <Copy className="h-3.5 w-3.5" />
            {t.copyAction}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
