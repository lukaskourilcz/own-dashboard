/** Run from this checkout with Node. Uses invented data and local source only;
 * no environment file, backend, provider or credential is read. */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { deepStrictEqual } from "node:assert";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const baselineRef = "33b5369";
const source = readFileSync(`${root}/src/lib/dev-finance.ts`, "utf8");
async function load(contents) {
  const result = await build({ stdin: { contents, resolveDir: `${root}/src/lib`, sourcefile: "dev-finance.ts", loader: "ts" },
    bundle: true, platform: "node", format: "esm", write: false, absWorkingDir: root });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const before = await load(execFileSync("git", ["show", `${baselineRef}:src/lib/dev-finance.ts`], { cwd: root, encoding: "utf8" }));
const after = await load(source);
const projects = Array.from({ length: 200 }, (_, i) => ({ id: `p${i}`, name: `Synthetic project ${i}`, engagement: i % 2 ? "client" : "own", portfolio_key: null }));
const subscriptions = Array.from({ length: 1000 }, (_, i) => ({ id: `s${i}`, name: `Synthetic subscription ${i}`, amount: 10, currency: "USD", category_group: "development",
  billing_cycle: "monthly", is_active: true, started_on: "2020-01-01", ended_on: null, created_at: "2020-01-01T00:00:00Z", amount_confirmed_on: null }));
const allocations = subscriptions.flatMap((sub, i) => [0, 1].map(offset => ({ subscription_id: sub.id, project_id: `p${(i + offset) % 200}`, share: 0.5 })));
const transactions = Array.from({ length: 10000 }, (_, i) => ({ id: `t${i}`, kind: "expense", amount: 10, currency: "USD",
  occurred_on: `2026-${String(1 + i % 9).padStart(2, "0")}-01`, subscription_id: `s${i % 1000}` }));
const projectCosts = Array.from({ length: 1000 }, (_, i) => ({ project_id: `p${i % 200}`, amount: 1, currency: "USD" }));
const input = { projects, subscriptions, allocations, transactions, projectCosts, crons: [], currency: "USD", now: new Date("2026-10-24T12:00:00Z"), months: 12 };
deepStrictEqual(after.summarizeDevFinance(input), before.summarizeDevFinance(input));
function measure(fn) { const start = performance.now(), result = fn(input); return { ms: performance.now() - start, result }; }
const samples = [];
for (let i = 0; i < 3; i++) {
  const old = measure(before.summarizeDevFinance), current = measure(after.summarizeDevFinance);
  deepStrictEqual(current.result, old.result);
  samples.push({ beforeMs: old.ms, afterMs: current.ms });
}
const evidence = { scope: "Local synthetic aggregate CPU only; not deployed latency, throughput or money savings.", baselineRef,
  currentSourceSha256: createHash("sha256").update(source).digest("hex"), node: process.version,
  subscriptions: 1000, allocations: 2000, transactions: 10000, projects: 200, projectCosts: 1000, outputsIdentical: true, samples };
writeFileSync(new URL("./dev-finance-cpu.json", import.meta.url), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence));
