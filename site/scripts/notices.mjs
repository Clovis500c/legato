// The website's third-party notices: minified bundles lose the license comments that MIT and the like ask to keep,
// so every production package's license text goes to public/third-party-licenses.txt (linked from the footer).
// Runs with each build (package.json); build-only packages are listed too, which costs nothing.
import { execSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const list = JSON.parse(execSync('pnpm licenses list --prod --json', { encoding: 'utf8', maxBuffer: 1 << 26 }))
const parts = Object.entries(list)
  .flatMap(([license, pkgs]) => pkgs.map((p) => ({ ...p, license })))
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((p) => {
    const dir = p.paths[0]
    const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)/i.test(f))
    const text = file ? readFileSync(join(dir, file), 'utf8').replace(/\r\n?/g, '\n').trim() : `License: ${p.license}`
    return `${p.name} ${p.versions.join(', ')} (${p.license})${p.homepage ? `\n${p.homepage}` : ''}\n\n${text}`
  })
writeFileSync('public/third-party-licenses.txt', `Legato website: third-party software\n\n${parts.join(`\n\n${'-'.repeat(80)}\n\n`)}\n`)
console.log(`third-party-licenses.txt: ${parts.length} packages`)
