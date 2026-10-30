// Promotes a beta to Stable (CI: .github/workflows/promote.yml, run by hand). Every green push is a prerelease
// (release.yml); Stable is what `releases/latest/download/latest.json` serves, the file every installed version reads, and
// GitHub's "latest" skips prereleases. So promoting = giving the prerelease the notes of everything since the previous
// Stable, then making it a normal, Latest release. The minisign signature covers the installer, not latest.json: the notes
// can change. Nothing is touched when the checks fail; the last step is the switch, so a failed run can run again.
// Usage: node scripts/promote.mjs [version] [--dry-run]   (version like 1.0.375, empty: the newest beta; --dry-run: change nothing)
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { notesFrom } from './notes.mjs'

/** "v1.0.375" → [1, 0, 375]. The rolling "beta" release and anything else → null. */
export function parseTag(tag) {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag ?? '')
  return m ? m.slice(1).map(Number) : null
}

/** Sort order of two version tags (negative: a is older). */
export function compareTags(a, b) {
  const [x, y] = [parseTag(a), parseTag(b)]
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
}

/** "1.0.375" or "v1.0.375" → "v1.0.375". */
export function toTag(version) {
  const v = version.trim()
  const tag = v.startsWith('v') ? v : `v${v}`
  if (!parseTag(tag)) throw new Error(`"${version}" is not a version like 1.0.375`)
  return tag
}

/** The highest version among the prereleases (gh's tagName, isPrerelease, isDraft), or undefined. */
export function newestBeta(releases) {
  return releases.filter((r) => r.isPrerelease && !r.isDraft && parseTag(r.tagName)).sort((a, b) => compareTags(b.tagName, a.tagName))[0]
}

/** Why `release` can't become Stable after `stableTag` (undefined: it can). */
export function refusal(release, stableTag) {
  if (release.isDraft) return `${release.tagName} is a draft`
  if (!release.isPrerelease) return `${release.tagName} is already Stable`
  if (stableTag && compareTags(release.tagName, stableTag) <= 0) return `${release.tagName} is not newer than the current Stable, ${stableTag}`
  return undefined
}

/** latest.json with `notes` replaced. Throws when it isn't a complete updater file for `version`: nothing broken becomes Stable. */
export function withNotes(text, version, notes) {
  const file = JSON.parse(text)
  const platforms = Object.values(file.platforms ?? {})
  if (String(file.version).replace(/^v/, '') !== version || !platforms.length || platforms.some((p) => !p?.url || !p?.signature)) {
    throw new Error(`latest.json of v${version} is not a complete updater file`)
  }
  return `${JSON.stringify({ ...file, notes }, null, 2)}\n`
}

const run = (cmd, ...args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()
const view = (...tag) => JSON.parse(run('gh', 'release', 'view', ...tag, '--json', 'tagName,isPrerelease,isDraft'))

function main(argv) {
  const dry = argv.includes('--dry-run')
  const input = argv.find((a) => !a.startsWith('--'))?.trim()
  // The current Stable = GitHub's Latest, what installed versions are served.
  let stable
  try {
    stable = view().tagName
  } catch {
    // No normal release yet: any beta can be the first.
  }
  const tag = input ? toTag(input) : newestBeta(JSON.parse(run('gh', 'release', 'list', '--exclude-drafts', '--limit', '200', '--json', 'tagName,isPrerelease,isDraft')))?.tagName
  if (!tag) throw new Error('No beta to promote')
  const why = refusal(view(tag), stable)
  if (why) throw new Error(why)

  const notes = notesFrom(run('git', 'log', '--no-merges', '--format=%s', stable ? `${stable}..${tag}` : tag).split('\n'))
  const dir = mkdtempSync(join(tmpdir(), 'promote-'))
  const file = join(dir, 'latest.json')
  run('gh', 'release', 'download', tag, '--pattern', 'latest.json', '--dir', dir)
  const manifest = withNotes(readFileSync(file, 'utf8'), tag.slice(1), notes)
  console.log(`${tag} becomes Stable (now ${stable ?? 'none'})\n${notes}`)
  if (dry) return

  writeFileSync(file, manifest)
  const notesFile = join(dir, 'notes.md')
  writeFileSync(notesFile, notes)
  run('gh', 'release', 'upload', tag, file, '--clobber')
  run('gh', 'release', 'edit', tag, '--notes-file', notesFile)
  // Last: until here it is still a prerelease and nobody's update changes.
  run('gh', 'release', 'edit', tag, '--prerelease=false', '--latest')
  console.log(`${tag} is Stable`)
}

// Run as a script, not when a test imports the functions.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2))
  } catch (e) {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  }
}
