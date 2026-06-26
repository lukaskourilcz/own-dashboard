# Notes — lukaskourilcz/own-dashboard

> **Status legend:** ~~struck-through~~ = done. Open bullets = still to do.
> Each finished item has a short **Done:** note describing what shipped and
> where, plus any deviation from the original ask.

---

## Completed

### ~~1. Plans: recurring plans + dashboard tracker~~
> Redesign the section 'Plans' so for each Plan I can choose if this is a weekly,
> biweekly or monthly reoccuring plan for each plan I add there. Once the plan is
> in place, i want to show on Dashboard which plans are still needed to be done
> until the end of the reoccurence with the options to mark them as done. This
> should be a motivator for me to always see which plans I have there and how
> much left I have before the end of the loop.

**Done.**
- New per-plan **Repeat** field (One-off / Weekly / Every 2 weeks / Monthly) in
  the Plans "New plan" form. A recurrence chip now shows on each board card and
  timeline row. (`src/components/panels/plans-panel.tsx`)
- Data model: `recurrence` + `last_completed_at` columns added to `plans`
  (`supabase/schema.sql`, with `add column if not exists` migration for existing
  installs). `Plan` type + `PlanRecurrence` added in `src/lib/types.ts`.
- Period logic lives in `src/lib/plan-recurrence.ts` (pure, unit-tested in
  `tests/lib/plan-recurrence.test.ts`). Weekly/biweekly windows are
  Monday-aligned; biweekly fortnights tile from a fixed epoch; monthly = calendar
  month. "Done this period" is derived from `last_completed_at` falling inside
  the current window, so it auto-resets when the next loop starts (no per-period
  rows needed).
- **Dashboard:** a new **"Recurring plans"** overview widget shows every active
  recurring plan, its cadence, **days left in the period** (the motivator), and a
  one-tap circular checkbox to mark done / undo. Pending items sort first
  (soonest deadline first); when all are done it shows an "All done for now 🎉"
  banner. (`src/components/overview/recurring-plans.tsx`, wired in
  `src/components/dashboard-shell.tsx`.)

**Deviations / things to know:**
- The tracker is a **separate overview widget** (id `plans`) rather than baked
  into the Plans page itself — matches the existing customizable dashboard
  pattern. It's in the default layout, so **new** users see it automatically;
  **existing** users with a saved custom layout must add it once via
  *Customize → Add widget*.
- Recurring plans with status `dropped` or `done` are treated as retired and
  excluded from the tracker. `idea`/`active` recurring plans are shown.
- Follow-up: a recurring plan has no single end date, so the **Target date**
  field and the one-off **Add to calendar** checkbox are hidden (and cleared)
  whenever a recurrence is selected — only one-off plans show them.

### ~~2. GitHub notes: textarea → saved card~~
> When the new note in /github section is added, I want it to change from text
> area to a small card with two action buttons for edit and delete. This way the
> user has a feeling that it is actually saved here. Also, make sure the card has
> some max height and it truncates the text rather than making the cards bigger
> higher than the max.

**Done.** In `src/components/panels/repos-panel.tsx` (`RepoNoteEntry`):
- A saved note now renders as a compact **card** with **edit** (pencil) and
  **delete** (trash) buttons. Text is truncated with `line-clamp-6` so the card
  never grows past ~6 lines.
- A freshly added (empty) note opens straight into the textarea; pressing
  **Done** (or blurring) collapses it into the saved card. Edit reopens the
  textarea. Autosave-on-debounce behaviour is preserved.

### ~~3. Don't reorder repos when sending notes to GitHub~~
> also, when I send the notes to Github, dont reorder the repos on the board.

**Done.** Added `touchRepoInCache()` in `src/lib/github-queries.ts` — it refreshes
the repo's `pushed_at` **without re-sorting** the list. `saveToGithub` now calls
that instead of `bumpRepoInCache` (which sorted the just-saved repo to the top).
Order stays stable.

**Note:** the "Write file" dialog (arbitrary commits) still uses the original
`bumpRepoInCache` (intentional reorder) — only the notes-save path was changed,
matching the request. A later background refetch from GitHub will reflect the
repo's real `pushed_at` order, but there's no more jump on save.

### ~~4. "Save to GitHub": confirm file created + clear local notes~~
> When I hit the button Ulozit na Github, I want the user to know that the .md
> file on GitHub was created and I want to delete the notes from here.

**Done.** In `saveToGithub` (`src/components/panels/repos-panel.tsx`): after a
successful push, the repo's `repo_notes` rows are deleted (DB + local store +
cache) so the card returns to its empty state, and a confirmation toast
(`notesSavedCleared`) tells the user the file was created on GitHub and the notes
were cleared.

**Decision:** clearing happens **automatically** on every successful push (owner's
choice). If the post-push delete fails, the push is still reported as saved and
the notes are left in place.

---

## Verification done this session
- `npx tsc --noEmit` — clean
- `npm run lint` (changed files) — clean
- `npx vitest run` — 140 passed (incl. new `plan-recurrence` tests)
- `npm run build` — succeeds

---

## Open / next tasks
_(none — add new tasks below this line)_
