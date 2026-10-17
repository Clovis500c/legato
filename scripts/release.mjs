// Release version and notes (CI: .github/workflows/release.yml). Version = MAJOR.MINOR from src-tauri/tauri.conf.json
// + patch = commits on this branch: every push gets a higher one. Written into tauri.conf.json and package.json (CI copy,
// never committed). Notes = feat / fix / perf subjects since the last v* tag: the app's update card shows them.
// Usage: node scripts/release.mjs [--dry-run]   (--dry-run: print, write nothing)
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'

const CONF = 'src-tauri/tauri.conf.json'
const MAX_NOTES = 20
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

if (git('rev-parse', '--is-shallow-repository') === 'true') throw new Error('Shallow clone: patch number needs the full history (fetch-depth: 0)')
const [major, minor] = JSON.parse(readFileSync(CONF, 'utf8')).version.split('.')
const version = `${major}.${minor}.${git('rev-list', '--count', 'HEAD')}`

let previous = ''
try {
  previous = git('describe', '--tags', '--abbrev=0', '--match', 'v*')
} catch {
  // First release.
}
const notes = notesFrom(git('log', '--no-merges', '--format=%s', previous ? `${previous}..HEAD` : 'HEAD').split('\n'))

/** "feat(player): smoother fades" → "Smoother fades". Other kinds (docs, ci, chore…) left out. */
export function notesFrom(subjects) {
  const lines = subjects
    .map((s) => /^(?:feat|fix|perf)(?:\([^)]*\))?!?:\s*(.+)$/.exec(s.trim())?.[1])
    .filter(Boolean)
    .map((s) => `- ${s[0].toUpperCase()}${s.slice(1)}`)
  if (!lines.length) return 'Small fixes and improvements.'
  return lines.length > MAX_NOTES ? [...lines.slice(0, MAX_NOTES), `- And ${lines.length - MAX_NOTES} more`].join('\n') : lines.join('\n')
}

if (!process.argv.includes('--dry-run')) {
  for (const file of [CONF, 'package.json']) {
    writeFileSync(file, readFileSync(file, 'utf8').replace(/"version": "[^"]*"/, `"version": "${version}"`))
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nnotes<<NOTES_END\n${notes}\nNOTES_END\n`)
}
console.log(`v${version} (since ${previous || 'the start'})\n${notes}`)
