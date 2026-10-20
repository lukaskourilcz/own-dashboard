# @boardlessai/carousel-studio, vendored

The deterministic Design Lab render engine from Quorum, consumed by OwnDashboard for DNESKAi
Instagram slides (own-dashboard#117, quorum#603). It is copied here as built output so that a
Vercel build of OwnDashboard needs no Quorum checkout, no pnpm workspace and no network.

## Pin

- Repository: `lukaskourilcz/quorum`, directory `studio/`, package `@boardlessai/carousel-studio` 1.0.0
- Commit: `72b7a5e02a640e6ffcbdd50c5f21f83066004cdf`
- Commit date: 2026-10-20T19:21:09Z. The same `studio/` tree (`68a3bb6e0775c8cab9ce4a74eae10ad5a4b96d0f`)
  reached Quorum `main` with PR #604 (`8be79ab`).
- Vendored: 2026-10-20
- Tree sha256: `d3cdd59ac1a1663000df62630722ed040cb3af9e95e9279e8166038519166400`

The tree hash covers every file in this directory except this one: sha256 over the sorted
`sha256sum` lines of the files, as `scripts/vendor-carousel-studio.sh` computes it.
`tests/lib/carousel-studio-vendor.test.ts` recomputes it, so a hand edit fails the test suite.

## What is here

| Path | From | Why |
| --- | --- | --- |
| `dist/` | `tsc -p studio/tsconfig.build.json` on the commit above (TypeScript 5.9.3) | The package entry point and its type declarations, byte-identical to Quorum's own build |
| `fonts/` | `studio/fonts/`, all 17 families with their `OFL.txt` | The renderer hands every committed face to resvg (`fontFiles()` lists all of `FONT_METRICS`), and resvg looks for a missing glyph across all of them. A subset would make the output depend on which files happen to exist |
| `brand-kits/caught-up/` | `studio/brand-kits/caught-up/` | The DNESKAi logotype and its manifest, which pins each file by sha256 |
| `golden/dneskai-photo.json` | `studio/golden/dneskai-photo.json` | The pinned PNG hash of each DNESKAi slide type, used by the vendor test |
| `LICENSE` | Quorum `LICENSE` (MIT) | Licence of the engine code |
| `package.json` | `studio/package.json`, trimmed | Only `name`, `version`, `type`, `exports` and `dependencies` |

Left out on purpose: `src/`, `tests/`, `scripts/`, the hook libraries in `studio/hooks/` (a missing
library loads as empty and DNESKAi slides never read one), `golden/manifest.json` and the
`marketingshark` brand kit. Nothing in the DNESKAi path reads them.

## Dependencies

Upstream pins `sharp` 0.35.4, `zod` 4.4.3 and `@resvg/resvg-js` ^2.6.2. The trimmed `package.json`
turns the exact pins into caret ranges (`^0.35.4`, `^4.4.3`) so that OwnDashboard's own `sharp`
0.35.5, `zod` 4.6.7 and `@resvg/resvg-js` 2.6.2 satisfy them. `npm ls` shows all three deduped
to the root `node_modules`, so there is one sharp and one libvips in a function. All ten pinned
DNESKAi golden hashes reproduce with these versions (`tests/lib/carousel-studio-vendor.test.ts`).
A future sharp minor (0.36) falls outside the range and npm would nest the pinned version; re-vendor
or widen the range on purpose, and let the golden test decide.

## Licences

- Engine code: MIT, `LICENSE`.
- Fonts: SIL Open Font License 1.1, one `OFL.txt` per family in `fonts/<family>/`. Families:
  Anton, Archivo, Barlow, Barlow Condensed, Figtree, IBM Plex Mono, IBM Plex Sans, Inter,
  JetBrains Mono, Karla, Literata, Manrope, Outfit, Petrona, Public Sans, Source Serif 4,
  Space Grotesk. The OFL allows bundling and embedding; the fonts are not sold on their own.
- Brand kit: the owner's DNESKAi logotype, copied byte for byte from `lukaskourilcz/aifirst`
  commit `978cf71eaa07e6465dea9055a92a7ad918844405` (see `brand-kits/caught-up/manifest.json`).

## Updating

Never edit files here by hand. With a Quorum checkout that has run `pnpm install`:

```bash
# verify the committed tree against the hash above (no Quorum needed)
scripts/vendor-carousel-studio.sh check
# rebuild a commit in a scratch directory and prove it equals the committed tree
scripts/vendor-carousel-studio.sh ../quorum <commit>
# replace the tree with the build of another commit and update the pin above
scripts/vendor-carousel-studio.sh ../quorum <commit> --write
```

The script reads the source with `git archive`, so uncommitted Quorum changes never reach the
tree and the checkout is never written to. After `--write`, run `npm install` (the link in
`node_modules/@boardlessai/carousel-studio` does not change), `npx vitest run tests/lib/carousel-studio-vendor.test.ts tests/lib/marketing-dneskai-render.test.ts`
and commit the tree, this file and any golden change together. A changed golden hash means the
studio draws differently; every DNESKAi render key changes with the version and the renderer
re-renders those slides once.
