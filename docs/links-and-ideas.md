# Links and Ideas

Links stores tools and references; Ideas appears immediately below it and stores actionable advice grouped by topic. Both use owner-scoped `ai_links` and `ai_categories`, existing route loading and React Query invalidation. `record_type` defaults to `link` for backward compatibility. The editor can move a record between the two sections.

A review can include a 1–5 usefulness score, rationale, repository-specific relevance, source URLs, pricing evidence and review date. These are advisory research metadata, not authorization or project foreign keys. Original descriptions remain stored; a legacy leading `N/5 ·` is hidden when a structured score supersedes it.

The export dialog previews JSON or Markdown and offers Copy all and download. It includes both Links and Ideas independently of the page search. Filters are exact: Free includes `free`; Free + freemium includes `free` and `freemium`; All also includes paid and unknown prices. Unknown prices are never inferred to be free. Export fields omit the owner identifier. Clipboard denial leaves selectable preview text.

## Migration and rollout

`20260915210805_link_ideas_and_relevance.sql` adds optional metadata and a required defaulted record type. Insert/update policies additionally require an owned category. Existing read/delete policies and RLS remain active.

The migration and owner-authorized research import were applied to the live database on 2026-09-15. A supplemental visual-review import on 2026-09-16 brought the verified total to 169 links and 17 ideas, all with ratings, rationales, project relevance and sources. All original 119 IDs, titles, URLs, descriptions and categories were preserved. No generated research or private repository inventory is committed. The import snapshot and coverage ledger are in the local ignored observations directory.

Application code requires a separate deployment. Until then the previous interface may show Ideas among ordinary links because it does not recognize the new record type. This task did not push or deploy.

## Evidence limits

Instagram Saved did not expose save dates, so the requested monthly boundary cannot be proven. All 32 accessible extracted videos received sequential frame sampling spanning their duration, plus detail frames for ambiguous identities. This is not continuous playback or every-frame inspection. The private report identifies the restricted post, a non-resolving font-resource domain, generic unlinked skill names and unverified pricing. Repository relevance uses authored commits reachable from each current default branch over the requested six months; it does not measure time spent or unmerged work.

## Validation

Export unit tests cover pricing, missing metadata, Unicode, source/relevance retention, legacy descriptions and owner omission. Browser tests cover desktop/mobile copy, download, filtering, keyboard dismissal/focus return, clipboard denial and dialog accessibility. Exact execution results and known suite failures are recorded in `docs/design/visual-qa.md`.
