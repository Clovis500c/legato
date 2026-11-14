// Release version and notes (CI: .github/workflows/release.yml). Version = MAJOR.MINOR from src-tauri/tauri.conf.json
// + n = commits since that MAJOR.MINOR's base (BASES below): patch = n % 1000 and the minor one up per 1000 (versionOf),
// higher with every push, back to 0 after a bump.
// Written into tauri.conf.json and package.json (CI copy, never committed). Notes = feat / fix / perf subjects since the
// last v* tag (the previous beta): the app's update card shows them. A Stable gets longer ones when it is promoted
// (scripts/promote.mjs).
// Usage: node scripts/release.mjs [--dry-run]   (--dry-run: print, write nothing)
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { notesFrom } from './notes.mjs'

/**
 * MAJOR.MINOR → the last commit before its bump; the patch counts the commits after it. A bump adds a line here in the
 * same commit (CONTRIBUTING.md › Version). Up to 1.1 the patch was every commit on master (1.1.994 the last).
 */
export const BASES = { '1.2': 'f8379a93452b543b0e39c2693d6dda6d37930098' }

/**
 * The release version from the file's MAJOR.MINOR ("1.2") and n = commits since its base: patch = n % 1000, the minor
 * rising by one each 1000 (n=999 → 1.2.999, n=1000 → 1.3.0, n=2500 → 1.4.500). Android's versionCode is
 * major·1 000 000 + minor·1 000 + patch: a patch past 999 would run into the next minor's, a bare % 1000 would go back.
 */
export function versionOf(majorMinor, n) {
  if (!BASES[majorMinor]) throw new Error(`No base commit for ${majorMinor} in scripts/release.mjs BASES: add the commit before the bump`)
  const [major, minor] = majorMinor.split('.').map(Number)
  return `${major}.${minor + Math.floor(n / 1000)}.${n % 1000}`
}

const CONF = 'src-tauri/tauri.conf.json'
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

function release() {
  if (git('rev-parse', '--is-shallow-repository') === 'true') throw new Error('Shallow clone: patch number needs the full history (fetch-depth: 0)')
  const majorMinor = JSON.parse(readFileSync(CONF, 'utf8')).version.split('.').slice(0, 2).join('.')
  const base = BASES[majorMinor]
  if (!base) versionOf(majorMinor, 0) // throws: no base for this MAJOR.MINOR
  try {
    git('merge-base', '--is-ancestor', base, 'HEAD')
  } catch {
    throw new Error(`Base ${base} of ${majorMinor} is not in this branch's history`)
  }
  const version = versionOf(majorMinor, Number(git('rev-list', '--count', `${base}..HEAD`)))

  let previous = ''
  try {
    previous = git('describe', '--tags', '--abbrev=0', '--match', 'v*')
  } catch {
    // First release.
  }
  const notes = notesFrom(git('log', '--no-merges', '--format=%s', previous ? `${previous}..HEAD` : 'HEAD').split('\n'))

  if (!process.argv.includes('--dry-run')) {
    for (const file of [CONF, 'package.json']) {
      writeFileSync(file, readFileSync(file, 'utf8').replace(/"version": "[^"]*"/, `"version": "${version}"`))
    }
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nnotes<<NOTES_END\n${notes}\nNOTES_END\n`)
  }
  console.log(`v${version} (since ${previous || 'the start'})\n${notes}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) release()
