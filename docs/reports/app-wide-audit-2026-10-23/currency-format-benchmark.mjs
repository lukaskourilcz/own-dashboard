/** Local invented values only. Measures formatter CPU, not deployed latency,
 * billing savings, provider traffic or database performance. */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { deepStrictEqual } from "node:assert";
const root = fileURLToPath(new URL("../../../", import.meta.url)), baselineRef = "319b972";
const source = readFileSync(`${root}/src/lib/utils.ts`, "utf8");
async function load(contents) {
  const result = await build({ stdin: { contents, resolveDir: `${root}/src/lib`, sourcefile: "utils.ts", loader: "ts" }, bundle: true, platform: "node", format: "esm", write: false, absWorkingDir: root });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const before = await load(execFileSync("git", ["show", `${baselineRef}:src/lib/utils.ts`], { cwd: root, encoding: "utf8" })), after = await load(source);
const currencies = ["USD", "EUR", "GBP", "CZK", "CAD"], values = Array.from({ length: 10000 }, (_, i) => ({ currency: currencies[i % currencies.length], value: (i % 2 ? -1 : 1) * (i * 97.13) }));
function measure(format) { const start = performance.now(), output = values.map(row => format(row.value, row.currency)); return { ms: performance.now() - start, output }; }
const samples = [];
for (let i = 0; i < 3; i++) {
  const old = measure(before.formatCurrency), current = measure(after.formatCurrency); deepStrictEqual(current.output, old.output);
  samples.push({ beforeMs: old.ms, afterMs: current.ms });
}
const evidence = { scope: "Local synthetic formatter CPU only; not deployed latency, throughput or money savings.", baselineRef,
  currentSourceSha256: createHash("sha256").update(source).digest("hex"), node: process.version, values: values.length, currencies, outputsIdentical: true, samples };
writeFileSync(new URL("./currency-format-cpu.json", import.meta.url), `${JSON.stringify(evidence, null, 2)}\n`); process.stdout.write(`${JSON.stringify(evidence)}\n`);
