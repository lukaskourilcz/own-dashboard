# Links and Ideas

Links stores tools and references; Ideas appears immediately below it and stores actionable advice grouped by topic. Both use owner-scoped `ai_links` and `ai_categories`, existing route loading and React Query invalidation. `record_type` defaults to `link` for backward compatibility. The editor can move a record between the two sections.

A review can include a 1–5 usefulness score, rationale, repository-specific relevance, source URLs, pricing evidence and review date. These are advisory research metadata, not authorization or project foreign keys. Original descriptions remain stored; a legacy leading `N/5 ·` is hidden when a structured score supersedes it.

Links and Ideas have separate export dialogs. Each dialog can include all records, selected categories, or individual records, then apply a price filter. JSON supports a detailed flat list, compact flat list, or category-grouped structure; Markdown uses the same selected records. Price filters distinguish free, freemium-only, paid, and unknown records, while the combined free + freemium option remains available. Unknown prices are never inferred to be free. Export fields omit the owner identifier. Clipboard denial leaves selectable preview text.

Idea rows use the idea or goal as their primary label. Instagram and other source URLs appear inside the expanded summary with the observed subject, practical benefit, project relevance, and evidence. They do not replace the idea label.

## Migration and rollout

`20260915210805_link_ideas_and_relevance.sql` adds optional metadata and a required defaulted record type. Insert/update policies additionally require an owned category. Existing read/delete policies and RLS remain active.

The migration and owner-authorized research import were applied to the live database on 2026-09-15. A supplemental visual-review import on 2026-09-16 brought the collection to 169 links and 17 ideas. The owner then added Google Pics and WhichAI.dev and replaced the broad mixed categories with 37 focused link categories and 10 focused idea categories. The current verified total is 171 links and 17 ideas; every record has a category. Existing records keep their IDs, titles, URLs and descriptions. No generated research or private repository inventory is committed. The import snapshot and coverage ledger are in the local ignored observations directory.

The category rows live only in the owner's Supabase project, so this repository holds no list of them and no count that a merge could silently invalidate. Collapsing categories that read as duplicates is therefore an owner action in the running app: the Links section offers a merge control on every category header, and flags name pairs that differ only by accents, case, separators or an English plural. Which of them are genuinely one topic is a judgement the tooling does not make.

The integrated application uses main’s expandable resource cards for both Links and Ideas. Before this code is deployed, the previous interface may show Ideas among ordinary links because it does not recognize the new record type. The initial delivery stayed local; the owner subsequently authorized merging into main and triggering deployment.

## Evidence limits

Instagram Saved did not expose save dates, so the requested monthly boundary cannot be proven. All 32 accessible extracted videos received sequential frame sampling spanning their duration, plus detail frames for ambiguous identities. This is not continuous playback or every-frame inspection. The private report identifies the restricted post, a non-resolving font-resource domain, generic unlinked skill names and unverified pricing. Repository relevance uses authored commits reachable from each current default branch over the requested six months; it does not measure time spent or unmerged work.

## Validation

Export unit tests cover scope, category and item selection, pricing, JSON structures, missing metadata, Unicode, source/relevance retention, legacy descriptions and owner omission. Browser tests cover desktop/mobile copy, download, filtering, keyboard dismissal/focus return, clipboard denial and dialog accessibility. Exact execution results and known suite failures are recorded in `docs/design/visual-qa.md`.
