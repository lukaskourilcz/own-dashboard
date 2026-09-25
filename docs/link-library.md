# Resource library

The `/links` route uses the existing owner-scoped `ai_links` and `ai_categories` tables. Historical table and component names are retained to avoid a storage migration; the user-facing feature is a general resource library. Link and category mutations retain the existing TanStack Query invalidation and own-only Supabase policies.

## Browsing

Cards start collapsed, with the favicon or an initial fallback, name, domain link, pricing dot and visible edit/delete buttons. A keyboard-operable disclosure reveals the description, source URLs and full destination. Category groups use one column below 1024 px, two from 1024 px and three from 1536 px, keeping the desktop sidebar from squeezing tablet cards.

Search combines words across titles, URLs, descriptions and category names, with Czech accent normalization. Category, pricing and project filters combine with search, and names or creation dates determine ordering within each category. A card lists the projects that use the link ("Used by", three chips and a count, from `project_links`), shows a Tool badge when the link is in the Tools section, and offers "Add to project" with a role and a note in its expanded details. The project filter appears once at least one relation exists. Exports are `version: 3` and list each item's `usedBy` projects; see [Links and Ideas](links-and-ideas.md). The toolbar exposes matching/total counts, clear filters and expand/collapse controls. Category creation sits in a native disclosure, while rename, merge and delete controls remain on the group headers.

Merge collapses one category into another. The dialog lists every other category plus Uncategorized, states how many records will move, and says in words what happens: the records move first, then the emptied category is deleted. `planCategoryMerge` in `src/lib/link-library.ts` is the pure planner behind both the optimistic update and the test. `duplicateCategoryCandidates` pairs categories whose names collapse to the same key once accents, case, separators and an English trailing plural are removed, marks those headers and preselects the partner in the dialog. It is a suggestion the owner confirms, never an automatic move, and it derives every pair from the loaded rows rather than from a fixed list of names.

## Pricing

- Green: the linked resource is fully free.
- Yellow: a free tier or edition coexists with paid offerings.
- Red: continued ordinary use of the linked commercial product is paid.
- Hollow: pricing has not been verified.

The legend, accessible labels and expanded text supplement color. Pricing is scoped to the linked resource: a public article collection can be free while the publisher sells separate training, and self-hosted software may still require paid infrastructure. A time-limited trial alone is not a free tier. Research notes record a source and check date in the existing description field; no automatic price refresh or scraping job runs.

## URLs and data

The form accepts HTTP(S) URLs without embedded credentials and checks the currently loaded collection for cosmetic duplicates, ignoring the scheme, www prefix, trailing slash, fragment and UTM parameters while keeping meaningful query parameters. This is a client-side accidental-duplicate guard, not a database uniqueness constraint or a cross-domain alias resolver. Invalid legacy URLs remain readable but are not rendered as navigable destinations.

Descriptions stay plain text, with valid HTTP(S) source URLs rendered as external links. The existing Google favicon service receives only the hostname, with no referrer; no owner descriptions or project records are sent to it. No new external service or credential is introduced by this feature.

Research imports run as owner-scoped database writes and preserve old link records. Owner-specific research, URLs, IDs and backups are not committed as application fixtures or seeds. The demonstration content remains synthetic and the production preview remains disabled.

## Verification

`tests/lib/link-library.test.ts` covers combined discovery and duplicate URL behavior; `tests/lib/project-links.test.ts` covers the project relation, the export `usedBy` field and the `project_relevance` backfill planner. `e2e/project-links.spec.ts` adds a link to a project from its workspace and checks the chips, the export and the project filter. `e2e/link-library.spec.ts` checks initial collapse, keyboard disclosure, pricing filters, empty search, filter reset, edit/delete dialogs, expanded long descriptions and source links, accessibility and overflow at 360, 430, 768, 1024, 1440 and 1728 px, with Czech, English and dark-mode cases. See [visual QA](design/visual-qa.md) for release evidence and limitations.
