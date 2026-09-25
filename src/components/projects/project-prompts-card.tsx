"use client";

import { useState } from "react";
import { Bot, Copy, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EntityBadge } from "@/components/ui/status-badge";
import { Tooltip } from "@/components/ui/tooltip";
import { PromptCopyDialog } from "@/components/prompts/prompt-copy-dialog";
import { useDict } from "@/lib/i18n";
import { groupPromptsByKind } from "@/lib/prompt-kinds";
import type { AiCategory, AiLink, Project, ProjectLink, Prompt, PromptLink } from "@/lib/types";

/**
 * Knowledge-tab list of every prompt, grouped by kind. Copying opens the
 * shared preview with this project fixed, so the placeholders, the Project
 * block and the project's links are filled in.
 */
export function ProjectPromptsCard({
  project,
  prompts,
  promptLinks,
  projectLinks,
  aiLinks,
  aiCategories,
}: {
  project: Pick<Project, "id" | "name" | "repo_full_name" | "url" | "dev_url">;
  prompts: Prompt[];
  promptLinks: PromptLink[];
  projectLinks: ProjectLink[];
  aiLinks: AiLink[];
  aiCategories: AiCategory[];
}) {
  const t = useDict();
  const [copying, setCopying] = useState<Prompt | null>(null);
  const groups = groupPromptsByKind(
    [...prompts].sort((a, b) =>
      Number(b.project_id === project.id) - Number(a.project_id === project.id) || a.name.localeCompare(b.name),
    ),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-4 w-4" />
          {t.nav.sections.prompts}
          <Tooltip content={t.prompts.workspacePromptsInfo}>
            <span className="ml-0.5 inline-flex cursor-help text-foreground-subtle hover:text-foreground">
              <Info className="h-3.5 w-3.5" />
            </span>
          </Tooltip>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {groups.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t.professional.noRelatedRecords}</p>
        ) : (
          <div className="space-y-2">
            {groups.map((group) => (
              <details key={group.kind} className="group rounded-md border border-border" open={group.prompts.some((prompt) => prompt.project_id === project.id)}>
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-xs font-semibold focus-ring sm:min-h-9">
                  {t.prompts.kindLabel[group.kind]}
                  <span className="font-medium tabular text-foreground-muted">{t.prompts.groupCount(group.prompts.length)}</span>
                </summary>
                <ul className="divide-y divide-border border-t border-border">
                  {group.prompts.map((prompt) => (
                    <li key={prompt.id} className="flex items-center gap-2 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{prompt.name}</p>
                        {prompt.description && <p className="truncate text-xs text-foreground-muted">{prompt.description}</p>}
                      </div>
                      {prompt.project_id === project.id && <EntityBadge className="min-h-5 py-0">{t.prompts.defaultProject}</EntityBadge>}
                      <Tooltip content={t.prompts.copyWithContext}>
                        <Button size="icon-sm" variant="ghost" onClick={() => setCopying(prompt)} aria-label={`${t.prompts.copyWithContext}: ${prompt.name}`}>
                          <Copy />
                        </Button>
                      </Tooltip>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        )}
      </CardContent>
      <PromptCopyDialog
        prompt={copying}
        open={copying !== null}
        onOpenChange={(open) => !open && setCopying(null)}
        projects={[project]}
        promptLinks={promptLinks}
        projectLinks={projectLinks}
        aiLinks={aiLinks}
        aiCategories={aiCategories}
        fixedProjectId={project.id}
      />
    </Card>
  );
}
