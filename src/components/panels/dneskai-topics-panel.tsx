"use client";

import { useMemo } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { DneskaiTopicsList } from "@/components/marketing/dneskai/lab/topics-list";
import { useLang } from "@/lib/i18n";
import { dneskaiLab } from "@/lib/i18n/sections/dneskai-lab";
import { nav } from "@/lib/i18n/sections/nav";
import { isDneskaiProject } from "@/lib/marketing/dneskai-registry";
import type { EntityStatus } from "@/lib/queries/entities";
import type { Project } from "@/lib/types";

/**
 * Náměty (owner request, 9 November 2026): the DNESKAi topics list as its own section instead of the top of the
 * Design Lab. It reads the projects the shell already holds to find the DNESKAi one, then the list loads its topics
 * through /api/marketing/dneskai/topics (in /dev-preview, the in-memory demo) only while this section is open.
 */
export function DneskaiTopicsPanel({ projects, projectsStatus, isPreview = false }: { projects: readonly Project[]; projectsStatus?: EntityStatus; isPreview?: boolean }) {
  const { lang } = useLang();
  const t = dneskaiLab[lang].topics;
  const project = useMemo(() => projects.find((item) => isDneskaiProject(item)) ?? null, [projects]);
  return <section className="min-w-0 space-y-4" data-testid="dneskai-topics-panel">
    <PageHeader title={nav[lang].sections.topics} />
    {project ? <DneskaiTopicsList projectId={project.id} lang={lang} preview={isPreview} standalone />
      : projectsStatus?.failed ? <p role="alert" className="text-sm text-risk">{t.unavailable}</p>
      : projectsStatus && !projectsStatus.ready ? null
      : <p className="text-sm text-foreground-muted" data-testid="dneskai-topics-no-project">{t.noProject}</p>}
  </section>;
}
