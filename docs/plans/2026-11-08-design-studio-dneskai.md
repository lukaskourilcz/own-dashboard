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

## What was done (7 November 2026)

1. **Own the source.** `studio/src` from Quorum 893a495 is `src/lib/carousel-studio/`, its fonts, kits and goldens
   `templates/carousel-studio/`; the vendor tree, its script, test and package dependency are gone. Every golden PNG
   still matches byte for byte, and the render keys keep the old pin, so no stored slide renders again.
2. **Hand placement in the engine, not a second Spotlight.** Re-drawing Spotlight in a new SVG layout would have meant
   two renderers that must agree pixel for pixel. Instead the engine takes optional boxes per slide
   (`dneskai-boxes.ts`) and reports the frames it drew, so the Studio edits over the engine's own render.
3. **One editing surface.** `BoxOverlay` and `StudioToolbar` serve devShark's `SlideCanvas` and DNESKAi's Studio view.
4. **Connected.** The deck contract, render key, deck edits, preview and "Dnes a zítra" carry the boxes; nothing else
   about publishing changes, so there is no cut-over step.
