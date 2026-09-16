# Changelog

What shipped in OwnDashboard, newest first, one dated entry per release.

`src/lib/changelog.ts` is the source of truth for these entries and this file is
generated from it, so edit the module and regenerate — `tests/lib/changelog.test.ts`
fails when the two disagree. Publish a new entry at least every two weeks, with one
authentic `/dev-preview` capture per feature (see `media/changelog/README.md`).
A feature without a capture yet carries no image at all; never stand in a
placeholder or generated screenshot.

## 2026-09-16 — Works, Competition and development finance

### Shipped

- **Portfolio registry and Works** — The daily projects are materialized from a code-level registry, so a repository shows up in Projects even when the GitHub allow-list predates it. Projects carry a scope, a parent and a portfolio key, and client repositories open as Works with the same workspace.

  ![The Works table listing the client repository gym-plzen with its client Acme s.r.o., a healthy status, the linked GitHub repository, its monthly cost and its open-task count.](media/changelog/2026-09-16-works.png)

- **Competition** — Each project keeps its competitors with a score, useful features, social content, pricing model and the lessons taken from them, editable in a dialog and reachable from a project workspace tab.

  ![Competition grouped by project, with filters for project, type and review date, a count of two competitors of which one needs a refresh, and TLDR AI under aifirst marked direct, scored 5 of 5 and reviewed on 2026-09-13.](media/changelog/2026-09-16-competition.png)

- **Development finance in the Money overview** — Money reports recurring commitments, paid invoices, the unallocated remainder and a twelve-month timeline. A subscription is split across projects by share and a paid invoice inherits that split, so nothing has to be guessed.

  ![Development finance in the Money overview: 2 806,05 Kč recurring per month, split 80% to Projects, 15% to Works and 4% unallocated, a warning that two subscription amounts are unchecked against an invoice, and a twelve-month committed-versus-paid bar chart above by-project and by-vendor donuts.](media/changelog/2026-09-16-development-finance.png)

- **Reviewed Ideas and pricing-filtered link exports** — The resource library gained reviewed Ideas, a tighter link taxonomy and exports that can be filtered by pricing model.

### Fixes

- Inactive subscription rows on Home use muted text instead of reduced opacity, which the mobile accessibility scan had flagged for contrast.
- Quarterly billing joined the supported subscription cycles.
- Ideas reconcile against the current resource library instead of the original seed list.

## 2026-09-11 — Resource library, freelance profiles and Drive-backed applications

### Shipped

- **Searchable resource library** — Links are browsable as expandable cards with search, so a saved resource can be found without scrolling the whole list.

- **Freelance profiles and proposal tracking** — Opportunities gained an own-only platform directory with editable profile and service drafts, proposal text, document links and a platform-filtered response rate. A draft never implies a published external account or a sent proposal.

- **Prepared applications connected to Drive** — Career links each prepared position to its posting and its Google Drive letter, records a sent snapshot atomically, keeps progress history and reports first replies, follow-up dates and cohort response statistics.

## 2026-09-07 — Career rebuilt around job matching

### Shipped

- **Match scoring and tailored letters** — Career was redesigned around an explicit, comparable match score per listing and application letters written for the specific position, with selected leads and letter guidance alongside them.

  ![Career's open positions beside one listing's detail: a senior React role at Ecomail.cz scored 88% stack overlap, the six matched skills listed, GraphQL named as the single gap, and the note that overlap is not a hiring probability.](media/changelog/2026-09-07-career-matching.png)

- **A saved stage before applying** — A position can be saved before it becomes an application, so the pipeline separates interest from a letter that was actually sent.

### Fixes

- Live job pages are given longer to respond before a listing is treated as gone.
