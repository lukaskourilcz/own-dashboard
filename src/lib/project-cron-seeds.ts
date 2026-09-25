/**
 * Known scheduled jobs for specific repos, so a repo-backed project can wire up
 * its crons automatically instead of the user re-entering them by hand.
 *
 * Keyed by the project slug, which is ours and stable. A GitHub repository
 * rename changes `repo_full_name` but never the slug, so a renamed repository
 * keeps its seeds. Each entry mirrors a `schedule: cron:` block in that repo's
 * `.github/workflows/*.yml`. When the Projects panel links a project to its
 * repository, it seeds these crons against the project (see
 * `projects-panel.tsx`). `cost_per_run` is intentionally left to the user — we
 * know the schedule, not the per-run price.
 */

export type CronSeed = {
  name: string;
  schedule: string;
  /** The workflow file the schedule lives in — shown as the cron's endpoint. */
  endpoint: string;
  description: string;
  /** Runs an AI API call, so it carries a (user-supplied) per-run cost. */
  is_ai_call: boolean;
  /** Approximate runs per month for the schedule (daily ≈ 30, weekly ≈ 4). */
  runs_per_month: number;
};

const PROJECT_CRON_SEEDS: Record<string, CronSeed[]> = {
  // DNESKAi (repository aifirst) — a daily/weekly content pipeline driven by
  // GitHub Actions. Derived from .github/workflows/daily.yml and weekly.yml.
  dneskai: [
    {
      name: "Denní generování článku",
      schedule: "0 6 * * *",
      endpoint: ".github/workflows/daily.yml",
      description:
        "GitHub Actions — vygeneruje denní článek, obnoví AI přehled a embeddings.",
      is_ai_call: true,
      runs_per_month: 30,
    },
    {
      name: "Týdenní souhrn",
      schedule: "0 7 * * 0",
      endpoint: ".github/workflows/weekly.yml",
      description:
        "GitHub Actions — vygeneruje týdenní souhrn (neděle 07:00 UTC).",
      is_ai_call: true,
      runs_per_month: 4,
    },
  ],
};

/** Cron seeds for a project, matched by its slug or an earlier slug. */
export function cronSeedsForProject(project: {
  slug: string;
  previous_slugs?: string[];
}): CronSeed[] {
  for (const slug of [project.slug, ...(project.previous_slugs ?? [])]) {
    const seeds = PROJECT_CRON_SEEDS[slug.toLowerCase()];
    if (seeds) return seeds;
  }
  return [];
}
