// Third-party notices for the installer (docs/licenses.md): every Rust crate the app ships (cargo-about, rules in
// about.toml) + the interface's production packages and fonts (node_modules). Writes src-tauri/third-party-licenses.html,
// bundled by tauri.conf.json › bundle.resources, opened from Settings › About. Needs cargo-about.
// Usage: node scripts/notices.mjs [target triple, default = this machine's]
import { execFileSync, execSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const OUT = 'src-tauri/third-party-licenses.html'
const target = process.argv[2] ?? /^host: (.+)$/m.exec(execFileSync('rustc', ['-vV'], { encoding: 'utf8' }))[1].trim()
const { version } = JSON.parse(readFileSync('package.json', 'utf8'))

// --fail: crate whose license can't be read = error, not a silent hole. --locked: must match Cargo.lock.
// -o file, not stdout: cargo-about refuses a redirected stdout under PowerShell (GitHub's Windows shell).
const json = join(mkdtempSync(join(tmpdir(), 'notices-')), 'about.json')
execFileSync('cargo', ['about', 'generate', '--format', 'json', '--locked', '--fail', '--target', target, '-m', 'src-tauri/Cargo.toml', '-o', json], { stdio: ['ignore', 'inherit', 'inherit'] })
const about = JSON.parse(readFileSync(json, 'utf8'))
rmSync(dirname(json), { recursive: true })
const npm = JSON.parse(execSync('pnpm licenses list --prod --json', { encoding: 'utf8', maxBuffer: 1 << 26 }))

/** name@version → { name, version, kind, authors, source, repo, licenses: Set(id) } */
const parts = new Map()
/** Same text (whitespace aside) once: key → { id, name, text, users: Set(part key) } */
const texts = new Map()

const clean = (t) => t.replace(/\r\n?/g, '\n').replace(/^\n+|\s+$/g, '')
function addText(id, name, text, user) {
  const key = `${id}\n${text.replace(/\s+/g, ' ').trim()}`
  if (!texts.has(key)) texts.set(key, { id, name, text: clean(text), users: new Set() })
  texts.get(key).users.add(user)
  parts.get(user).licenses.add(id)
}
/** [name, text] of the files in dir whose name matches (LICENSE.spdx = metadata, not a text). */
const filesIn = (dir, name) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && name.test(e.name) && !/\.spdx$/i.test(e.name))
    .map((e) => [e.name, readFileSync(join(dir, e.name), 'utf8')])

// cargo-about misses license files named outside its patterns (license-mit, LICENSE_MIT) and stands in the bare SPDX
// text, without copyright line. The crate's own file instead when one has that license.
const FINGERPRINT = {
  MIT: /above copyright notice and this permission notice shall be included/i,
  'Apache-2.0': /Apache License,?\s+Version 2\.0/i,
  'BSD-3-Clause': /Neither the name/i,
  ISC: /Permission to use, copy, modify, and\/or distribute/i,
}
const ownText = (crate, id) => FINGERPRINT[id] && filesIn(dirname(crate.manifest_path), /^(licen[cs]e|copying)/i).find(([, t]) => FINGERPRINT[id].test(t))?.[1]

for (const { package: p } of about.crates) {
  parts.set(`${p.name}@${p.version}`, {
    name: p.name,
    version: p.version,
    kind: 'rust',
    authors: p.authors.map((a) => a.replace(/\s*<[^>]*>/, '')),
    source: `https://crates.io/crates/${p.name}/${p.version}`,
    repo: p.repository,
    licenses: new Set(),
  })
}
for (const l of about.licenses) for (const { crate: c } of l.used_by) addText(l.id, l.name, (!l.source_path && ownText(c, l.id)) || l.text, `${c.name}@${c.version}`)
// Apache-2.0 §4(d): NOTICE files travel with the work. cargo-about skips them.
for (const { package: p } of about.crates) {
  for (const [f, text] of filesIn(dirname(p.manifest_path), /^notice/i)) addText('NOTICE', `${f} of ${p.name}`, text, `${p.name}@${p.version}`)
}

// Packages without a license file (Tauri plugins ship LICENSE.spdx only): canonical text cargo-about made from SPDX.
const canonical = new Map(about.licenses.filter((l) => !l.source_path).map((l) => [l.id, l]))
const names = new Map([['OFL-1.1', 'SIL Open Font License 1.1'], ['CC0-1.0', 'Creative Commons Zero v1.0 Universal'], ...about.licenses.map((l) => [l.id, l.name])])
for (const [expression, pkgs] of Object.entries(npm)) {
  for (const p of pkgs) {
    p.versions.forEach((v, i) => {
      const key = `${p.name}@${v}`
      parts.set(key, {
        name: p.name,
        version: v,
        kind: 'js',
        authors: p.author ? [p.author] : [],
        source: `https://www.npmjs.com/package/${p.name}/v/${v}`,
        repo: p.homepage,
        licenses: new Set(),
      })
      const files = filesIn(p.paths[i], /^(licen[cs]e|copying|notice)/i)
      for (const [f, text] of files) {
        const notice = /^notice/i.test(f)
        addText(notice ? 'NOTICE' : expression, notice ? `${f} of ${p.name}` : (names.get(expression) ?? expression), text, key)
      }
      if (files.length) return
      const known = expression
        .split(/ OR | AND /)
        .map((id) => canonical.get(id.replace(/[()]/g, '')))
        .find(Boolean)
      if (!known) throw new Error(`${key} (${expression}): no license file and no canonical text. Add one to scripts/notices.mjs.`)
      addText(known.id, known.name, known.text, key)
    })
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const link = (href, text) => (href ? `<a href="${esc(href)}">${esc(text)}</a>` : esc(text))
const sorted = [...parts.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version, undefined, { numeric: true }))
const textList = [...texts.values()].sort((a, b) => a.id.localeCompare(b.id) || b.users.size - a.users.size)
textList.forEach((t, i) => (t.anchor = `t${i + 1}`))
const anchorsOf = (key) => textList.filter((t) => t.users.has(key))
const keyOf = (p) => `${p.name}@${p.version}`
const mpl = sorted.filter((p) => p.licenses.has('MPL-2.0'))

const row = (p) =>
  `<tr><td>${link(p.source, p.name)}</td><td>${esc(p.version)}</td><td>${[...new Map(anchorsOf(keyOf(p)).map((t) => [t.id, t])).values()]
    .map((t) => `<a href="#${t.anchor}">${esc(t.id)}</a>`)
    .join(', ')}</td><td>${p.authors.length ? esc(p.authors.join(', ')) : p.repo ? link(p.repo, 'see repository') : ''}</td></tr>`
const section = (t) =>
  `<section id="${t.anchor}"><h3>${esc(t.name)}</h3><p class="used">Used by ${[...t.users]
    .sort()
    .map((k) => esc(k))
    .join(', ')}</p><pre>${esc(t.text)}</pre></section>`

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Music App ${esc(version)} · Third-party licenses</title>
<style>
:root { color-scheme: light dark; font: 14px/1.5 system-ui, sans-serif; }
body { max-width: 960px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 24px; } h2 { margin-top: 40px; font-size: 18px; } h3 { font-size: 15px; margin-bottom: 4px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; vertical-align: top; padding: 4px 8px; border-bottom: 1px solid #8884; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; padding: 12px; background: #8881; border-radius: 6px; }
.used { margin: 0; font-size: 12px; opacity: 0.75; }
section { margin-top: 24px; }
</style>
</head>
<body>
<h1>Third-party licenses</h1>
<p>Music App ${esc(version)} is built on the open-source components below. Each keeps its own license: the full texts
follow the list, with their copyright lines. Built for ${esc(target)} from Cargo.lock and pnpm-lock.yaml.</p>

<h2>Source code of the MPL-2.0 components</h2>
<p>These components are under the Mozilla Public License 2.0 and are used unmodified. Their source code is at the
links below. The license text is in <a href="#${textList.find((t) => t.id === 'MPL-2.0')?.anchor ?? ''}">License texts</a>.</p>
<ul>
${mpl.map((p) => `<li>${esc(p.name)} ${esc(p.version)}: ${link(p.source, 'crates.io')}${p.repo ? `, ${link(p.repo, 'repository')}` : ''}</li>`).join('\n')}
</ul>

<h2>Components (${sorted.length})</h2>
<table>
<thead><tr><th>Name</th><th>Version</th><th>License</th><th>Authors</th></tr></thead>
<tbody>
${sorted.map(row).join('\n')}
</tbody>
</table>

<h2>License texts (${textList.length})</h2>
${textList.map(section).join('\n')}
</body>
</html>
`

writeFileSync(OUT, html)
const rust = sorted.filter((p) => p.kind === 'rust').length
console.log(`${OUT}: ${rust} crates, ${sorted.length - rust} packages, ${textList.length} license texts, ${Math.round(html.length / 1024)} KB`)
