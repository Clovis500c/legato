// Licenses of the interface's bundled packages (prod dependencies only). Fails on one not allowed here.
// Rust side: deny.toml, which must allow what about.toml (installer notices) accepts. Why each license is fine:
// docs/licenses.md.
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const ALLOWED = new Set(['0BSD', 'Apache-2.0', 'Apache-2.0 OR MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'CC0-1.0', 'ISC', 'MIT', 'MIT OR Apache-2.0', 'OFL-1.1'])

const byLicense = JSON.parse(execSync('pnpm licenses list --prod --json', { encoding: 'utf8' }))
const bad = Object.entries(byLicense).filter(([license]) => !ALLOWED.has(license))
for (const [license, pkgs] of Object.entries(byLicense)) console.log(`${bad.some(([l]) => l === license) ? 'NOT ALLOWED' : 'ok'}  ${license}: ${pkgs.map((p) => p.name).join(', ')}`)
if (bad.length) {
  console.error('\nLicense not allowed. Check it (docs/licenses.md), then add it to ALLOWED in scripts/licenses.mjs.')
  process.exit(1)
}

/** Quoted strings of `key = [ … ]` in a TOML file, comments dropped. */
function tomlList(file, key) {
  const text = readFileSync(file, 'utf8').replace(/#.*$/gm, '')
  const body = new RegExp(`^${key}\\s*=\\s*\\[([^\\]]*)\\]`, 'm').exec(text)?.[1]
  if (body === undefined) throw new Error(`${file}: no ${key} list`)
  return new Set([...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]))
}
const deny = tomlList('deny.toml', 'allow')
const about = tomlList('about.toml', 'accepted')
const drift = [...[...deny].filter((l) => !about.has(l)).map((l) => `${l}: in deny.toml only`), ...[...about].filter((l) => !deny.has(l)).map((l) => `${l}: in about.toml only`)]
if (drift.length) {
  console.error(`\ndeny.toml › licenses.allow and about.toml › accepted differ:\n  ${drift.join('\n  ')}`)
  process.exit(1)
}
console.log(`ok  deny.toml and about.toml allow the same ${deny.size} licenses`)
