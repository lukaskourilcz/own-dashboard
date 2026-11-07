# DNESKAi in the Design Studio, without Quorum

Owner decision, 7 November 2026: one Design Studio for DNESKAi and devShark, and no dependency on the Quorum
repository. devShark is done (PRs #236, #237). This plan moves DNESKAi.

## Where DNESKAi stands

- Slides are drawn by `@boardlessai/carousel-studio`, vendored as **built output** in `vendor/carousel-studio`
  (`dist/` JavaScript, `fonts/`, `brand-kits/`, `golden/`) and linked as `file:vendor/carousel-studio`.
  Nothing is fetched from Quorum at runtime or build time; the dependency is the workflow: the TypeScript source
  lives in `lukaskourilcz/quorum` (`studio/src`), and a kit change meant edit Quorum, build, re-vendor
  (`scripts/vendor-carousel-studio.sh`, tree hash in `UPSTREAM.md`).
- Quorum `main` and the pinned commit `893a495` have the same `studio/src`, so the source can move over unchanged.
- own-dashboard imports only `renderDneskaiSlide` and a few constants (`dneskai-render.ts`, `dneskai-slides.ts`, the
  dev-preview render route, the preview-fixture script).

## Steps

1. **Own the source (B1, ~3 h).** Copy `studio/src` (43 modules and `hooks/`) to `src/lib/carousel-studio/`, the
   fonts, brand kits and goldens to `templates/carousel-studio/`. Replace the three `import.meta.url` directories
   (`fonts.ts`, `brand-kit.ts`, `golden.ts`) with `process.cwd()` paths, as `devshark-render.ts` does, and point the
   file tracing in `next.config.ts` at the new folder. Imports change from `@boardlessai/carousel-studio` to
   `@/lib/carousel-studio`. The golden PNG hashes must stay identical: the existing vendor test becomes a golden
   test of the owned source. Then delete `vendor/carousel-studio`, the vendor script and its tests, and the
   `package.json` dependency.
2. **Spotlight in the shared layout (B2, ~6 h).** Express Spotlight's slide types (photo cover with ink fade and
   optional round inset, statement, before/after quote, figure, split) as Design Studio layouts: text blocks with
   boxes, plus picture layers whose crop and focal point the Lab already edits. The automatic boxes must reproduce
   today's Spotlight output; the goldens are the check.
3. **Studio editor for DNESKAi (B3, ~4 h).** The Lab's slide stage uses `SlideCanvas` for Spotlight decks: drag,
   size, align, write and green words on the slide, saved in the deck as `layout`. Older kits stay rendered as they
   were and are not editable on the slide.
4. **Cut over (B4, ~2 h).** Generation, the plan step and "Dnes a zítra" render Spotlight through the shared layout;
   compare a week of posts against the old renderer before switching; docs and the system map.

Estimate: 14–18 hours. Publishing keeps the current renderer until step 4 shows identical output.
