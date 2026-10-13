/** Offline draft preparation only. No credentials, model, storage, Auth or publication calls.
 * node scripts/marketing-weekly-offline.mjs --input /private/packets.json --week-start YYYY-MM-DD --output /private/new-folder
 * Optional --captions /private/seven-captions.json; --source-proof /private/evidence.json.
 */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { builtinModules, createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import sharp from "sharp";
import { Resvg } from "@resvg/resvg-js";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const sha = value => createHash("sha256").update(value).digest("hex");
const escaped = value => value.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const label = {javascript:"JavaScript",typescript:"TypeScript",react:"React",css:"CSS",html:"HTML",nodejs:"Node.js",git:"Git"};
export function weeklyDates(weekStart) {
  assert.equal(typeof weekStart, "string", "week-start-required");
  assert.match(weekStart, /^\d{4}-\d{2}-\d{2}$/, "week-start-invalid");
  const date = new Date(`${weekStart}T00:00:00Z`);
  assert.ok(Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === weekStart && date.getUTCDay() === 0, "week-start-must-be-real-Sunday");
  return Array.from({length:7}, (_, i) => new Date(date.getTime()+i*86400000).toISOString().slice(0,10));
}
export function weeklyThreads(source) {
  const correct = source.content.options.indexOf(source.content.answer);
  assert.ok(correct >= 0 && source.content.options.filter(v => v === source.content.answer).length === 1, "ambiguous-authored-answer");
  const question = `${source.content.body}\n\n${source.content.options.map((v,i)=>`${String.fromCharCode(65+i)}. ${v}`).join("\n")}\n\n${source.canonicalUrl}`;
  const answer = `Answer: ${String.fromCharCode(65+correct)}.\n\n${source.content.explanation}`;
  assert.ok([...question].length <= 500 && Buffer.byteLength(question,"utf8") <= 500, "threads-question-overflow");
  assert.ok([...answer].length <= 500 && Buffer.byteLength(answer,"utf8") <= 500, "threads-answer-overflow");
  return {question, answer};
}
export function prepareWeeklyPackets(raw, consumer, now = new Date()) {
  assert.ok(Array.isArray(raw) && raw.length === 7, "exactly-seven-source-items-required");
  const packets = raw.map(consumer.parseSourcePacket);
  assert.equal(new Set(packets.map(p=>p.sourceId)).size, 7, "distinct-source-items-required");
  for (const source of packets) {
    assert.ok(source.brand === "devshark" && source.kind === "question" && source.locale === "en" && source.eligible, "eligible-English-devshark-questions-required");
    assert.equal(consumer.contentHash(source.content), source.contentHash, "source-content-hash-mismatch");
    assert.ok(label[source.content.category], "category-not-supported-by-weekly-layout");
    const canonical = new URL(source.canonicalUrl);
    assert.ok(canonical.origin === "https://devshark.app" && canonical.pathname === "/quiz" && !canonical.username && !canonical.password, "evergreen-category-url-required");
    assert.ok(source.expiresAt === null || Date.parse(source.expiresAt) > now.getTime(), "source-expired");
    assert.ok(Date.parse(source.observedAt) <= now.getTime()+300000, "source-observed-in-future");
    weeklyThreads(source);
  }
  return packets;
}
export function weeklySlides(source, authoredMarketingText) {
  const correct = source.content.options.indexOf(source.content.answer);
  return [
    {headline:label[source.content.category],body:authoredMarketingText(source.content.body,source.content.code),code:source.content.code,evidenceIndexes:[]},
    {headline:"Choose an answer",body:source.content.options.map((v,i)=>`${String.fromCharCode(65+i)}. ${authoredMarketingText(v,null)}`).join("\n"),code:null,evidenceIndexes:[]},
    {headline:`Answer: ${String.fromCharCode(65+correct)}`,body:authoredMarketingText(source.content.explanation,source.content.code),code:null,evidenceIndexes:[]},
    {headline:"Keep practising",body:`devshark.app\n${label[source.content.category]}`,code:null,evidenceIndexes:[]},
  ];
}
export function parseWeeklyOptions(args) {
  const options = {};
  for(let i=0;i<args.length;i+=2){
    assert.ok(["--input","--week-start","--output","--captions","--source-proof"].includes(args[i]) && args[i+1] && !options[args[i].slice(2)], "invalid-or-duplicate-option");
    options[args[i].slice(2)] = args[i+1];
  }
  assert.ok(options.input && options["week-start"] && options.output, "input-week-start-output-required");
  weeklyDates(options["week-start"]);
  return options;
}
async function loadConsumer() {
  const work = fs.mkdtempSync(path.join(tmpdir(), "marketing-weekly-renderer-"));
  const outfile = path.join(work,"consumer.cjs");
  const require = createRequire(import.meta.url);
  try {
    await build({stdin:{contents:`export {parseSourcePacket,parseContentRevision} from './src/lib/marketing/contracts'; export {contentHash} from './src/lib/marketing/hashes'; export {authoredMarketingText} from './src/lib/marketing/generation'; export {pendingMarketingTemplate,renderMarketingPreview,fitMarketingText} from './src/lib/marketing/render';`,resolveDir:repo,loader:"ts",sourcefile:"weekly-offline-consumer.ts"},outfile,bundle:true,platform:"node",format:"cjs",target:"node24",logLevel:"silent",plugins:[{name:"absolute-external-packages",setup(builder){builder.onResolve({filter:/^[^./]/},args=>{if(args.path.startsWith("node:")||builtinModules.includes(args.path))return {path:args.path,external:true};return {path:createRequire(args.importer||path.join(repo,"package.json")).resolve(args.path),external:true}})}}]});
    return require(outfile);
  } finally {fs.rmSync(work,{recursive:true,force:true})}
}
export async function buildWeeklyOffline(options) {
 const dates = weeklyDates(options["week-start"]);
 const requestedOutput = path.resolve(options.output);
 assert.ok(requestedOutput !== repo && !requestedOutput.startsWith(repo+path.sep), "private-output-must-be-outside-repository");
 fs.mkdirSync(path.dirname(requestedOutput),{recursive:true,mode:0o700});
 const output = path.join(fs.realpathSync(path.dirname(requestedOutput)),path.basename(requestedOutput));
 assert.ok(output !== repo && !output.startsWith(repo+path.sep), "private-output-must-be-outside-repository");
 assert.ok(!fs.existsSync(output), "output-must-be-new-directory");
 const consumer = await loadConsumer();
 const {parseContentRevision,authoredMarketingText,pendingMarketingTemplate,renderMarketingPreview,fitMarketingText} = consumer;
 const inputBytes = fs.readFileSync(path.resolve(options.input));
 const packets = prepareWeeklyPackets(JSON.parse(inputBytes.toString("utf8")),consumer);
 const suppliedCaptions = options.captions ? readJson(path.resolve(options.captions)) : null;
 if(suppliedCaptions)assert.ok(Array.isArray(suppliedCaptions)&&suppliedCaptions.length===7&&suppliedCaptions.every(v=>typeof v==="string"&&v.length>0&&v.length<=2200),"seven-bounded-manual-captions-required");
 const sourceProof = options["source-proof"] ? {path:path.resolve(options["source-proof"]),sha256:sha(fs.readFileSync(path.resolve(options["source-proof"])))} : null;
 const design=readJson(path.join(repo,"templates/marketing/devshark/derived-layout.json"));
 const metrics=readJson(path.join(repo,"templates/marketing/font-metrics.json"));
 const fontProvenance=readJson(path.join(repo,"templates/marketing/provenance.json"));
 const originalFetch = globalThis.fetch;
 const cwd = process.cwd();
 fs.mkdirSync(output,{mode:0o700});
 try {
 if(cwd!==repo)process.chdir(repo);
 globalThis.fetch=async()=>{throw Error("offline-deliverables-network-forbidden")};
const write = (file, value) => {
  const dest = path.join(output, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 448 });
  fs.writeFileSync(dest, value, { mode: 384 });
  fs.chmodSync(dest, 384);
  return { file, sha256: sha(value), bytes: Buffer.byteLength(value) };
};
const saveJson = (file, value) => write(file, JSON.stringify(value, null, 2) + "\n");
const faces = metrics;
const faceIds = ["manrope-800", "manrope-700", "inter-400", "jetbrains-mono-400"];
const fontFiles = faceIds.map((id) => {
  const f = faces[id];
  const file = path.join(repo, "templates/marketing/fonts", f.file);
  const proof = fontProvenance.fonts.find((v) => v.file === f.file);
  assert.equal(sha(fs.readFileSync(file)), proof.sha256);
  return file;
});
const assets = {};
for (const [file, hash] of Object.entries(design.assets)) {
  const bytes = fs.readFileSync(path.join(repo, "templates/marketing/devshark", file));
  assert.equal(sha(bytes), hash);
  assets[file] = bytes;
}
const texts = (value, id, size, x, y, color, maxLines, width = 920, code = false) => {
  const lines = fitMarketingText({ value, faceId: id, fontSize: size, width, maxLines, code });
  const leading = code ? 1.45 : 1.35;
  return { bottom: y + (lines.length - 1) * size * leading + size * 0.3, svg: `<text xml:space="preserve" font-family="${escaped(faces[id].rasterFamily)}" font-weight="${faces[id].weight}" font-size="${size}" fill="${color}" x="${x}" y="${y}">${lines.map((line, i) => `<tspan x="${x}" dy="${i ? size * leading : 0}">${escaped(line)}</tspan>`).join("")}</text>` };
};
async function story(p, stage) {
  const palette = [design.themes.light, design.themes.dark, design.themes.green][stage];
  const margin = 80;
  let parts = "";
  if (stage === 0) parts += texts("devShark", "manrope-700", 42, margin, 260, palette.accent, 1).svg;
  else parts += `<image x="80" y="204" width="400" height="64" xlink:href="data:image/svg+xml;base64,${assets["devshark-logo-horizontal-white.svg"].toString("base64")}"/>`;
  parts += `<path d="M80 315 Q104 303 128 315 T176 315 T224 315 T272 315" fill="none" stroke="${palette.accent}" stroke-width="4"/>`;
  const correct = p.content.options.indexOf(p.content.answer);
  assert.ok(correct >= 0);
  const letter = String.fromCharCode(65 + correct);
  if (stage === 0) {
    const head = texts(label[p.content.category], "manrope-800", 76, margin, 432, palette.foreground, 2);
    parts += head.svg;
    const body = texts(authoredMarketingText(p.content.body, p.content.code), "inter-400", 46, margin, head.bottom + 84, palette.foreground, 8);
    parts += body.svg;
    if (p.content.code) {
      const y = body.bottom + 116;
      const code = texts(p.content.code, "jetbrains-mono-400", 32, margin + 32, y, design.code.foreground, 8, 856, true);
      assert.ok(code.bottom < 1610);
      parts += `<rect x="80" y="${y - 52}" width="920" height="${code.bottom - y + 96}" rx="12" fill="${design.code.background}"/>` + code.svg;
    }
  } else if (stage === 1) {
    const h = texts("Choose an answer", "manrope-800", 72, margin, 432, palette.foreground, 2);
    parts += h.svg;
    let y = h.bottom + 90;
    for (const [i, option] of p.content.options.entries()) {
      const block = texts(`${String.fromCharCode(65 + i)}. ${authoredMarketingText(option, null)}`, "inter-400", 46, margin, y, palette.foreground, 5);
      parts += block.svg;
      y = block.bottom + 94;
    }
    assert.ok(y < 1680, "story-options-overflow");
  } else {
    const h = texts(`Answer: ${letter}`, "manrope-800", 76, margin, 432, palette.foreground, 2);
    parts += h.svg;
    const answer = texts(authoredMarketingText(p.content.answer, null), "manrope-700", 52, margin, h.bottom + 100, palette.foreground, 4);
    parts += answer.svg;
    const explanation = texts(authoredMarketingText(p.content.explanation, p.content.code), "inter-400", 42, margin, answer.bottom + 84, palette.foreground, 16);
    assert.ok(explanation.bottom < 1660, "story-explanation-overflow");
    parts += explanation.svg;
  }
  parts += texts(`${stage + 1} / 3`, "inter-400", 34, margin, 1680, palette.muted, 1).svg;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1080" height="1920" viewBox="0 0 1080 1920"><rect width="1080" height="1920" fill="${palette.background}"/>${parts}</svg>`;
  const png = new Resvg(svg, { font: { loadSystemFonts: false, fontFiles, defaultFontFamily: faces["inter-400"].rasterFamily } }).render().asPng();
  const jpeg = await sharp(Buffer.from(png)).flatten({ background: palette.background }).jpeg({ quality: 92, chromaSubsampling: "4:4:4", progressive: false }).toBuffer();
  const info = await sharp(jpeg).metadata();
  assert.equal(info.width, 1080);
  assert.equal(info.height, 1920);
  assert.equal(info.format, "jpeg");
  return { svg, jpeg };
}
  const template = pendingMarketingTemplate("devshark");
  assert.equal(template.approved, false);
  const days = [];
  for (const [i, p] of packets.entries()) {
    const date = dates[i];
    const caption = suppliedCaptions?.[i] ?? `Choose an answer before you swipe.\n\nPractise ${label[p.content.category]} on devShark:\n${p.canonicalUrl}`;
    const slides = weeklySlides(p, authoredMarketingText);
    const revision = parseContentRevision({ schemaVersion: "marketing-content/1", brand: "devshark", title: p.content.title, caption, format: "carousel", sources: [{ sourceId: p.sourceId, sourceRevision: p.sourceRevision, contentHash: p.contentHash }], knowledgeIds: [], assets: [], account: { id: "unconnected-private-offline-preview", platform: "instagram", handle: "devshark" }, scheduledAt: `${date}T12:00:00.000Z`, timeZone: "Europe/Prague", templateVersion: template.version, promptVersion: "authored-weekly-offline-draft/1", model: "none-offline-authored", traceId: null });
    let rendered;
    try {
      rendered = await renderMarketingPreview({ draft: { revision, slides }, template, revisionId: randomUUID() });
    } catch (e) {
      console.log({ day: date, sourceId: p.sourceId, renderHeldCode: e.code ?? "unknown" });
      throw e;
    }
    const carouselAssets = [];
    for (const [n, slide] of rendered.entries()) {
      carouselAssets.push({ ...write(`${date}/instagram-${n + 1}.jpg`, slide.jpeg), width: 1080, height: 1350, svg: write(`${date}/instagram-${n + 1}.svg`, slide.svg), status: "draft", alt: slide.alt });
    }
    saveJson(`${date}/source.json`, p);
    saveJson(`${date}/instagram-authored-slides.json`, slides);
    write(`${date}/instagram-caption.txt`, caption + "\n");
    const {question,answer} = weeklyThreads(p);
    for(const text of [question,answer])parseContentRevision({...revision,format:"thread",caption:text,account:{id:"unconnected-private-offline-preview",platform:"threads",handle:"devshark"}});
    const threads = [{ ...write(`${date}/threads-question.txt`, question), role: "question", format:"thread", title:p.content.title, utf8Bytes:Buffer.byteLength(question,"utf8"), codepoints: [...question].length, status: "draft" }, { ...write(`${date}/threads-answer.txt`, answer), role: "answer", format:"thread", title:p.content.title, utf8Bytes:Buffer.byteLength(answer,"utf8"), codepoints: [...answer].length, status: "draft" }];
    const stories = [];
    for (let n = 0; n < 3; n++) {
      const frame = await story(p, n);
      stories.push({ ...write(`${date}/story-${n + 1}.jpg`, frame.jpeg), width: 1080, height: 1920, svg: write(`${date}/story-${n + 1}.svg`, frame.svg), role: ["question", "options", "answer"][n], status: "draft", templateApproved: false });
    }
    days.push({ date, sourceId: p.sourceId, sourceRevision: p.sourceRevision, contentHash: p.contentHash, sourceObservedAt: p.observedAt, category: p.content.category, caption, instagram: { status: "draft", templateVersion: template.version, templateSha256: template.templateSha256, slides: carouselAssets }, threads, stories });
  }
  const contact = async (name, rows, width, height) => {
    const tiles = [];
    for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) {
      const image = await sharp(path.join(output, rows[y][x].file)).resize(width, height, { fit: "contain", background: "#dae1dc" }).toBuffer();
      tiles.push({ input: image, left: x * (width + 12), top: y * (height + 12) });
    }
    return write(name, await sharp({ create: { width: rows[0].length * (width + 12) - 12, height: rows.length * (height + 12) - 12, channels: 3, background: "#dae1dc" } }).composite(tiles).jpeg({ quality: 90 }).toBuffer());
  };
  const contacts = [await contact("carousel-contact-sheet.jpg", days.map((d) => d.instagram.slides), 270, 338), await contact("story-contact-sheet.jpg", days.map((d) => d.stories), 216, 384)];
  const manifest = { schemaVersion: "devshark-private-weekly-drafts/1", status: "draft", week: { startsOn: dates[0], endsOn: dates[6], timeZone: "Europe/Prague" }, counts: { sourceItems: 7, instagramPosts: 7, instagramJpegs: days.reduce((n, d) => n + d.instagram.slides.length, 0), threadsPosts: 14, storyJpegs: 21, logicalDeliverables: 42 }, sourceAuthority: "Caller-provided SourcePackets. The offline builder performs no live DB/export verification.", inputSha256: sha(inputBytes), sourceProof, requiresFreshSourceRecheck:true, sourceApproval: false, readyRevisionPersisted: false, published: false, providerCalls: 0, storageCalls: 0, modelCalls: 0, carousel: "Existing Own renderer and pinned source-approved visual tokens. Preview only; no final post approval.", stories: { template: "new 1080x1920 SVG layout derived from approved devShark palette/Manrope/Inter/JetBrains Mono/logo assets", templateApproved: false, safeArea: { top: 204, bottom: 1680 }, requiresOwnerVisualApproval: true }, sourceWords: "Questions/options/code/answer/explanations retained exactly in metadata/text posts; only Markdown formatting markers removed for graphics with existing authoredMarketingText helper.", captionEditing: { skill: "templates/marketing/humanizer/SKILL.md", version: "3.1.0", mode: "embedded", scope: "manual intros/captions/CTA only; immutable exercises unchanged; supplied captions require editorial review", externalModelCalls: 0 }, scientificReview: "Owner reviews source semantics separately; no source code is executed by this builder.", contacts, days };
  saveJson("manifest.json", manifest);
  const cards = days.map((d) => `<section><h2>${d.date} \xB7 ${escaped(label[d.category])}</h2><p>${escaped(d.sourceId)} \xB7 Draft</p><h3>Instagram carousel</h3><div class="carousel">${d.instagram.slides.map((a) => `<a href="${a.file}"><img loading="lazy" src="${a.file}" alt="${escaped(a.alt)}"></a>`).join("")}</div><pre>${escaped(d.caption)}</pre><h3>Threads</h3><div class="threads">${d.threads.map((t) => `<article><p>${t.role} \xB7 ${t.codepoints}/500 codepoints · ${t.utf8Bytes}/500 UTF-8 bytes</p><pre>${escaped(fs.readFileSync(path.join(output, t.file), "utf8"))}</pre></article>`).join("")}</div><h3>Stories \xB7 new layout draft</h3><div class="stories">${d.stories.map((s) => `<a href="${s.file}"><img loading="lazy" src="${s.file}" alt="${escaped(s.role + " \xB7 " + label[d.category])}"></a>`).join("")}</div><p><a href="${escaped(packets.find((p) => p.sourceId === d.sourceId).canonicalUrl)}" target="_blank" rel="noopener noreferrer">Practice source category</a></p></section>`).join("");
  write("index.html", `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'"><title>devShark drafts \xB7 ${dates[0]} to ${dates[6]}</title><style>body{margin:0;background:#f3f6f1;color:#132019;font:16px/1.55 system-ui,sans-serif}main{max-width:1280px;margin:auto;padding:32px}h1{font-size:32px}h2{margin:0 0 8px}section{margin-top:32px;padding-top:24px;border-top:1px solid #9db3bc}.carousel,.stories{display:grid;gap:12px}.carousel{grid-template-columns:repeat(4,minmax(0,1fr))}.stories{grid-template-columns:repeat(3,minmax(0,1fr));max-width:850px}.threads{display:grid;grid-template-columns:1fr 1fr;gap:24px}img{display:block;width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:15px/1.6 ui-monospace,monospace}a{color:#236123}a:focus-visible{outline:3px solid #236123;outline-offset:4px}@media(max-width:700px){main{padding:16px}.carousel{grid-template-columns:repeat(2,minmax(0,1fr))}.threads{grid-template-columns:1fr}.stories{grid-template-columns:1fr}}</style><main><h1>devShark \xB7 ${dates[0]} to ${dates[6]}</h1><p>Private drafts for owner review. Seven Instagram carousels, fourteen Threads posts and twenty-one Stories.</p><p>Every post requires source recheck and owner approval before scheduling or publishing. Stories use a new unapproved layout. Provided source observation: ${escaped(packets[0].observedAt)}. The offline builder has not rechecked the live source.</p><p><a href="manifest.json">Source/byte hashes and review evidence</a> \xB7 <a href="carousel-contact-sheet.jpg">Carousel contact sheet</a> \xB7 <a href="story-contact-sheet.jpg">Story contact sheet</a></p>${cards}</main></html>`);
  return {output,...manifest.counts,threadsMaxCodepoints:Math.max(...days.flatMap(day=>day.threads.map(text=>text.codepoints))),status:"draft",modelCalls:0,published:false};
 } finally {globalThis.fetch=originalFetch;if(cwd!==repo)process.chdir(cwd)}
}
if(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 buildWeeklyOffline(parseWeeklyOptions(process.argv.slice(2))).then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error("Offline draft preparation held. Verify seven eligible source packets, source/text hashes, Sunday dates, text fit and a new private output path. No provider or publication calls were made.");process.exitCode=1});
}
