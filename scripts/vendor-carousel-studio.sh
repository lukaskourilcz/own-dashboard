#!/usr/bin/env bash
# Vendor @boardlessai/carousel-studio from a Quorum checkout into vendor/carousel-studio/.
#
#   scripts/vendor-carousel-studio.sh check
#       Verify the committed vendor tree against the tree hash in vendor/carousel-studio/UPSTREAM.md.
#       Needs nothing but this repository.
#
#   scripts/vendor-carousel-studio.sh <quorum-checkout> <commit>
#       Rebuild the package from <commit> into a scratch directory and verify that the rebuilt tree
#       is byte-identical to the committed vendor tree. Changes nothing.
#
#   scripts/vendor-carousel-studio.sh <quorum-checkout> <commit> --write
#       Rebuild from <commit>, replace vendor/carousel-studio/ with the result and record the commit
#       and the new tree hash in UPSTREAM.md. Review the diff and run the tests before committing.
#
# The source is read with `git archive <commit>`, so uncommitted work in the Quorum checkout never
# reaches the vendor tree and the checkout itself is never written to. The build uses the checkout's
# installed TypeScript (`pnpm install` in the Quorum checkout first). See vendor/carousel-studio/UPSTREAM.md.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
vendor="$repo/vendor/carousel-studio"
upstream_doc="$vendor/UPSTREAM.md"

# sha256 over the sorted "<sha256>  <relative path>" lines of every vendored file except UPSTREAM.md.
# GNU coreutils and recent macOS ship sha256sum; older macOS only has `shasum -a 256`, same output format.
if command -v sha256sum >/dev/null 2>&1; then
  sha256=(sha256sum)
else
  sha256=(shasum -a 256)
fi

tree_hash() {
  (cd "$1" && find . -type f ! -path ./UPSTREAM.md -print0 | LC_ALL=C sort -z | xargs -0 "${sha256[@]}") | "${sha256[@]}" | cut -d' ' -f1
}

recorded_hash() {
  sed -n 's/^- Tree sha256: `\([0-9a-f]\{64\}\)`$/\1/p' "$upstream_doc"
}

if [[ "${1:-}" == "check" ]]; then
  expected="$(recorded_hash)"
  actual="$(tree_hash "$vendor")"
  if [[ -z "$expected" || "$expected" != "$actual" ]]; then
    echo "vendor/carousel-studio tree hash $actual does not match UPSTREAM.md (${expected:-missing})" >&2
    exit 1
  fi
  echo "vendor/carousel-studio matches UPSTREAM.md: $actual"
  exit 0
fi

if [[ $# -lt 2 ]]; then
  sed -n '2,18p' "$0" >&2
  exit 2
fi
quorum="$(cd "$1" && pwd)"
commit="$(git -C "$quorum" rev-parse --verify "$2^{commit}")"
write="${3:-}"
[[ -z "$write" || "$write" == "--write" ]] || { echo "Unknown option $write; the only option is --write." >&2; exit 2; }
tsc="$quorum/studio/node_modules/typescript/bin/tsc"
[[ -f "$tsc" ]] || { echo "No TypeScript at $tsc; run pnpm install in the Quorum checkout." >&2; exit 1; }

scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/source" "$scratch/out"
git -C "$quorum" archive "$commit" studio tsconfig.base.json LICENSE | tar -x -C "$scratch/source"
# Type declarations only; the build reads nothing else from the checkout.
ln -s "$quorum/studio/node_modules" "$scratch/source/studio/node_modules"
node "$tsc" -p "$scratch/source/studio/tsconfig.build.json"

out="$scratch/out"
cp -R "$scratch/source/studio/dist" "$out/dist"
cp -R "$scratch/source/studio/fonts" "$out/fonts"
mkdir -p "$out/brand-kits" "$out/golden"
cp -R "$scratch/source/studio/brand-kits/caught-up" "$out/brand-kits/caught-up"
# The editorial pins and each other kit's pins (golden/dneskai-<kit>.json), which the vendor test reads.
cp "$scratch/source/studio/golden/"dneskai-*.json "$out/golden/"
cp "$scratch/source/LICENSE" "$out/LICENSE"
# The manifest keeps what Node and npm read. Exact dependency pins become caret ranges so that
# OwnDashboard's own sharp, resvg and zod satisfy them and npm installs no second copy. Two subpath
# exports are added: `./dneskai-slide`, the DNESKAi slide API alone, so a route bundle does not pull in
# the barrel's hook-library reader, whose dynamic file reads make Turbopack trace the whole project;
# and `./fonts`, the committed faces' metrics, which OwnDashboard's glyph gate checks copy against.
node -e '
  const fs = require("node:fs");
  const upstream = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const caret = (range) => /^\d+\.\d+\.\d+$/.test(range) ? `^${range}` : range;
  const dependencies = Object.fromEntries(Object.entries(upstream.dependencies).map(([name, range]) => [name, caret(range)]));
  const exports = {
    ...upstream.exports,
    "./dneskai-slide": { types: "./dist/dneskai-slide.d.ts", default: "./dist/dneskai-slide.js" },
    "./fonts": { types: "./dist/fonts.d.ts", default: "./dist/fonts.js" }
  };
  const trimmed = { name: upstream.name, version: upstream.version, type: upstream.type, exports, dependencies };
  fs.writeFileSync(process.argv[2], JSON.stringify(trimmed, null, 2) + "\n");
' "$scratch/source/studio/package.json" "$out/package.json"

rebuilt="$(tree_hash "$out")"
if [[ "$write" == "--write" ]]; then
  committed="$(TZ=UTC git -C "$quorum" show -s --date=format-local:%Y-%m-%dT%H:%M:%SZ --format=%cd "$commit")"
  today="$(date -u +%Y-%m-%d)"
  # Prepare the new UPSTREAM.md in the scratch directory first. Node rewrites it, so GNU and BSD sed
  # behave the same, and a missing pin line stops the script before the vendored tree is touched.
  staged_doc="$scratch/UPSTREAM.md"
  node -e '
    const fs = require("node:fs");
    const [source, target, commit, committed, today, rebuilt] = process.argv.slice(1);
    let text = fs.readFileSync(source, "utf8");
    const lines = [
      [/^- Commit: `[0-9a-f]{40}`$/m, `- Commit: \`${commit}\``],
      [/^- Commit date: `[^`]*`$/m, `- Commit date: \`${committed}\``],
      [/^- Vendored: `[^`]*`$/m, `- Vendored: \`${today}\``],
      [/^- Tree sha256: `[0-9a-f]{64}`$/m, `- Tree sha256: \`${rebuilt}\``]
    ];
    const missing = lines.filter(([pattern]) => (text.match(new RegExp(pattern.source, "gm")) ?? []).length !== 1);
    if (missing.length > 0) {
      console.error(`UPSTREAM.md needs exactly one of each pin line; missing or repeated: ${missing.map(([pattern]) => pattern.source).join(", ")}`);
      process.exit(1);
    }
    for (const [pattern, line] of lines) text = text.replace(pattern, () => line);
    fs.writeFileSync(target, text);
  ' "$upstream_doc" "$staged_doc" "$commit" "$committed" "$today" "$rebuilt"

  find "$vendor" -mindepth 1 -maxdepth 1 ! -name UPSTREAM.md -exec rm -rf {} +
  cp -R "$out/." "$vendor/"
  cp "$staged_doc" "$upstream_doc"
  written="$(tree_hash "$vendor")"
  [[ "$written" == "$rebuilt" && "$(recorded_hash)" == "$rebuilt" ]] \
    || { echo "vendor/carousel-studio is $written after the copy, UPSTREAM.md records $(recorded_hash), the build was $rebuilt." >&2; exit 1; }
  echo "vendor/carousel-studio rebuilt from $commit ($committed): $rebuilt"
  echo "Update DNESKAI_STUDIO in src/lib/marketing/dneskai-render.ts and the note under Pin in UPSTREAM.md."
  exit 0
fi

current="$(tree_hash "$vendor")"
if [[ "$rebuilt" != "$current" ]]; then
  echo "Rebuilt tree $rebuilt differs from vendor/carousel-studio $current:" >&2
  diff -rq "$out" "$vendor" --exclude UPSTREAM.md >&2 || true
  exit 1
fi
[[ "$(recorded_hash)" == "$current" ]] || { echo "UPSTREAM.md records $(recorded_hash), the tree is $current." >&2; exit 1; }
echo "vendor/carousel-studio is the build of $commit: $current"
