# /visual-qa

1. Read the visual-QA skill/docs and target test helpers.
2. Start/reuse the local app and deterministic `/dev-preview`; never use private data.
3. Inspect representative routes at 360, 430, 768, 1024, 1440, and 1728 px in light/dark and EN/CS, including long content and non-happy states.
4. Check mobile hierarchy/safe areas, overflow/reflow, tabs, filters, tables, charts, forms, dialogs/drawers, sticky controls, and media seams.
5. Run axe plus keyboard/focus/Escape/trap/label/error/live-region/touch-target/reduced-motion checks.
6. Inspect console/network, invoice print when relevant, and real asset loading.
7. Fix feasible failures, rerun, and write exact evidence to `docs/design/visual-qa.md`; never mark an unrun check passed.
