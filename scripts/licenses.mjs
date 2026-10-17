// Licenses of the interface's bundled packages (prod dependencies only). Fails on one not allowed here.
// Rust side: deny.toml. Why each license is fine: docs/licenses.md.
import { execSync } from 'node:child_process'

const ALLOWED = new Set(['0BSD', 'Apache-2.0', 'Apache-2.0 OR MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'CC0-1.0', 'ISC', 'MIT', 'MIT OR Apache-2.0', 'OFL-1.1'])

const byLicense = JSON.parse(execSync('pnpm licenses list --prod --json', { encoding: 'utf8' }))
const bad = Object.entries(byLicense).filter(([license]) => !ALLOWED.has(license))
for (const [license, pkgs] of Object.entries(byLicense)) console.log(`${bad.some(([l]) => l === license) ? 'NOT ALLOWED' : 'ok'}  ${license}: ${pkgs.map((p) => p.name).join(', ')}`)
if (bad.length) {
  console.error('\nLicense not allowed. Check it (docs/licenses.md), then add it to ALLOWED in scripts/licenses.mjs.')
  process.exit(1)
}
