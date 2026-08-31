// The docs site registers a language in four separate places, and every one of
// them degrades silently when a language is missing from it:
//
//   docs/_data/i18n.yml     a missing key renders as empty chrome
//   docs/_config.yml        a missing path scope tags the pages `lang: zh`,
//                           i.e. Chinese chrome around a translated body
//   docs/index.html         a missing dictionary key leaves the English string
//                           in place, and a language in META but not I18N puts
//                           a dead entry in the switcher
//   docs/<lang>/index.html  a language directory with no index 404s
//
// None of this is covered by anything else: the site is plain Jekyll with no
// tests, and a build that is missing every one of these still succeeds. This
// project has already shipped that exact class of bug twice — a hardcoded
// (en|zh|ja) in the client's preload plugin, and a bare /en/ that 404'd.
//
// Run: bun .github/scripts/check-docs-i18n.mjs
//
// YAML comes through ruby's stdlib rather than a node package: Jekyll is ruby,
// so it is already a hard requirement of this directory, and this stays free of
// a dependency added for one check.

import { existsSync, readFileSync } from 'node:fs';

const problems = [];
const fail = (msg) => problems.push(msg);

function loadYaml(path) {
  const out = Bun.spawnSync([
    'ruby',
    '-ryaml',
    '-rjson',
    '-e',
    'puts YAML.load_file(ARGV[0]).to_json',
    path,
  ]);
  if (out.exitCode !== 0) throw new Error(`ruby failed on ${path}: ${out.stderr.toString()}`);
  return JSON.parse(out.stdout.toString());
}

const sameSet = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---- docs/_data/i18n.yml : chrome strings and the doc nav ------------------
const i18n = loadYaml('docs/_data/i18n.yml');
const languages = Object.keys(i18n);
const chromeKeys = Object.keys(i18n.en).sort();
const docFiles = i18n.en.docs.map((d) => d.file);

for (const [lng, block] of Object.entries(i18n)) {
  const keys = Object.keys(block).sort();
  if (!sameSet(keys, chromeKeys)) {
    fail(`i18n.yml: ${lng} key set differs from en (${keys.join(',')})`);
  }
  for (const [k, v] of Object.entries(block)) {
    if (k !== 'docs' && String(v ?? '').trim() === '') fail(`i18n.yml: ${lng}.${k} is empty`);
  }
  if (!['ltr', 'rtl'].includes(block.dir)) fail(`i18n.yml: ${lng}.dir is ${block.dir}`);
  const files = (block.docs ?? []).map((d) => d.file);
  // Same documents in the same order: the sidebar numbers them 01..09 by
  // position, so a reordered list renumbers the docs for that language alone.
  if (!sameSet(files, docFiles)) fail(`i18n.yml: ${lng}.docs differs from en`);
  for (const d of block.docs ?? []) {
    if (String(d.name ?? '').trim() === '') fail(`i18n.yml: ${lng}.docs ${d.file} has no name`);
  }
}

// ---- docs/_config.yml : which directory is which language -----------------
const config = loadYaml('docs/_config.yml');
const scoped = new Set(config.defaults.map((d) => d.scope.path).filter(Boolean));
for (const lng of languages) {
  if (lng === 'zh') continue; // Chinese is the canonical text and lives at the root.
  if (!scoped.has(lng))
    fail(`_config.yml: no path scope for '${lng}', its pages would be lang: zh`);
  if (!existsSync(`docs/${lng}/index.html`)) fail(`docs/${lng}/ has no index.html — it will 404`);
}

// ---- docs/index.html : the landing page's own dictionary ------------------
const html = readFileSync('docs/index.html', 'utf8');

function jsObject(name) {
  const start = html.indexOf(`const ${name} = {`);
  if (start < 0) throw new Error(`docs/index.html: no '${name}' object`);
  const end = html.indexOf('\n  };', start);
  if (end < 0) throw new Error(`docs/index.html: '${name}' is not closed as expected`);
  // The input is a literal in this repo's own tracked source, read at lint time
  // on a developer's machine or a CI runner — never at runtime, and never from
  // anything a user supplies. The alternative is quoting the bare keys with a
  // regex to make it JSON, which would have to reach inside string values that
  // legitimately contain colons ("DID:web") to do it.
  // biome-ignore lint/security/noGlobalEval: repo-owned literal, lint-time only
  return eval(`(${html.slice(start + `const ${name} = `.length, end + 4)})`);
}

const I18N = jsObject('I18N');
const META = jsObject('META');

// All three lists are ordered by total speakers; keeping them equal is what
// makes _data/i18n.yml the single readable answer to "which languages ship".
if (!sameSet(Object.keys(I18N), languages)) {
  fail(
    `index.html: I18N languages ${Object.keys(I18N).join(',')} != i18n.yml ${languages.join(',')}`,
  );
}
if (!sameSet(Object.keys(META), languages)) {
  fail(
    `index.html: META languages ${Object.keys(META).join(',')} != i18n.yml ${languages.join(',')}`,
  );
}
for (const [lng, m] of Object.entries(META)) {
  if (i18n[lng] && m.label !== i18n[lng].label) {
    fail(`index.html: META.${lng}.label '${m.label}' != i18n.yml '${i18n[lng].label}'`);
  }
  if (i18n[lng] && m.rtl !== (i18n[lng].dir === 'rtl')) {
    fail(`index.html: META.${lng}.rtl disagrees with i18n.yml dir '${i18n[lng].dir}'`);
  }
}

const pageKeys = Object.keys(I18N.en).sort();
for (const [lng, dict] of Object.entries(I18N)) {
  const keys = Object.keys(dict).sort();
  const missing = pageKeys.filter((k) => !keys.includes(k));
  const extra = keys.filter((k) => !pageKeys.includes(k));
  if (missing.length) fail(`index.html: ${lng} is missing ${missing.join(', ')}`);
  if (extra.length) fail(`index.html: ${lng} has keys en does not: ${extra.join(', ')}`);
  for (const [k, v] of Object.entries(dict)) {
    if (String(v ?? '').trim() === '') fail(`index.html: ${lng}.${k} is empty`);
  }
}

// A key in the markup that no dictionary defines leaves that element showing
// whatever English happens to be hardcoded in the HTML, in every language.
const used = new Set([...html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)].map((m) => m[1]));
for (const k of used) {
  if (!pageKeys.includes(k)) fail(`index.html: markup uses '${k}', which no dictionary defines`);
}

if (problems.length) {
  console.error(`docs i18n: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(
  `docs i18n OK — ${languages.length} languages, ${chromeKeys.length} chrome keys, ` +
    `${pageKeys.length} landing-page keys, ${used.size} referenced in markup`,
);
