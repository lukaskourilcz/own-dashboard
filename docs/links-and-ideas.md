# Links and IG TIPS

Links stores tools and references. IG TIPS, its own Library destination at `/ig-tips` since 2026-09-26, holds the practical advice that used to sit in an Ideas section below Links. Both use owner-scoped `ai_links` and `ai_categories`, existing route loading and React Query invalidation. `record_type` decides the section: `link` (the default, for backward compatibility) is Links and `idea` is IG TIPS. The Links editor's Type select moves a link to IG TIPS.

A review can include a 1–5 usefulness score, rationale, repository-specific relevance, source URLs, pricing evidence and review date. These are advisory research metadata, not authorization or project foreign keys. Original descriptions remain stored; a legacy leading `N/5 ·` is hidden when a structured score supersedes it.

## Links used by projects

`project_links` records which library links a project really uses: one row per project and link, with a role (`uses`, `reference` or `tool`) and a note on how the link helps that project. Both parents must belong to the owner, and deleting a link or a project deletes its relations. Each link card shows "Used by" chips (three, then a count) and an "Add to project" action; the toolbar filters the library to one project's links. Every project workspace lists its links on the Overview tab, where the owner adds links from a searchable picker (pages of 50), edits the note inline, and opens, copies or removes each link. The Links and IG TIPS exports are `version: 4`; they list the using projects under `usedBy`, and each tip also carries its `group` and `summary`.

Tools lists what the active projects' repositories use (see [the architecture](../DOCS.md#planning-and-library)) and, beside it, the curated in-use subset of Links: a `tools` row marks a library link as a tool with what it does, a status (in use, trial, retired) and an optional subscription for its monthly cost. Its per-project notes are `project_links` rows with role `tool`, so the same note shows on the Tools card and in the project's Links section. Links that are tools carry a "Tool" badge, and "Show in Links" on a Tools card opens the library with that card expanded.

`ai_links.project_relevance` is deprecated. It stays readable for now; `node scripts/backfill-project-links.mjs --apply` copies each `{repository, reason}` into a `project_links` row with the reason as note, resolving the repository by current or previous name, slug or project name and listing anything it cannot resolve.

Links and IG TIPS have separate export dialogs. Each dialog can include all records, selected categories, or individual records, then apply a price filter. JSON supports a detailed flat list, compact flat list, or category-grouped structure; Markdown uses the same selected records. Price filters distinguish free, freemium-only, paid, and unknown records, while the combined free + freemium option remains available. Unknown prices are never inferred to be free. Export fields omit the owner identifier. Clipboard denial leaves selectable preview text.

## IG TIPS

IG TIPS groups the tips by topic, in the fixed order of `TIP_GROUPS` in `src/lib/ig-tips.ts`: content ideas, formats and editing, platforms and reach, growth and retention, pricing and monetization, research and testing, design and web, AI cost, quality and safety, and operations and career. A tip without a group sits under Ungrouped, last. The group is `ai_links.tip_group`, and a check constraint keeps it to those nine values.

A tip card carries no icon. It shows the tip's title, then two to four plain sentences on what the tip is and how to use it (`ai_links.tip_summary`, at most 2,000 characters), then one line naming where it came from (the number of distinct Instagram Reels among its URLs, or the website) and the projects it is linked to through `project_links`. A tip without a summary shows its stored description instead, without a legacy leading score. Details opens the research notes (the stored description, with source URLs as links), why the tip is useful and its 1–5 score, the projects that benefit, the sources and "Add to project". Its actions are plain text, with no icons either: Details, Open original, Edit and Delete.

Search matches every word across the title, summary, notes, the reason it is useful, the projects that benefit and the topic name, ignoring case and accents. Topic chips narrow the list to one group, and a status line counts what is shown. The dialog for adding or editing a tip writes the title, the original URL, the topic, the summary and the notes; a new tip gets no category and no pricing, and an edit leaves the category, pricing, score and sources as they were. Deleting a tip deletes its project links with it, as it always did.

The tips in production were written in English, so their summaries are English too. The interface around them follows the chosen language.

## Migration and rollout

`20260915210805_link_ideas_and_relevance.sql` adds optional metadata and a required defaulted record type. Insert/update policies additionally require an owned category. Existing read/delete policies and RLS remain active.

`20260926140000_ig_tips.sql` adds the nullable `tip_group` and `tip_summary` columns with their checks and changes no policy: the four own-only `ai_links` policies cover them. IG TIPS works before the columns are filled, with every tip under Ungrouped and its stored description as its text. The group and summary for each of the 73 tips in production were written from that tip's own stored notes, sources and review, and go to the database as a separate data file keyed by id, outside this repository, because they are the owner's library content. The migration guide has the checks and the rollback.

The migration and owner-authorized research import were applied to the live database on 2026-09-15. A supplemental visual-review import on 2026-09-16 brought the collection to 169 links and 17 ideas. The owner then added Google Pics and WhichAI.dev and replaced the broad mixed categories with 37 focused link categories and 10 focused idea categories. The total verified on 2026-09-16 was 171 links and 17 ideas; on 2026-09-25 the live library held 279 links and 73 ideas, every record with a category. Existing records keep their IDs, titles, URLs and descriptions. No generated research or private repository inventory is committed. The import snapshot and coverage ledger are in the local ignored observations directory.

The category rows live only in the owner's Supabase project, so this repository holds no list of them and no count that a merge could silently invalidate. Collapsing categories that read as duplicates is therefore an owner action in the running app: the Links section offers a merge control on every category header, and flags name pairs that differ only by accents, case, separators or an English plural. Which of them are genuinely one topic is a judgement the tooling does not make.

Links uses the expandable resource cards. A category that holds only tips does not appear in Links.

## Evidence limits

Instagram Saved did not expose save dates, so the requested monthly boundary cannot be proven. All 32 accessible extracted videos received sequential frame sampling spanning their duration, plus detail frames for ambiguous identities. This is not continuous playback or every-frame inspection. The private report identifies the restricted post, a non-resolving font-resource domain, generic unlinked skill names and unverified pricing. Repository relevance uses authored commits reachable from each current default branch over the requested six months; it does not measure time spent or unmerged work.

## Validation

Export unit tests cover scope, category and item selection, pricing, JSON structures, missing metadata, Unicode, source/relevance retention, the tip group and summary, legacy descriptions and owner omission. `tests/lib/ig-tips.test.ts` covers the group order, the summary fallback, source counting, search and the navigation entry. Browser tests cover desktop/mobile copy, download, filtering, keyboard dismissal/focus return, clipboard denial and dialog accessibility; `e2e/ig-tips.spec.ts` covers the topic sections, icon-free cards, keyboard details, topic chips and search, the tip export, adding and editing a tip, and Czech at 360 px with axe, and `e2e/link-export.spec.ts` moves a link to IG TIPS. Exact execution results and known suite failures are recorded in `docs/design/visual-qa.md`.
