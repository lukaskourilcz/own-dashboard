/** Local synthetic CPU only. No app server, owner documents, environment files
 * or provider calls. Run from the repository root; results go to stdout. */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const baseline = "1886429", root = process.cwd(), temporary = mkdtempSync(join(tmpdir(), "app-audit-markdown-"));
const filename = "src/components/ui/markdown.tsx";
const before = execFileSync("git", ["show", `${baseline}:${filename}`], { encoding: "utf8" });
const current = readFileSync(filename, "utf8");
const benchmark = `import {renderToStaticMarkup} from 'react-dom/server';import {Markdown} from './${filename}';import{createElement}from'react';import{createHash}from'node:crypto';const results=[];const render=source=>renderToStaticMarkup(createElement(Markdown,{source,tableLabel:'Synthetic table',codeLabel:'Synthetic code'}));render('Warmup');for(let sample=0;sample<3;sample++)for(const n of [10000,20000,30000]){const source='['.repeat(n),start=performance.now(),html=render(source);results.push({sample:sample+1,characters:n,milliseconds:Number((performance.now()-start).toFixed(3)),textHash:createHash('sha256').update(html.replace(/<[^>]*>/g,'')).digest('hex')});}console.log(JSON.stringify(results));`;
try {
  const results = {};
  for (const [mode, source] of [["before", before], ["after", current]]) {
    const outfile = join(temporary, `${mode}.cjs`);
    await build({ stdin: { contents: benchmark, resolveDir: root, loader: "tsx" }, bundle: true, platform: "node", format: "cjs", outfile,
      define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
      plugins: [{ name: "selected-renderer", setup(build) { build.onLoad({ filter: /src\/components\/ui\/markdown\.tsx$/ }, () => ({ contents: source, loader: "tsx", resolveDir: join(root,"src/components/ui") })); } }],
    });
    results[mode] = JSON.parse(execFileSync(process.execPath, [outfile], { timeout: 20_000, encoding: "utf8" }));
  }
  const textEqual = results.before.every((row, index) => row.textHash === results.after[index].textHash);
  if (!textEqual) throw Error("Rendered fixture text differs");
  console.log(JSON.stringify({ baseline, measuredAt: new Date().toISOString(), node: process.version, platform: process.platform,
    scope: "Local warmed server-render CPU for invented unclosed bracket runs; no deployed latency or billing measurement.", textEqual, ...results }, null, 2));
} finally { rmSync(temporary, { recursive: true, force: true }); }
