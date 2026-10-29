import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const out = path.join(root, 'docs/reports/dneskai-code-ux-audit-2026-10-23');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const file = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(file) : [file];
});
const relative = (file) => path.relative(root, file).replaceAll(path.sep, '/');
const lineOf = (source, node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

function inspect(file) {
  const text = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const imports = [], controls = [], headings = [], literals = [], classes = [];
  const hooks = {};
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^use[A-Z]/.test(node.expression.text)) hooks[node.expression.text] = (hooks[node.expression.text] ?? 0) + 1;
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
      const literal = (name) => {
        const attr = attrs.find((a) => a.name.getText(source) === name);
        return attr && ts.isStringLiteral(attr.initializer) ? attr.initializer.text : null;
      };
      const className = literal('className');
      if (className) classes.push({ line: lineOf(source, node), value: className });
      if (/^(button|Button|Input|input|select|SimpleSelect|textarea|Textarea|Switch)$/.test(tag)) controls.push({ tag, line: lineOf(source, node), size: literal('size'), className, ariaLabel: literal('aria-label') });
      if (/^h[1-6]$/.test(tag)) headings.push({ tag, line: lineOf(source, node) });
    }
    if (ts.isJsxText(node)) {
      const value = node.text.replace(/\s+/g, ' ').trim();
      if (value.length > 3) literals.push({ text: value, line: lineOf(source, node) });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  const byText = Map.groupBy(literals, (item) => item.text);
  return {
    path: relative(file), lines: text.split('\n').length, bytes: Buffer.byteLength(text),
    client: /^['"]use client['"]/.test(text.trimStart()), imports, hooks, controls, headings,
    layoutClasses: classes.filter((entry) => /grid|flex|w-full|max-w|items-|justify-|space-y|gap-/.test(entry.value)),
    repeatedLiteralCandidates: [...byText].filter(([, items]) => items.length > 1).map(([value, items]) => ({ value, lines: items.map((item) => item.line) })),
    rawButtonCount: controls.filter((c) => c.tag === 'button').length,
    sharedButtonCount: controls.filter((c) => c.tag === 'Button').length,
    explicitHeightControls: controls.filter((c) => c.className && /(?:^|\s)(?:[a-z]+:)?(?:min-)?(?:h|size)-/.test(c.className)),
    note: 'AST inventory only; repeated literals and explicit sizes require contextual review.',
  };
}

const components = walk(path.join(root, 'src/components')).filter((file) => /\.[tj]sx?$/.test(file)).sort().map(inspect);
const libraries = walk(path.join(root, 'src/lib/marketing')).filter((file) => file.endsWith('.ts')).sort().map(inspect);
const routes = walk(path.join(root, 'src/app/api/marketing')).filter((file) => file.endsWith('.ts')).sort().map(inspect);
const migrations = walk(path.join(root, 'supabase/migrations')).filter((file) => file.endsWith('.sql') && /marketing|dneskai/i.test(fs.readFileSync(file, 'utf8'))).sort().map((file) => ({ path: relative(file), lines: fs.readFileSync(file, 'utf8').split('\n').length }));
const inventory = {
  baseline: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  date: '2026-10-23', scope: 'All application component source files; marketing libraries/routes; marketing-related migrations.',
  counts: { componentFiles: components.length, marketingLibraries: libraries.length, marketingRoutes: routes.length, marketingMigrations: migrations.length },
  components, libraries, routes, migrations,
};
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
console.log(JSON.stringify(inventory.counts));
