import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// REN-05: `--write` must prepare UPSTREAM.md before it replaces the vendored tree, and it must not
// depend on GNU `sed -i`, which BSD sed on macOS rejects. The test runs the real script against a
// throwaway Quorum-shaped Git repository with a stub TypeScript compiler; it never touches
// vendor/carousel-studio of this repository.

const script = path.resolve(__dirname, "../../scripts/vendor-carousel-studio.sh");
const pinDoc = (lines: { vendored?: boolean } = {}) => [
  "# stub",
  "",
  "- Commit: `0000000000000000000000000000000000000000`",
  "- Commit date: `2000-01-01T00:00:00Z`",
  ...(lines.vendored === false ? [] : ["- Vendored: `2000-01-01`"]),
  "- Tree sha256: `0000000000000000000000000000000000000000000000000000000000000000`",
  "",
].join("\n");

let root: string;
let quorum: string;
let commit: string;
let shimBin: string;

function run(command: string, args: string[], cwd: string, env: Record<string, string> = {}) {
  return spawnSync(command, args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
}

function write(file: string, text: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** A copy of OwnDashboard's layout that the script derives from its own location. */
function dashboard(name: string, upstream: string): { dir: string; vendor: string } {
  const dir = path.join(root, name);
  mkdirSync(path.join(dir, "scripts"), { recursive: true });
  copyFileSync(script, path.join(dir, "scripts/vendor-carousel-studio.sh"));
  chmodSync(path.join(dir, "scripts/vendor-carousel-studio.sh"), 0o755);
  const vendor = path.join(dir, "vendor/carousel-studio");
  write(path.join(vendor, "UPSTREAM.md"), upstream);
  write(path.join(vendor, "dist/old.js"), "export const old = true;\n");
  return { dir, vendor };
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "vendor-studio-script-"));
  quorum = path.join(root, "quorum");
  write(path.join(quorum, "LICENSE"), "MIT\n");
  write(path.join(quorum, "tsconfig.base.json"), "{}\n");
  write(path.join(quorum, ".gitignore"), "node_modules\n");
  write(path.join(quorum, "studio/tsconfig.build.json"), "{}\n");
  write(path.join(quorum, "studio/src/index.ts"), "export const studio = 1;\n");
  write(path.join(quorum, "studio/fonts/face.txt"), "font\n");
  write(path.join(quorum, "studio/brand-kits/caught-up/manifest.json"), "{}\n");
  write(path.join(quorum, "studio/golden/dneskai-photo.json"), "{}\n");
  write(path.join(quorum, "studio/package.json"), JSON.stringify({ name: "@boardlessai/carousel-studio", version: "1.0.0", type: "module", exports: { ".": "./dist/index.js" }, dependencies: { zod: "4.0.0" } }));
  const git = (...args: string[]) => {
    const result = run("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args], quorum, {
      GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_DATE: "2026-10-20T10:00:00Z", GIT_COMMITTER_DATE: "2026-10-20T10:00:00Z",
    });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  };
  git("init", "-q");
  git("add", ".");
  git("commit", "-q", "-m", "stub studio");
  commit = git("rev-parse", "HEAD");
  // The stub compiler, outside Git like a real pnpm install: emits dist/ beside the -p config.
  write(path.join(quorum, "studio/node_modules/typescript/bin/tsc"), [
    "const fs = require('node:fs'); const path = require('node:path');",
    "const project = path.dirname(process.argv[process.argv.indexOf('-p') + 1]);",
    "fs.mkdirSync(path.join(project, 'dist'), { recursive: true });",
    "fs.writeFileSync(path.join(project, 'dist/index.js'), fs.readFileSync(path.join(project, 'src/index.ts')));",
  ].join("\n"));
  // A sed that refuses in-place edits, as BSD sed refuses the GNU `-i 's/…/'` form.
  shimBin = path.join(root, "bin");
  write(path.join(shimBin, "sed"), `#!/bin/sh\nfor arg in "$@"; do case "$arg" in -i*) echo "sed: in-place edit refused by test shim" >&2; exit 1;; esac; done\nexec ${run("sh", ["-c", "command -v sed"], root).stdout.trim()} "$@"\n`);
  chmodSync(path.join(shimBin, "sed"), 0o755);
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("scripts/vendor-carousel-studio.sh --write", () => {
  it("fails before mutating the vendored tree when UPSTREAM.md lacks a pin line", () => {
    const { dir, vendor } = dashboard("missing-line", pinDoc({ vendored: false }));
    const before = readFileSync(path.join(vendor, "UPSTREAM.md"), "utf8");
    const result = run("bash", [path.join(dir, "scripts/vendor-carousel-studio.sh"), quorum, commit, "--write"], dir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/UPSTREAM\.md needs exactly one of each pin line/);
    expect(existsSync(path.join(vendor, "dist/old.js"))).toBe(true);
    expect(existsSync(path.join(vendor, "dist/index.js"))).toBe(false);
    expect(readFileSync(path.join(vendor, "UPSTREAM.md"), "utf8")).toBe(before);
  });

  it("rejects an unknown option before building or writing", () => {
    const { dir, vendor } = dashboard("bad-option", pinDoc());
    const result = run("bash", [path.join(dir, "scripts/vendor-carousel-studio.sh"), quorum, commit, "--wirte"], dir);
    expect(result.status).toBe(2);
    expect(existsSync(path.join(vendor, "dist/old.js"))).toBe(true);
  });

  it("replaces the tree and records the pin without sed -i, then passes its own check", () => {
    const { dir, vendor } = dashboard("write", pinDoc());
    const env = { PATH: `${shimBin}${path.delimiter}${process.env.PATH ?? ""}` };
    const result = run("bash", [path.join(dir, "scripts/vendor-carousel-studio.sh"), quorum, commit, "--write"], dir, env);
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(path.join(vendor, "dist/old.js"))).toBe(false);
    expect(readFileSync(path.join(vendor, "dist/index.js"), "utf8")).toContain("studio = 1");
    const doc = readFileSync(path.join(vendor, "UPSTREAM.md"), "utf8");
    expect(doc).toContain(`- Commit: \`${commit}\``);
    expect(doc).toContain("- Commit date: `2026-10-20T10:00:00Z`");
    expect(doc).toMatch(/^- Vendored: `\d{4}-\d{2}-\d{2}`$/m);
    expect(doc).not.toContain("2000-01-01");
    expect(JSON.parse(readFileSync(path.join(vendor, "package.json"), "utf8")).dependencies).toEqual({ zod: "^4.0.0" });
    const check = run("bash", [path.join(dir, "scripts/vendor-carousel-studio.sh"), "check"], dir, env);
    expect(check.status, check.stderr).toBe(0);
    const verify = run("bash", [path.join(dir, "scripts/vendor-carousel-studio.sh"), quorum, commit], dir, env);
    expect(verify.status, verify.stderr).toBe(0);
  });
});
