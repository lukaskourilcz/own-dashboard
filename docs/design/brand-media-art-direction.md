# Brand-media art direction and provider gate

No generated media has been approved or shipped. This document defines the provider-neutral art direction and integration boundary. Prompts, target placements, provider research, and provenance belong in `generated-media-manifest.json`.

## Direction

Use editorial operational cartography: connected work nodes, project paths, modular documents, ledger lines, restrained repository branches, and opportunity-to-client-to-project-to-invoice continuity. Compositions are structured, asymmetric but balanced, grid-aware, text-safe, and mostly orthographic/top-down with only mild physical depth.

Use paper, warm stone, graphite, charcoal, deep ink/cobalt, and limited amber. Materials are matte with subtle paper/mineral/technical-drawing texture and soft directional light. Avoid people, faces, fake screens, readable generated text, glossy plastic, glass, chrome, neon, cyan glow, purple neural networks, robots, brains, circuitry clichés, crypto, space, cinematic perspective, lens flare, random objects, and third-party marks.

## Integration contracts

- Login: `src/app/login/page.tsx` exposes `data-brand-media-slot="login-hero"`. Media must leave negative space for real HTML and be optional; layout, contrast, and sign-in remain complete without it.
- Empty states: extend the existing `EmptyState` API only after final assets exist. Decorative art must use empty alt text/`aria-hidden`; explanatory art needs localized adjacent text, not text burned into the image.
- Brand mark: retain `src/components/brand-mark.tsx` and `src/app/icon.tsx` until an approved direction is deterministically redrawn and tested at 16, 32, 192, and 512 px, monochrome, dark, and maskable crops.
- Presentation image: capture real fixture UI from `/dev-preview`, preserve its pixels/aspect ratio, and composite with deterministic tooling. Do not add Open Graph metadata until the file exists.
- Motion: optional login-only loop, slow path tracing/parallax/drift, no operational-screen loop. Require poster/static fallback, `prefers-reduced-motion`, a visible pause when controls are needed, and no delayed interaction.

## Provider and delivery gates

Research at least three current low-cost or free providers using primary sources. Compare exact cost/free quota, output ownership and redistribution, watermark policy, privacy/retention, supported dimensions/formats, quality fit, API/manual workflow, and credential requirements. Prefer a no-subscription option that permits use in the repository and deployed application. Record the date and direct sources in the manifest. Do not create accounts, purchase plans, expose credentials, or upload private data without owner authorization. If no safe provider qualifies, preserve reusable prompts and leave the assets deferred without placeholders.

Apply the same prompts, art direction, rejection criteria, responsive review, optimization, and provenance regardless of provider. Use SVG for the final mark; AVIF/WebP for still art; WebM plus MP4 only for justified motion. Target under 300 KB for desktop login, 180 KB mobile, 100 KB per empty state, and 1.5 MB for an optional loop. Record intrinsic dimensions, byte sizes, crops, accessibility classification, provider/model, exact prompt/negative prompt, sources, selected and rejected variants, provenance, and regeneration notes.

The priority order is mark exploration, login stills, empty-state family, then the authentic screenshot presentation frame. Motion and optional explanatory art remain rejected until static placements prove insufficient.
